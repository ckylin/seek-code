// Reference-counted raw mode manager.
// Prevents multiple callers (input.ts, interrupt.ts, select.ts) from
// independently toggling raw mode and stepping on each other — especially
// important on Windows where setRawMode(false) may not restore
// ENABLE_PROCESSED_INPUT correctly, breaking subsequent Ctrl+C handling.
let rawModeRefCount = 0;

export function acquireRawMode(): void {
  rawModeRefCount++;
  if (rawModeRefCount === 1) {
    try {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
    } catch {
      // Non-TTY or platform doesn't support raw mode
    }
  }
}

export function releaseRawMode(): void {
  if (rawModeRefCount <= 0) return;
  rawModeRefCount--;
  if (rawModeRefCount === 0) {
    try {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    } catch {
      // ignore
    }
  }
}
