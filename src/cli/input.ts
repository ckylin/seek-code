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

    let buffer = '';
    let cursorPos = 0; // position within buffer
    let historyIdx = history.length; // current position in history (history.length = new input)
    let dropdownVisible = false;
    let dropdownIdx = 0;
    let lastHeight = 0;

    // Save original terminal state
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    // Hide cursor during input
    stdout.write('\x1B[?25l');

    const prompt = chalk.blue('> ');

    const render = (): void => {
      // If dropdown was open, move cursor up past dropdown lines then clear to bottom.
      // Otherwise just clear the current input line in place.
      if (lastHeight > 0) {
        stdout.write(`\x1B[${lastHeight}A\r\x1B[J`);
      } else {
        stdout.write('\r\x1B[K');
      }

      // Write prompt + buffer
      const display = buffer.length === 0 ? '' : buffer;
      stdout.write(prompt + display);

      // Position cursor (prompt visible width is always 2: "> ")
      const promptLen = 2;
      const absPos = promptLen + stringWidth(buffer.slice(0, cursorPos));
      stdout.write(`\r\x1B[${absPos}C`);

      // Draw dropdown if visible
      if (dropdownVisible) {
        const items = getFilteredCommands();
        if (items.length > 0) {
          const lines: string[] = [];
          for (let i = 0; i < items.length; i++) {
            const sel = i === dropdownIdx;
            const cursor = sel ? chalk.blue('  ❯ ') : '    ';
            const label = sel ? chalk.bold.white(items[i].name) : chalk.white(items[i].name);
            const desc = items[i].desc
              ? chalk.gray('   ' + items[i].desc.slice(0, (stdout.columns || 80) - items[i].name.length - 12))
              : '';
            lines.push(cursor + label + desc);
          }
          stdout.write('\n' + lines.join('\n'));
          // Remember how many lines below the input line we drew,
          // so next render can move back up to the input line.
          lastHeight = lines.length;
        } else {
          lastHeight = 0;
        }
      } else {
        // No dropdown — nothing below the input line to erase next time.
        lastHeight = 0;
      }
    };

    const getFilteredCommands = (): typeof SLASH_COMMANDS => {
      if (buffer === '/') return SLASH_COMMANDS;
      return SLASH_COMMANDS.filter((c) => c.name.startsWith(buffer));
    };

    const showDropdown = (): void => {
      dropdownVisible = true;
      dropdownIdx = 0;
      render();
    };

    const hideDropdown = (): void => {
      dropdownVisible = false;
      render();
    };

    const selectDropdownItem = (): void => {
      const items = getFilteredCommands();
      if (items.length > 0 && dropdownIdx < items.length) {
        const selected = items[dropdownIdx].name;
        dropdownVisible = false;
        lastHeight = 0;
        stdout.write('\r\x1B[K'); // clear line
        stdout.write('\x1B[?25h'); // show cursor
        stdin.setRawMode(false);
        stdin.pause();
        history.push(selected);
        resolve_p({ text: selected, cancelled: false });
      }
    };

    const commitInput = (): void => {
      const text = buffer.trim();
      dropdownVisible = false;
      lastHeight = 0;
      stdout.write('\n');
      stdout.write('\x1B[?25h'); // show cursor
      stdin.setRawMode(false);
      stdin.pause();

      if (text === '/') {
        // Show slash command selector on Enter with just "/"
        void showSlashCommandSelector().then((selected) => {
          if (selected) {
            history.push(selected);
            resolve_p({ text: selected, cancelled: false });
          } else {
            resolve_p({ text: '', cancelled: false });
          }
        });
        return;
      }

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

      // Escape — cancel dropdown or clear buffer
      if (key === '\x1B') {
        if (dropdownVisible) {
          hideDropdown();
          return;
        }
        // Clear buffer on bare Escape
        buffer = '';
        cursorPos = 0;
        historyIdx = history.length;
        render();
        return;
      }

      // Arrow keys come as escape sequences: \x1B[A, \x1B[B, etc.
      if (key === '\x1B[A') {
        // Up arrow
        if (dropdownVisible) {
          const items = getFilteredCommands();
          dropdownIdx = (dropdownIdx - 1 + items.length) % items.length;
          render();
          return;
        }
        // History navigation
        if (historyIdx > 0) {
          historyIdx--;
          buffer = history[historyIdx] || '';
          cursorPos = buffer.length;
          render();
        }
        return;
      }

      if (key === '\x1B[B') {
        // Down arrow
        if (dropdownVisible) {
          const items = getFilteredCommands();
          dropdownIdx = (dropdownIdx + 1) % items.length;
          render();
          return;
        }
        // History navigation
        if (historyIdx < history.length) {
          historyIdx++;
          buffer = historyIdx < history.length ? history[historyIdx] : '';
          cursorPos = buffer.length;
          render();
        }
        return;
      }

      if (key === '\x1B[C') {
        // Right arrow — move by code points, not JS string indices
        if (cursorPos < [...buffer].length) {
          cursorPos++;
          render();
        }
        return;
      }

      if (key === '\x1B[D') {
        // Left arrow
        if (cursorPos > 0) {
          cursorPos--;
          render();
        }
        return;
      }

      // Enter
      if (key === '\r' || key === '\n') {
        if (dropdownVisible) {
          selectDropdownItem();
          return;
        }
        commitInput();
        return;
      }

      // Backspace
      if (key === '\x7F' || key === '\b') {
        if (cursorPos > 0) {
          // Split by code points to correctly handle wide chars and surrogate pairs
          const codePoints = [...buffer];
          codePoints.splice(cursorPos - 1, 1);
          buffer = codePoints.join('');
          cursorPos--;
          // If buffer no longer starts with '/', hide dropdown
          if (!buffer.startsWith('/')) {
            dropdownVisible = false;
          } else {
            // Re-filter dropdown
            const items = getFilteredCommands();
            if (items.length === 0) dropdownVisible = false;
            else if (dropdownIdx >= items.length) dropdownIdx = items.length - 1;
          }
          render();
        }
        return;
      }

      // Tab — if dropdown visible, select item
      if (key === '\t') {
        if (dropdownVisible) {
          selectDropdownItem();
          return;
        }
        return;
      }

      // Printable character input — handles ASCII, CJK, emoji, and IME batch input.
      // Reject escape sequences (\x1B...) and control characters (< 0x20 or 0x7F).
      if (!key.startsWith('\x1B') && key.charCodeAt(0) >= 0x20 && key.charCodeAt(0) !== 0x7F) {
        buffer = buffer.slice(0, cursorPos) + key + buffer.slice(cursorPos);
        // Advance by Unicode code point count, not byte/char count (handles surrogate pairs)
        cursorPos += [...key].length;

        // Show dropdown immediately when user types "/"
        if (buffer === '/' && !dropdownVisible) {
          showDropdown();
        } else if (buffer.startsWith('/') && dropdownVisible) {
          // Update dropdown filter
          const items = getFilteredCommands();
          if (items.length === 0) {
            dropdownVisible = false;
          } else {
            if (dropdownIdx >= items.length) dropdownIdx = 0;
          }
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
