import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import { diffLines } from 'diff';
import { selectFromList } from './select.js';
import { ACCENT } from './constants.js';

const CONTEXT_LINES = 3;

interface DiffLine {
  type: 'ctx' | 'del' | 'add';
  oldNo: number;
  newNo: number;
  text: string;
}

interface Hunk {
  lines: DiffLine[];
}

function computeDiff(oldContent: string, newContent: string): { hunks: Hunk[]; added: number; removed: number } {
  const changes = diffLines(oldContent, newContent);

  // Expand into flat line list with type tags
  type FlatLine = { type: 'ctx' | 'del' | 'add'; text: string };
  const flat: FlatLine[] = [];
  for (const change of changes) {
    const lines = change.value.split('\n');
    // diffLines includes a trailing empty string when value ends with \n
    if (lines[lines.length - 1] === '') lines.pop();
    const type: 'ctx' | 'del' | 'add' = change.added ? 'add' : change.removed ? 'del' : 'ctx';
    for (const text of lines) flat.push({ type, text });
  }

  // Assign line numbers
  let oldNo = 1, newNo = 1;
  const numbered: DiffLine[] = flat.map((l) => {
    const line: DiffLine = { type: l.type, oldNo: l.type === 'add' ? 0 : oldNo, newNo: l.type === 'del' ? 0 : newNo, text: l.text };
    if (l.type !== 'add') oldNo++;
    if (l.type !== 'del') newNo++;
    return line;
  });

  // Count changes
  let added = 0, removed = 0;
  for (const l of numbered) {
    if (l.type === 'add') added++;
    else if (l.type === 'del') removed++;
  }

  if (added === 0 && removed === 0) return { hunks: [], added: 0, removed: 0 };

  // Group into hunks with context
  const changedIdx = new Set<number>();
  for (let i = 0; i < numbered.length; i++) {
    if (numbered[i].type !== 'ctx') changedIdx.add(i);
  }

  const included = new Set<number>();
  for (const k of changedIdx) {
    for (let d = -CONTEXT_LINES; d <= CONTEXT_LINES; d++) {
      const idx = k + d;
      if (idx >= 0 && idx < numbered.length) included.add(idx);
    }
  }

  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;
  let prevIncluded = false;

  for (let i = 0; i < numbered.length; i++) {
    if (!included.has(i)) {
      if (prevIncluded) currentHunk = null;
      prevIncluded = false;
      continue;
    }
    if (!currentHunk) {
      currentHunk = { lines: [] };
      hunks.push(currentHunk);
    }
    currentHunk.lines.push(numbered[i]);
    prevIncluded = true;
  }

  return { hunks, added, removed };
}

function renderDiff(hunks: Hunk[], totalOldLines: number, totalNewLines: number): string[] {
  const out: string[] = [];
  const lineNoWidth = String(Math.max(totalOldLines, totalNewLines)).length;
  const pad = (n: number): string => n > 0 ? String(n).padStart(lineNoWidth) : ' '.repeat(lineNoWidth);

  for (let hi = 0; hi < hunks.length; hi++) {
    if (hi > 0) out.push(chalk.gray('  ' + '·'.repeat(lineNoWidth + 4)));
    for (const l of hunks[hi].lines) {
      if (l.type === 'ctx') {
        out.push(chalk.gray(`  ${pad(l.oldNo)}   ${l.text}`));
      } else if (l.type === 'del') {
        out.push(chalk.red(`  ${pad(l.oldNo)} - `) + chalk.red(l.text));
      } else {
        out.push(chalk.green(`  ${pad(l.newNo)} + `) + chalk.green(l.text));
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

// ── Confirm prompt ──────────────────────────────────────────────────────────

async function promptConfirm(): Promise<ConfirmChoice> {
  const items = [
    { value: 'yes', label: 'Yes — 接受这次修改' },
    { value: 'yes_all_session', label: 'Yes for all — 本次会话中所有类似修改都自动接受' },
    { value: 'no', label: 'No — 拒绝这次修改' },
  ];

  const selected = await selectFromList('Confirm edit', items);
  if (selected === null) return 'no';
  return selected as ConfirmChoice;
}

/**
 * Show diff and prompt for confirmation. Accepts optional pre-read content
 * to avoid redundant disk read when the caller already has the file content.
 *
 * @returns The user's choice AND the original file content (so the caller
 *          can pass it to the tool to avoid a second read).
 */
export async function confirmEdit(
  filePath: string,
  newContent: string,
  preReadOriginal?: string,
): Promise<{ choice: ConfirmChoice; originalContent: string }> {
  const absPath = resolve(filePath);
  const exists = preReadOriginal !== undefined ? preReadOriginal !== '' : existsSync(absPath);
  const oldContent = preReadOriginal !== undefined
    ? preReadOriginal
    : (exists ? await readFile(absPath, 'utf-8') : '');

  const oldLines = oldContent ? oldContent.split('\n') : [];
  const newLines = newContent.split('\n');
  const { hunks, added, removed } = computeDiff(oldContent, newContent);

  const isNew = !exists;
  const fileLabel = (isNew ? chalk.green('new') : chalk.yellow('edit')) + '  ' + chalk.bold(relPath(absPath));
  const stats = added > 0 || removed > 0
    ? '  ' + chalk.green(`+${added}`) + ' ' + chalk.red(`-${removed}`)
    : '';

  process.stdout.write('\n  ' + fileLabel + stats + '\n\n');

  if (hunks.length === 0 && !isNew) {
    process.stdout.write(chalk.gray('  (no changes)') + '\n');
  } else {
    const diffOutput = renderDiff(hunks, oldLines.length, newLines.length);
    process.stdout.write(diffOutput.join('\n') + '\n');
  }

  process.stdout.write('\n');

  const choice = await promptConfirm();
  return { choice, originalContent: oldContent };
}

export function applyEdit(original: string, oldString: string, newString: string): string | null {
  if (!original.includes(oldString)) return null;
  return original.replace(oldString, newString);
}
