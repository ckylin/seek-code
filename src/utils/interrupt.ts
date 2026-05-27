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

  const sigintHandler = (): void => {
    process.stdout.write('\n');
    controller.abort();
  };

  process.on('SIGINT', sigintHandler);

  return {
    signal: controller.signal,
    cleanup: () => {
      activeCount--;
      process.removeListener('SIGINT', sigintHandler);
    },
  };
}
