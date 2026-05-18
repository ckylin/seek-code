import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join, resolve, relative } from 'path';
import chalk from 'chalk';
import type { LLMProvider, Message, SeekCodeConfig } from '../types.js';
import type { ContextManager } from '../core/context/manager.js';
import { DEEPSEEK_MODELS } from './setup.js';
import { getSessionUsage, resetSessionUsage, addUsage } from '../core/agent/loop.js';
import { printBalanceAndUsage } from '../utils/billing.js';

export type SlashCommandResult =
  | { type: 'handled' }
  | { type: 'clear' }
  | { type: 'model_changed'; config: SeekCodeConfig }
  | { type: 'not_a_command' };

export async function handleSlashCommand(
  input: string,
  cwd: string,
  config: SeekCodeConfig,
  provider: LLMProvider,
  context: ContextManager,
): Promise<SlashCommandResult> {
  if (!input.startsWith('/')) return { type: 'not_a_command' };

  const [cmd, ...rest] = input.slice(1).split(' ');
  const args = rest.join(' ').trim();

  switch (cmd.toLowerCase()) {
    case 'help':
      printHelp(config);
      return { type: 'handled' };

    case 'clear':
      context.clear();
      console.log(chalk.gray('Context cleared.'));
      return { type: 'clear' };

    case 'compact':
      await compactContext(context, config, provider);
      return { type: 'handled' };

    case 'init':
      await runInit(cwd, config, provider, args);
      return { type: 'handled' };

    case 'model':
      return await switchModel(args, config);

    case 'cost':
      printSessionCost(config.model);
      return { type: 'handled' };

    case 'balance':
      await printBalanceAndUsage(config.apiKey, config.baseURL, config.model);
      return { type: 'handled' };

    default:
      console.log(chalk.yellow(`Unknown command: /${cmd}. Type /help for available commands.`));
      return { type: 'handled' };
  }
}

// ── /help ───────────────────────────────────────────────────────────────────

function printHelp(config: SeekCodeConfig): void {
  console.log(`
${chalk.bold('Slash Commands')}

  ${chalk.cyan('/init')}              Analyze the codebase and generate a SEEKCODE.md project guide
  ${chalk.cyan('/model')}             Switch model interactively
  ${chalk.cyan('/model <id>')}        Switch to a specific model  (e.g. /model deepseek-v4-pro)
  ${chalk.cyan('/cost')}              Show session token usage and cost (DeepSeek pricing)
  ${chalk.cyan('/balance')}           Show account balance, today's & this month's usage
  ${chalk.cyan('/help')}              Show this help message
  ${chalk.cyan('/clear')}             Clear conversation context
  ${chalk.cyan('/compact')}           Summarize and compress conversation history to save tokens

${chalk.bold('@ References')}

  ${chalk.cyan('@<file>')}        Inject file contents into your message  (e.g. @src/index.ts)
  ${chalk.cyan('@<directory>')}   Inject directory listing                (e.g. @src/)
  ${chalk.cyan('@<url>')}         Fetch and inject webpage content        (e.g. @https://example.com)

${chalk.bold('Current')}

  model: ${chalk.cyan(config.model)}${config.reasoningEffort ? chalk.gray(`  reasoning: ${config.reasoningEffort}`) : ''}

${chalk.bold('Other')}

  ${chalk.cyan('exit')} / ${chalk.cyan('quit')}   Exit Seek Code
  ${chalk.cyan('Ctrl+C')}         Interrupt a running task
`);
}

// ── /cost ───────────────────────────────────────────────────────────────────

// DeepSeek pricing (USD per 1M tokens) — updated 2025
const DEEPSEEK_PRICING: Record<string, { prompt: number; completion: number; cacheHit: number }> = {
  'deepseek-chat':     { prompt: 0.27, completion: 1.10, cacheHit: 0.07 },
  'deepseek-v4-flash': { prompt: 0.27, completion: 1.10, cacheHit: 0.07 },
  'deepseek-v4-pro':   { prompt: 0.27, completion: 1.10, cacheHit: 0.07 },
  'deepseek-reasoner': { prompt: 0.55, completion: 2.19, cacheHit: 0.14 },
};

// USD → CNY exchange rate (人民币)
const USD_TO_CNY = 7.25;

function formatDualCurrency(usdAmount: number): string {
  const cnyAmount = usdAmount * USD_TO_CNY;
  return chalk.yellow(`${usdAmount.toFixed(4)}`) + chalk.gray(` (¥${cnyAmount.toFixed(2)} RMB)`);
}

function printSessionCost(model: string): void {
  const usage = getSessionUsage();
  const pricing = DEEPSEEK_PRICING[model] ?? DEEPSEEK_PRICING['deepseek-chat'];

  const inputCost = (usage.inputTokens / 1_000_000) * pricing.prompt;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.completion;
  const cacheSavings = (usage.cacheHitTokens / 1_000_000) * (pricing.prompt - pricing.cacheHit);
  const totalCost = inputCost + outputCost - cacheSavings;

  console.log(`
${chalk.bold('Session Usage')}
  ${chalk.gray('Model:')}        ${chalk.cyan(model)}
  ${chalk.gray('Input tokens:')}  ${usage.inputTokens.toLocaleString()}${usage.cacheHitTokens > 0 ? chalk.green(`  (${usage.cacheHitTokens.toLocaleString()} cache hits)`) : ''}
  ${chalk.gray('Output tokens:')} ${usage.outputTokens.toLocaleString()}
  ${chalk.gray('Total tokens:')}  ${(usage.inputTokens + usage.outputTokens).toLocaleString()}
${chalk.gray('─'.repeat(30))}
  ${chalk.gray('Input cost:')}   ${formatDualCurrency(inputCost)}
  ${chalk.gray('Output cost:')}  ${formatDualCurrency(outputCost)}${cacheSavings > 0 ? chalk.green(`\n  ${chalk.gray('Cache saved:')}  -${formatDualCurrency(cacheSavings)}`) : ''}
  ${chalk.bold('Session cost:')} ${formatDualCurrency(totalCost)}
`);
}

async function switchModel(arg: string, config: SeekCodeConfig): Promise<SlashCommandResult> {
  // /model deepseek-v4-pro  — direct switch by ID
  if (arg) {
    const match = DEEPSEEK_MODELS.find((m) => m.id === arg || m.label.toLowerCase() === arg.toLowerCase());
    if (!match) {
      console.log(chalk.yellow(`Unknown model: ${arg}`));
      console.log(chalk.gray('Available: ' + DEEPSEEK_MODELS.map((m) => m.id).join(', ')));
      return { type: 'handled' };
    }
    console.log(chalk.green(`✓ Switched to ${chalk.bold(match.label)}`) + chalk.gray(` (${match.id})`));
    return { type: 'model_changed', config: { ...config, model: match.id } };
  }

  // /model — arrow-key dropdown picker
  const { selectFromList } = await import('./input.js');
  const selected = await selectFromList(
    'Select model',
    DEEPSEEK_MODELS.map((m) => ({ value: m.id, label: m.label, desc: m.description })),
    config.model,
  );

  if (!selected || selected === config.model) {
    console.log(chalk.gray('Model unchanged.'));
    return { type: 'handled' };
  }

  const match = DEEPSEEK_MODELS.find((m) => m.id === selected)!;
  console.log(chalk.green(`✓ Switched to ${chalk.bold(match.label)}`) + chalk.gray(` (${selected})`));
  return { type: 'model_changed', config: { ...config, model: selected } };
}

// ── /clear ──────────────────────────────────────────────────────────────────
// Handled inline above via context.clear()

// ── /compact ────────────────────────────────────────────────────────────────

async function compactContext(
  context: ContextManager,
  config: SeekCodeConfig,
  provider: LLMProvider,
): Promise<void> {
  const messages = context.getMessages();
  const nonSystem = messages.filter((m) => m.role !== 'system');

  if (nonSystem.length < 4) {
    console.log(chalk.gray('Context is already short, nothing to compact.'));
    return;
  }

  process.stdout.write(chalk.gray('Compacting context…'));

  const summaryMessages: Message[] = [
    {
      role: 'system',
      content: 'You are a helpful assistant. Summarize the following conversation concisely, preserving key decisions, code changes made, and any important context needed to continue the work.',
    },
    {
      role: 'user',
      content: nonSystem
        .map((m) => {
          const role = m.role.toUpperCase();
          const content = 'content' in m && m.content ? String(m.content) : '[tool call]';
          return `${role}: ${content}`;
        })
        .join('\n\n'),
    },
  ];

  let summary = '';
  try {
    const stream = provider.stream(summaryMessages, {
      model: config.model,
      maxTokens: 1024,
      temperature: 0.2,
    });
    for await (const chunk of stream) {
      if (chunk.type === 'text_delta') summary += chunk.text;
    }
  } catch (err) {
    console.log(chalk.red('\nFailed to compact: ' + (err instanceof Error ? err.message : String(err))));
    return;
  }

  const systemMsg = messages.find((m) => m.role === 'system');
  context.clear();
  if (systemMsg) context.push(systemMsg);
  context.push({
    role: 'user',
    content: `[Previous conversation summary]\n${summary}`,
  });
  context.push({
    role: 'assistant',
    content: 'Understood. I have the context from our previous conversation and am ready to continue.',
  });

  process.stdout.write(chalk.green(' done\n'));
  console.log(chalk.gray(`Reduced to ${context.getMessages().length} messages.\n`));
}

// ── /init ────────────────────────────────────────────────────────────────────

const INIT_SKIP = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.cache', 'coverage']);
const INIT_KEY_FILES = [
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'tsconfig.json', 'tsconfig.base.json',
  'vite.config.ts', 'vite.config.js',
  'vitest.config.ts', 'jest.config.ts', 'jest.config.js',
  '.eslintrc', '.eslintrc.js', '.eslintrc.json', 'eslint.config.js',
  'Makefile', 'Dockerfile', 'docker-compose.yml',
  'pyproject.toml', 'setup.py', 'requirements.txt',
  'Cargo.toml', 'go.mod',
  'README.md', 'CLAUDE.md', 'SEEKCODE.md',
];

async function runInit(
  cwd: string,
  config: SeekCodeConfig,
  provider: LLMProvider,
  outputFile: string,
): Promise<void> {
  const outPath = resolve(cwd, outputFile || 'SEEKCODE.md');
  console.log(chalk.gray(`Analyzing codebase at ${cwd}…\n`));

  // 1. Collect file tree
  const tree = await buildFileTree(cwd);

  // 2. Read key config files
  const keyContents = await readKeyFiles(cwd);

  // 3. Sample a few source files for architecture hints
  const sourceSamples = await sampleSourceFiles(cwd);

  const prompt = buildInitPrompt(cwd, tree, keyContents, sourceSamples, outPath);

  process.stdout.write(chalk.gray('Generating project guide'));

  let output = '';
  try {
    const stream = provider.stream(
      [{ role: 'user', content: prompt }],
      { model: config.model, maxTokens: 4096, temperature: 0.2 },
    );
    for await (const chunk of stream) {
      if (chunk.type === 'text_delta') {
        output += chunk.text;
        process.stdout.write('.');
      }
    }
  } catch (err) {
    console.log(chalk.red('\nFailed: ' + (err instanceof Error ? err.message : String(err))));
    return;
  }

  // Strip markdown code fence if model wrapped the output
  const cleaned = output.replace(/^```markdown\n?/, '').replace(/\n?```$/, '').trim();

  await mkdir(resolve(cwd), { recursive: true });
  await writeFile(outPath, cleaned + '\n', 'utf-8');

  process.stdout.write('\n');
  console.log(chalk.green(`✓ Written to ${relative(cwd, outPath)}\n`));
}

async function buildFileTree(cwd: string): Promise<string> {
  const lines: string[] = [];
  await walkTree(cwd, cwd, 0, 3, lines);
  return lines.join('\n');
}

async function walkTree(root: string, dir: string, depth: number, maxDepth: number, lines: string[]): Promise<void> {
  if (depth > maxDepth || lines.length > 150) return;
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const entry of entries) {
    if (entry.name.startsWith('.') && depth > 0) continue;
    if (INIT_SKIP.has(entry.name)) continue;
    const indent = '  '.repeat(depth);
    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`);
      await walkTree(root, join(dir, entry.name), depth + 1, maxDepth, lines);
    } else {
      lines.push(`${indent}${entry.name}`);
    }
  }
}

async function readKeyFiles(cwd: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of INIT_KEY_FILES) {
    const p = join(cwd, name);
    try {
      const content = await readFile(p, 'utf-8');
      result[name] = content.length > 3000 ? content.slice(0, 3000) + '\n[truncated]' : content;
    } catch {
      // file doesn't exist
    }
  }
  return result;
}

async function sampleSourceFiles(cwd: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const candidates: string[] = [];
  await collectSourceCandidates(cwd, cwd, candidates);

  // Take up to 5 files
  for (const p of candidates.slice(0, 5)) {
    try {
      const content = await readFile(p, 'utf-8');
      const rel = relative(cwd, p);
      result[rel] = content.length > 2000 ? content.slice(0, 2000) + '\n[truncated]' : content;
    } catch {
      // skip
    }
  }
  return result;
}

async function collectSourceCandidates(root: string, dir: string, out: string[]): Promise<void> {
  if (out.length >= 10) return;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= 10) return;
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (INIT_SKIP.has(entry.name)) continue;
      await collectSourceCandidates(root, full, out);
    } else if (/\.(ts|tsx|js|jsx|py|go|rs|java)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function buildInitPrompt(
  cwd: string,
  tree: string,
  keyFiles: Record<string, string>,
  sourceSamples: Record<string, string>,
  outPath: string,
): string {
  const keyFilesSection = Object.entries(keyFiles)
    .map(([name, content]) => `### ${name}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n');

  const sourceSamplesSection = Object.entries(sourceSamples)
    .map(([name, content]) => `### ${name}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n');

  return `Analyze this codebase and write a concise developer guide in Markdown.

The guide will be saved as ${outPath} and read by AI coding assistants to understand the project quickly.

## File tree
\`\`\`
${tree}
\`\`\`

## Key config files
${keyFilesSection || '(none found)'}

## Source file samples
${sourceSamplesSection || '(none found)'}

## Instructions
Write a Markdown document with these sections (only include sections that are relevant):

1. **Build & Dev Commands** — exact commands to build, run, test, lint. Include how to run a single test.
2. **Architecture** — high-level structure: what each major directory/module does, key data flows. Focus on non-obvious things that require reading multiple files to understand.
3. **Key Patterns & Conventions** — coding patterns, naming conventions, or architectural decisions that are specific to this project.
4. **Configuration** — environment variables, config files, and their effects.

Rules:
- Be concise. No generic advice. No obvious instructions.
- Do not list every file — only what's architecturally significant.
- Do not add sections that have no content.
- Output raw Markdown only, no code fences wrapping the whole document.`;
}
