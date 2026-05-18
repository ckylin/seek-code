export interface InterruptController {
  signal: AbortSignal;
  cleanup: () => void;
}

export function createInterruptController(): InterruptController {
  const controller = new AbortController();

  const handler = () => {
    process.stdout.write('\n');
    controller.abort();
  };

  process.on('SIGINT', handler);

  return {
    signal: controller.signal,
    cleanup: () => process.removeListener('SIGINT', handler),
  };
}
