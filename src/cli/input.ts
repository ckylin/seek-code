import { readdir, access } from 'fs/promises';
import { resolve, dirname, basename, join } from 'path';
import chalk from 'chalk';
import { input } from '@inquirer/prompts';
import type { Skill } from './skills.js';
import { selectFromList } from '../utils/select.js';
import { ACCENT } from '../utils/constants.js';
export type { SelectorItem } from '../utils/select.js';
export { selectFromList };

export interface InputResult {
  text: string;
  cancelled: boolean;
}

export type SlashCommandKind = 'builtin' | 'skill';

const SLASH_COMMANDS = [
  { name: '/init',    desc: 'Analyze codebase and generate SEEK.md' },
  { name: '/model',   desc: 'Switch model' },
  { name: '/config',  desc: 'View or change config (temperature, reasoning, etc.)' },
  { name: '/skills',  desc: 'List and manage skills' },
  { name: '/token',   desc: 'Update API key' },
  { name: '/compact', desc: 'Compress conversation history' },
  { name: '/review',  desc: 'Review session changes for logic issues' },
  { name: '/clear',   desc: 'Clear conversation context' },
  { name: '/balance', desc: 'Show account balance & usage' },
  { name: '/exit',    desc: 'Exit CodeGrunt (or exit current skill)' },
  { name: '/help',    desc: 'Show help' },
];

const history: string[] = [];

async function getFileCompletions(partial: string, cwd: string): Promise<string[]> {
  const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__']);
  try {
    const dir = partial.includes('/') ? resolve(cwd, dirname(partial)) : cwd;
    const prefix = partial.includes('/') ? basename(partial) : partial;
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => !SKIP.has(e.name) && e.name.startsWith(prefix))
      .slice(0, 8)
      .map((e) => {
        const suffix = e.isDirectory() ? '/' : '';
        return partial.includes('/')
          ? dirname(partial) + '/' + e.name + suffix
          : e.name + suffix;
      });
  } catch {
    return [];
  }
}

async function detectContextFile(cwd: string): Promise<string | null> {
  for (const name of ['CODEGRUNT.md', 'CLAUDE.md']) {
    try {
      await access(join(cwd, name));
      return name;
    } catch {
      // not found
    }
  }
  return null;
}

export async function readMultilineInput(
  cwd = process.cwd(),
  model?: string,
  skills: Skill[] = [],
  activeSkill?: string,
): Promise<InputResult> {
  // Non-TTY: read until EOF
  if (!process.stdin.isTTY) {
    return new Promise((resolve_p) => {
      let buf = '';
      const onData = (chunk: Buffer): void => { buf += chunk.toString(); };
      const onEnd = (): void => {
        process.stdin.removeListener('data', onData);
        resolve_p({ text: buf.trim(), cancelled: false });
      };
      process.stdin.resume();
      process.stdin.on('data', onData);
      process.stdin.once('end', onEnd);
    });
  }

  const prefix = activeSkill
    ? chalk.hex('#6C63FF').bold(`[${activeSkill}]`) + ' ' + chalk.hex(ACCENT)('> ')
    : chalk.hex(ACCENT)('> ');

  // Show context file and model info above the prompt on first render
  const contextFile = await detectContextFile(cwd).catch(() => null);
  const metaParts: string[] = [];
  if (model) metaParts.push(chalk.hex(ACCENT)(model));
  if (contextFile) metaParts.push(chalk.gray('In ' + contextFile));
  if (metaParts.length > 0) {
    process.stdout.write(chalk.gray('  ' + metaParts.join('  ·  ') + '\n'));
  }

  let historyIdx = history.length;
  let text: string;

  try {
    text = await input({
      message: '',
      theme: {
        prefix,
        style: {
          answer: (val: string) => chalk.white(val),
        },
      },
    });
  } catch {
    // Ctrl+C
    process.stdout.write('\n');
    process.exit(0);
  }

  text = text.trim();

  // Bare "/" — show full-screen slash command selector
  if (text === '/') {
    const selected = await showSlashCommandSelector(skills);
    if (selected) {
      history.push(selected);
      return { text: selected, cancelled: false };
    }
    return { text: '', cancelled: false };
  }

  if (text) history.push(text);
  return { text, cancelled: false };
}

// ── Slash command full-screen selector ────────────────────────────────────────

export async function showSlashCommandSelector(skills: Skill[] = []): Promise<string | null> {
  const builtinItems = SLASH_COMMANDS.map((cmd) => ({
    value: cmd.name,
    label: cmd.name,
    desc: cmd.desc,
    kind: 'builtin' as SlashCommandKind,
  }));

  const skillItems = skills.map((s) => ({
    value: '/' + s.name,
    label: '/' + s.name,
    desc: s.description ?? `(${s.source})`,
    kind: 'skill' as SlashCommandKind,
  }));

  const items = [...builtinItems, ...skillItems];

  const title = skillItems.length > 0
    ? `Slash Commands  ${chalk.gray('(built-in + ' + skillItems.length + ' skills)')}`
    : 'Slash Commands';

  const selected = await selectFromList(title, items);
  if (selected) {
    process.stdout.write(chalk.hex(ACCENT)('> ') + selected + '\n');
  }
  return selected;
}
