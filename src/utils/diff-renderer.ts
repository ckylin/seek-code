/**
 * Adaptive diff renderer — selects the best display format based on change size:
 *   - Small changes (≤5 lines): compact unified diff
 *   - Medium changes: unified diff with context
 *   - Large block replacements (≥6 consecutive lines): side-by-side diff
 *
 * Ref: replaces computeDiff()/renderDiff() in confirm.ts and printDiff() in display.ts
 */

import { diffLines, diffArrays } from 'diff';
import chalk from 'chalk';
import { ACCENT } from './constants.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface DiffStats {
  added: number;
  removed: number;
  /** Largest block of consecutive add+remove lines (no context between them) */
  maxConsecutiveChanged: number;
}

export interface DiffResult {
  output: string;
  format: 'unified' | 'side-by-side';
  stats: DiffStats;
}

interface SideBySideRow {
  oldNo: number;   // 0 if no old line on this row
  newNo: number;   // 0 if no new line on this row
  oldText: string;
  newText: string;
  type: 'ctx' | 'del' | 'add' | 'mod';
}

// ── Thresholds ──────────────────────────────────────────────────────────

/** Consecutive changed block ≥ this → side-by-side for comparison */
const SIDE_BY_SIDE_MIN_BLOCK = 6;

/** Content chars per side in side-by-side, min */
const SIDEBYSIDE_MIN_CONTENT = 20;

// ── Stats ───────────────────────────────────────────────────────────────

function analyzeDiff(oldContent: string, newContent: string): DiffStats {
  const changes = diffLines(oldContent, newContent);
  let added = 0;
  let removed = 0;
  let consecutiveChanged = 0;
  let maxConsecutive = 0;

  for (const change of changes) {
    const lines = change.value.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();

    if (change.added) {
      added += lines.length;
      consecutiveChanged += lines.length;
    } else if (change.removed) {
      removed += lines.length;
      consecutiveChanged += lines.length;
    } else {
      // Context resets the consecutive counter
      // But only if there's a meaningful gap (>1 context line basically)
      // For hunk purposes, any context resets it
      maxConsecutive = Math.max(maxConsecutive, consecutiveChanged);
      consecutiveChanged = 0;
    }
  }
  maxConsecutive = Math.max(maxConsecutive, consecutiveChanged);

  return { added, removed, maxConsecutiveChanged: maxConsecutive };
}

// ── Unified Diff ────────────────────────────────────────────────────────

function renderUnified(
  oldContent: string,
  newContent: string,
  contextLines: number,
): { output: string; numbered: Array<{ type: 'ctx' | 'del' | 'add'; oldNo: number; newNo: number; text: string }> } {
  const changes = diffLines(oldContent, newContent);

  // Expand into flat line list
  const flat: Array<{ type: 'ctx' | 'del' | 'add'; text: string }> = [];
  for (const change of changes) {
    const lines = change.value.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const type = change.added ? 'add' as const : change.removed ? 'del' as const : 'ctx' as const;
    for (const text of lines) flat.push({ type, text });
  }

  // Assign line numbers
  let oldNo = 1;
  let newNo = 1;
  const numbered = flat.map(l => {
    const line = {
      type: l.type,
      oldNo: l.type === 'add' ? 0 : oldNo,
      newNo: l.type === 'del' ? 0 : newNo,
      text: l.text,
    };
    if (l.type !== 'add') oldNo++;
    if (l.type !== 'del') newNo++;
    return line;
  });

  // Find changed indices
  const changedIdx = new Set<number>();
  for (let i = 0; i < numbered.length; i++) {
    if (numbered[i].type !== 'ctx') changedIdx.add(i);
  }

  // Context window
  const included = new Set<number>();
  for (const k of changedIdx) {
    for (let d = -contextLines; d <= contextLines; d++) {
      const idx = k + d;
      if (idx >= 0 && idx < numbered.length) included.add(idx);
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
      // Hunk separator
      out.push(chalk.gray(`  ${'─'.repeat(padW)} ─`));
    }

    const l = numbered[i];
    if (l.type === 'ctx') {
      out.push(chalk.gray(`  ${String(l.oldNo).padStart(padW)}  ${l.text}`));
    } else if (l.type === 'del') {
      out.push(chalk.red(`  ${String(l.oldNo).padStart(padW)} - ${l.text}`));
    } else {
      out.push(chalk.green(`  ${String(l.newNo).padStart(padW)} + ${l.text}`));
    }

    prevIncluded = true;
    needSep = true;
  }

  return { output: out.join('\n'), numbered };
}

// ── Side-by-Side Diff ───────────────────────────────────────────────────

function buildSideBySideRows(oldLines: string[], newLines: string[]): SideBySideRow[] {
  const changes = diffArrays(oldLines, newLines);
  const rows: SideBySideRow[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];

    if (!change.added && !change.removed) {
      // Unchanged lines — pair them 1:1
      for (let j = 0; j < change.count; j++) {
        rows.push({
          oldNo: oldIdx + j + 1,
          newNo: newIdx + j + 1,
          oldText: oldLines[oldIdx + j],
          newText: newLines[newIdx + j],
          type: 'ctx',
        });
      }
      oldIdx += change.count;
      newIdx += change.count;
    } else if (change.removed) {
      // Removed lines — check if followed by added (→ modifications)
      const removedTexts: string[] = [];
      for (let j = 0; j < change.count; j++) {
        removedTexts.push(oldLines[oldIdx + j]);
      }

      const nextChange = changes[i + 1];
      if (nextChange && nextChange.added) {
        // Adjacent removed + added → treat as modified block, pair line-by-line
        const addedTexts: string[] = [];
        for (let j = 0; j < nextChange.count; j++) {
          addedTexts.push(newLines[newIdx + j]);
        }

        const maxLen = Math.max(removedTexts.length, addedTexts.length);
        for (let j = 0; j < maxLen; j++) {
          const hasOld = j < removedTexts.length;
          const hasNew = j < addedTexts.length;
          rows.push({
            oldNo: hasOld ? oldIdx + j + 1 : 0,
            newNo: hasNew ? newIdx + j + 1 : 0,
            oldText: hasOld ? removedTexts[j] : '',
            newText: hasNew ? addedTexts[j] : '',
            type: hasOld && hasNew ? 'mod' : hasOld ? 'del' : 'add',
          });
        }

        oldIdx += change.count;
        newIdx += nextChange.count;
        i++; // Consumed the next (added) change
      } else {
        // Pure deletion
        for (let j = 0; j < change.count; j++) {
          rows.push({
            oldNo: oldIdx + j + 1,
            newNo: 0,
            oldText: oldLines[oldIdx + j],
            newText: '',
            type: 'del',
          });
        }
        oldIdx += change.count;
      }
    } else if (change.added) {
      // Pure addition (not preceded by removal)
      for (let j = 0; j < change.count; j++) {
        rows.push({
          oldNo: 0,
          newNo: newIdx + j + 1,
          oldText: '',
          newText: newLines[newIdx + j],
          type: 'add',
        });
      }
      newIdx += change.count;
    }
  }

  return rows;
}

function renderSideBySide(
  oldContent: string,
  newContent: string,
  terminalWidth: number,
): string {
  const oldLines = oldContent ? oldContent.split('\n') : [''];
  const newLines = newContent ? newContent.split('\n') : [''];

  const rows = buildSideBySideRows(oldLines, newLines);
  const maxLineNo = Math.max(oldLines.length, newLines.length);
  const padW = String(maxLineNo).length;

  // Calculate available content width per side
  // Layout: "  " + padW + " " + type + " " + content + " │ " + padW + " " + type + " " + content
  const margin = 2;          // leading spaces
  const sepWidth = 3;        // " │ "
  const typeAndGap = 3;      // " - " or " + " or "   " (3 chars) — Ref: formatSideBySideRow L240-270
  const fixedPerSide = margin + padW + typeAndGap;
  const availableForContent = terminalWidth - fixedPerSide * 2 - sepWidth;
  const contentWidth = Math.max(
    SIDEBYSIDE_MIN_CONTENT,
    Math.floor(availableForContent / 2),
  );

  const blue = chalk.hex(ACCENT);
  const out: string[] = [];

  // Column headers
  // Layout per side: margin(2) + padW + typeAndGap(3) + contentWidth
  const prefixSpaces = ' '.repeat(margin + padW + typeAndGap);
  // Use ASCII labels to avoid CJK double-width issues
  const leftLabel = '[old]';
  const rightLabel = '[new]';
  const leftHeaderPad = Math.max(0, contentWidth - leftLabel.length);
  const rightHeaderPad = Math.max(0, contentWidth - rightLabel.length);
  out.push(
    prefixSpaces + chalk.bold(leftLabel) + ' '.repeat(leftHeaderPad) +
    ' │ ' +
    prefixSpaces + chalk.bold(rightLabel) + ' '.repeat(rightHeaderPad),
  );

  // Divider line — uses '─│─' to match the ' │ ' separator in data rows,
  // all gray so the vertical bar visually aligns with data-row pipes.
  const prefixForDivider = ' '.repeat(margin + padW);
  const dashes = chalk.gray('─'.repeat(typeAndGap + contentWidth));
  out.push(
    prefixForDivider + dashes + chalk.gray('─│─') + dashes + prefixForDivider,
  );

  // Build rows, grouping context rows for brevity
  const renderedRows: string[] = [];
  let ctxSkipCount = 0;

  const flushCtxSkip = () => {
    if (ctxSkipCount > 0) {
      const msg = `  ... ${ctxSkipCount} 行未变更 ...`;
      const leftPart = ' '.repeat(margin + padW + typeAndGap);
      renderedRows.push(
        leftPart + chalk.gray(msg.padEnd(contentWidth)) + ' │ ' +
        leftPart + chalk.gray(msg.padEnd(contentWidth)),
      );
      ctxSkipCount = 0;
    }
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Context collapsing: skip long runs of ctx rows, show only first 3 and last 3
    if (row.type === 'ctx') {
      // Check if we should collapse
      const isNearEdge = i < 3 || i >= rows.length - 3;
      const isNearChange = rows.slice(Math.max(0, i - 3), i + 4).some(
        r => r.type !== 'ctx',
      );

      if (isNearEdge || isNearChange) {
        flushCtxSkip();
        renderedRows.push(formatSideBySideRow(row, padW, contentWidth, margin));
      } else {
        ctxSkipCount++;
      }
    } else {
      flushCtxSkip();
      renderedRows.push(formatSideBySideRow(row, padW, contentWidth, margin));
    }
  }
  // Don't flush trailing context skip — it's clear the file continues

  out.push(...renderedRows);
  return out.join('\n');
}

function formatSideBySideRow(
  row: SideBySideRow,
  padW: number,
  contentWidth: number,
  margin: number,
): string {
  const truncate = (s: string, w: number): string => {
    if (s.length <= w) return s.padEnd(w);
    return s.slice(0, w - 1) + '…';
  };

  const prefix = ' '.repeat(margin);

  // Left side
  const leftNo = row.oldNo > 0 ? String(row.oldNo).padStart(padW) : ' '.repeat(padW);
  if (row.type === 'del' || row.type === 'mod') {
    const leftContent = prefix + chalk.red(leftNo + ' - ') + chalk.red(truncate(row.oldText, contentWidth));
    // Right side
    if (row.type === 'mod') {
      const rightNo = row.newNo > 0 ? String(row.newNo).padStart(padW) : ' '.repeat(padW);
      const rightContent = prefix + chalk.green(rightNo + ' + ') + chalk.green(truncate(row.newText, contentWidth));
      return leftContent + ' │ ' + rightContent;
    } else {
      // del only
      const rightNo = ' '.repeat(padW);
      const rightContent = prefix + chalk.gray(rightNo + '   ') + ' '.repeat(contentWidth);
      return leftContent + ' │ ' + rightContent;
    }
  } else if (row.type === 'add') {
    const leftNo = ' '.repeat(padW);
    const leftContent = prefix + chalk.gray(leftNo + '   ') + ' '.repeat(contentWidth);
    const rightNo = String(row.newNo).padStart(padW);
    const rightContent = prefix + chalk.green(rightNo + ' + ') + chalk.green(truncate(row.newText, contentWidth));
    return leftContent + ' │ ' + rightContent;
  } else {
    // ctx
    const leftContent = prefix + chalk.gray(leftNo + '   ') + chalk.gray(truncate(row.oldText, contentWidth));
    const rightNo = String(row.newNo).padStart(padW);
    const rightContent = prefix + chalk.gray(rightNo + '   ') + chalk.gray(truncate(row.newText, contentWidth));
    return leftContent + ' │ ' + rightContent;
  }
}

// ── Adaptive Renderer ───────────────────────────────────────────────────

export function renderAdaptiveDiff(
  oldContent: string,
  newContent: string,
  options?: {
    contextLines?: number;
    terminalWidth?: number;
  },
): DiffResult {
  const stats = analyzeDiff(oldContent, newContent);
  const contextLines = options?.contextLines ?? 3;
  const termWidth = options?.terminalWidth ?? (process.stdout.columns || 100);

  // Decision: side-by-side or unified?
  // Use side-by-side when a single block of consecutive changes is large enough
  // that unified diff would just be a red blob followed by a green blob with no
  // visual correspondence between old and new lines.
  const useSideBySide = stats.maxConsecutiveChanged >= SIDE_BY_SIDE_MIN_BLOCK;

  if (useSideBySide) {
    return {
      output: renderSideBySide(oldContent, newContent, termWidth),
      format: 'side-by-side',
      stats,
    };
  }

  const { output } = renderUnified(oldContent, newContent, contextLines);
  return {
    output,
    format: 'unified',
    stats,
  };
}

// ── Simplified post-execution summary (no full diff, stats only) ────────

export function formatDiffStats(added: number, removed: number): string {
  const parts: string[] = [];
  if (added > 0) parts.push(chalk.green(`+${added}`));
  if (removed > 0) parts.push(chalk.red(`-${removed}`));
  return parts.join(' ');
}
