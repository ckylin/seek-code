import chalk from 'chalk';

const GLYPHS: Record<string, string[]> = {
  S: [
    '▄███▄',
    '██   ',
    '▀███▄',
    '   ██',
    '▀███▀',
  ],
  E: [
    '█████',
    '██   ',
    '████ ',
    '██   ',
    '█████',
  ],
  K: [
    '██  █',
    '██▄█ ',
    '███  ',
    '██▀█ ',
    '██  █',
  ],
  ' ': [
    '   ',
    '   ',
    '   ',
    '   ',
    '   ',
  ],
  C: [
    '▄███▄',
    '██   ',
    '██   ',
    '██   ',
    '▀███▀',
  ],
  O: [
    '▄███▄',
    '██  █',
    '██  █',
    '██  █',
    '▀███▀',
  ],
  D: [
    '████▄',
    '██  █',
    '██  █',
    '██  █',
    '████▀',
  ],
};

const WORD = 'SEEK CODE';

export function printBanner(model: string): void {
  const cols = process.stdout.columns || 80;
  const b = chalk.blue;
  const g = chalk.gray;

  const rows = Array.from({ length: 5 }, () => '');
  for (let i = 0; i < WORD.length; i++) {
    const ch = WORD[i];
    const glyph = GLYPHS[ch] ?? GLYPHS[' '];
    for (let r = 0; r < 5; r++) {
      rows[r] += (i > 0 ? ' ' : '') + glyph[r];
    }
  }

  process.stdout.write('\n');
  for (const row of rows) {
    const pad = Math.max(0, Math.floor((cols - row.length) / 2));
    process.stdout.write(' '.repeat(pad) + chalk.cyan.bold(row) + '\n');
  }

  process.stdout.write('\n');
  process.stdout.write(b('─'.repeat(cols)) + '\n');
  process.stdout.write(
    '  ' + chalk.bold.white('Seek Code') +
    g('  v0.1.0  ·  model: ') +
    chalk.cyan(model) +
    g('  ·  /help for commands') + '\n',
  );
  process.stdout.write(b('─'.repeat(cols)) + '\n');
  process.stdout.write('\n');
}
