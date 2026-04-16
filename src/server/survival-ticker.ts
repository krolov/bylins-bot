// ---------------------------------------------------------------------------
// Survival-tick scheduler — the debounced timer that asks the survival
// controller to run its maintenance tick (feed / drink / refill flask).
// Extracted from server.ts so the surrounding code doesn't need to hold
// survivalTickTimer / survivalTickRunning module state inline.
//
// Ownership:
//   - schedule(delayMs): arms a single-shot timer; no-ops if a tick is
//     already scheduled or still running
//   - clear(): cancels a pending tick (teardown path)
// ---------------------------------------------------------------------------

interface SurvivalControllerLike {
  runTick: (rearm: (delayMs: number) => void) => Promise<unknown>;
}

export interface SurvivalTicker {
  schedule: (delayMs: number) => void;
  clear: () => void;
}

export function createSurvivalTicker(
  survivalController: SurvivalControllerLike,
): SurvivalTicker {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  function schedule(delayMs: number): void {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (running) return;
      running = true;
      void survivalController.runTick(schedule).finally(() => {
        running = false;
      });
    }, Math.max(0, delayMs));
  }

  function clear(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    running = false;
  }

  return { schedule, clear };
}
