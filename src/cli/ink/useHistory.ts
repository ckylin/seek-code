import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HISTORY_DIR = join(homedir(), '.codegrunt');
const HISTORY_FILE = join(HISTORY_DIR, 'history');
export const MAX_HISTORY = 500;

// Module-global history array — shared across all sessions in this process
export const history: string[] = [];

export function loadHistory(): void {
  try {
    const raw = readFileSync(HISTORY_FILE, 'utf-8');
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    history.push(...lines.slice(-MAX_HISTORY));
  } catch { /* no history file yet */ }
}

export function saveHistoryEntry(line: string): void {
  try {
    mkdirSync(HISTORY_DIR, { recursive: true });
    writeFileSync(HISTORY_FILE, line + '\n', { flag: 'a' });
  } catch { /* ignore write errors */ }
}

loadHistory();

export interface HistoryController {
  navigateUp(currentInput: string): string;
  navigateDown(): string;
  addEntry(line: string): void;
  reset(): void;
}

export function createHistoryController(): HistoryController {
  let cursor = -1;
  let draft = '';

  return {
    navigateUp(currentInput: string): string {
      if (history.length === 0) return currentInput;
      if (cursor === -1) {
        draft = currentInput;
        cursor = history.length - 1;
      } else if (cursor > 0) {
        cursor--;
      }
      return history[cursor] ?? currentInput;
    },

    navigateDown(): string {
      if (cursor === -1) return '';
      cursor++;
      if (cursor >= history.length) {
        cursor = -1;
        return draft;
      }
      return history[cursor] ?? '';
    },

    addEntry(line: string): void {
      if (history.length === 0 || history[history.length - 1] !== line) {
        history.push(line);
        if (history.length > MAX_HISTORY) history.shift();
      }
      cursor = -1;
      draft = '';
    },

    reset(): void {
      cursor = -1;
      draft = '';
    },
  };
}
