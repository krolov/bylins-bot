export interface TickTimer {
  schedule(runFn: () => Promise<void>, delayMs: number): void;
  clear(): void;
}

export function createTickTimer(): TickTimer {
  let handle: ReturnType<typeof setTimeout> | null = null;

  return {
    schedule(runFn: () => Promise<void>, delayMs: number): void {
      if (handle !== null) {
        clearTimeout(handle);
        handle = null;
      }
      handle = setTimeout(() => {
        handle = null;
        void runFn();
      }, Math.max(0, delayMs));
    },
    clear(): void {
      if (handle !== null) {
        clearTimeout(handle);
        handle = null;
      }
    },
  };
}
