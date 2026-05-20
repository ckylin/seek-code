import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';

const CONTEXT_LINES = 3;

interface Hunk {
  oldStart: number;
  newStart: number;
  lines: Array<{ type: 'ctx' | 'del' | 'add'; oldNo: number; newNo: number; text: string }>;
}

function computeDiff(oldLines: string[], newLines: string[]): Hunk[] {
  const m = oldLines.length;
  const n = newLines.length;

  if (m * n > 400_000) {
    const hunk: Hunk = { oldStart: 1, newStart: 1, lines: [] };
    for (let i = 0; i < m; i++) hunk.lines.push({ type: 'del', oldNo: i + 1, newNo: 0, text: oldLines[i] });
    for (let i = 0; i < n; i++) hunk.lines.push({ type: 'add', oldNo: 0, newNo: i + 1, text: newLines[i] });
    return [hunk];
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldLines[i - 1] === newLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  type Edit = { type: 'ctx' | 'del' | 'add'; oi: number; ni: number };
  const edits: Edit[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      edits.push({ type: 'ctx', oi: i - 1, ni: j - 1 }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      edits.push({ type: 'add', oi: -1, ni: j - 1 }); j--;
    } else {
      edits.push({ type: 'del', oi: i - 1, ni: -1 }); i--;
    }
  }
  edits.reverse();

  const changed = new Set<number>();
  for (let k = 0; k < edits.length; k++) if (edits[k].type !== 'ctx') changed.add(k);

  const included = new Set<number>();
  for (const k of changed)
    for (let d = -CONTEXT_LINES; d <= CONTEXT_LINES; d++) {
      const idx = k + d;
      if (idx >= 0 && idx < edits.length) included.add(idx);
    }

  if (included.size === 0) return [];

  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;
  let prevIncluded = false;

  for (let k = 0; k < edits.length; k++) {
    const e = edits[k];
    if (!included.has(k)) { if (prevIncluded) currentHunk = null; prevIncluded = false; continue; }
    if (!currentHunk) {
      currentHunk = { oldStart: e.oi + 1, newStart: e.ni + 1, lines: [] };
      hunks.push(currentHunk);
    }
    currentHunk.lines.push({
      type: e.type,
      oldNo: e.oi + 1,
      newNo: e.ni + 1,
      text: e.type === 'del' ? oldLines[e.oi] : newLines[e.ni < 0 ? 0 : e.ni],
    });
    prevIncluded = true;
  }
  return hunks;
}

function countChanges(hunks: Hunk[]): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const h of hunks) for (const l of h.lines) {
    if (l.type === 'add') added++;
    else if (l.type === 'del') removed++;
  }
  return { added, removed };
}

function renderDiff(hunks: Hunk[], totalOldLines: number, totalNewLines: number): string[] {
  const out: string[] = [];
  const lineNoWidth = String(Math.max(totalOldLines, totalNewLines)).length;
  const pad = (n: number): string => n > 0 ? String(n).padStart(lineNoWidth) : ' '.repeat(lineNoWidth);

  for (let hi = 0; hi < hunks.length; hi++) {
    if (hi > 0) out.push(chalk.gray('   ' + ' '.repeat(lineNoWidth * 2 + 3) + '···'));
    for (const l of hunks[hi].lines) {
      if (l.type === 'ctx') {
        out.push(chalk.gray(`   ${pad(l.oldNo)} │ ${l.text}`));
      } else if (l.type === 'del') {
        out.push(chalk.red(`  -${pad(l.oldNo)} │ `) + chalk.red(l.text));
      } else {
        out.push(chalk.green(`  +${pad(l.newNo)} │ `) + chalk.green(l.text));
      }
    }
  }
  return out;
}

function relPath(filePath: string): string {
  const cwd = process.cwd();
  return filePath.startsWith(cwd) ? filePath.slice(cwd.length).replace(/^[\\/]/, '') : filePath;
}

export type ConfirmChoice = 'yes' | 'yes_all_session' | 'no';

// ── Arrow-key selector for confirm choices ──────────────────────────────────

interface SelectorItem {
  value: string;
  label: string;
  desc?: string;
}

function clearLines(n: number): void {
  if (n <= 0) return;
  process.stdout.write(`\x1B[${n}A\r\x1B[J`);
}

function selectFromList(
  title: string,
  items: SelectorItem[],
): Promise<string | null> {
  return new Promise((resolve_p) => {
    const { stdin, stdout } = process;

    if (!stdin.isTTY) {
      resolve_p(items[0]?.value ?? null);
      return;
    }

    let idx = 0;
    let lastHeight = 0;

    const buildLines = (): string[] => {
      const out: string[] = [];
      out.push(chalk.bold('  ' + title));
      out.push('');
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const sel = i === idx;
        const cursor = sel ? chalk.blue('  ❯ ') : '    ';
        const label = sel ? chalk.bold.white(item.label) : chalk.white(item.label);
        const desc = item.desc
          ? chalk.gray('   ' + item.desc.slice(0, (stdout.columns || 80) - item.label.length - 12))
          : '';
        out.push(cursor + label + desc);
      }
      out.push('');
      out.push(chalk.gray('  ↑↓ navigate   Enter confirm   Esc cancel'));
      return out;
    };

    const render = (): void => {
      clearLines(lastHeight);
      const outputLines = buildLines();
      stdout.write(outputLines.join('\r\n'));
      lastHeight = outputLines.length - 1;
    };

    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdout.write('\n');
    lastHeight = 0;
    render();

    const onData = (key: string): void => {
      // Ctrl+C cancels the selection (same as Esc) — does not exit the process.
      if (key === '\x03') { cleanup(); resolve_p(null); return; }
      if (key === '\x1B') { cleanup(); resolve_p(null); return; }
      if (key === '\x1B[A') { idx = (idx - 1 + items.length) % items.length; render(); return; }
      if (key === '\x1B[B') { idx = (idx + 1) % items.length; render(); return; }
      if (key === '\r' || key === '\n') { cleanup(); resolve_p(items[idx].value); return; }
    };

    stdin.on('data', onData);
  });
}

// ── Confirm prompt ──────────────────────────────────────────────────────────

async function promptConfirm(): Promise<ConfirmChoice> {
  const items: SelectorItem[] = [
    { value: 'yes', label: 'Yes — 接受这次修改' },
    { value: 'yes_all_session', label: 'Yes for all — 本次会话中所有类似修改都自动接受' },
    { value: 'no', label: 'No — 拒绝这次修改' },
  ];

  const selected = await selectFromList('Confirm edit', items);
  if (selected === null) return 'no'; // Esc → treat as no
  return selected as ConfirmChoice;
}

export async function confirmEdit(filePath: string, newContent: string): Promise<ConfirmChoice> {
  const absPath = resolve(filePath);
  const exists = existsSync(absPath);
  const oldContent = exists ? await readFile(absPath, 'utf-8') : '';

  const oldLines = oldContent ? oldContent.split('\n') : [];
  const newLines = newContent.split('\n');
  const hunks = computeDiff(oldLines, newLines);
  const { added, removed } = countChanges(hunks);

  const cols = Math.min(process.stdout.columns || 80, 80);
  const isNew = !exists;
  const fileLabel = (isNew ? chalk.green('⊕ ') : chalk.yellow('✎ ')) + chalk.bold(relPath(absPath));
  const stats = added > 0 || removed > 0
    ? '  ' + chalk.green(`+${added}`) + ' ' + chalk.red(`-${removed}`)
    : '';
  const headerText = fileLabel + stats;
  // Strip ANSI for length calculation
  const headerPlain = (isNew ? '⊕ ' : '✎ ') + relPath(absPath) + (added > 0 || removed > 0 ? `  +${added} -${removed}` : '');
  const topFill = Math.max(0, cols - 2 - headerPlain.length - 2);
  const topBorder = chalk.gray('╭─ ') + headerText + chalk.gray(' ' + '─'.repeat(topFill) + '╮');

  process.stdout.write('\n' + topBorder + '\n');

  if (hunks.length === 0 && !isNew) {
    process.stdout.write(chalk.gray('│  (no changes)') + '\n');
  } else {
    for (const line of renderDiff(hunks, oldLines.length, newLines.length)) {
      process.stdout.write(chalk.gray('│') + line + '\n');
    }
  }

  process.stdout.write(chalk.gray('╰' + '─'.repeat(cols - 2) + '╯') + '\n');

  return promptConfirm();
}

export function applyEdit(original: string, oldString: string, newString: string): string | null {
  if (!original.includes(oldString)) return null;
  return original.replace(oldString, newString);
}
