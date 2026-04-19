// Fake clock for the replay harness (SAFE-01 runtime).
//
// Provides a deterministic NowProvider + TimerProvider pair backed by a single
// virtual-time counter, seeded from the first baseline timestamp per D-10.
// Every scheduling / clear / fire event emits a transcript entry via the
// injected sink so the recorded side-effect stream has exact temporal
// positioning, not wall-clock drift.
//
// Contract: no real timers ever fire. callers drive time forward through
// advanceTo(atMs) or drain() at end-of-stream.

import type { NowProvider } from "../../src/ports/now-provider.ts";
import type { IntervalHandle, TimerHandle, TimerProvider } from "../../src/ports/timer-provider.ts";

export interface TranscriptSink {
  emit(entry: Record<string, unknown>): void;
}

export interface FakeClockHandle {
  now: NowProvider;
  timer: TimerProvider;
  /** Advance virtual time to `atMs`, firing every scheduled callback whose fire time <= atMs. */
  advanceTo(atMs: number): void;
  /** Drain all pending timers by firing each in order of fire time; callers use this at end-of-stream. */
  drain(): void;
  /** Current virtual time in ms. */
  nowMs(): number;
}

interface ScheduledTimer {
  id: number;
  fireAt: number;
  fn: () => void;
  kind: "timeout" | "interval";
  intervalMs?: number;
  cancelled: boolean;
}

export function createFakeClock(seedMs: number, sink: TranscriptSink): FakeClockHandle {
  let currentMs = seedMs;
  let nextId = 1;
  const queue: ScheduledTimer[] = [];

  function scheduleEmit(kind: "timeout" | "interval", id: number, delayMs: number): void {
    sink.emit({ kind: `timer.schedule-${kind}`, id, delayMs, atVirtualMs: currentMs });
  }

  const now: NowProvider = {
    now: () => currentMs,
  };

  const timer: TimerProvider = {
    setTimeout(fn: () => void, ms: number): TimerHandle {
      const id = nextId;
      nextId += 1;
      queue.push({ id, fireAt: currentMs + ms, fn, kind: "timeout", cancelled: false });
      scheduleEmit("timeout", id, ms);
      return id as unknown as TimerHandle;
    },
    clearTimeout(handle: TimerHandle): void {
      const id = handle as unknown as number;
      const entry = queue.find((t) => t.id === id && !t.cancelled);
      if (entry) {
        entry.cancelled = true;
        sink.emit({ kind: "timer.clear-timeout", id, atVirtualMs: currentMs });
      }
    },
    setInterval(fn: () => void, ms: number): IntervalHandle {
      const id = nextId;
      nextId += 1;
      queue.push({ id, fireAt: currentMs + ms, fn, kind: "interval", intervalMs: ms, cancelled: false });
      scheduleEmit("interval", id, ms);
      return id as unknown as IntervalHandle;
    },
    clearInterval(handle: IntervalHandle): void {
      const id = handle as unknown as number;
      const entry = queue.find((t) => t.id === id && !t.cancelled);
      if (entry) {
        entry.cancelled = true;
        sink.emit({ kind: "timer.clear-interval", id, atVirtualMs: currentMs });
      }
    },
  };

  function pickNextReady(atMs: number): ScheduledTimer | null {
    let chosen: ScheduledTimer | null = null;
    for (const entry of queue) {
      if (entry.cancelled) continue;
      if (entry.fireAt > atMs) continue;
      if (chosen === null || entry.fireAt < chosen.fireAt) {
        chosen = entry;
      }
    }
    return chosen;
  }

  function advanceTo(atMs: number): void {
    if (atMs < currentMs) {
      return; // never move backwards
    }
    // Fire eligible timers in fireAt-ascending order; callbacks may enqueue
    // more timers, so re-scan after each fire. Ties resolve in insertion order
    // because pickNextReady uses strict `<` when picking the minimum.
    while (true) {
      const ready = pickNextReady(atMs);
      if (ready === null) break;
      currentMs = ready.fireAt;
      sink.emit({ kind: "timer.fire", id: ready.id, atVirtualMs: currentMs, timerKind: ready.kind });
      if (ready.kind === "interval" && ready.intervalMs !== undefined) {
        ready.fireAt = currentMs + ready.intervalMs;
      } else {
        ready.cancelled = true;
      }
      ready.fn();
    }
    currentMs = atMs;
  }

  function drain(): void {
    while (true) {
      let next: ScheduledTimer | null = null;
      for (const entry of queue) {
        if (entry.cancelled) continue;
        if (next === null || entry.fireAt < next.fireAt) {
          next = entry;
        }
      }
      if (next === null) break;
      advanceTo(next.fireAt);
    }
  }

  return {
    now,
    timer,
    advanceTo,
    drain,
    nowMs: () => currentMs,
  };
}

export function createFakeNowProvider(seedMs: number): NowProvider {
  let currentMs = seedMs;
  return {
    now: () => currentMs,
  };
}

export function createFakeTimerProvider(): TimerProvider {
  // Convenience standalone: callers that want JUST a TimerProvider shape without
  // a sink should instead use createFakeClock — it wires timer + now under one
  // virtual time. This stub exists so the contract is obvious in the export list;
  // production-replay callers always go through createFakeClock.
  throw new Error("createFakeTimerProvider: callers should use createFakeClock for time-integrated scheduling.");
}
