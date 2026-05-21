import { acquireRawMode, releaseRawMode } from './rawMode.js';

export interface InterruptController {
  signal: AbortSignal;
  cleanup: () => void;
}

// Track active interrupt controllers so the global SIGINT handler in repl.ts
// can distinguish between "abort current task" and "exit the REPL entirely".
let activeCount = 0;
export function getActiveInterruptCount(): number {
  return activeCount;
}

export function createInterruptController(): InterruptController {
  const controller = new AbortController();

  activeCount++;

  const sigintHandler = () => {
    process.stdout.write('\n');
    controller.abort();
  };

  process.on('SIGINT', sigintHandler);

  // Listen for Esc key when stdin is a TTY (interactive mode).
  // acquireRawMode() coordinates with input.ts and select.ts so raw mode
  // is only truly disabled when all callers have released it.
  const escHandler = (data: Buffer | string): void => {
    const key = data.toString();
    if ((key === '\x1B' || key === '\x03') && !controller.signal.aborted) {
      controller.abort();
    }
  };

  let escListening = false;
  if (process.stdin.isTTY) {
    acquireRawMode();
    process.stdin.on('data', escHandler);
    process.stdin.resume();
    escListening = true;
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      activeCount--;
      process.removeListener('SIGINT', sigintHandler);
      if (escListening) {
        process.stdin.removeListener('data', escHandler);
        releaseRawMode();
      }
    },
  };
}
