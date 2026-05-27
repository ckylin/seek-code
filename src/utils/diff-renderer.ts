import { diffLines, diffWordsWithSpace } from 'diff';
import chalk from 'chalk';

// ── Types ────────────────────────────────────────────────────────────────

export interface DiffStats {
  added: number;
  removed: number;
}

export interface DiffResult {
  output: string;
  format: 'unified';
  stats: DiffStats;
}

// ── Inline word-level highlight ──────────────────────────────────────────

function highlightInline(oldText: string, newText: string): { oldHighlighted: string; newHighlighted: string } {
  const parts = diffWordsWithSpace(oldText, newText);
  let oldHighlighted = '';
  let newHighlighted = '';

  for (const part of parts) {
    if (part.added) {
      newHighlighted += chalk.bgGreen.black(part.value);
    } else if (part.removed) {
      oldHighlighted += chalk.bgRed.white(part.value);
    } else {
      oldHighlighted += part.value;
      newHighlighted += part.value;
    }
  }

  return { oldHighlighted, newHighlighted };
}

// ── Unified diff with inline highlights ─────────────────────────────────

export function renderAdaptiveDiff(
  oldContent: string,
  newContent: string,
  options?: { contextLines?: number },
): DiffResult {
  const contextLines = options?.contextLines ?? 3;
  const changes = diffLines(oldContent, newContent);

  // Expand into flat line list
  type FlatLine = { type: 'ctx' | 'del' | 'add'; text: string };
  const flat: FlatLine[] = [];
  for (const change of changes) {
    const lines = change.value.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const type = change.added ? 'add' : change.removed ? 'del' : 'ctx';
    for (const text of lines) flat.push({ type: type as FlatLine['type'], text });
  }

  // Assign line numbers
  let oldNo = 1;
  let newNo = 1;
  type NumberedLine = { type: FlatLine['type']; oldNo: number; newNo: number; text: string };
  const numbered: NumberedLine[] = flat.map(l => {
    const line: NumberedLine = { type: l.type, oldNo: l.type === 'add' ? 0 : oldNo, newNo: l.type === 'del' ? 0 : newNo, text: l.text };
    if (l.type !== 'add') oldNo++;
    if (l.type !== 'del') newNo++;
    return line;
  });

  // Count stats
  let added = 0;
  let removed = 0;
  for (const l of numbered) {
    if (l.type === 'add') added++;
    else if (l.type === 'del') removed++;
  }

  // Context window
  const changedIdx = new Set<number>();
  for (let i = 0; i < numbered.length; i++) {
    if (numbered[i].type !== 'ctx') changedIdx.add(i);
  }
  const included = new Set<number>();
  for (const k of changedIdx) {
    for (let d = -contextLines; d <= contextLines; d++) {
      const idx = k + d;
      if (idx >= 0 && idx < numbered.length) included.add(idx);
    }
  }

  // Pre-compute inline highlights for adjacent del+add pairs
  // Map: del index → highlighted old text; add index → highlighted new text
  const inlineOld = new Map<number, string>();
  const inlineNew = new Map<number, string>();
  for (let i = 0; i < numbered.length - 1; i++) {
    if (numbered[i].type === 'del' && numbered[i + 1].type === 'add') {
      const { oldHighlighted, newHighlighted } = highlightInline(numbered[i].text, numbered[i + 1].text);
      inlineOld.set(i, oldHighlighted);
      inlineNew.set(i + 1, newHighlighted);
    }
  }

  // Build output
  const maxLineNo = Math.max(oldNo - 1, newNo - 1);
  const padW = String(maxLineNo).length;
  const out: string[] = [];
  let prevIncluded = false;
  let needSep = false;

  for (let i = 0; i < numbered.length; i++) {
    if (!included.has(i)) {
      prevIncluded = false;
      continue;
    }

    if (!prevIncluded && needSep) {
      out.push(chalk.gray(`  ${'─'.repeat(padW + 2)}`));
    }

    const l = numbered[i];
    if (l.type === 'ctx') {
      out.push(chalk.gray(`  ${String(l.oldNo).padStart(padW)}  ${l.text}`));
    } else if (l.type === 'del') {
      const text = inlineOld.has(i) ? inlineOld.get(i)! : l.text;
      out.push(chalk.red(`  ${String(l.oldNo).padStart(padW)} -`) + ' ' + chalk.red(text));
    } else {
      const text = inlineNew.has(i) ? inlineNew.get(i)! : l.text;
      out.push(chalk.green(`  ${String(l.newNo).padStart(padW)} +`) + ' ' + chalk.green(text));
    }

    prevIncluded = true;
    needSep = true;
  }

  return {
    output: out.join('\n'),
    format: 'unified',
    stats: { added, removed },
  };
}

export function formatDiffStats(added: number, removed: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(chalk.green(`+${added}`));
  if (removed > 0) parts.push(chalk.red(`-${removed}`));
  return parts.join(' ');
}
