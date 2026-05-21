import { readdir, access } from 'fs/promises';
import { resolve, dirname, basename, join } from 'path';
import chalk from 'chalk';
import stringWidth from 'string-width';
import { getSessionUsage } from '../core/agent/loop.js';
import type { Skill } from './skills.js';
import { selectFromList } from '../utils/select.js';
import { ACCENT } from '../utils/constants.js';
import { acquireRawMode, releaseRawMode } from '../utils/rawMode.js';
export type { SelectorItem } from '../utils/select.js';
export { selectFromList };

export interface InputResult {
  text: string;
  cancelled: boolean;
}

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

export type SlashCommandKind = 'builtin' | 'skill';

// Logo blue — matches banner.ts and display.ts
const border = (w: number): string => chalk.hex(ACCENT)('─'.repeat(w));

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

const history: string[] = [];

/** Build the hint line shown below the bottom border */
function buildHintLine(model?: string, activeSkill?: string, contextFile?: string | null): string {
  const usage = getSessionUsage();
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const tokenStr = totalTokens > 0
    ? (totalTokens >= 1000 ? (totalTokens / 1000).toFixed(1) + 'k' : String(totalTokens)) + ' tokens'
    : '';

  const sep = chalk.gray('  ·  ');
  const parts: string[] = [];

  if (activeSkill) {
    parts.push(
      chalk.bgHex('#6C63FF').hex('#FFFFFF').bold(' SKILL ') +
      ' ' +
      chalk.hex('#6C63FF').bold(activeSkill),
    );
  }
  if (model) parts.push(chalk.hex(ACCENT)(model));
  if (tokenStr) parts.push(chalk.gray(tokenStr));
  if (contextFile) parts.push(chalk.gray('In ' + contextFile));

  // Ref: Hint shows actually-available shortcuts, not phantom keys
  const hint = activeSkill
    ? chalk.gray('Ctrl+J newline  /exit to leave skill')
    : chalk.gray('Ctrl+J newline  Esc clear  Ctrl+A/E ↖↘');

  parts.push(hint);

  return '  ' + parts.join(sep);
}

// ── Raw-mode input with bottom border ────────────────────────────────────────
//
// Layout (terminal width W):
//
//   <─────────────────── W ───────────────────>
//   > <user input>
//   -----------------------------------------   ← bottom border (accent color)
//     model  ·  tokens  ·  hint               ← hint line (gray, below border)
//
// Only the bottom horizontal line uses special rendering; the input line itself
// is plain text so readline/raw-mode cursor positioning stays trivial.

export function readMultilineInput(
  cwd = process.cwd(),
  model?: string,
  skills: Skill[] = [],
  activeSkill?: string,
): Promise<InputResult> {
  return new Promise((resolve_p) => {
    const { stdin, stdout } = process;

    // Non-TTY: read until EOF
    if (!stdin.isTTY) {
      let buf = '';
      const onData = (chunk: Buffer): void => { buf += chunk.toString(); };
      const onEnd = (): void => {
        stdin.removeListener('data', onData);
        resolve_p({ text: buf.trim(), cancelled: false });
      };
      stdin.resume();
      stdin.on('data', onData);
      stdin.once('end', onEnd);
      return;
    }

    // ── State ────────────────────────────────────────────────────────────────
    let cpBuf: string[] = [];          // Unicode code points
    let buffer = '';                   // cpBuf.join('') — kept in sync
    let cursor = 0;                    // code-point index
    let historyIdx = history.length;
    let historySavedDraft: string[] | null = null;
    let dropdownVisible = false;
    let dropdownIdx = 0;
    let dropdownMode: 'slash' | 'at' = 'slash';
    let atCompletions: string[] = [];
    let contextFile: string | null = null;
    // Total number of lines written in the previous render call.
    // Used to reliably clear the entire old block before re-rendering.
    // This is more robust than tracking rowsAboveCursor (which can get out of
    // sync after Escape, resize, or async callbacks), preventing old dropdown
    // items from appearing to duplicate.
    let lastRenderLineCount = 0;
    // Total height of the rendered block (dropdown + input rows + border + hint).
    // Used by onResize to clear with a safety margin, since terminal reflow
    // after resize can shift the cursor's physical row, making lastRenderLineCount stale.
    let lastBlockTotalHeight = 0;
    // Cached slash command filter result — recomputed only when buffer changes.
    let cachedFilteredCommands: Array<{ name: string; desc: string; kind: SlashCommandKind }> = [];
    // Generation counter to prevent stale async file-completion results (race condition).
    // Incremented each time we fire an async getFileCompletions; stale callbacks discard themselves.
    let atGeneration = 0;

    /** Clamp cursor into [0, cpBuf.length] so it never goes out of bounds. */
    const clampCursor = (): void => {
      if (cursor < 0) cursor = 0;
      if (cursor > cpBuf.length) cursor = cpBuf.length;
    };

    const syncBuffer = (): void => {
      buffer = cpBuf.join('');
      cachedFilteredCommands = getFilteredCommands();
      clampCursor();
    };

    const termW = (): number => stdout.columns || 80;

    acquireRawMode();

    // Re-render on terminal resize — recompute cursor position under new width
    // because the terminal reflows content, placing the cursor at the position
    // corresponding to the same logical character but under the new column count.
    // Use lastBlockTotalHeight + 2 as a safety margin: terminal reflow after
    // resize can shift the cursor's physical row, making lastRenderLineCount stale.
    const onResize = (): void => {
      const clearRows = lastBlockTotalHeight > 0 ? lastBlockTotalHeight + 2 : 0;
      if (clearRows > 0) {
        stdout.write(`\x1B[${clearRows}A`);
      }
      stdout.write('\r\x1B[J');
      lastRenderLineCount = 0;
      lastBlockTotalHeight = 0;
      render();
    };
    process.stdout.on('resize', onResize);

    const cleanup = (): void => {
      process.stdout.removeListener('resize', onResize);
      stdin.removeListener('data', onData);
      releaseRawMode();
    };

    // ── Helpers ───────────────────────────────────────────────────────────────

    const getFilteredCommands = (): Array<{ name: string; desc: string; kind: SlashCommandKind }> => {
      const all = [
        ...SLASH_COMMANDS.map(c => ({ ...c, kind: 'builtin' as SlashCommandKind })),
        ...skills.map(s => ({ name: '/' + s.name, desc: s.description ?? `skill (${s.source})`, kind: 'skill' as SlashCommandKind })),
      ];
      if (buffer === '/') return all;
      if (buffer.startsWith('/') && buffer.length > 1 && buffer[1] !== ' ') {
        return all.filter(c => c.name.startsWith(buffer));
      }
      return [];
    };

    const isSlashMode = (): boolean =>
      buffer === '/' || (buffer.startsWith('/') && buffer.length > 1 && buffer[1] !== ' ');

    /** Extract the @partial token immediately before the cursor, or null */
    const getAtPartial = (): string | null => {
      const before = cpBuf.slice(0, cursor).join('');
      const match = before.match(/@(\S*)$/);
      return match ? match[1] : null;
    };

    /**
     * Initiate an async @-file completion request, protected by a generation
     * counter to prevent stale results from overwriting fresh ones (race condition).
     *
     * IMPORTANT: Always call render() BEFORE firing the async request so the
     * keystroke's effect (char insertion / deletion / cursor move) is reflected
     * on screen immediately.  The dropdown will update when the async callback
     * completes.  Without this, every keystroke after an @ feels laggy because
     * render waits for file I/O.
     */
    const triggerAtCompletions = (): void => {
      const partial = getAtPartial();
      if (partial === null) {
        if (dropdownMode === 'at') dropdownVisible = false;
        render();
        return;
      }
      // Render immediately so the typed character / cursor move is visible now
      render();
      const gen = ++atGeneration;
      getFileCompletions(partial, cwd).then((completions) => {
        // Discard stale results — another request was fired after this one.
        if (gen !== atGeneration) return;
        if (completions.length > 0) {
          atCompletions = completions;
          dropdownMode = 'at';
          dropdownVisible = true;
          dropdownIdx = 0;
        } else {
          if (dropdownMode === 'at') dropdownVisible = false;
        }
        render();
      });
    };

    const completeAt = (completion: string): void => {
      const before = cpBuf.slice(0, cursor).join('');
      const match = before.match(/@(\S*)$/);
      if (!match) return;
      const partialLen = match[1].length;
      cpBuf.splice(cursor - partialLen, partialLen, ...completion.split(''));
      cursor = cursor - partialLen + completion.length;
      syncBuffer();
    };

    // ── Render ────────────────────────────────────────────────────────────────

    /**
     * How many terminal rows does a line of `visibleLen` columns occupy
     * when the terminal is `w` columns wide?
     * A line that exactly fills the terminal still occupies 1 row (no wrap).
     */
    const visualRows = (visibleLen: number, w: number): number =>
      Math.max(1, Math.ceil(visibleLen / w));

    const render = (): void => {
      const w = termW();

      // Dropdown items (rendered above the top border)
      const dropItems = dropdownVisible
        ? (dropdownMode === 'slash'
            ? cachedFilteredCommands.map(c => ({
                label: c.name,
                desc: c.desc || '',
                kind: c.kind,
              }))
            : atCompletions.map(c => ({ label: c, desc: '', kind: 'builtin' as SlashCommandKind })))
        : [];

      // Hide cursor during repaint
      stdout.write('\x1B[?25l');

      // Clear the entire previously rendered block by moving up lastRenderLineCount
      // lines and erasing from there to end of screen.  This is more robust than
      // the old rowsAboveCursor approach because it doesn't depend on the cursor
      // still being exactly where we left it — it just rewinds the entire block.
      if (lastRenderLineCount > 0) {
        stdout.write(`\x1B[${lastRenderLineCount}A`);
      }
      stdout.write('\r\x1B[J');

      // Dropdown rows (above top border)
      for (let i = 0; i < dropItems.length; i++) {
        const sel = i === dropdownIdx;
        const cur = sel ? chalk.hex(ACCENT)('  ❯ ') : '    ';
        const labelText = dropItems[i].label;
        const descText = dropItems[i].desc;
        const label = sel
          ? chalk.bold.hex(ACCENT)(labelText)
          : (dropItems[i].kind === 'skill' ? chalk.white(labelText) : chalk.hex(ACCENT)(labelText));
        const maxDescW = Math.max(0, w - 4 - stringWidth(labelText) - 3);
        const desc = descText
          ? chalk.gray('  ' + (dropItems[i].kind === 'skill' && !sel ? chalk.dim.gray('[skill] ') : '') + descText.slice(0, maxDescW))
          : '';
        stdout.write(cur + label + desc + '\r\n');
      }

      // Input line — may wrap across multiple rows when text is long
      const inputText = cpBuf.join('');
      const inputVisibleW = 2 + stringWidth(inputText); // "> " prefix = 2 cols
      const inputRows = visualRows(inputVisibleW, w);
      stdout.write(chalk.hex(ACCENT)('> ') + inputText + '\r\n');

      // Bottom border (1 row)
      stdout.write(border(w) + '\r\n');

      // Hint line (1 row, below bottom border) — no trailing \r\n to avoid
      // scrolling when hint is at the bottom of the terminal, which would
      // shift all lines and corrupt lastRenderLineCount tracking.
      stdout.write(buildHintLine(model, activeSkill, contextFile));

      // ── Reposition cursor onto the input line ──────────────────────────────
      // Cursor is now at the END of the hint line (no \r\n written).
      // Distance to cursor row in input (moving up from hint line end):
      //   1 (hint → border)
      // + 1 (border → last input row)
      // + rowsBelowCursorInInput (last input row → cursor row, going up)
      const cursorTextW = stringWidth(cpBuf.slice(0, cursor).join(''));
      const cursorColInInput = 2 + cursorTextW; // "> " = 2 cols

      // Clamp cursor visual row to [0, effectiveInputRows-1] so the cursor never
      // overflows onto the border line.
      // Compute effectiveInputRows BEFORE clamping cursorVisualRow: when
      // cursorColInInput is an exact multiple of w (cursor at start of a new
      // visual row), Math.floor gives the correct row index but inputRows
      // (computed from the full text width) may be one less, causing the old
      // clamp to incorrectly push cursorVisualRow back by one row.
      let cursorVisualRow = Math.floor(cursorColInInput / w);
      const effectiveInputRows = Math.max(inputRows, cursorVisualRow + 1);
      if (cursorVisualRow >= effectiveInputRows) {
        cursorVisualRow = effectiveInputRows - 1;
      }

      const rowsBelowCursorInInput = effectiveInputRows - 1 - cursorVisualRow;
      const moveUp = 2 + rowsBelowCursorInInput;
      stdout.write(`\r\x1B[${moveUp}A`);

      // Horizontal position within the cursor's visual row.
      // When the cursor wraps to column 0 of a new line (cursorColInInput
      // is an exact multiple of w), keep cursorCol at 0 — we've already
      // placed it on the correct row above.
      const cursorCol = cursorColInInput % w;
      stdout.write('\r' + (cursorCol > 0 ? `\x1B[${cursorCol}C` : ''));

      // Track distance from cursor to top of block so the next render (or
      // clearPanel) can move up exactly to the block start and erase to EOD.
      // After moveUp, cursor sits at row (dropItems.length + cursorVisualRow)
      // inside the block — that is the distance we need to rewind next time.
      lastRenderLineCount = dropItems.length + cursorVisualRow;
      // Track total block height for resize clearing: dropdown rows + input rows
      // + 1 border row + 1 hint row (hint has no \r\n but occupies a line).
      lastBlockTotalHeight = dropItems.length + effectiveInputRows + 2;

      stdout.write('\x1B[?25h');
    };

    // ── Erase panel ───────────────────────────────────────────────────────────

    const clearPanel = (): void => {
      // Cancel any in-flight async file-completion callbacks so they don't
      // call render() after the panel has been cleared (ghost rendering).
      atGeneration++;
      if (lastRenderLineCount > 0) {
        stdout.write(`\x1B[${lastRenderLineCount}A`);
      }
      // Always erase from column 0 of the current line (top of block) to end
      // of screen — covers border + hint rows that sit below the cursor.
      stdout.write('\r\x1B[J');
      lastRenderLineCount = 0;
      lastBlockTotalHeight = 0;
    };

    // ── Commit ────────────────────────────────────────────────────────────────

    const commitInput = (): void => {
      const text = buffer.trim();

      if (text === '/') {
        cleanup();
        dropdownVisible = false;
        clearPanel();
        void showSlashCommandSelector(skills).then((selected) => {
          stdout.write('\x1B[?25h');
          if (selected) { history.push(selected); resolve_p({ text: selected, cancelled: false }); }
          else resolve_p({ text: '', cancelled: false });
        });
        return;
      }

      dropdownVisible = false;
      clearPanel();
      stdout.write('\x1B[?25h');
      cleanup();

      if (text) history.push(text);
      resolve_p({ text, cancelled: false });
    };

    // ── Initial render (after context file detection) ─────────────────────────

    detectContextFile(cwd).then((f) => {
      contextFile = f;
    }).catch(() => {
      contextFile = null;
    }).finally(() => {
      render();
    });

    // ── Key handler ───────────────────────────────────────────────────────────

    const onData = (key: string): void => {
      // Ctrl+C
      if (key === '\x03') {
        clearPanel();
        stdout.write('\x1B[?25h');
        cleanup();
        process.exit(0);
      }

      // ── Ctrl+A / Home — jump to beginning of line ──────────────────────────
      if (key === '\x01' || key === '\x1B[H' || key === '\x1B[1~') {
        cursor = 0;
        // If dropdown is in @ mode, refresh completions at new cursor position
        if (dropdownVisible && dropdownMode === 'at') { triggerAtCompletions(); return; }
        render();
        return;
      }

      // ── Ctrl+E / End — jump to end of line ──────────────────────────────────
      if (key === '\x05' || key === '\x1B[F' || key === '\x1B[4~') {
        cursor = cpBuf.length;
        if (dropdownVisible && dropdownMode === 'at') { triggerAtCompletions(); return; }
        render();
        return;
      }

      // ── Ctrl+W — delete word backward ───────────────────────────────────────
      if (key === '\x17') {
        if (cursor > 0 && cpBuf.length > 0) {
          // Find the start of the current/last word
          let delStart = cursor - 1;
          // Skip trailing whitespace
          while (delStart >= 0 && cpBuf[delStart] === ' ') delStart--;
          // Skip word characters
          while (delStart >= 0 && cpBuf[delStart] !== ' ') delStart--;
          delStart++; // move back to first char of the word
          const count = cursor - delStart;
          cpBuf.splice(delStart, count);
          cursor = delStart;
          syncBuffer();
          if (dropdownMode === 'at') { triggerAtCompletions(); return; }
          if (!isSlashMode()) { dropdownVisible = false; }
          else if (cachedFilteredCommands.length === 0) { dropdownVisible = false; }
          else if (dropdownIdx >= cachedFilteredCommands.length) { dropdownIdx = cachedFilteredCommands.length - 1; }
        }
        render();
        return;
      }

      // ── Ctrl+K — kill (delete) from cursor to end of line ──────────────────
      if (key === '\x0B') {
        if (cursor < cpBuf.length) {
          cpBuf.splice(cursor, cpBuf.length - cursor);
          syncBuffer();
          if (dropdownMode === 'at') { triggerAtCompletions(); return; }
          if (!isSlashMode()) { dropdownVisible = false; }
          else if (cachedFilteredCommands.length === 0) { dropdownVisible = false; }
          else if (dropdownIdx >= cachedFilteredCommands.length) { dropdownIdx = cachedFilteredCommands.length - 1; }
        }
        render();
        return;
      }

      // Ctrl+J / Shift+Enter — insert newline into buffer
      if (key === '\n' || key === '\x1B[13;2u' || key === '\x1B[27;2;13~') {
        if (dropdownVisible) { dropdownVisible = false; render(); return; }
        if (isSlashMode()) { commitInput(); return; }
        cpBuf.splice(cursor, 0, '\n');
        syncBuffer(); cursor++;
        render();
        return;
      }

      // Alt+Enter / Ctrl+D — submit
      if (key === '\x1B\r' || key === '\x1B[13;3u' || key === '\x1B[27;3;13~' || key === '\x04') {
        if (dropdownVisible) { selectDropdownItem(); return; }
        commitInput();
        return;
      }

      // Escape — cancel dropdown or clear buffer
      if (key === '\x1B') {
        if (dropdownVisible) { dropdownVisible = false; render(); return; }
        cpBuf = []; syncBuffer(); cursor = 0;
        historyIdx = history.length; historySavedDraft = null;
        render();
        return;
      }

      // Arrow up
      if (key === '\x1B[A') {
        if (dropdownVisible) {
          const len = dropdownMode === 'slash' ? cachedFilteredCommands.length : atCompletions.length;
          if (len > 0) { dropdownIdx = (dropdownIdx - 1 + len) % len; }
          render(); return;
        }
        if (historyIdx > 0) {
          if (historySavedDraft === null) historySavedDraft = [...cpBuf];
          historyIdx--;
          cpBuf = [...(history[historyIdx] ?? '')];
          syncBuffer(); cursor = cpBuf.length; render();
        }
        return;
      }

      // Arrow down
      if (key === '\x1B[B') {
        if (dropdownVisible) {
          const len = dropdownMode === 'slash' ? cachedFilteredCommands.length : atCompletions.length;
          if (len > 0) { dropdownIdx = (dropdownIdx + 1) % len; }
          render(); return;
        }
        if (historyIdx < history.length) {
          historyIdx++;
          if (historyIdx === history.length) {
            cpBuf = historySavedDraft ?? [];
            historySavedDraft = null;
          } else {
            cpBuf = [...history[historyIdx]];
          }
          syncBuffer(); cursor = cpBuf.length; render();
        }
        return;
      }

      // Arrow right
      if (key === '\x1B[C') {
        if (cursor < cpBuf.length) { cursor++; render(); }
        return;
      }

      // Arrow left
      if (key === '\x1B[D') {
        if (cursor > 0) { cursor--; render(); }
        return;
      }

      // Delete key
      if (key === '\x1B[3~') {
        if (cursor < cpBuf.length) {
          cpBuf.splice(cursor, 1);
          syncBuffer();
          if (dropdownMode === 'at') { triggerAtCompletions(); return; }
          if (!isSlashMode()) { dropdownVisible = false; }
          else if (cachedFilteredCommands.length === 0) { dropdownVisible = false; }
          else if (dropdownIdx >= cachedFilteredCommands.length) { dropdownIdx = cachedFilteredCommands.length - 1; }
        }
        render();
        return;
      }

      // Enter — submit
      if (key === '\r') {
        if (dropdownVisible) { selectDropdownItem(); return; }
        commitInput();
        return;
      }

      // Backspace
      if (key === '\x7F' || key === '\b') {
        if (cursor > 0) {
          cpBuf.splice(cursor - 1, 1);
          cursor--;
          syncBuffer();
          if (dropdownMode === 'at') {
            triggerAtCompletions();
            return;
          } else if (!isSlashMode()) {
            dropdownVisible = false;
          } else {
            const items = cachedFilteredCommands;
            if (items.length === 0) dropdownVisible = false;
            else if (dropdownIdx >= items.length) dropdownIdx = items.length - 1;
          }
          render();
        }
        return;
      }

      // Tab — complete
      if (key === '\t') {
        if (dropdownVisible) { selectDropdownItem(); }
        return;
      }

      // Printable input
      if (!key.startsWith('\x1B') && key.charCodeAt(0) >= 0x20 && key.charCodeAt(0) !== 0x7F) {
        let incoming = [...key];

        // Normalize Windows line endings from paste
        const normalized: string[] = [];
        for (let i = 0; i < incoming.length; i++) {
          if (incoming[i] === '\r' && incoming[i + 1] === '\n') {
            normalized.push('\n'); i++;
          } else if (incoming[i] === '\r') {
            normalized.push('\n');
          } else {
            normalized.push(incoming[i]);
          }
        }
        incoming = normalized;

        cpBuf.splice(cursor, 0, ...incoming);
        syncBuffer(); cursor += incoming.length;

        if (buffer === '/' && !dropdownVisible) {
          dropdownMode = 'slash'; dropdownVisible = true; dropdownIdx = 0; render();
        } else if (isSlashMode() && dropdownVisible && dropdownMode === 'slash') {
          const items = cachedFilteredCommands;
          if (items.length === 0) dropdownVisible = false;
          else if (dropdownIdx >= items.length) dropdownIdx = 0;
          render();
        } else if (!isSlashMode() && dropdownVisible && dropdownMode === 'slash') {
          dropdownVisible = false; render();
        } else {
          triggerAtCompletions();
        }
        return;
      }
    };

    const selectDropdownItem = (): void => {
      if (dropdownMode === 'slash') {
        const items = cachedFilteredCommands;
        if (items.length === 0 || dropdownIdx >= items.length) return;
        const selected = items[dropdownIdx].name;
        dropdownVisible = false;
        clearPanel();
        stdout.write('\x1B[?25h');
        cleanup();
        history.push(selected);
        resolve_p({ text: selected, cancelled: false });
      } else {
        if (atCompletions.length === 0 || dropdownIdx >= atCompletions.length) return;
        completeAt(atCompletions[dropdownIdx]);
        dropdownVisible = false;
        render();
      }
    };

    stdin.on('data', onData);
    stdin.resume();
  });
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
    desc: `${chalk.dim.gray('[skill]')} ${s.description ?? `(${s.source})`}`,
    kind: 'skill' as SlashCommandKind,
  }));

  const items = [...builtinItems, ...skillItems];

  const selected = await selectFromList(
    skillItems.length > 0
      ? `Slash Commands  ${chalk.gray('(built-in + ' + skillItems.length + ' skills)')}`
      : 'Slash Commands',
    items,
  );
  if (selected) {
    process.stdout.write(chalk.hex(ACCENT)('> ') + selected + '\n');
  }
  return selected;
}

// ── Arrow-key list selector ───────────────────────────────────────────────────
// selectFromList is re-exported from ../utils/select.ts above
