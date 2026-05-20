import { readdir, access } from 'fs/promises';
import { resolve, dirname, basename, join } from 'path';
import chalk from 'chalk';
import stringWidth from 'string-width';
import { getSessionUsage } from '../core/agent/loop.js';
import type { Skill } from './skills.js';

export interface InputResult {
  text: string;
  cancelled: boolean;
}

export interface SelectorItem {
  value: string;
  label: string;
  desc?: string;
  kind?: SlashCommandKind;
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
  { name: '/exit',    desc: 'Exit Seek Code (or exit current skill)' },
  { name: '/help',    desc: 'Show help' },
];

export type SlashCommandKind = 'builtin' | 'skill';

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

/** Detect which context file is active (SEEKCODE.md > CLAUDE.md > none) */
async function detectContextFile(cwd: string): Promise<string | null> {
  for (const name of ['SEEKCODE.md', 'CLAUDE.md']) {
    try {
      await access(join(cwd, name));
      return name;
    } catch {
      // not found
    }
  }
  return null;
}

// Session history shared across calls
const history: string[] = [];

/** Split a code-point array into visual lines that each fit within maxW display columns. */
function wrapLine(cps: string[], maxW: number): string[][] {
  if (cps.length === 0) return [[]];
  const result: string[][] = [];
  let current: string[] = [];
  let currentW = 0;
  for (const cp of cps) {
    const cw = stringWidth(cp);
    if (currentW + cw > maxW && current.length > 0) {
      result.push(current);
      current = [cp];
      currentW = cw;
    } else {
      current.push(cp);
      currentW += cw;
    }
  }
  result.push(current);
  return result;
}

export function readMultilineInput(cwd = process.cwd(), model?: string, skills: Skill[] = [], activeSkill?: string): Promise<InputResult> {
  return new Promise((resolve_p, reject) => {
    const { stdin, stdout } = process;

    // Non-TTY: read until EOF from stdin
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

    // ── Raw-mode interactive input ──────────────────────────────────────────
    //
    // Panel layout:
    //   ╭──────────────────────────────────────────────────────────────────╮
    //   │ > <user input here>                                              │
    //   ╰─ model  · ↑ tokens  · Ctrl+J 换行   Enter 发送 ────────────────╯
    //
    // cpBuf  — flat array of Unicode code points for the whole buffer
    // cursor — code-point index into cpBuf

    let cpBuf: string[] = [];
    let buffer = '';                   // cpBuf.join('') — kept in sync
    let cursor = 0;                    // code-point index
    let historyIdx = history.length;
    let historySavedDraft: string[] | null = null;
    let dropdownVisible = false;
    let dropdownIdx = 0;
    let dropdownMode: 'slash' | 'at' = 'slash';
    let atCompletions: string[] = [];
    // Terminal rows above the cursor that belong to our rendered block.
    let linesAboveCursor = 0;
    // Cached context file name (populated async before first render)
    let contextFile: string | null = null;

    const syncBuffer = (): void => { buffer = cpBuf.join(''); };

    // ── Cleanup helper ──────────────────────────────────────────────────────
    // Every exit path (commit, Ctrl+C, dropdown select) must call cleanup()
    // before resolving/rejecting the promise.  This guarantees raw mode is
    // always restored even if an async callback throws after setRawMode(true).
    const cleanup = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const PROMPT   = chalk.blue('> ');
    const PROMPT_W = 2;  // display width of "> "
    const CONT_PREFIX = '  '; // continuation line prefix (same width)

    // Split cpBuf into logical lines at '\n' code points
    const getLines = (): string[][] => {
      const lines: string[][] = [[]];
      for (const cp of cpBuf) {
        if (cp === '\n') lines.push([]);
        else lines[lines.length - 1].push(cp);
      }
      return lines;
    };

    // Given a flat cursor position, return { lineIdx, colIdx } within getLines()
    const cursorToLineCol = (): { lineIdx: number; colIdx: number } => {
      let remaining = cursor;
      const lines = getLines();
      for (let i = 0; i < lines.length; i++) {
        const lineLen = lines[i].length + (i < lines.length - 1 ? 1 : 0);
        if (remaining <= lines[i].length) return { lineIdx: i, colIdx: remaining };
        remaining -= lineLen;
      }
      const last = lines.length - 1;
      return { lineIdx: last, colIdx: lines[last].length };
    };

    /** Extract the @partial token immediately before the cursor, or null */
    const getAtPartial = (): string | null => {
      const before = cpBuf.slice(0, cursor).join('');
      const match = before.match(/@(\S*)$/);
      return match ? match[1] : null;
    };

    /** Replace the @partial before cursor with the completed value */
    const completeAt = (completion: string): void => {
      const before = cpBuf.slice(0, cursor).join('');
      const match = before.match(/@(\S*)$/);
      if (!match) return;
      const partialLen = match[1].length;
      // Remove the partial and insert the completion
      cpBuf.splice(cursor - partialLen, partialLen, ...completion.split(''));
      cursor = cursor - partialLen + completion.length;
      syncBuffer();
    };

    /** Build the bottom status bar content for the panel footer */
    const buildStatusBar = (maxWidth?: number): string => {
      const usage = getSessionUsage();
      const totalTokens = usage.inputTokens + usage.outputTokens;
      const tokenStr = totalTokens > 0
        ? (totalTokens >= 1000 ? (totalTokens / 1000).toFixed(1) + 'k' : String(totalTokens)) + ' tokens'
        : '';

      const skillPart = activeSkill ? chalk.bgHex('#6C63FF').hex('#FFFFFF').bold(' SKILL ') + ' ' + chalk.hex('#6C63FF').bold(activeSkill) : '';
      const modelPart = model ? chalk.hex('#4A90D9')(model) : '';
      const tokenPart = tokenStr ? chalk.gray('↑ ' + tokenStr) : '';
      const ctxPart = contextFile ? chalk.gray('In ' + contextFile) : '';
      const hintPart = activeSkill
        ? chalk.gray('Ctrl+J 换行   Enter 发送   /exit 退出')
        : chalk.gray('Ctrl+J 换行   Enter 发送');

      // Build parts from most to least important; drop trailing parts if too wide
      const sep = chalk.gray('  ·  ');
      const sepW = 5; // '  ·  ' visible width
      const candidates = [skillPart, modelPart, tokenPart, ctxPart, hintPart].filter(Boolean);

      if (!maxWidth) return candidates.join(sep);

      let result = '';
      let usedW = 0;
      for (const part of candidates) {
        const plain = part.replace(/\x1b\[[0-9;]*m/g, '');
        const partW = stringWidth(plain);
        const addW = usedW === 0 ? partW : sepW + partW;
        if (usedW + addW > maxWidth) break;
        result += usedW === 0 ? part : sep + part;
        usedW += addW;
      }
      return result;
    };

    const render = (): void => {
      const lines = getLines();
      const termW = stdout.columns || 80;
      // Reserve the rightmost column to avoid terminal auto-wrap "phantom cursor"
      // state, which would corrupt our \r\n positioning and break linesAboveCursor.
      const panelW = termW - 1;
      const innerW = panelW - 4; // inside "│ " and " │"

      // Build dropdown items before moving cursor so we know the height
      const dropItems = dropdownVisible
        ? (dropdownMode === 'slash'
            ? getFilteredCommands().map(c => ({ label: c.name, desc: formatCommandDesc(c), kind: c.kind }))
            : atCompletions.map(c => ({ label: c, desc: '', kind: 'builtin' as SlashCommandKind })))
        : [];
      const numDrop = dropItems.length;

      // Hide cursor during repaint to prevent visible jump to top border.
      stdout.write('\x1B[?25l');

      // Move up to the top of our previously rendered block, then erase downward.
      // linesAboveCursor already includes dropdown rows from the previous render.
      if (linesAboveCursor > 0) stdout.write(`\x1B[${linesAboveCursor}A`);
      stdout.write('\r\x1B[J');

      // ── Dropdown rendered ABOVE the panel ──────────────────────────────────
      // This avoids pushing the panel downward (and scrolling the logo off screen).
      if (numDrop > 0) {
        for (let i = 0; i < numDrop; i++) {
          const sel = i === dropdownIdx;
          const cur = sel ? chalk.blue('  ❯ ') : '    ';
          const labelText = dropItems[i].label;
          const descText = dropItems[i].desc;
          // Total visible width: "│ " (2) + cur (4) + label + "   " + desc
          const fixedW = 2 + 4 + stringWidth(labelText);
          const descSpace = Math.max(0, panelW - fixedW - 3);
          const descTrim = descText
            ? descText.slice(0, descSpace).replace(/\s+$/, '')
            : '';
          const label = sel
            ? (dropItems[i].kind === 'builtin' ? chalk.bold.blue(labelText) : chalk.bold.white(labelText))
            : (dropItems[i].kind === 'builtin' ? chalk.blue(labelText) : chalk.white(labelText));
          const desc = descTrim ? chalk.gray('   ' + descTrim) : '';
          stdout.write(chalk.gray('│ ') + cur + label + desc + '\r\n');
        }
      }

      // Wrap each logical line into visual lines that fit within availTextW.
      const availTextW = innerW - PROMPT_W;
      const visualLinesPerLogical: string[][][] = lines.map(l => wrapLine(l, availTextW));
      const rowsPerLine = visualLinesPerLogical.map(vls => vls.length);

      // Compute cursor logical position before rendering.
      const { lineIdx, colIdx } = cursorToLineCol();

      // Top border
      stdout.write(chalk.gray('╭' + '─'.repeat(panelW - 2) + '╮') + '\r\n');

      // Input lines — each logical line may span multiple visual rows.
      for (let i = 0; i < lines.length; i++) {
        const vls = visualLinesPerLogical[i];
        for (let j = 0; j < vls.length; j++) {
          const prefix = (i === 0 && j === 0) ? PROMPT : CONT_PREFIX;
          const text = vls[j].join('');
          const padLen = Math.max(0, availTextW - stringWidth(text));
          stdout.write(chalk.gray('│ ') + prefix + text + ' '.repeat(padLen) + chalk.gray(' │') + '\r\n');
        }
      }

      const BOTTOM_GAP = 1;

      // Bottom border with status bar
      // "╰─ " (3) + content + " " (1) + "─"*fill + "╯" (1) = panelW
      // Available width for content: panelW - 5
      {
        const available = panelW - 5; // panelW - len("╰─ ") - len(" ╯")
        const statusContent = buildStatusBar(available);
        const statusPlain = statusContent.replace(/\x1b\[[0-9;]*m/g, '');
        const statusLen = stringWidth(statusPlain);
        const borderFill = Math.max(0, available - statusLen);
        stdout.write(
          chalk.gray('╰─ ') + statusContent + chalk.gray(' ' + '─'.repeat(borderFill) + '╯') + '\r\n'
        );

        // Keep distance from terminal bottom (1 line ≈ ~14-16px)
        for (let i = 0; i < BOTTOM_GAP; i++) {
          stdout.write('\r\n');
        }
      }

      // After writing bottom border + BOTTOM_GAP \r\n's, move up to the cursor's visual row.
      // Find which visual line within lines[lineIdx] the cursor falls on.
      const vls = visualLinesPerLogical[lineIdx];
      let remaining = colIdx;
      let visualLineIdx = 0;
      while (visualLineIdx < vls.length - 1 && remaining >= vls[visualLineIdx].length) {
        remaining -= vls[visualLineIdx].length;
        visualLineIdx++;
      }
      const visualColIdx = remaining;

      const cursorTextW = stringWidth(vls[visualLineIdx].slice(0, visualColIdx).join(''));
      const visualCursorCol = 2 + PROMPT_W + cursorTextW;

      // Visual rows of lines[lineIdx] above and below the cursor row.
      const currentLinePartialRows = visualLineIdx;
      const rowsBelowOnCursorLine = vls.length - visualLineIdx - 1;

      let rowsBelowCursor = rowsBelowOnCursorLine + 1 /* bottom border */ + BOTTOM_GAP + 1 /* line after last \r\n */;
      for (let i = lineIdx + 1; i < lines.length; i++) {
        rowsBelowCursor += rowsPerLine[i];
      }
      stdout.write(`\x1B[${rowsBelowCursor}A`);

      const colW = visualCursorCol % termW;
      stdout.write('\r' + (colW > 0 ? `\x1B[${colW}C` : ''));

      // Rows above cursor in our rendered block (used to erase on next render).
      linesAboveCursor = numDrop + 1 /* top border */ + currentLinePartialRows;
      for (let i = 0; i < lineIdx; i++) {
        linesAboveCursor += rowsPerLine[i];
      }

      stdout.write('\x1B[?25h');
    };

    const getFilteredCommands = (): Array<{ name: string; desc: string; kind: SlashCommandKind }> => {
      const allCommands = [
        ...SLASH_COMMANDS.map(c => ({ ...c, kind: 'builtin' as SlashCommandKind })),
        ...skills.map((s) => ({ name: '/' + s.name, desc: s.description ?? `skill (${s.source})`, kind: 'skill' as SlashCommandKind })),
      ];
      if (buffer === '/') return allCommands;
      if (buffer.startsWith('/') && buffer.length > 1 && buffer[1] !== ' ') {
        return allCommands.filter((c) => c.name.startsWith(buffer));
      }
      return [];
    };

    /** Format a command's description for dropdown display, with kind tag */
    const formatCommandDesc = (cmd: ReturnType<typeof getFilteredCommands>[number]): string => {
      const tag = cmd.kind === 'skill' ? chalk.dim.gray('[skill] ') : '';
      return tag + (cmd.desc || '');
    };

    const isSlashMode = (): boolean =>
      buffer === '/' || (buffer.startsWith('/') && buffer.length > 1 && buffer[1] !== ' ');

    const showDropdown = (mode: 'slash' | 'at' = 'slash'): void => {
      dropdownMode = mode;
      dropdownVisible = true;
      dropdownIdx = 0;
      render();
    };
    const hideDropdown = (): void => { dropdownVisible = false; render(); };

    const selectDropdownItem = (): void => {
      if (dropdownMode === 'slash') {
        const items = getFilteredCommands();
        if (items.length === 0 || dropdownIdx >= items.length) return;
        const selected = items[dropdownIdx].name;
        dropdownVisible = false;
        clearPanel();
        stdout.write('\x1B[?25h');
        cleanup();
        history.push(selected);
        resolve_p({ text: selected, cancelled: false });
      } else {
        // @ mode — complete the partial path
        if (atCompletions.length === 0 || dropdownIdx >= atCompletions.length) return;
        const selected = atCompletions[dropdownIdx];
        completeAt(selected);
        dropdownVisible = false;
        render();
      }
    };

    /** Erase the entire rendered panel and move cursor to a clean line */
    const clearPanel = (): void => {
      if (linesAboveCursor > 0) stdout.write(`\x1B[${linesAboveCursor}A`);
      stdout.write('\r\x1B[J');
      linesAboveCursor = 0;
    };

    const commitInput = (): void => {
      const text = buffer.trim();

      if (text === '/') {
        // Hand off to the full-screen selector.  We must stop listening on stdin
        // before showSlashCommandSelector sets up its own listener, otherwise both
        // handlers would fire on the same keystrokes.  cleanup() also restores raw
        // mode so selectFromList can re-enter it cleanly via its own setRawMode(true).
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

    // Detect context file async, then render.
    // Use .finally() so the panel always renders even if detection fails.
    detectContextFile(cwd).then((f) => {
      contextFile = f;
    }).catch(() => {
      contextFile = null;
    }).finally(() => {
      render();
    });

    const onData = (key: string): void => {
      // Ctrl+C — hard exit; restore terminal state before killing the process
      if (key === '\x03') {
        clearPanel();
        stdout.write('\x1B[?25h');
        cleanup();
        process.exit(0);
      }

      // Ctrl+J / Shift+Enter — insert newline
      if (key === '\n' || key === '\x1B[13;2u' || key === '\x1B[27;2;13~') {
        if (dropdownVisible) { hideDropdown(); return; }
        if (isSlashMode()) { commitInput(); return; }
        cpBuf.splice(cursor, 0, '\n');
        syncBuffer(); cursor++;
        render();
        return;
      }

      // Alt+Enter / Ctrl+D — submit (alternative)
      if (key === '\x1B\r' || key === '\x1B[13;3u' || key === '\x1B[27;3;13~' || key === '\x04') {
        if (dropdownVisible) { selectDropdownItem(); return; }
        commitInput();
        return;
      }

      // Bare Escape — cancel dropdown or clear buffer
      if (key === '\x1B') {
        if (dropdownVisible) { hideDropdown(); return; }
        cpBuf = []; syncBuffer(); cursor = 0;
        historyIdx = history.length; historySavedDraft = null;
        render();
        return;
      }

      // Arrow up — history prev / dropdown navigate
      if (key === '\x1B[A') {
        if (dropdownVisible) {
          const len = dropdownMode === 'slash' ? getFilteredCommands().length : atCompletions.length;
          dropdownIdx = (dropdownIdx - 1 + len) % len;
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

      // Arrow down — history next / dropdown navigate
      if (key === '\x1B[B') {
        if (dropdownVisible) {
          const len = dropdownMode === 'slash' ? getFilteredCommands().length : atCompletions.length;
          dropdownIdx = (dropdownIdx + 1) % len;
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

      // Enter — send message
      if (key === '\r') {
        if (dropdownVisible) { selectDropdownItem(); return; }
        commitInput();
        return;
      }

      // Backspace
      if (key === '\x7F' || key === '\b') {
        if (cursor > 0) {
          cpBuf.splice(cursor - 1, 1);
          syncBuffer(); cursor--;
          if (dropdownMode === 'at') {
            const partial = getAtPartial();
            if (partial !== null) {
              getFileCompletions(partial, cwd).then((completions) => {
                if (completions.length > 0) {
                  atCompletions = completions;
                  dropdownVisible = true;
                  dropdownIdx = 0;
                } else {
                  dropdownVisible = false;
                }
                render();
              });
              return;
            } else {
              dropdownVisible = false;
            }
          } else if (!isSlashMode()) {
            dropdownVisible = false;
          } else {
            const items = getFilteredCommands();
            if (items.length === 0) dropdownVisible = false;
            else if (dropdownIdx >= items.length) dropdownIdx = items.length - 1;
          }
          render();
        }
        return;
      }

      // Tab
      if (key === '\t') {
        if (dropdownVisible) { selectDropdownItem(); }
        return;
      }

      // Printable input — ASCII, CJK, emoji, IME batch
      if (!key.startsWith('\x1B') && key.charCodeAt(0) >= 0x20 && key.charCodeAt(0) !== 0x7F) {
        let incoming = [...key];

        // Normalize Windows line endings from paste: \r\n -> \n, then lone \r -> \n
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
          showDropdown('slash');
        } else if (isSlashMode() && dropdownVisible && dropdownMode === 'slash') {
          const items = getFilteredCommands();
          if (items.length === 0) dropdownVisible = false;
          else if (dropdownIdx >= items.length) dropdownIdx = 0;
          render();
        } else if (!isSlashMode() && dropdownVisible && dropdownMode === 'slash') {
          hideDropdown();
        } else {
          // Check for @ completion trigger
          const partial = getAtPartial();
          if (partial !== null) {
            getFileCompletions(partial, cwd).then((completions) => {
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
          } else {
            if (dropdownMode === 'at') dropdownVisible = false;
            render();
          }
        }
        return;
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Show an interactive selector with all available slash commands
 * when the user types just "/" and presses Enter.
 */
async function showSlashCommandSelector(skills: Skill[] = []): Promise<string | null> {
  const builtinItems: SelectorItem[] = SLASH_COMMANDS.map((cmd) => ({
    value: cmd.name,
    label: cmd.name,
    desc: cmd.desc,
    kind: 'builtin' as SlashCommandKind,
  }));

  const skillItems: SelectorItem[] = skills.map((s) => ({
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
    process.stdout.write(chalk.blue('> ') + selected + '\n');
  }
  return selected;
}

// ── Arrow-key list selector ───────────────────────────────────────────────────

function clearLines(n: number): void {
  if (n <= 0) return;
  process.stdout.write(`\x1B[${n}A\r\x1B[J`);
}

export function selectFromList(
  title: string,
  items: SelectorItem[],
  currentValue?: string,
): Promise<string | null> {
  return new Promise((resolve_p) => {
    const { stdin, stdout } = process;

    if (!stdin.isTTY) {
      resolve_p(items[0]?.value ?? null);
      return;
    }

    let idx = Math.max(0, items.findIndex((i) => i.value === currentValue));
    let lastHeight = 0;

    const buildLines = (): string[] => {
      const out: string[] = [];
      out.push(chalk.bold('  ' + title));
      out.push('');
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const sel = i === idx;
        const cur = sel ? chalk.blue('  ❯ ') : '    ';
        const label = sel
          ? (item.kind === 'builtin' ? chalk.bold.blue(item.label) : chalk.bold.white(item.label))
          : (item.kind === 'builtin' ? chalk.blue(item.label) : chalk.white(item.label));
        const desc = item.desc
          ? chalk.gray('   ' + item.desc.slice(0, (stdout.columns || 80) - item.label.length - 12))
          : '';
        out.push(cur + label + desc);
      }
      out.push('');
      out.push(chalk.gray('  ↑↓ navigate   Enter select   Esc cancel'));
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
      // Ctrl+C inside a selector cancels the selection (same as Esc).
      // We do NOT exit the process here — the caller decides what to do with null.
      // Rejecting with AbortError would require every call site to add a catch,
      // which is easy to forget and causes unhandled-rejection crashes.
      if (key === '\x03') { cleanup(); resolve_p(null); return; }
      if (key === '\x1B') { cleanup(); resolve_p(null); return; }
      if (key === '\x1B[A') { idx = (idx - 1 + items.length) % items.length; render(); return; }
      if (key === '\x1B[B') { idx = (idx + 1) % items.length; render(); return; }
      if (key === '\r' || key === '\n') { cleanup(); resolve_p(items[idx].value); return; }
    };

    stdin.on('data', onData);
  });
}
