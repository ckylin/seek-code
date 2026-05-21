import chalk from 'chalk';
import { ACCENT } from './constants.js';
import { acquireRawMode, releaseRawMode } from './rawMode.js';

export interface SelectorItem {
  value: string;
  label: string;
  desc?: string;
  kind?: 'builtin' | 'skill';
}

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

    // If there are no items, resolve immediately.
    if (items.length === 0) {
      resolve_p(null);
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
        const cur = sel ? chalk.hex(ACCENT)('  ❯ ') : '    ';
        const label = sel
          ? chalk.bold.hex(ACCENT)(item.label)
          : (item.kind === 'builtin' || item.kind === undefined ? chalk.hex(ACCENT)(item.label) : chalk.white(item.label));
        const desc = item.desc
          ? chalk.gray('   ' + item.desc.slice(0, (stdout.columns || 80) - item.label.length - 12))
          : '';
        out.push(cur + label + desc);
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
      stdin.removeListener('data', onData);
      releaseRawMode();
      stdout.write('\n');
    };

    acquireRawMode();
    stdout.write('\n');
    lastHeight = 0;
    render();

    const onData = (key: string): void => {
      if (key === '\x03') { cleanup(); resolve_p(null); return; }
      if (key === '\x1B') { cleanup(); resolve_p(null); return; }
      if (key === '\x1B[A') { if (items.length > 0) { idx = (idx - 1 + items.length) % items.length; } render(); return; }
      if (key === '\x1B[B') { if (items.length > 0) { idx = (idx + 1) % items.length; } render(); return; }
      // Home / Ctrl+A — jump to first item
      if (key === '\x1B[H' || key === '\x1B[1~' || key === '\x01') { idx = 0; render(); return; }
      // End / Ctrl+E — jump to last item
      if (key === '\x1B[F' || key === '\x1B[4~' || key === '\x05') { idx = Math.max(0, items.length - 1); render(); return; }
      if (key === '\r' || key === '\n') {
        if (items.length === 0) { cleanup(); resolve_p(null); return; }
        cleanup(); resolve_p(items[idx].value); return;
      }
    };

    stdin.on('data', onData);
    stdin.resume();
  });
}
