import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { join, resolve, relative } from 'path';
import chalk from 'chalk';
import type { LLMProvider, CodeGruntConfig } from '../types.js';

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

async function sampleSourceFiles(cwd: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const candidates: string[] = [];
  await collectSourceCandidates(cwd, cwd, candidates);

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

export async function runInit(
  cwd: string,
  config: CodeGruntConfig,
  provider: LLMProvider,
  outputFile: string,
): Promise<void> {
  const outPath = resolve(cwd, outputFile || 'CODEGRUNT.md');
  console.log(chalk.gray(`Analyzing codebase at ${cwd}…\n`));

  const tree = await buildFileTree(cwd);
  const keyContents = await readKeyFiles(cwd);
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

  const cleaned = output.replace(/^```markdown\n?/, '').replace(/\n?```$/, '').trim();

  await mkdir(resolve(cwd), { recursive: true });
  await writeFile(outPath, cleaned + '\n', 'utf-8');

  process.stdout.write('\n');
  console.log(chalk.green(`✓ Written to ${relative(cwd, outPath)}\n`));
}
