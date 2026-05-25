/**
 * Unconditionally restore the terminal to cooked mode.
 * Call on process exit to ensure the shell is left in a usable state.
 */
export function forceRestoreTerminal(): void {
  try {
    process.stdin.pause();
    process.stdin.setRawMode(false);
  } catch {
    // ignore — non-TTY or platform doesn't support raw mode
  }
}

/**
 * Drain Node.js's internal stream buffer.
 * Safe to call at any time; only clears bytes already in Node's buffer.
 */
export function drainInternalBuffer(): void {
  if (!process.stdin.isTTY) return;
  while (process.stdin.read() !== null) { /* drain */ }
}
