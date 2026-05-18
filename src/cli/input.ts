import * as readline from 'readline';
import { readdir } from 'fs/promises';
import { resolve, dirname, basename } from 'path';
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
  { name: '/compact', desc: 'Compress conversation history' },
  { name: '/clear',   desc: 'Clear conversation context' },
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

// Session history shared across calls
const history: string[] = [];

export function readMultilineInput(cwd = process.cwd()): Promise<InputResult> {
  return new Promise((resolve_p, reject) => {
    const { stdin, stdout } = process;

    // Non-TTY: read a single line from stdin
    if (!stdin.isTTY) {
      let buf = '';
      const onData = (chunk: Buffer): void => {
        const str = chunk.toString();
        const nl = str.indexOf('\n');
        if (nl !== -1) {
          buf += str.slice(0, nl);
          stdin.removeListener('data', onData);
          stdin.pause();
          resolve_p({ text: buf.trim(), cancelled: false });
        } else {
          buf += str;
        }
      };
      stdin.resume();
      stdin.on('data', onData);
      return;
    }

    // ── Raw-mode interactive input with real-time slash dropdown ──
    //
    // cursorPos is always a Unicode code-point index into cpBuf.
    // buffer (string) is derived from cpBuf and kept in sync.
    // All mutations go through cpBuf so surrogate pairs / CJK are handled correctly.

    let cpBuf: string[] = [];          // code-point array
    let buffer = '';                   // cpBuf.join('') — kept in sync
    let cursorPos = 0;                 // code-point index
    let historyIdx = history.length;
    let dropdownVisible = false;
    let dropdownIdx = 0;
    let lastHeight = 0;

    const syncBuffer = (): void => { buffer = cpBuf.join(''); };

    // Save original terminal state
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const prompt = chalk.blue('> ');

    const render = (): void => {
      // First, erase all previously rendered content (prompt line + dropdown lines)
      if (lastHeight > 0) {
        stdout.write(`\x1B[${lastHeight}A\r\x1B[J`);
      } else {
        stdout.write('\r\x1B[K');
      }

      // Write prompt + current buffer
      stdout.write(prompt + buffer);

      // Position cursor at the right place within the buffer.
      // prompt has display width 2 → "> " after color codes.
      const promptLen = 2;
      const absPos = promptLen + stringWidth(cpBuf.slice(0, cursorPos).join(''));
      if (absPos === 0) {
        stdout.write('\r');
      } else {
        stdout.write(`\r\x1B[${absPos}C`);
      }

      // Compute dropdown content before writing so we can track new height
      let newHeight = 0;
      if (dropdownVisible) {
        const items = getFilteredCommands();
        if (items.length > 0) {
          const lines: string[] = [];
          for (let i = 0; i < items.length; i++) {
            const sel = i === dropdownIdx;
            const cur = sel ? chalk.blue('  ❯ ') : '    ';
            const label = sel ? chalk.bold.white(items[i].name) : chalk.white(items[i].name);
            const desc = items[i].desc
              ? chalk.gray('   ' + items[i].desc.slice(0, (stdout.columns || 80) - items[i].name.length - 12))
              : '';
            lines.push(cur + label + desc);
          }
          stdout.write('\n' + lines.join('\n'));
          newHeight = lines.length;
        }
      }
      lastHeight = newHeight;

      // Show cursor after positioning so the user can see where they are
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
      if (items.length > 0 && dropdownIdx < items.length) {
        const selected = items[dropdownIdx].name;
        dropdownVisible = false;
        // Clear everything we rendered (prompt + dropdown), then show cursor
        if (lastHeight > 0) {
          stdout.write(`\x1B[${lastHeight}A\r\x1B[J`);
        } else {
          stdout.write('\r\x1B[K');
        }
        lastHeight = 0;
        stdout.write('\x1B[?25h');
        stdin.setRawMode(false);
        stdin.pause();
        history.push(selected);
        resolve_p({ text: selected, cancelled: false });
      }
    };

    const commitInput = (): void => {
      const text = buffer.trim();

      // Slash-command selector fallback when user types just "/" — we must NOT
      // tear down raw mode before showing the selector, since selectFromList
      // needs raw mode on stdin.  Close the current listener first to avoid
      // double-listening, then hand over.
      if (text === '/') {
        stdin.removeListener('data', onData);
        dropdownVisible = false;
        lastHeight = 0;
        stdout.write('\n');
        // Keep raw mode on for the selector
        void showSlashCommandSelector().then((selected) => {
          stdout.write('\x1B[?25h');
          if (selected) { history.push(selected); resolve_p({ text: selected, cancelled: false }); }
          else resolve_p({ text: '', cancelled: false });
        });
        return;
      }

      dropdownVisible = false;
      lastHeight = 0;
      stdout.write('\n');
      stdout.write('\x1B[?25h');
      stdin.setRawMode(false);
      stdin.pause();

      if (text) history.push(text);
      resolve_p({ text, cancelled: false });
    };

    render();

    const onData = (key: string): void => {
      // Ctrl+C
      if (key === '\x03') {
        stdout.write('\n');
        stdout.write('\x1B[?25h');
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        reject(Object.assign(new Error('Interrupted'), { name: 'AbortError' }));
        return;
      }

      // Bare Escape — cancel dropdown or clear buffer
      if (key === '\x1B') {
        if (dropdownVisible) { hideDropdown(); return; }
        cpBuf = []; syncBuffer(); cursorPos = 0; historyIdx = history.length;
        render();
        return;
      }

      // Arrow keys
      if (key === '\x1B[A') {
        if (dropdownVisible) {
          const items = getFilteredCommands();
          dropdownIdx = (dropdownIdx - 1 + items.length) % items.length;
          render(); return;
        }
        if (historyIdx > 0) {
          historyIdx--;
          cpBuf = [...(history[historyIdx] ?? '')];
          syncBuffer(); cursorPos = cpBuf.length; render();
        }
        return;
      }

      if (key === '\x1B[B') {
        if (dropdownVisible) {
          const items = getFilteredCommands();
          dropdownIdx = (dropdownIdx + 1) % items.length;
          render(); return;
        }
        if (historyIdx < history.length) {
          historyIdx++;
          cpBuf = [...(historyIdx < history.length ? history[historyIdx] : '')];
          syncBuffer(); cursorPos = cpBuf.length; render();
        }
        return;
      }

      if (key === '\x1B[C') {
        if (cursorPos < cpBuf.length) { cursorPos++; render(); }
        return;
      }

      if (key === '\x1B[D') {
        if (cursorPos > 0) { cursorPos--; render(); }
        return;
      }

      // Enter
      if (key === '\r' || key === '\n') {
        if (dropdownVisible) { selectDropdownItem(); return; }
        commitInput(); return;
      }

      // Backspace
      if (key === '\x7F' || key === '\b') {
        if (cursorPos > 0) {
          cpBuf.splice(cursorPos - 1, 1);
          syncBuffer(); cursorPos--;
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
        const incoming = [...key]; // split into code points
        cpBuf.splice(cursorPos, 0, ...incoming);
        syncBuffer(); cursorPos += incoming.length;

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
  // selectFromList writes one \n in cleanup but does NOT erase its
  // rendering, so we re-display the chosen command on the prompt line.
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
