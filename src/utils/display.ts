import chalk from 'chalk';
import { createPatch } from 'diff';
import type { ToolResult } from '../types.js';

export function printToolCall(name: string, args: Record<string, unknown>): void {
  const argsStr = formatArgs(args);
  process.stdout.write('\n' + chalk.cyan('  ⚙ ') + chalk.bold(name) + chalk.gray(argsStr) + '\n');
}

export function printToolResult(name: string, result: ToolResult): void {
  if (result.success) {
    const preview = result.output.length > 120
      ? result.output.slice(0, 120).replace(/\n/g, ' ') + '…'
      : result.output.replace(/\n/g, ' ');
    process.stdout.write(chalk.green('  ✓ ') + chalk.gray(preview) + '\n');
  } else {
    process.stdout.write(chalk.red('  ✗ ') + chalk.red(result.error ?? result.output) + '\n');
  }
}

export function printDiff(filePath: string, oldContent: string, newContent: string): void {
  const patch = createPatch(filePath, oldContent, newContent, '', '', { context: 3 });
  const lines = patch.split('\n');
  // Skip the first two header lines (--- / +++ paths) — we already show the filename
  for (const line of lines.slice(2)) {
    if (line.startsWith('@@')) {
      process.stdout.write(chalk.cyan(line) + '\n');
    } else if (line.startsWith('+')) {
      process.stdout.write(chalk.green(line) + '\n');
    } else if (line.startsWith('-')) {
      process.stdout.write(chalk.red(line) + '\n');
    } else {
      process.stdout.write(chalk.gray(line) + '\n');
    }
  }
}

export function printError(message: string): void {
  process.stderr.write(chalk.red('Error: ') + message + '\n');
}

export function printInfo(message: string): void {
  process.stdout.write(chalk.gray(message) + '\n');
}

export function printDivider(): void {
  process.stdout.write(chalk.gray('─'.repeat(60)) + '\n');
}

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '';
  const parts = entries.map(([k, v]) => {
    const val = typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : String(v);
    return `${k}=${val}`;
  });
  return ' ' + parts.join(', ');
}
