# Testing Patterns

**Analysis Date:** 2026-04-18

## Test Framework

**Runner:**
- `bun:test` — built into Bun runtime, Jest-compatible API
- No external test framework (no Jest, no Vitest, no Mocha)
- No dedicated test config file — Bun discovers `*.test.ts` files automatically
- Configuration is implicit from `tsconfig.json` (strict mode, ESM, `allowImportingTsExtensions`)

**Assertion Library:**
- Built-in `expect` from `bun:test` — Jest-compatible matchers (`.toBe`, `.toEqual`, `.toBeNull`, etc.)

**Run Commands:**
```bash
bun test                                        # Run all tests
bun test src/map/parser.test.ts                 # Run a single test file
bun test --test-name-pattern "handles portal"   # Run tests matching a name pattern
bun run build                                   # typecheck (not tests)
```

Watch mode: Bun does not need a separate `--watch` flag here — re-run `bun test` manually.
Coverage: not configured.

## Test File Organization

**Location:**
- Co-located with source — `src/map/parser.ts` + `src/map/parser.test.ts`
- No separate `tests/`, `__tests__/`, or `spec/` directory
- Only 2 test files currently exist:
  - `src/map/parser.test.ts` — stateful streaming parser tests
  - `src/map/tracker.test.ts` — movement tracking / edge inference tests

**Naming:**
- `<source>.test.ts` (NOT `.spec.ts`)
- Test files live in the same directory as the code under test

**Structure:**
```
src/
  map/
    parser.ts
    parser.test.ts      # co-located
    tracker.ts
    tracker.test.ts     # co-located
```

## Test Structure

**Suite organization uses `describe` per exported function:**
```ts
import { describe, expect, test } from "bun:test";
import { createTrackerState, processParsedEvents, trackOutgoingCommand } from "./tracker";
import type { ParsedEvent } from "./types";

describe("trackOutgoingCommand", () => {
  test("tracks russian abbreviations", () => {
    const state = createTrackerState();
    state.currentRoomId = 6000;

    trackOutgoingCommand(state, "с");
    expect(state.pendingMove?.direction).toBe("north");
  });

  test("ignores non-directional commands", () => {
    const state = createTrackerState();
    trackOutgoingCommand(state, "look");
    expect(state.pendingMove).toBeNull();
  });
});

describe("processParsedEvents", () => {
  test("creates edge when room changes after a move", () => {
    // arrange
    const state = createTrackerState();
    state.currentRoomId = 6000;
    trackOutgoingCommand(state, "с");

    // act
    const result = processParsedEvents(state, [
      { kind: "room", room: { vnum: 6001, name: "...", exits: [...], closedExits: [] } },
    ] satisfies ParsedEvent[]);

    // assert
    expect(result.edges).toEqual([{ fromVnum: 6000, toVnum: 6001, direction: "north", isPortal: false }]);
  });
});
```
See `src/map/tracker.test.ts:1-174`.

**Patterns:**
- **Imports:** `import { describe, expect, test } from "bun:test"` (never use `it`)
- **Types via `import type`:** test files respect `verbatimModuleSyntax`
- **Arrange-act-assert:** setup inline in each `test`, no global `beforeEach`/`afterEach` (none used in existing tests)
- **Test names are prose, lowercase:** `"parses room header and exits from one chunk"`, `"does not create self-loop edge"`
- **One behavior per `test` block** — never bundle multiple assertions for different scenarios into one test
- **`satisfies` for typed literals:** `[{ kind: "movement_blocked" }] satisfies ParsedEvent[]`

## Mocking

**No mocking framework.** The factory + dependency-injection pattern (see `CONVENTIONS.md`) makes units testable with plain objects — no `jest.mock`, no `bun:test` mock helpers needed in existing tests.

**What to Mock:**
- Pass plain object literals implementing the `Dependencies` interface:
  ```ts
  const controller = createFarm2Controller({
    sendCommand: (cmd) => { /* capture */ },
    getCurrentRoomId: () => 10200,
    onLog: () => {},
    // ...
  });
  ```
- For state-bearing helpers, construct state directly via the `create*State` factory and mutate fields under test:
  ```ts
  const state = createTrackerState();
  state.currentRoomId = 6000;
  ```

**What NOT to Mock:**
- Never stub internal helpers — test at the exported function boundary
- Never import a module then mock its exports — refactor to inject the dep instead
- Never patch `Date.now()` or `setTimeout` globally — if time matters, thread time through parameters (e.g. `PENDING_MOVE_TTL_MS` is tested by sequencing events, not by clock manipulation)

## Fixtures and Factories

**Test Data:**
- Inline literal objects inside each test — no `fixtures/` directory, no JSON files
- Typed with `satisfies` to catch drift when the union grows:
  ```ts
  const events = [
    {
      kind: "room",
      room: {
        vnum: 6049,
        name: "Комната отдыха",
        exits: ["north", "south", "down"],
        closedExits: [],
      },
    },
  ] satisfies ParsedEvent[];
  ```
- Russian strings are valid in test inputs (they mirror actual MUD server text)

**Location:**
- None centralized — fixtures are inlined next to the assertions that use them

## Coverage

**Requirements:** None enforced. No `bun test --coverage` in scripts.

**Current coverage areas:**
- `src/map/parser.ts` — stateful streaming parser: room headers, exits, movement confirmations, blocked movement, ANSI stripping, partial-line buffering, prompt-prefix stripping, cross-chunk assembly, combat-prompt prefix, multiple room variants
- `src/map/tracker.ts` — outgoing command → pending move, edge inference on room change, self-loop suppression, movement_blocked clearing, cross-zone portal detection

**Untested areas (no `.test.ts` file exists):**
- `src/map/pathfinder.ts` — BFS pathfinding
- `src/map/mover.ts`, `src/map/store.ts`, `src/map/memory-store.ts`
- `src/farm2/*` (tick, controller, state, mud-handler, navigation)
- `src/zone-scripts/*`
- `src/combat-state.ts`, `src/triggers.ts`, `src/survival-script.ts`, `src/gather-script.ts`, `src/repair-script.ts`
- `src/mob-resolver.ts`, `src/item-identify.ts`, `src/container-tracker.ts`
- `src/compare-scan/*`
- `src/wiki.ts`, `src/bazaar-notifier.ts`
- `src/client/*` (all browser-side code)
- `src/server.ts`, `src/mud-connection.ts`
- Entire `scripts/` directory

## Test Types

**Unit Tests:**
- Scope: single exported function or small group of related functions (usually within one file)
- Approach: pure functional testing — construct state via `createXxxState()`, call the function, assert return value and/or state mutation
- Example: `processParsedEvents(state, events) → TrackerResult` with state side-effects on `state.pendingMove` / `state.currentRoomId`

**Integration Tests:**
- Not present. No end-to-end controller tests, no DB tests, no WebSocket tests.

**E2E Tests:**
- Not used. A manual `scripts/smoke-test.ts` runs via `bun run smoke` — builds the client and performs a lightweight startup check (not a test framework test).

## Common Patterns

**Stateful streaming testing** (parser):
- Build state once via `createParserState()`
- Feed multiple text chunks and assert returned events per chunk:
  ```ts
  const state = createParserState();
  expect(feedText(state, "Комната отдыха [6049]\n")).toEqual([]);
  expect(feedText(state, "[ Exits: n s d ]\n")).toEqual([{ kind: "room", room: {...} }]);
  ```
- Assert internal buffer state when testing partial-line handling:
  ```ts
  expect(feedText(state, "Комната от")).toEqual([]);
  expect(state.lineBuffer).toBe("Комната от");
  ```

**State-transition testing** (tracker):
- Arrange: construct state + set relevant fields + call "outgoing command" helper
- Act: invoke the function under test with a typed event array
- Assert on both the return value AND the state mutation:
  ```ts
  expect(result.edges).toEqual([...]);
  expect(state.pendingMove).toBeNull();
  expect(result.currentVnum).toBe(6001);
  ```

**Async Testing:**
- Not yet present in existing tests. If needed, use `async` test functions + `await`:
  ```ts
  test("awaits the thing", async () => {
    const result = await someAsyncFn();
    expect(result).toBe(...);
  });
  ```

**Error Testing:**
- Not yet present in existing tests. Prefer:
  ```ts
  expect(() => fn()).toThrow("specific message");
  // or for async:
  await expect(asyncFn()).rejects.toThrow("specific message");
  ```

## Adding New Tests

**When adding a test:**
1. Place `<source>.test.ts` next to the source file
2. Import with `import { describe, expect, test } from "bun:test"`
3. One `describe` block per exported function; one `test` block per behavior
4. Use `satisfies <Type>[]` on literal event/step arrays
5. Inject stub dependencies as plain objects — do NOT reach for a mocking framework
6. Keep tests deterministic — never rely on wall-clock time or real network I/O
7. If the module under test uses `setTimeout`, thread the timer dep through `createTickTimer()` (`src/utils/timer.ts`) so it can be swapped in tests (no such test exists yet, but the shape is already dependency-injectable)

**Pre-existing typecheck note:** `bun run typecheck` may surface pre-existing errors in `parser.test.ts` and `tracker.test.ts` around `closedExits` — documented in `AGENTS.md:449` as unrelated to new changes.

---

*Testing analysis: 2026-04-18*
