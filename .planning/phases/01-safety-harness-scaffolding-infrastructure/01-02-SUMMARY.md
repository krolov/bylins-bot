---
phase: 01-safety-harness-scaffolding-infrastructure
plan: 02
subsystem: infra-bus
tags: [bus, pub-sub, typed-events, discriminated-union, sync-delivery, factory-di, bun-test, tdd]

# Dependency graph
requires: []
provides:
  - "src/bus/types.ts — MudEvent discriminated union (Phase 1: mud_text_raw variant only), MudEventHandler<K>, Unsubscribe, MudEventBus interface (5 methods), MudEventBusDependencies"
  - "src/bus/mud-event-bus.ts — createMudBus({onError}) factory with sync delivery, insertion-order dispatch, listener-snapshot-before-iterate, try/catch per handler"
  - "Error-message prefix convention for bus: '[bus] handler error for <kind>: <message>' — Phase 2 consumers observe this prefix"
  - "Test-helper pattern: makeDeps() returns {deps, errors} — reused by Phase 2 bus-consumer test files"
affects: [02-xx-PLAN.md (Phase 2 bus-shim)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Factory-DI from closure state (mirrors src/map/memory-store.ts + src/utils/timer.ts)"
    - "Listener-snapshot-before-iterate via [...set] spread (defends against self-remove mid-dispatch — PITFALLS §1)"
    - "Discriminated-union events with Extract<Union, {kind: K}> for narrowing (mirrors src/map/types.ts::ParsedEvent + src/zone-scripts/types.ts::ScriptStep)"
    - "Closure-over-array test helper makeDeps() as substitute for mocking framework (AGENTS.md: 'No mocking framework needed')"

key-files:
  created:
    - "src/bus/types.ts"
    - "src/bus/mud-event-bus.ts"
    - "src/bus/mud-event-bus.test.ts"
  modified: []

key-decisions:
  - "Production code is the canonical factory body from 01-PATTERNS.md verbatim — no semantic deviation; same shape as research/ARCHITECTURE.md §3 Pattern 1"
  - "once() implemented as an on() wrapper that unsubscribes itself before invoking the user handler — keeps the single unsubscribe closure returned from once() in sync with the internal 'on' registration (prevents double-unsub or dangling-reference bugs)"
  - "Error isolation uses the existing narrowing idiom from server.ts:73-75: `error instanceof Error ? error.message : 'unknown error'` — consistent with AGENTS.md 'Never suppress errors' rule and routes via injected deps.onError, not console"
  - "onAny handlers receive the same event object emitted by emit(); no cloning — matches the 'sync, zero-copy' delivery semantic of the existing mudTextHandlers Set iteration in server.ts:63"

patterns-established:
  - "Bus factory shape: closure-captured Map<kind, Set<handler>> + Set<anyHandler> + reportError(kind, err) helper. Phase 2 consumers will reuse this exact subscription shape via bus.on(kind, handler)."
  - "Test helper shape: makeDeps() returns {deps, errors}. Replicable across Phase 2 tests that need to assert on bus onError output."
  - "Error-message prefix convention: '[bus] handler error for <kind>: <message>'. Phase 2 integration in server.ts must wire deps.onError to logEvent(null, 'error', ...) so these prefixed lines land in /var/log/bylins-bot/mud-traffic.log."

requirements-completed: [INFRA-01]

# Metrics
duration: 3min
completed: 2026-04-19
---

# Phase 01 Plan 02: MUD Event Bus Summary

**Typed sync pub/sub factory (`createMudBus`) that preserves the four semantic guarantees of the existing `mudTextHandlers: Set` pattern — foundation for every Phase 2+ extraction that subscribes to MUD text.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-19T08:33:14Z
- **Completed:** 2026-04-19T08:36:39Z
- **Tasks:** 2 completed (Task 1 types file; Task 2 TDD RED + GREEN)
- **Files created:** 3 (`src/bus/types.ts`, `src/bus/mud-event-bus.ts`, `src/bus/mud-event-bus.test.ts`)
- **Files modified:** 0 (no consumer wired yet per D-29)

## Accomplishments

- **Typed `MudEvent` discriminated union locked** — Phase 1 has exactly one variant (`{kind: "mud_text_raw"; text: string}`). Leading `| ` preserved so Phase 2 extension (`session_teardown`, `room_parsed`, …) is a one-line diff.
- **`createMudBus(deps)` factory ships** with sync delivery + insertion-order dispatch + `[...bucket]` / `[...anyHandlers]` listener-snapshot-before-iterate + try/catch per handler + `[bus] handler error for <kind>` error-message prefix.
- **Five-method public API** — `emit`, `on`, `once`, `off`, `onAny`. All subscription methods return an unsubscribe closure (matches `addMudTextListener` return shape at server.ts:523-526).
- **Seven bun:test cases green** — emit-no-handlers, emit-many-handlers, self-remove mid-dispatch, once auto-unsub, onAny typed event, handler error isolation, typed-payload narrowing. All cases mapped 1:1 to D-25.
- **Zero regressions elsewhere** — full `bun test` reports 31 pass / 0 fail (24 pre-existing parser/tracker + 7 new bus).
- **No consumer wired** (per D-29) — `grep -c "mudTextHandlers\|addMudTextListener" src/server.ts` returns 16, unchanged from pre-plan baseline. Phase 2 integrates via `bus.on("mud_text_raw", handler)` in the composition root.

## Public API Reference (for Phase 2 consumers)

### `src/bus/types.ts`

```typescript
export type MudEvent =
  | { kind: "mud_text_raw"; text: string };
// Phase 2 extends inline.

export type MudEventHandler<K extends MudEvent["kind"] = MudEvent["kind"]> =
  (event: Extract<MudEvent, { kind: K }>) => void;

export type Unsubscribe = () => void;

export interface MudEventBus {
  emit<K extends MudEvent["kind"]>(event: Extract<MudEvent, { kind: K }>): void;
  on<K extends MudEvent["kind"]>(kind: K, handler: MudEventHandler<K>): Unsubscribe;
  once<K extends MudEvent["kind"]>(kind: K, handler: MudEventHandler<K>): Unsubscribe;
  off<K extends MudEvent["kind"]>(kind: K, handler: MudEventHandler<K>): void;
  onAny(handler: (event: MudEvent) => void): Unsubscribe;
}

export interface MudEventBusDependencies {
  onError(message: string): void;
}
```

### `src/bus/mud-event-bus.ts`

```typescript
export function createMudBus(deps: MudEventBusDependencies): MudEventBus
```

**Deps contract:** `onError(message: string): void` — called once per thrown handler with a message of the form `[bus] handler error for <kind>: <narrowed-error-message>`. Phase 2 wires this to `logEvent(null, "error", ...)` so entries land in `/var/log/bylins-bot/mud-traffic.log` (see AGENTS.md log-format).

## Test Coverage (D-25 — 7 cases)

All in `src/bus/mud-event-bus.test.ts`, one `describe("createMudBus", …)` block:

| # | Case | What it proves |
|---|------|----------------|
| 1 | `emit with no handlers is a no-op` | No throw, no onError call, no async side-effects |
| 2 | `emit dispatches to every handler in insertion order` | Three registered handlers all fire; received order matches registration order |
| 3 | `self-remove mid-dispatch does not break iteration` | Handler A unsubs inside its own body; B still fires for the same event; subsequent emit skips A and fires B (reproduces server.ts:456-470 `onceMudText` semantic) |
| 4 | `once auto-unsubscribes after first event` | Registered via `bus.once`; second emit does not invoke the handler |
| 5 | `onAny receives the typed event` | Captured event has `kind === "mud_text_raw"` and `text === "x"` |
| 6 | `one handler throwing does not block subsequent handlers` | Handler A throws `boom`; handler B still runs; `errors[0]` contains `[bus] handler error for mud_text_raw` and `boom` |
| 7 | `typed payload narrowing lets handler read event.text without any cast` | Exists primarily for `tsc --noEmit` to catch future regressions in `Extract<Union, {kind: K}>` narrowing |

## Task Commits

Each task was committed atomically:

1. **Task 1** — `feat(01-02): add MudEvent types + MudEventBus interface` — `997e608`
2. **Task 2 (RED)** — `test(01-02): add failing bun:test suite for createMudBus (RED)` — `edb2804`
3. **Task 2 (GREEN)** — `feat(01-02): implement createMudBus factory (GREEN)` — `e5169f4`

REFACTOR phase skipped — code already matches the canonical factory body from 01-PATTERNS.md verbatim; no cleanup needed.

**Plan metadata commit:** appended separately with SUMMARY + STATE + ROADMAP updates.

## Files Created/Modified

- **Created** `src/bus/types.ts` (32 LOC) — pure type declarations. `MudEvent` union, `MudEventHandler<K>` parameterized handler, `Unsubscribe` alias, `MudEventBus` interface (5 methods), `MudEventBusDependencies`. Zero runtime code (`grep -cE '^(const|function|class|…)'` returns 0), zero `any`, zero Cyrillic.
- **Created** `src/bus/mud-event-bus.ts` (72 LOC) — `createMudBus` factory. Closure state: `Map<kind, Set<AnyHandler>>` + `Set<AnyHandler>` for wildcard. Single internal type alias `AnyHandler = (event: MudEvent) => void` used for `Set` storage casts — hidden inside the factory closure, never leaks. Type-only imports (`import type { … } from "./types.ts"` per verbatimModuleSyntax). No classes, no `new` (except `new Map`/`new Set` for data structures).
- **Created** `src/bus/mud-event-bus.test.ts` (111 LOC) — 7 bun:test cases inside `describe("createMudBus", …)`. Reusable `makeDeps()` helper returns `{deps, errors}` — closure-over-array style per AGENTS.md ("No mocking framework needed"). Imports `MudEvent` type for the onAny-capture array.

## Decisions Made

See `key-decisions` in frontmatter. Summary:

- **Canonical factory body used verbatim.** The plan's `<interfaces>` block already contained the correct factory from research/ARCHITECTURE.md §3 Pattern 1. Copied directly — the only deviations allowed were cosmetic (import ordering), and none were needed.
- **`once()` as on()-wrapper.** A simpler design would store a `once` flag alongside the handler, but wrapping `on()` keeps the unsubscribe closure returned from `once` in sync with the actual 'on' registration — prevents double-unsub bugs if the caller invokes `unsubscribe()` after the once has already fired.
- **Error-prefix convention locked.** `[bus] handler error for <kind>: <message>` — matches CONVENTIONS.md:123-126 `[module-name]` log-prefix rule. Phase 2 consumers can grep mud-traffic.log for `[bus]` to surface all bus-related errors in one stream.
- **onAny zero-copy delivery.** The same `event` object is passed to kind-handlers and any-handlers, matching the `for (const h of mudTextHandlers) h(text)` iteration in server.ts:63. No defensive clone — the `MudEvent` union is a literal object, immutable by convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] onAny test typecheck failure (TS control-flow analysis)**

- **Found during:** Task 2 GREEN verify (`bun run typecheck` flagged TS2769 on lines 82 and 83 of the initial test draft)
- **Issue:** The initial onAny test used `let seenKind: string | null = null; let seenText: string | null = null;` and assigned to them inside the `bus.onAny(event => …)` closure. TypeScript's control-flow analysis cannot see closure mutations, so it narrowed both variables to the literal `null` type at the later `expect(seenKind).toBe("mud_text_raw")` call — rejecting `"mud_text_raw"` as an argument because the parameter type was narrowed to just `null`.
- **Fix:** Rewrote the test to push events into a typed `MudEvent[]` array, then narrow via the discriminator (`if (event?.kind === "mud_text_raw") { expect(event.text).toBe("x"); }`). No `any`, no `ts-ignore` — the fix uses the same kind-narrowing pattern the production bus code uses. Semantics identical (onAny still receives a typed event; test still proves kind + text round-trip through the bus).
- **Files modified:** `src/bus/mud-event-bus.test.ts` (1 test case rewritten + added `MudEvent` to existing `import type`)
- **Commit:** `e5169f4` (rolled into the GREEN commit since the fix was discovered during GREEN verify; the RED commit `edb2804` never passed typecheck, which is expected for a RED commit).

### Plan-level TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED  | `edb2804` `test(01-02): ... (RED)` | ✓ present (test file introduced; fails with "Cannot find module") |
| GREEN | `e5169f4` `feat(01-02): implement createMudBus factory (GREEN)` | ✓ present (7 pass / 0 fail after) |
| REFACTOR | — | skipped — canonical factory body matched 01-PATTERNS.md verbatim |

**Total deviations:** 1 (auto-fixed, no architectural impact).
**Impact on plan:** None. All acceptance criteria pass; 7 D-25 tests green; 31/31 full suite pass; `src/server.ts` unchanged (D-29 satisfied).

## Issues Encountered

One TS control-flow narrowing issue on the onAny test's null-initialized variables — diagnosed from the tsc error message and fixed in ~30 seconds by switching to a captured-array pattern with explicit discriminator narrowing. No architectural change.

## Verification Results

Phase-level integration checks from the plan's `<verification>` block — all pass:

| Check | Expected | Actual |
|-------|----------|--------|
| `bun run typecheck` | exit 0 | ✓ clean |
| `bun test` (full suite) | zero regressions | ✓ 31 pass / 0 fail (was 24 pre-plan, now 24 + 7 bus) |
| `grep -c "mudTextHandlers\|addMudTextListener" src/server.ts` | unchanged from pre-plan | ✓ 16 (no consumer wired; D-29 satisfied) |
| `ls src/bus/` file count | exactly 3 | ✓ `types.ts`, `mud-event-bus.ts`, `mud-event-bus.test.ts` |
| Seven D-25 test cases green | all pass | ✓ 7 pass / 0 fail |
| No `as any`, `@ts-ignore`, `@ts-expect-error` | zero | ✓ zero across both src files |
| No `console.*` | zero | ✓ zero |
| No `queueMicrotask`, `setImmediate`, `setTimeout` in bus impl | zero | ✓ zero |
| No Cyrillic in bus files | zero | ✓ zero |

## Self-Check Before Finishing

- `src/bus/types.ts` exists: confirmed by `test -f` + git-tracked in `997e608`
- `src/bus/mud-event-bus.ts` exists: confirmed + git-tracked in `e5169f4`
- `src/bus/mud-event-bus.test.ts` exists: confirmed + git-tracked in `edb2804` (later edited in `e5169f4`)
- `tsc --noEmit` clean
- `bun test src/bus/mud-event-bus.test.ts` — 7 pass / 0 fail
- `bun test` (full suite) — 31 pass / 0 fail (zero regressions)
- Commits `997e608`, `edb2804`, `e5169f4` present in `git log`
- `src/bus/` contains exactly 3 files — no accidental extra scaffolding
- GitNexus impact analysis: not applicable — plan creates only new files in a brand-new `src/bus/` directory; no pre-existing symbols edited. (GitNexus hook flagged index as stale after each commit — will refresh via `npx gitnexus analyze` after the final metadata commit, per CLAUDE.md.)
- GitNexus pre-commit scope: manually verified each commit via `git status --short` — only `src/bus/*.ts` files + (for the last commit) the SUMMARY/STATE/ROADMAP metadata. Zero unrelated scope bleed.

## Next Phase Readiness

**Ready for Plan 03 (ports layer):** Plan 03 is the other Wave-1 plan in Phase 1 and is independent of Plan 02 — can proceed immediately.

**For Phase 2 (BUS-01 bus-shim):**
- Composition root (`src/server.ts`) will create the bus via:
  ```typescript
  const mudBus = createMudBus({
    onError: (message) => logEvent(null, "error", message),
  });
  ```
- The shim then emits `mud_text_raw` **alongside** the existing `for (const h of mudTextHandlers) h(text)` iteration at server.ts:63. Replay-harness (Plan 06) verifies no duplicate/missed side-effects from the parallel dispatch paths.
- Consumers subscribe via `mudBus.on("mud_text_raw", (event) => handler(event.text))`. Returned `Unsubscribe` closure replaces `mudTextHandlers.delete(handler)` at call sites.

**No blockers.** The bus ships as self-contained infrastructure; no downstream plan is waiting on additional bus surface area (`session_teardown`, `room_parsed` variants are deferred to Phase 2 per D-23).

## Threat Flags

None. This plan adds only new files to a brand-new `src/bus/` directory. No network endpoints, no auth paths, no filesystem access, no schema changes, no new trust boundaries. The bus is pure in-memory pub/sub within a single process; handler errors are routed to a local logging callback (not serialized or transmitted).

## Self-Check: PASSED

- FOUND: src/bus/types.ts
- FOUND: src/bus/mud-event-bus.ts
- FOUND: src/bus/mud-event-bus.test.ts
- FOUND: .planning/phases/01-safety-harness-scaffolding-infrastructure/01-02-SUMMARY.md
- FOUND: commit 997e608 (Task 1 — types)
- FOUND: commit edb2804 (Task 2 RED — failing test)
- FOUND: commit e5169f4 (Task 2 GREEN — implementation + test fix)

---

*Phase: 01-safety-harness-scaffolding-infrastructure*
*Completed: 2026-04-19*
