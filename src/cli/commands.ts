import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join, resolve, relative } from 'path';
import chalk from 'chalk';
import type { LLMProvider, Message, CodeGruntConfig } from '../types.js';
import type { ContextManager } from '../core/context/manager.js';
import { DEEPSEEK_MODELS } from './setup.js';
import { getSessionUsage } from '../core/agent/loop.js';
import { printBalanceAndUsage, formatDualCurrency, PRICING } from '../utils/billing.js';
import type { Skill } from './skills.js';
import { getGlobalSkillsDir, createSkill } from './skills.js';
import { validateApiKey } from '../providers/deepseek/client.js';
import { MarkdownRenderer } from '../utils/markdown.js';

export type SlashCommandResult =
  | { type: 'handled' }
  | { type: 'clear' }
  | { type: 'config_changed'; config: CodeGruntConfig }
  | { type: 'model_changed'; config: CodeGruntConfig }
  | { type: 'exit' }
  | { type: 'skill_run'; prompt: string; system?: string }
  | { type: 'skills_reload' }
  | { type: 'not_a_command' };

export async function handleSlashCommand(
  input: string,
  cwd: string,
  config: CodeGruntConfig,
  provider: LLMProvider,
  context: ContextManager,
  skills: Skill[] = [],
): Promise<SlashCommandResult> {
  if (!input.startsWith('/')) return { type: 'not_a_command' };

  const [cmd, ...rest] = input.slice(1).split(' ');
  const args = rest.join(' ').trim();

  switch (cmd.toLowerCase()) {
    case 'help':
      printHelp(config, skills);
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

    case 'reasoning':
    case 'effort':
      return switchReasoningEffort(args, config);

    case 'token':
    case 'apikey':
      return await switchToken(args, config);

    case 'config':
      return await handleConfig(rest, config);

    case 'cost':
      printSessionCost(config.model);
      return { type: 'handled' };

    case 'balance':
      await printBalanceAndUsage(config.apiKey, config.baseURL, config.model);
      return { type: 'handled' };

    case 'exit':
      return { type: 'exit' };

    case 'skills':
      return await handleSkills(rest, skills);

    case 'review':
      await reviewContext(context, config, provider);
      return { type: 'handled' };

    default: {
      // Check if it matches a loaded skill
      const skill = skills.find((s) => s.name.toLowerCase() === cmd.toLowerCase());
      if (skill) {
        const prompt = args ? `${skill.content}\n\n${args}` : skill.content;
        return { type: 'skill_run', prompt, system: skill.system };
      }
      console.log(chalk.yellow(`Unknown command: /${cmd}. Type /help for available commands.`));
      return { type: 'handled' };
    }
  }
}

// ── /help ───────────────────────────────────────────────────────────────────

function printHelp(config: CodeGruntConfig, skills: Skill[] = []): void {
  const skillsSection = skills.length > 0
    ? `\n${chalk.bold('Skills')}\n\n` +
      skills.map((s) =>
        `  ${chalk.cyan('/' + s.name)}${' '.repeat(Math.max(1, 18 - s.name.length - 1))}${s.description ? chalk.gray(` — ${s.description}`) : chalk.gray(`(${s.source})`)}`
      ).join('\n') + '\n'
    : '';
  console.log(`
${chalk.bold('Slash Commands')}

  ${chalk.cyan('/init')}              Analyze the codebase and generate a CODEGRUNT.md project guide
  ${chalk.cyan('/model')}             Switch model interactively
  ${chalk.cyan('/model <id>')}        Switch to a specific model  (e.g. /model deepseek-v4-pro)
  ${chalk.cyan('/config')}            Show current configuration
  ${chalk.cyan('/config <key> [val]')} Set a config value interactively or directly
                        Keys: ${chalk.gray('temperature  maxtokens  topp  frequencypenalty  presencepenalty  reasoning')}
  ${chalk.cyan('/reasoning')}         Set reasoning effort for R1 models (low/medium/high)
  ${chalk.cyan('/effort <level>')}    Shortcut: /effort low | /effort medium | /effort high
  ${chalk.cyan('/token [key]')}       Update your DeepSeek API key
  ${chalk.cyan('/cost')}              Show session token usage and cost (DeepSeek pricing)
  ${chalk.cyan('/balance')}           Show account balance, today's & this month's usage
  ${chalk.cyan('/skills')}            List and manage skills (create, list)
  ${chalk.cyan('/review')}            Review session changes for logic issues
  ${chalk.cyan('/help')}              Show this help message
  ${chalk.cyan('/clear')}             Clear conversation context
  ${chalk.cyan('/compact')}           Summarize and compress conversation history to save tokens
  ${chalk.cyan('/exit')}              Exit CodeGrunt
${skillsSection}
${chalk.bold('@ References')}

  ${chalk.cyan('@<file>')}        Inject file contents into your message  (e.g. @src/index.ts)
  ${chalk.cyan('@<directory>')}   Inject directory listing                (e.g. @src/)
  ${chalk.cyan('@<url>')}         Fetch and inject webpage content        (e.g. @https://example.com)

${chalk.bold('Current')}

  temperature: ${chalk.cyan(String(config.temperature))}  max_tokens: ${chalk.cyan(String(config.maxTokens))}  top_p: ${chalk.cyan(String(config.topP ?? 1))}${config.reasoningEffort ? chalk.gray(`  reasoning: ${config.reasoningEffort}`) : ''}

${chalk.bold('Other')}

  ${chalk.cyan('exit')} / ${chalk.cyan('quit')}   Exit CodeGrunt
  ${chalk.cyan('Ctrl+C')}         Interrupt a running task
`);
}

// ── /cost ───────────────────────────────────────────────────────────────────

function printSessionCost(model: string): void {
  const usage = getSessionUsage();
  const pricing = PRICING[model] ?? PRICING['deepseek-chat'];

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

async function switchReasoningEffort(
  arg: string,
  config: CodeGruntConfig,
): Promise<SlashCommandResult> {
  const validEfforts = ['low', 'medium', 'high'] as const;

  if (arg && validEfforts.includes(arg as (typeof validEfforts)[number])) {
    const effort = arg as 'low' | 'medium' | 'high';
    console.log(
      chalk.green(`✓ Reasoning effort set to ${chalk.bold(effort)}`) +
      chalk.gray(' (only applies to reasoner/R1 models)'),
    );
    return { type: 'config_changed', config: { ...config, reasoningEffort: effort } };
  }

  // Interactive picker
  const { selectFromList } = await import('./input.js');
  const selected = await selectFromList(
    'Select reasoning effort (only applies to R1/reasoner models)',
    [
      { value: 'low', label: 'Low', desc: 'Faster responses, less thinking' },
      { value: 'medium', label: 'Medium', desc: 'Balanced (default)' },
      { value: 'high', label: 'High', desc: 'Most thorough, slower responses' },
    ],
    config.reasoningEffort ?? 'medium',
  );

  if (!selected || selected === config.reasoningEffort) {
    console.log(chalk.gray('Reasoning effort unchanged.'));
    return { type: 'handled' };
  }

  console.log(chalk.green(`✓ Reasoning effort set to ${chalk.bold(selected)}`));
  return {
    type: 'config_changed',
    config: { ...config, reasoningEffort: selected as 'low' | 'medium' | 'high' },
  };
}

async function switchToken(
  arg: string,
  config: CodeGruntConfig,
): Promise<SlashCommandResult> {
  // If an argument is provided, use it directly
  if (arg) {
    const trimmed = arg.trim();
    if (trimmed.length < 10) {
      console.log(chalk.yellow('API key seems too short. Please check and try again.'));
      return { type: 'handled' };
    }
    process.stdout.write(chalk.gray('Validating API key…'));
    const err = await validateApiKey(trimmed, config.baseURL);
    process.stdout.write('\r' + ' '.repeat(30) + '\r');
    if (err) {
      console.log(chalk.red(`✗ ${err} Key not saved.`));
      return { type: 'handled' };
    }
    console.log(chalk.green('✓ API key updated'));
    console.log(chalk.gray(`  Key: ${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`));
    return { type: 'config_changed', config: { ...config, apiKey: trimmed } };
  }

  // Interactive input (readline for direct text input)
  // try/finally ensures rl.close() is always called even if the prompt throws.
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  let newKey = '';
  try {
    console.log(chalk.gray('Enter your new DeepSeek API key (get one at https://platform.deepseek.com/api_keys):'));
    newKey = (await ask(chalk.bold('API Key: '))).trim();
  } finally {
    rl.close();
  }

  if (!newKey) {
    console.log(chalk.gray('API key unchanged.'));
    return { type: 'handled' };
  }

  if (newKey.length < 10) {
    console.log(chalk.yellow('API key seems too short. Key unchanged.'));
    return { type: 'handled' };
  }

  process.stdout.write(chalk.gray('Validating API key…'));
  const err = await validateApiKey(newKey, config.baseURL);
  process.stdout.write('\r' + ' '.repeat(30) + '\r');
  if (err) {
    console.log(chalk.red(`✗ ${err} Key not saved.`));
    return { type: 'handled' };
  }

  console.log(chalk.green('✓ API key updated'));
  console.log(chalk.gray(`  Key: ${newKey.slice(0, 4)}...${newKey.slice(-4)}`));
  return { type: 'config_changed', config: { ...config, apiKey: newKey } };
}

// ── /config ─────────────────────────────────────────────────────────────────
// /config                        — show current config
// /config temperature [val]      — set temperature
// /config maxtokens [val]        — set max tokens
// /config topp [val]             — set top-p
// /config frequencypenalty [val] — set frequency penalty
// /config presencepenalty [val]  — set presence penalty
// /config reasoning [level]      — set reasoning effort

async function handleConfig(
  rest: string[],
  config: CodeGruntConfig,
): Promise<SlashCommandResult> {
  const sub = rest[0]?.toLowerCase();
  const val = rest.slice(1).join(' ').trim();

  switch (sub) {
    case 'temperature':
    case 'temp':
      return switchTemperature(val, config);

    case 'maxtokens':
    case 'max_tokens':
      return switchMaxTokens(val, config);

    case 'topp':
    case 'top_p':
      return switchTopP(val, config);

    case 'frequencypenalty':
    case 'frequency_penalty':
      return switchFrequencyPenalty(val, config);

    case 'presencepenalty':
    case 'presence_penalty':
      return switchPresencePenalty(val, config);

    case 'reasoning':
    case 'effort':
      return switchReasoningEffort(val, config);

    default:
      // /config with no args — show current config overview
      if (!sub) {
        printConfigOverview(config);
        return { type: 'handled' };
      }
      console.log(
        chalk.yellow(`Unknown config key: ${sub}\n`) +
        chalk.gray('Available: temperature, maxtokens, topp, frequencypenalty, presencepenalty, reasoning'),
      );
      return { type: 'handled' };
  }
}

function printConfigOverview(config: CodeGruntConfig): void {
  console.log(`
${chalk.bold('Current Configuration')}

  ${chalk.gray('temperature:')}        ${chalk.cyan(String(config.temperature))}
  ${chalk.gray('max_tokens:')}         ${chalk.cyan(String(config.maxTokens))}
  ${chalk.gray('top_p:')}              ${chalk.cyan(String(config.topP ?? '1'))}
  ${chalk.gray('frequency_penalty:')}  ${chalk.cyan(String(config.frequencyPenalty ?? '0'))}
  ${chalk.gray('presence_penalty:')}   ${chalk.cyan(String(config.presencePenalty ?? '0'))}
  ${chalk.gray('reasoning_effort:')}   ${chalk.cyan(config.reasoningEffort ?? 'medium')}

${chalk.gray('Use /config <key> <value> to change a setting, e.g. /config temperature 0.8')}
`);
}

// ── /temperature (via /config temperature) ──────────────────────────────────

async function switchTemperature(
  arg: string,
  config: CodeGruntConfig,
): Promise<SlashCommandResult> {
  if (arg) {
    const val = parseFloat(arg);
    if (isNaN(val) || val < 0 || val > 2) {
      console.log(chalk.yellow('Temperature must be a number between 0 and 2.'));
      return { type: 'handled' };
    }
    console.log(chalk.green(`✓ Temperature set to ${chalk.bold(String(val))}`));
    return { type: 'config_changed', config: { ...config, temperature: val } };
  }

  const { selectFromList } = await import('./input.js');
  const selected = await selectFromList(
    'Select temperature (0 = deterministic, 1 = balanced, 2 = creative)',
    [
      { value: '0', label: '0.0', desc: 'Deterministic, consistent output' },
      { value: '0.2', label: '0.2', desc: 'Mostly deterministic (default)' },
      { value: '0.5', label: '0.5', desc: 'Balanced' },
      { value: '0.8', label: '0.8', desc: 'More creative' },
      { value: '1.0', label: '1.0', desc: 'Creative' },
      { value: '1.5', label: '1.5', desc: 'Very creative' },
      { value: '2.0', label: '2.0', desc: 'Maximum creativity' },
    ],
    String(config.temperature),
  );

  if (!selected || parseFloat(selected) === config.temperature) {
    console.log(chalk.gray('Temperature unchanged.'));
    return { type: 'handled' };
  }

  const val = parseFloat(selected);
  console.log(chalk.green(`✓ Temperature set to ${chalk.bold(String(val))}`));
  return { type: 'config_changed', config: { ...config, temperature: val } };
}

// ── /maxtokens ──────────────────────────────────────────────────────────────

async function switchMaxTokens(
  arg: string,
  config: CodeGruntConfig,
): Promise<SlashCommandResult> {
  if (arg) {
    const val = parseInt(arg, 10);
    if (isNaN(val) || val < 256 || val > 65536) {
      console.log(chalk.yellow('Max tokens must be an integer between 256 and 65536.'));
      return { type: 'handled' };
    }
    console.log(chalk.green(`✓ Max tokens set to ${chalk.bold(String(val))}`));
    return { type: 'config_changed', config: { ...config, maxTokens: val } };
  }

  const { selectFromList } = await import('./input.js');
  const selected = await selectFromList(
    'Select max tokens per response',
    [
      { value: '1024', label: '1024', desc: 'Short responses' },
      { value: '2048', label: '2048', desc: 'Medium responses' },
      { value: '4096', label: '4096', desc: 'Standard length' },
      { value: '8192', label: '8192', desc: 'Long responses (default)' },
      { value: '16384', label: '16384', desc: 'Very long responses' },
      { value: '32768', label: '32768', desc: 'Maximum length responses' },
    ],
    String(config.maxTokens),
  );

  if (!selected || parseInt(selected, 10) === config.maxTokens) {
    console.log(chalk.gray('Max tokens unchanged.'));
    return { type: 'handled' };
  }

  const val = parseInt(selected, 10);
  console.log(chalk.green(`✓ Max tokens set to ${chalk.bold(String(val))}`));
  return { type: 'config_changed', config: { ...config, maxTokens: val } };
}

// ── /topp ───────────────────────────────────────────────────────────────────

async function switchTopP(
  arg: string,
  config: CodeGruntConfig,
): Promise<SlashCommandResult> {
  if (arg) {
    const val = parseFloat(arg);
    if (isNaN(val) || val < 0 || val > 1) {
      console.log(chalk.yellow('Top-p must be a number between 0 and 1.'));
      return { type: 'handled' };
    }
    console.log(chalk.green(`✓ Top-p set to ${chalk.bold(String(val))}`));
    return { type: 'config_changed', config: { ...config, topP: val } };
  }

  const { selectFromList } = await import('./input.js');
  const selected = await selectFromList(
    'Select top-p (nucleus sampling)',
    [
      { value: '1', label: '1.0', desc: 'Consider all tokens (default)' },
      { value: '0.9', label: '0.9', desc: 'Top 90% probability mass' },
      { value: '0.8', label: '0.8', desc: 'Top 80%' },
      { value: '0.7', label: '0.7', desc: 'Top 70%' },
      { value: '0.5', label: '0.5', desc: 'Top 50% (more focused)' },
    ],
    config.topP !== undefined ? String(config.topP) : '1',
  );

  if (!selected || (config.topP !== undefined && parseFloat(selected) === config.topP)) {
    console.log(chalk.gray('Top-p unchanged.'));
    return { type: 'handled' };
  }

  const val = parseFloat(selected);
  console.log(chalk.green(`✓ Top-p set to ${chalk.bold(String(val))}`));
  return { type: 'config_changed', config: { ...config, topP: val } };
}

// ── /frequencypenalty ───────────────────────────────────────────────────────

async function switchFrequencyPenalty(
  arg: string,
  config: CodeGruntConfig,
): Promise<SlashCommandResult> {
  if (arg) {
    const val = parseFloat(arg);
    if (isNaN(val) || val < -2 || val > 2) {
      console.log(chalk.yellow('Frequency penalty must be a number between -2 and 2.'));
      return { type: 'handled' };
    }
    console.log(chalk.green(`✓ Frequency penalty set to ${chalk.bold(String(val))}`));
    return { type: 'config_changed', config: { ...config, frequencyPenalty: val } };
  }

  const { selectFromList } = await import('./input.js');
  const selected = await selectFromList(
    'Select frequency penalty (-2 = encourage repetition, 2 = discourage)',
    [
      { value: '0', label: '0.0', desc: 'No penalty (default)' },
      { value: '0.3', label: '0.3', desc: 'Slight repetition reduction' },
      { value: '0.6', label: '0.6', desc: 'Moderate repetition reduction' },
      { value: '1.0', label: '1.0', desc: 'Strong repetition reduction' },
      { value: '1.5', label: '1.5', desc: 'Very strong reduction' },
      { value: '2.0', label: '2.0', desc: 'Maximum reduction' },
    ],
    config.frequencyPenalty !== undefined ? String(config.frequencyPenalty) : '0',
  );

  if (!selected || (config.frequencyPenalty !== undefined && parseFloat(selected) === config.frequencyPenalty)) {
    console.log(chalk.gray('Frequency penalty unchanged.'));
    return { type: 'handled' };
  }

  const val = parseFloat(selected);
  console.log(chalk.green(`✓ Frequency penalty set to ${chalk.bold(String(val))}`));
  return { type: 'config_changed', config: { ...config, frequencyPenalty: val } };
}

// ── /presencepenalty ────────────────────────────────────────────────────────

async function switchPresencePenalty(
  arg: string,
  config: CodeGruntConfig,
): Promise<SlashCommandResult> {
  if (arg) {
    const val = parseFloat(arg);
    if (isNaN(val) || val < -2 || val > 2) {
      console.log(chalk.yellow('Presence penalty must be a number between -2 and 2.'));
      return { type: 'handled' };
    }
    console.log(chalk.green(`✓ Presence penalty set to ${chalk.bold(String(val))}`));
    return { type: 'config_changed', config: { ...config, presencePenalty: val } };
  }

  const { selectFromList } = await import('./input.js');
  const selected = await selectFromList(
    'Select presence penalty (-2 = encourage same topics, 2 = encourage new topics)',
    [
      { value: '0', label: '0.0', desc: 'No penalty (default)' },
      { value: '0.3', label: '0.3', desc: 'Slight topic diversity' },
      { value: '0.6', label: '0.6', desc: 'Moderate topic diversity' },
      { value: '1.0', label: '1.0', desc: 'Strong topic diversity' },
      { value: '1.5', label: '1.5', desc: 'Very strong diversity' },
      { value: '2.0', label: '2.0', desc: 'Maximum diversity' },
    ],
    config.presencePenalty !== undefined ? String(config.presencePenalty) : '0',
  );

  if (!selected || (config.presencePenalty !== undefined && parseFloat(selected) === config.presencePenalty)) {
    console.log(chalk.gray('Presence penalty unchanged.'));
    return { type: 'handled' };
  }

  const val = parseFloat(selected);
  console.log(chalk.green(`✓ Presence penalty set to ${chalk.bold(String(val))}`));
  return { type: 'config_changed', config: { ...config, presencePenalty: val } };
}

async function switchModel(arg: string, config: CodeGruntConfig): Promise<SlashCommandResult> {
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
  config: CodeGruntConfig,
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
  'README.md', 'CLAUDE.md', 'CODEGRUNT.md',
];

async function runInit(
  cwd: string,
  config: CodeGruntConfig,
  provider: LLMProvider,
  outputFile: string,
): Promise<void> {
  const outPath = resolve(cwd, outputFile || 'CODEGRUNT.md');
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


// ── /skills ─────────────────────────────────────────────────────────────────
// /skills              — list all loaded skills
// /skills create <name> — interactively create a new skill in ~/.codegrunt/skills/

async function handleSkills(
  rest: string[],
  skills: Skill[],
): Promise<SlashCommandResult> {
  const sub = rest[0]?.toLowerCase();
  const name = rest.slice(1).join(' ').trim();

  if (sub === 'create') {
    if (!name) {
      console.log(chalk.yellow('Usage: /skills create <name>'));
      console.log(chalk.gray('Example: /skills create my-skill'));
      return { type: 'handled' };
    }

    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (prompt: string): Promise<string> =>
      new Promise<string>((resolve) => rl.question(prompt, resolve));

    console.log(chalk.gray(`\nCreating skill "${chalk.cyan(name)}" in ${chalk.gray(getGlobalSkillsDir())}\n`));

    // try/finally ensures rl.close() is always called even if a prompt throws.
    let desc = '';
    let content = '';
    try {
      console.log(chalk.gray('Enter a short description (optional, press Enter to skip):'));
      desc = (await ask(chalk.bold('Description: '))).trim();

      console.log(chalk.gray('\nEnter the skill content (instructions/prompt that will be sent to the model):'));
      console.log(chalk.gray('Type your content and press Enter. Multi-line is supported —'));
      console.log(chalk.gray('just keep typing and press Enter on an empty line to finish.\n'));

      const lines = [];
      while (true) {
        const line = await ask('');
        if (line === '') break;
        lines.push(line);
      }
      content = lines.join('\n').trim();
    } finally {
      rl.close();
    }
    if (!content) {
      console.log(chalk.yellow('Skill content cannot be empty. Aborted.'));
      return { type: 'handled' };
    }

    try {
      const fileName = await createSkill(name, desc || '', content);
      console.log(chalk.green(`\n✓ Skill "${name}" created: ${fileName}`));
      console.log(chalk.gray(`  Directory: ${getGlobalSkillsDir()}`));
      console.log(chalk.gray(`  Use as /${name} immediately.`));
      return { type: 'skills_reload' };
    } catch (err) {
      console.log(chalk.red(`\nFailed to create skill: ${err instanceof Error ? err.message : String(err)}`));
    }

    return { type: 'handled' };
  }

  // /skills — list all skills
  if (skills.length === 0) {
    console.log(`\n${chalk.gray('No skills loaded.')}`);
    console.log(chalk.gray(`Create one with ${chalk.cyan('/skills create <name>')}`));
    console.log(chalk.gray(`Or add .md files to ${chalk.gray(getGlobalSkillsDir())}`));
    console.log(chalk.gray(`Project skills: ${chalk.gray('.codegrunt/skills/')}`));
    return { type: 'handled' };
  }

  console.log(`\n${chalk.bold('Skills')}\n`);

  const maxNameLen = Math.max(...skills.map((s) => s.name.length));
  for (const skill of skills) {
    const sourceLabel = skill.source === 'project' ? chalk.blue('[project]') : chalk.gray('[global]');
    const desc = skill.description ? chalk.gray(` — ${skill.description}`) : '';
    const namePadded = chalk.cyan('/' + skill.name.padEnd(maxNameLen));
    console.log(`  ${namePadded}  ${sourceLabel}${desc}`);
  }

  console.log(`\n${chalk.gray('Use /<skill-name> to run a skill')}`);
  console.log(chalk.gray(`Create: ${chalk.cyan('/skills create <name>')}`));
  console.log(chalk.gray(`Global dir: ${chalk.gray(getGlobalSkillsDir())}`));
  console.log(chalk.gray(`Project dir: ${chalk.gray('.codegrunt/skills/')}`));

  return { type: 'handled' };
}

// ── /review ──────────────────────────────────────────────────────────────────

async function reviewContext(
  context: ContextManager,
  config: CodeGruntConfig,
  provider: LLMProvider,
): Promise<void> {
  const messages = context.getMessages();
  const nonSystem = messages.filter((m) => m.role !== 'system');

  if (nonSystem.length < 2) {
    console.log(chalk.gray('No conversation to review yet.'));
    return;
  }

  console.log(chalk.bold('\n🔍 Reviewing session changes for logic issues…\n'));

  const reviewPrompt = messages
    .map((m) => {
      const role = m.role.toUpperCase();
      if ('tool_calls' in m && m.tool_calls) {
        const calls = m.tool_calls.map(tc =>
          `  → ${tc.function.name}(${tc.function.arguments})`
        ).join('\n');
        return `${role}: [tool calls]\n${calls}`;
      }
      const content = 'content' in m && m.content ? String(m.content) : '';
      return `${role}: ${content}`;
    })
    .join('\n\n');

  const reviewMessages: Message[] = [
    {
      role: 'system',
      content: `You are an expert code reviewer. Analyze the following conversation log containing code changes (write_file, edit_file tool calls). Focus on:
- Logical errors or inconsistencies in the code changes
- Potential bugs, edge cases, or race conditions
- Missing error handling
- Type safety issues
- Breaking changes to existing APIs or interfaces
- Performance concerns

Provide a structured review:
1. **Critical Issues** — bugs that would cause runtime errors or data loss
2. **Logic Issues** — flaws in reasoning, incorrect assumptions, edge cases missed
3. **Style / Best Practices** — deviations from conventions, minor improvements
4. **Summary** — overall assessment

If no issues are found, clearly state that the changes look correct. Be specific — reference exact file paths and line content from the conversation.`,
    },
    {
      role: 'user',
      content: `Review this conversation session for logic issues:\n\n${reviewPrompt}`,
    },
  ];

  process.stdout.write(chalk.gray('Analyzing…'));

  let review = '';
  const md = new MarkdownRenderer();
  try {
    const stream = provider.stream(reviewMessages, {
      model: config.model,
      maxTokens: 4096,
      temperature: 0.2,
    });
    for await (const chunk of stream) {
      if (chunk.type === 'text_delta') {
        if (!review) {
          process.stdout.write('\r' + ' '.repeat(20) + '\r');
        }
        review += chunk.text;
        const formatted = md.feed(chunk.text);
        if (formatted) process.stdout.write(formatted);
      }
    }
    // Flush any remaining markdown buffer (e.g. pending table)
    const flushOut = md.flush();
    if (flushOut) process.stdout.write(flushOut);
  } catch (err) {
    console.log(chalk.red('\nFailed to review: ' + (err instanceof Error ? err.message : String(err))));
    return;
  }

  console.log('\n');
}