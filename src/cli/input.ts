import { readdir, access } from 'fs/promises';
import { resolve, dirname, basename, join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import stringWidth from 'string-width';

export interface InputResult {
  text: string;
  cancelled: boolean;
}

export interface SelectorItem {
  value: string;
  label: string;
  desc?: string;
}

const SLASH_COMMANDS = [
  { name: '/init',    desc: 'Analyze codebase and generate SEEK.md' },
  { name: '/model',   desc: 'Switch model' },
  { name: '/config',  desc: 'View or change config (temperature, topp, etc.)' },
  { name: '/reasoning', desc: 'Set reasoning effort (low/medium/high)' },
  { name: '/token',   desc: 'Update API key' },
  { name: '/compact', desc: 'Compress conversation history' },
  { name: '/clear',   desc: 'Clear conversation context' },
  { name: '/cost',    desc: 'Show session token usage and cost' },
  { name: '/balance', desc: 'Show account balance & usage' },
  { name: '/help',    desc: 'Show help' },
];

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

/** Detect which context file is active (SEEK.md > CLAUDE.md > none) */
async function detectContextFile(cwd: string): Promise<string | null> {
  for (const name of ['SEEK.md', 'CLAUDE.md']) {
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

export function readMultilineInput(cwd = process.cwd()): Promise<InputResult> {
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
    // Layout:
    //   ────────────────────────────────  (separator)
    //   > <user input here>              (prompt line, may wrap)
    //   ? for shortcuts        ↑ In X.md (status bar)
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
    // Terminal rows above the cursor that belong to our rendered block.
    let linesAboveCursor = 0;
    // Cached context file name (populated async before first render)
    let contextFile: string | null = null;

    const syncBuffer = (): void => { buffer = cpBuf.join(''); };

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

    /** Build the status bar line */
    const buildStatusBar = (termW: number): string => {
      const left = chalk.gray('? for shortcuts') + chalk.gray('   Alt+Enter to send');
      const right = contextFile
        ? chalk.gray('↑ In ' + contextFile)
        : '';
      const leftW = stringWidth(left);
      const rightW = stringWidth(right);
      const gap = Math.max(1, termW - leftW - rightW);
      return left + ' '.repeat(gap) + right;
    };

    const render = (): void => {
      // Move up to the top of our previously rendered block, then erase downward
      if (linesAboveCursor > 0) stdout.write(`\x1B[${linesAboveCursor}A`);
      stdout.write('\r\x1B[J');

      const lines = getLines();
      const termW = stdout.columns || 80;

      // Count terminal rows each logical line occupies (accounts for wrapping)
      const rowsPerLine = lines.map((l, i) => {
        const prefix = i === 0 ? PROMPT : CONT_PREFIX;
        const w = stringWidth(prefix + l.join(''));
        return Math.max(1, Math.ceil(w / termW));
      });

      // ── Separator ──
      stdout.write(chalk.gray('─'.repeat(termW)) + '\r\n');

      // ── Input lines ──
      for (let i = 0; i < lines.length; i++) {
        const prefix = i === 0 ? PROMPT : CONT_PREFIX;
        const text = lines[i].join('');
        if (i < lines.length - 1) {
          stdout.write(prefix + text + '\r\n');
        } else {
          stdout.write(prefix + text);
        }
      }

      // ── Dropdown or status bar below the last input line ──
      let extraRows = 0;
      if (dropdownVisible) {
        const items = getFilteredCommands();
        if (items.length > 0) {
          const rows: string[] = [];
          for (let i = 0; i < items.length; i++) {
            const sel = i === dropdownIdx;
            const cur = sel ? chalk.blue('  ❯ ') : '    ';
            const label = sel ? chalk.bold.white(items[i].name) : chalk.white(items[i].name);
            const desc = items[i].desc
              ? chalk.gray('   ' + items[i].desc.slice(0, termW - items[i].name.length - 12))
              : '';
            rows.push(cur + label + desc);
          }
          stdout.write('\r\n' + rows.join('\r\n'));
          extraRows = rows.length;
        }
      } else if (cpBuf.includes('\n')) {
        stdout.write('\r\n' + chalk.gray('  Enter for new line   Alt+Enter to send'));
        extraRows = 1;
      } else {
        // Bottom separator then status bar
        stdout.write('\r\n' + chalk.gray('─'.repeat(termW)));
        stdout.write('\r\n' + buildStatusBar(termW));
        extraRows = 2;
      }

      // Move back up past the extra rows to the last input line
      if (extraRows > 0) stdout.write(`\x1B[${extraRows}A`);

      // Position cursor on the correct logical line (accounting for wrapped rows)
      const { lineIdx, colIdx } = cursorToLineCol();
      let rowsBelowCursor = 0;
      for (let i = lineIdx + 1; i < lines.length; i++) {
        rowsBelowCursor += rowsPerLine[i];
      }
      if (rowsBelowCursor > 0) stdout.write(`\x1B[${rowsBelowCursor}A`);

      const colW = PROMPT_W + stringWidth(lines[lineIdx].slice(0, colIdx).join(''));
      stdout.write('\r' + (colW > 0 ? `\x1B[${colW}C` : ''));

      // Compute rows above cursor within our rendered block.
      // +1 for the separator line above the first input line.
      const currentLinePartialRows = Math.max(0,
        Math.ceil((PROMPT_W + stringWidth(lines[lineIdx].slice(0, colIdx).join(''))) / termW) - 1
      );
      linesAboveCursor = currentLinePartialRows + 1; // +1 for separator
      for (let i = 0; i < lineIdx; i++) {
        linesAboveCursor += rowsPerLine[i];
      }

      stdout.write('\x1B[?25h');
    };

    const getFilteredCommands = (): typeof SLASH_COMMANDS => {
      if (buffer === '/') return SLASH_COMMANDS;
      return SLASH_COMMANDS.filter((c) => c.name.startsWith(buffer));
    };

    const showDropdown = (): void => { dropdownVisible = true; dropdownIdx = 0; render(); };
    const hideDropdown = (): void => { dropdownVisible = false; render(); };

    const selectDropdownItem = (): void => {
      const items = getFilteredCommands();
      if (items.length === 0 || dropdownIdx >= items.length) return;
      const selected = items[dropdownIdx].name;
      dropdownVisible = false;
      stdout.write('\r\x1B[J');
      linesAboveCursor = 0;
      stdout.write('\x1B[?25h');
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      history.push(selected);
      resolve_p({ text: selected, cancelled: false });
    };

    const commitInput = (): void => {
      const text = buffer.trim();

      if (text === '/') {
        stdin.removeListener('data', onData);
        dropdownVisible = false;
        linesAboveCursor = 0;
        stdout.write('\n');
        void showSlashCommandSelector().then((selected) => {
          stdout.write('\x1B[?25h');
          if (selected) { history.push(selected); resolve_p({ text: selected, cancelled: false }); }
          else resolve_p({ text: '', cancelled: false });
        });
        return;
      }

      dropdownVisible = false;
      linesAboveCursor = 0;
      stdout.write('\n');
      stdout.write('\x1B[?25h');
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);

      if (text) history.push(text);
      resolve_p({ text, cancelled: false });
    };

    // Detect context file async, then render
    detectContextFile(cwd).then((f) => {
      contextFile = f;
      render();
    });

    const onData = (key: string): void => {
      // Ctrl+C — hard exit
      if (key === '\x03') {
        stdout.write('\n');
        stdout.write('\x1B[?25h');
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.exit(0);
      }

      // Alt+Enter — submit
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

      // Arrow up — history prev
      if (key === '\x1B[A') {
        if (dropdownVisible) {
          const items = getFilteredCommands();
          dropdownIdx = (dropdownIdx - 1 + items.length) % items.length;
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

      // Arrow down — history next
      if (key === '\x1B[B') {
        if (dropdownVisible) {
          const items = getFilteredCommands();
          dropdownIdx = (dropdownIdx + 1) % items.length;
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

      // Enter — insert newline (slash commands submit immediately)
      if (key === '\r' || key === '\n') {
        if (dropdownVisible) { selectDropdownItem(); return; }
        if (buffer.startsWith('/')) { commitInput(); return; }
        cpBuf.splice(cursor, 0, '\n');
        syncBuffer(); cursor++;
        render();
        return;
      }

      // Backspace
      if (key === '\x7F' || key === '\b') {
        if (cursor > 0) {
          cpBuf.splice(cursor - 1, 1);
          syncBuffer(); cursor--;
          if (!buffer.startsWith('/')) {
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

        // Normalize Windows line endings from paste: \r\n → \n, then lone \r → \n
        // Without this, \r corrupts terminal cursor tracking and causes the input
        // box to drift upward on backspace (see render's linesAboveCursor calc).
        const normalized: string[] = [];
        for (let i = 0; i < incoming.length; i++) {
          if (incoming[i] === '\r' && incoming[i + 1] === '\n') {
            normalized.push('\n'); i++; // skip the \n
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
          showDropdown();
        } else if (buffer.startsWith('/') && dropdownVisible) {
          const items = getFilteredCommands();
          if (items.length === 0) dropdownVisible = false;
          else if (dropdownIdx >= items.length) dropdownIdx = 0;
          render();
        } else if (!buffer.startsWith('/') && dropdownVisible) {
          hideDropdown();
        } else {
          render();
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
async function showSlashCommandSelector(): Promise<string | null> {
  const items: SelectorItem[] = SLASH_COMMANDS.map((cmd) => ({
    value: cmd.name,
    label: cmd.name,
    desc: cmd.desc,
  }));

  const selected = await selectFromList('Slash Commands', items);
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
  return new Promise((resolve_p, reject) => {
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
        const cursor = sel ? chalk.blue('  ❯ ') : '    ';
        const label = sel ? chalk.bold.white(item.label) : chalk.white(item.label);
        const desc = item.desc
          ? chalk.gray('   ' + item.desc.slice(0, (stdout.columns || 80) - item.label.length - 12))
          : '';
        out.push(cursor + label + desc);
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
      if (key === '\x03') {
        cleanup();
        reject(Object.assign(new Error('Interrupted'), { name: 'AbortError' }));
        return;
      }
      if (key === '\x1B') { cleanup(); resolve_p(null); return; }
      if (key === '\x1B[A') { idx = (idx - 1 + items.length) % items.length; render(); return; }
      if (key === '\x1B[B') { idx = (idx + 1) % items.length; render(); return; }
      if (key === '\r' || key === '\n') { cleanup(); resolve_p(items[idx].value); return; }
    };

    stdin.on('data', onData);
  });
}
