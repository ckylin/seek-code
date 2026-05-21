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
      process.stdin.setEncoding('utf8');
      // Do NOT call resume() here — callers must call stdin.resume() AFTER
      // registering their 'data' listener. On Windows, the libuv TTY read
      // loop must be started after the listener is in place; resuming before
      // registration means the loop fires into a void and is never restarted.
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
      // pause() before setRawMode(false) — stop the stream while it's idle
      // so libuv doesn't tear down and restart the TTY read loop mid-flight.
      // Changing mode on a flowing stream on Windows can leave the handle in
      // a state where the next resume() doesn't deliver events until a
      // synthetic keystroke kicks the loop.
      process.stdin.pause();
      process.stdin.setRawMode(false);
    } catch {
      // ignore
    }
  }
}

/**
 * Drain Node.js's internal stream buffer without touching raw mode or
 * attaching any listeners. Safe to call at any refCount level.
 *
 * This only clears bytes already sitting in Node's internal buffer; it does
 * NOT flush the OS TTY buffer. That's intentional — flushing the OS buffer
 * requires resume() + a data listener, which risks consuming real keystrokes.
 * In practice, the OS buffer is empty by the time the agent run finishes
 * because the interrupt controller's listener (active during the run) already
 * drained it in real time.
 */
export function drainInternalBuffer(): void {
  if (!process.stdin.isTTY) return;
  // .read() pulls from Node's internal buffer even while paused.
  while (process.stdin.read() !== null) { /* drain */ }
}
