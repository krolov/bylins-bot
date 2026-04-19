import { describe, expect, test } from "bun:test";
import { createMudBus } from "./mud-event-bus.ts";
import type { MudEventBusDependencies } from "./types.ts";

function makeDeps(): { deps: MudEventBusDependencies; errors: string[] } {
  const errors: string[] = [];
  return {
    deps: { onError: (message: string) => { errors.push(message); } },
    errors,
  };
}

describe("createMudBus", () => {
  test("emit with no handlers is a no-op (does not throw, does not call onError)", () => {
    const { deps, errors } = makeDeps();
    const bus = createMudBus(deps);

    bus.emit({ kind: "mud_text_raw", text: "hello" });

    expect(errors).toEqual([]);
  });

  test("emit dispatches to every handler in insertion order", () => {
    const { deps, errors } = makeDeps();
    const bus = createMudBus(deps);
    const received: string[] = [];
    bus.on("mud_text_raw", (event) => { received.push(`A:${event.text}`); });
    bus.on("mud_text_raw", (event) => { received.push(`B:${event.text}`); });
    bus.on("mud_text_raw", (event) => { received.push(`C:${event.text}`); });

    bus.emit({ kind: "mud_text_raw", text: "ping" });

    expect(received).toEqual(["A:ping", "B:ping", "C:ping"]);
    expect(errors).toEqual([]);
  });

  test("self-remove mid-dispatch does not break iteration", () => {
    const { deps, errors } = makeDeps();
    const bus = createMudBus(deps);
    const received: string[] = [];
    let unsubA: (() => void) | null = null;
    unsubA = bus.on("mud_text_raw", (event) => {
      received.push(`A:${event.text}`);
      unsubA?.();
    });
    bus.on("mud_text_raw", (event) => { received.push(`B:${event.text}`); });

    bus.emit({ kind: "mud_text_raw", text: "one" });
    bus.emit({ kind: "mud_text_raw", text: "two" });

    expect(received).toEqual(["A:one", "B:one", "B:two"]);
    expect(errors).toEqual([]);
  });

  test("once auto-unsubscribes after first event", () => {
    const { deps, errors } = makeDeps();
    const bus = createMudBus(deps);
    let calls = 0;
    bus.once("mud_text_raw", () => { calls += 1; });

    bus.emit({ kind: "mud_text_raw", text: "first" });
    bus.emit({ kind: "mud_text_raw", text: "second" });

    expect(calls).toBe(1);
    expect(errors).toEqual([]);
  });

  test("onAny receives the typed event", () => {
    const { deps, errors } = makeDeps();
    const bus = createMudBus(deps);
    let seenKind: string | null = null;
    let seenText: string | null = null;
    bus.onAny((event) => {
      seenKind = event.kind;
      if (event.kind === "mud_text_raw") {
        seenText = event.text;
      }
    });

    bus.emit({ kind: "mud_text_raw", text: "x" });

    expect(seenKind).toBe("mud_text_raw");
    expect(seenText).toBe("x");
    expect(errors).toEqual([]);
  });

  test("one handler throwing does not block subsequent handlers (error isolation)", () => {
    const { deps, errors } = makeDeps();
    const bus = createMudBus(deps);
    let bSaw = false;
    bus.on("mud_text_raw", () => { throw new Error("boom"); });
    bus.on("mud_text_raw", () => { bSaw = true; });

    bus.emit({ kind: "mud_text_raw", text: "x" });

    expect(bSaw).toBe(true);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("[bus] handler error for mud_text_raw");
    expect(errors[0]).toContain("boom");
  });

  test("typed payload narrowing lets handler read event.text without any cast", () => {
    const { deps, errors } = makeDeps();
    const bus = createMudBus(deps);
    let receivedText = "";
    bus.on("mud_text_raw", (event) => { receivedText = event.text; });

    bus.emit({ kind: "mud_text_raw", text: "narrowed" });

    expect(receivedText).toBe("narrowed");
    expect(errors).toEqual([]);
  });
});
