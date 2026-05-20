import chalk from 'chalk';
import { createPatch } from 'diff';
import type { ToolResult } from '../types.js';

// ── Colour palette ──────────────────────────────────────────────────────────
const blue  = (s: string) => chalk.hex('#4A90D9')(s);
const muted = chalk.gray;
const success = chalk.green;
const danger  = chalk.red;

// ── Box drawing helpers ─────────────────────────────────────────────────────

function cardWidth(): number {
  return (process.stdout.columns || 80) - 1;
}

/** Pad/truncate a string to exactly `w` visible characters */
function fitLine(s: string, w: number): string {
  if (s.length > w) return s.slice(0, w - 1) + '…';
  return s + ' '.repeat(w - s.length);
}

/** Top border: ╭─ label ─────╮ */
function topBorder(label: string, w: number): string {
  const inner = w - 2; // inside ╭ and ╮
  const labelPart = '─ ' + label + ' ';
  const fill = Math.max(0, inner - labelPart.length);
  return muted('╭' + labelPart + '─'.repeat(fill) + '╮');
}

/** Bottom border: ╰─ label ──╯ */
function bottomBorder(label: string, w: number): string {
  const inner = w - 2;
  const labelPart = label ? '─ ' + label + ' ' : '';
  const fill = Math.max(0, inner - labelPart.length);
  return muted('╰' + labelPart + '─'.repeat(fill) + '╯');
}

/** Content row: │  text  │ */
function contentRow(text: string, w: number): string {
  const inner = w - 4; // ╭ + space + space + ╮
  return muted('│ ') + fitLine(text, inner) + muted(' │');
}

// ── Tool call card ──────────────────────────────────────────────────────────

export function printToolCall(name: string, args: Record<string, unknown>): void {
  const w = cardWidth();
  const label = blue('⚙ ') + chalk.bold(name);
  process.stdout.write('\n' + topBorder('⚙ ' + name, w) + '\n');

  const entries = Object.entries(args);
  if (entries.length > 0) {
    for (const [k, v] of entries) {
      const val = typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : String(v);
      const row = muted(k + ' = ') + chalk.white(val);
      process.stdout.write(contentRow(row, w) + '\n');
    }
  }
}

export function printToolResult(name: string, result: ToolResult): void {
  const w = cardWidth();
  if (result.success) {
    const preview = result.output.length > 80
      ? result.output.slice(0, 80).replace(/\n/g, ' ') + '…'
      : result.output.replace(/\n/g, ' ');
    process.stdout.write(bottomBorder(success('✓ ') + muted(preview), w) + '\n');
  } else {
    const msg = (result.error ?? result.output).slice(0, 70);
    process.stdout.write(bottomBorder(danger('✗ ') + danger(msg), w) + '\n');
  }
}

// ── Message boundary helpers ────────────────────────────────────────────────

export function printUserMessage(text: string): void {
  const w = cardWidth();
  const lines = text.split('\n');
  process.stdout.write('\n' + topBorder(blue('You'), w) + '\n');
  for (const line of lines) {
    process.stdout.write(contentRow(chalk.white(line), w) + '\n');
  }
  process.stdout.write(bottomBorder('', w) + '\n\n');
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

// ── Thinking block ──────────────────────────────────────────────────────────

export function printThinkingCollapsed(reasoningText: string, elapsedMs: number): void {
  const secs = Math.round(elapsedMs / 1000);
  const lines = reasoningText.split('\n').filter(l => l.trim());
  const preview = lines.slice(0, 2).map(l => l.slice(0, 70)).join(' · ');
  const suffix = lines.length > 2 ? ' …' : '';
  process.stdout.write(
    muted('  ▾ 推理过程') +
    muted(` (${secs}s)  `) +
    muted(preview + suffix) +
    '\n\n'
  );
}

// ── Diff output ─────────────────────────────────────────────────────────────

export function printDiff(filePath: string, oldContent: string, newContent: string): void {
  const patch = createPatch(filePath, oldContent, newContent, '', '', { context: 3 });
  const lines = patch.split('\n');
  for (const line of lines.slice(2)) {
    if (line.startsWith('@@')) {
      process.stdout.write(blue(line) + '\n');
    } else if (line.startsWith('+')) {
      process.stdout.write(success(line) + '\n');
    } else if (line.startsWith('-')) {
      process.stdout.write(danger(line) + '\n');
    } else {
      process.stdout.write(muted(line) + '\n');
    }
  }
}

export function printError(message: string): void {
  process.stderr.write(danger('Error: ') + message + '\n');
}

export function printInfo(message: string): void {
  process.stdout.write(muted(message) + '\n');
}

export function printDivider(): void {
  process.stdout.write(muted('─'.repeat(process.stdout.columns || 80)) + '\n');
}
