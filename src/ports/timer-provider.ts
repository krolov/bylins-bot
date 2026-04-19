// Port for scheduling. Default impl delegates to globalThis timers; test/harness
// impls inject a virtual scheduler driven by the baseline fixture timestamp (per D-14).

export type TimerHandle = ReturnType<typeof setTimeout>;
export type IntervalHandle = ReturnType<typeof setInterval>;

export interface TimerProvider {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(fn: () => void, ms: number): IntervalHandle;
  clearInterval(handle: IntervalHandle): void;
}
