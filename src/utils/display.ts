import chalk from 'chalk';
import { createPatch } from 'diff';
import type { ToolResult } from '../types.js';
import { ACCENT } from './constants.js';

const blue  = (s: string) => chalk.hex(ACCENT)(s);
const muted = chalk.gray;
const success = chalk.green;
const danger  = chalk.red;

export function printToolCall(name: string, args: Record<string, unknown>): void {
  process.stdout.write('\n  ' + muted('tool') + '  ' + chalk.bold(name) + '\n');
  const entries = Object.entries(args);
  for (const [k, v] of entries) {
    const val = typeof v === 'string' && v.length > 80 ? v.slice(0, 80) + '…' : String(v);
    process.stdout.write('  ' + muted(k + ' = ') + chalk.white(val) + '\n');
  }
}

export function printToolResult(name: string, result: ToolResult): void {
  if (result.success) {
    const preview = result.output.length > 100
      ? result.output.slice(0, 100).replace(/\n/g, ' ') + '…'
      : result.output.replace(/\n/g, ' ');
    process.stdout.write('  ' + success('ok') + '  ' + muted(preview) + '\n');
  } else {
    const msg = (result.error ?? result.output).slice(0, 80);
    process.stdout.write('  ' + danger('err') + '  ' + danger(msg) + '\n');
  }
}

export function printUserMessage(text: string): void {
  process.stdout.write('\n  ' + blue('You') + '\n');
  for (const line of text.split('\n')) {
    process.stdout.write('  ' + chalk.white(line) + '\n');
  }
  process.stdout.write('\n');
}

export function printAssistantHeader(): void {
  const cols = process.stdout.columns || 80;
  const label = ' ' + blue('CodeGrunt') + ' ';
  const labelLen = ' CodeGrunt '.length;
  const fill = Math.max(0, cols - labelLen - 2);
  const half = Math.floor(fill / 2);
  process.stdout.write(
    '\n' + muted('─'.repeat(half)) + label + muted('─'.repeat(fill - half)) + '\n\n'
  );
}

export function printThinkingCollapsed(reasoningText: string, elapsedMs: number): void {
  const secs = Math.round(elapsedMs / 1000);
  const lines = reasoningText.split('\n').filter(l => l.trim());
  const preview = lines.slice(0, 2).map(l => l.slice(0, 70)).join(' · ');
  const suffix = lines.length > 2 ? ' …' : '';
  process.stdout.write(
    muted('  > 推理过程') +
    muted(` (${secs}s)  `) +
    muted(preview + suffix) +
    '\n\n'
  );
}

export function printDiff(filePath: string, oldContent: string, newContent: string): void {
  const patch = createPatch(filePath, oldContent, newContent, '', '', { context: 3 });
  const lines = patch.split('\n');
  const out: string[] = [];
  for (const line of lines.slice(2)) {
    if (line.startsWith('@@')) {
      out.push(blue(line));
    } else if (line.startsWith('+')) {
      out.push(success(line));
    } else if (line.startsWith('-')) {
      out.push(danger(line));
    } else {
      out.push(muted(line));
    }
  }
  process.stdout.write(out.join('\n') + '\n');
}

export function printError(message: string): void {
  process.stderr.write(danger('  error  ') + message + '\n');
}

export function printInfo(message: string): void {
  process.stdout.write(muted('  ' + message) + '\n');
}

export function printDivider(): void {
  process.stdout.write(muted('─'.repeat(process.stdout.columns || 80)) + '\n');
}
