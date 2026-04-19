import type { IntervalHandle, TimerHandle, TimerProvider } from "../timer-provider.ts";

export function createDefaultTimerProvider(): TimerProvider {
  return {
    setTimeout(fn: () => void, ms: number): TimerHandle {
      return globalThis.setTimeout(fn, ms);
    },
    clearTimeout(handle: TimerHandle): void {
      globalThis.clearTimeout(handle);
    },
    setInterval(fn: () => void, ms: number): IntervalHandle {
      return globalThis.setInterval(fn, ms);
    },
    clearInterval(handle: IntervalHandle): void {
      globalThis.clearInterval(handle);
    },
  };
}
