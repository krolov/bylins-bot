---
phase: 01-safety-harness-scaffolding-infrastructure
plan: 03
subsystem: infra-ports
tags: [ports, interface-only, factory-di, hexagonal, pre-wired, phase-1-infrastructure]

# Dependency graph
requires: []
provides:
  - "src/ports/mud-command-sink.ts — MudCommandSink interface: send(command, source) port extracted from mud-connection.ts::writeAndLogMudCommand public boundary"
  - "src/ports/broadcaster.ts — Broadcaster interface: broadcast(ServerEvent) port extracted from server.ts::broadcastServerEvent"
  - "src/ports/now-provider.ts — NowProvider interface: now(): number port for clock injection (D-14)"
  - "src/ports/timer-provider.ts — TimerProvider interface + TimerHandle/IntervalHandle type aliases for setTimeout/setInterval abstraction (D-14)"
  - "src/ports/session-teardown-registry.ts — SessionTeardownRegistry interface: register/invokeAll mirror of server.ts sessionTeardownHooks Set pattern"
  - "src/ports/defaults/now.ts — createDefaultNowProvider() factory wrapping Date.now()"
  - "src/ports/defaults/timer.ts — createDefaultTimerProvider() factory delegating to globalThis timers"
  - "src/ports/defaults/session-teardown.ts — createDefaultSessionTeardownRegistry() with [...hooks] snapshot-before-iterate defense"
  - "Source-vocabulary contract: 18 values used at writeAndLogMudCommand call sites — Phase 2 controllers reuse verbatim (listed below)"
affects: [02-xx-PLAN.md (Phase 2 extractions import from src/ports/)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ports-and-adapters (hexagonal) seams: pure TypeScript interfaces in src/ports/ — no runtime code, no classes, no new-keyword"
    - "Factory-DI defaults from closure state (mirrors src/map/memory-store.ts + src/utils/timer.ts + src/bus/mud-event-bus.ts from Plan 02)"
    - "Snapshot-before-iterate for hook dispatch ([...hooks] spread) — same defense as Plan 02 bus emit (PITFALLS §1)"
    - "Return-value subscribe = unsubscribe closure — matches Plan 02 bus on() contract and existing server.ts:557-560 addMudTextListener shape"
    - "ReturnType<typeof setTimeout> / ReturnType<typeof setInterval> aliases — portable timer handle typing (mirrors mud-connection.ts:40-44 idiom)"

key-files:
  created:
    - "src/ports/mud-command-sink.ts"
    - "src/ports/broadcaster.ts"
    - "src/ports/now-provider.ts"
    - "src/ports/timer-provider.ts"
    - "src/ports/session-teardown-registry.ts"
    - "src/ports/defaults/now.ts"
    - "src/ports/defaults/timer.ts"
    - "src/ports/defaults/session-teardown.ts"
  modified: []

key-decisions:
  - "Port signatures match the canonical PATTERNS.md shapes verbatim — no semantic deviation; Phase 2 consumers import these identifiers by name and will break if renamed"
  - "MapStore port intentionally NOT created in Phase 1 (D-28) — it stays in src/map/store.ts; Phase 2 may relocate if extraction pressure warrants it, otherwise it remains where it is"
  - "No existing controller imports from src/ports/ (D-29 pre-wired invariant) — verified via `grep -rn 'from \"\\.\\.?/ports/' src/ --exclude-dir=ports` returning 0 matches"
  - "createDefaultSessionTeardownRegistry.invokeAll() does NOT wrap hooks in try/catch — matches existing server.ts:158 `for (const hook of sessionTeardownHooks) hook();` semantic; Phase 2 composition root (not the port default) decides error-isolation policy"
  - "[...hooks] snapshot-before-iterate inside invokeAll() is a CONTRACT requirement (not an optimization) — Plan 02 bus emit established the idiom; register/unregister during teardown must not break iteration"
  - "TimerHandle / IntervalHandle type aliases exported from the port (not hidden) — Phase 2 consumers need portable field typing for keepaliveTimer/reconnectTimer/reconnectRetryTimer-style state"

patterns-established:
  - "src/ports/ layout: interfaces at root, factory defaults under src/ports/defaults/ — mirrors ports-and-adapters convention from research/ARCHITECTURE.md §3"
  - "Port file is interface-only: no const/function/class/new at module scope (except type aliases). Verified via `grep -E '^(const|function|class|export function|export const) ' src/ports/*.ts` returning zero matches"
  - "Default-impl factory shape: `export function createDefaultXxx(): Xxx { return { ... }; }` — same shape across all three defaults, same shape as Plan 02 createMudBus"

commits:
  - "505015d feat(01-03): add five port interfaces (interface-only, pre-wired)"
  - "9d288c6 feat(01-03): add default port implementations (factory-DI)"

metrics:
  files_created: 8
  files_modified: 0
  lines_added: 83
  lines_removed: 0
  tests_added: 0
  tests_passing: "31/31 (no change from Plan 02 baseline — ports layer is passive scaffolding)"
  duration_min: "~10 (actual wall time including GitNexus reindex)"
  completed_date: "2026-04-19"
---

# Phase 01 Plan 03: Ports Layer Summary

**One-liner:** Created five pure-interface port files (MudCommandSink, Broadcaster, NowProvider, TimerProvider, SessionTeardownRegistry) plus three default factory implementations under `src/ports/defaults/` — the hexagonal seams Phase 2 extractions will use to inject side-effects into controllers, committed up-front with MapStore intentionally excluded per D-28 and zero existing consumers per D-29.

## What Was Built

### Port Interfaces (src/ports/*.ts) — interface-only, 5 files

**`src/ports/mud-command-sink.ts`** — extracted from `src/mud-connection.ts:251-265,483-488` `writeAndLogMudCommand` public boundary:

```typescript
export interface MudCommandSink {
  send(command: string, source: string): void;
}
```

The `ws` and `socket` parameters from `writeAndLogMudCommand` become implementation details bound at composition time in `server.ts`; controllers only care about `(command, source)`.

**`src/ports/broadcaster.ts`** — extracted from `src/server.ts:778-782` `broadcastServerEvent`:

```typescript
import type { ServerEvent } from "../events.type.ts";

export interface Broadcaster {
  broadcast(event: ServerEvent): void;
}
```

The iteration over `browserClients` becomes an implementation detail; the default Phase 2 impl will close over that Set.

**`src/ports/now-provider.ts`** — clock injection seam per D-14:

```typescript
export interface NowProvider {
  now(): number;
}
```

**`src/ports/timer-provider.ts`** — scheduler injection seam per D-14:

```typescript
export type TimerHandle = ReturnType<typeof setTimeout>;
export type IntervalHandle = ReturnType<typeof setInterval>;

export interface TimerProvider {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(fn: () => void, ms: number): IntervalHandle;
  clearInterval(handle: IntervalHandle): void;
}
```

Handle-type aliases exported alongside the interface so Phase 2 consumers can declare timer-holding fields portably (mirrors `mud-connection.ts:40-44` idiom).

**`src/ports/session-teardown-registry.ts`** — registry port mirroring `src/server.ts:454` `sessionTeardownHooks = new Set<() => void>()`:

```typescript
export interface SessionTeardownRegistry {
  register(hook: () => void): () => void;
  invokeAll(): void;
}
```

`register()` returns an unregister closure — matches Plan 02 bus `on()` contract and existing `addMudTextListener` shape (`src/server.ts:557-560`).

### Default Implementations (src/ports/defaults/*.ts) — factory-DI, 3 files

**`src/ports/defaults/now.ts`** — 7 lines. Wraps `Date.now()`.

**`src/ports/defaults/timer.ts`** — 18 lines. Delegates each method to the corresponding `globalThis.*` timer with explicit parameter and return types per CONVENTIONS.md:150. Imports `IntervalHandle, TimerHandle, TimerProvider` sorted alphabetically.

**`src/ports/defaults/session-teardown.ts`** — 18 lines. Uses `new Set<() => void>` for closure state; `register()` returns a closure that deletes the hook; `invokeAll()` iterates `[...hooks]` (snapshot) rather than the Set directly — contract requirement, not optimization (see Decisions).

## MudCommandSink Source-String Vocabulary

The `source: string` parameter of `MudCommandSink.send()` is a free-form string at the type level, but in practice `src/server.ts` uses exactly **18 unique values** across **32 `writeAndLogMudCommand` call sites** (enumerated via `grep -oE 'writeAndLogMudCommand[^)]*,\s*"[^"]+"\s*\)' src/server.ts`):

| Source string | Example call site (server.ts) | Phase 2 consumer |
|---------------|-------------------------------|------------------|
| `attack-nearest` | :1640-1641 | attack-nearest handler in browser-gateway extraction |
| `bazaar-notifier` | :588 | bazaar-notifier.ts |
| `browser` | :991, :997, :1001 | browser-gateway adapter |
| `compare-apply` | :1936 | compare-scan controller |
| `compare-scan` | :1912 | compare-scan controller |
| `equipped-scan` | :1804 | browser-gateway (container inspect path) |
| `farm2-script` | :300, :305 | farm2 controller |
| `gather-script` | :375, :1780 | gather-script controller |
| `goto_and_run` | :1696 | navigation controller |
| `inspect-container` | :1789 | container-tracker integration |
| `inspect-inventory` | :1796 | container-tracker integration |
| `mover` | :279 | mover helper (zone-scripts) |
| `navigation` | :1162 | navigation-controller.ts |
| `repair-script` | :340 | repair-script controller |
| `room-auto-cmd` | :1421 | room-auto-cmd dispatcher |
| `survival-script` | :325 | survival-script controller |
| `triggers` | :411 | triggers.ts |
| `zone-script` | :502, :514, :534, :564-566, :598, :605, :633, :650 | zone-scripts controller |

**Phase 2 contract:** Controllers MUST reuse these exact strings when they acquire `MudCommandSink`. Inventing new values breaks the log-audit trail and any downstream filter that greps `mud-out` log lines by source. This list is the source-of-truth registry; any new source value requires a conscious decision recorded in the relevant Phase 2 plan's Deviations section.

## Decisions Made

1. **Port signatures match PATTERNS.md verbatim** — no semantic deviation. The `<interfaces>` block in 01-03-PLAN.md already locked the exact shape; Phase 2 extractions import these identifiers by name.

2. **MapStore port intentionally NOT created (D-28)** — The `MapStore` interface already lives in `src/map/store.ts` and is consumed by `src/map/memory-store.ts` and by production code. Moving it in Phase 1 would conflict with pre-existing uncommitted working-tree modifications to `store.ts` (85 diff lines from prior work) and would spread the edit surface unnecessarily. Phase 2 may relocate it to `src/ports/map-store.ts` if extraction pressure warrants; the decision is deferred without cost since no current import path depends on physical location.

3. **No existing controller imports from `src/ports/` (D-29 pre-wired)** — Verified via:
   ```bash
   grep -rn 'from "\.\./ports/\|from "\./ports/\|from "\.\./\.\./ports/\|from "\.\./\.\./\.\./ports/' src/ --exclude-dir=ports
   ```
   Returns zero matches. Phase 2 extractions will be the first consumers; in the meantime the port files are dead code by design — they exist only to commit the contract.

4. **`createDefaultSessionTeardownRegistry.invokeAll()` does NOT wrap hooks in try/catch** — matches existing `src/server.ts:158` semantic (`for (const hook of sessionTeardownHooks) hook();` with no catch). Teardown-hook authors are responsible for their own error handling. If Phase 2 discovers a throwing hook blocking subsequent hooks, the fix lives in the composition-root wiring (wrap at registration time), not in the port default. This preserves behaviour-preserving invariant: the default port reproduces the existing iteration semantic exactly.

5. **`[...hooks]` snapshot-before-iterate is a contract requirement** — Plan 02 bus emit established the idiom; register/unregister during teardown must not break iteration. Do NOT replace with `hooks.forEach(...)` or direct `for (const hook of hooks)` — both break under in-dispatch registration/unregistration.

6. **`TimerHandle` / `IntervalHandle` type aliases exported from the port** — Phase 2 consumers need portable field typing for keepaliveTimer/reconnectTimer-style state (mirrors `mud-connection.ts:40-44` idiom). Hiding the aliases would force each consumer to re-declare `ReturnType<typeof setTimeout>` locally, fragmenting the type surface.

## Deviations from Plan

**None — plan executed exactly as written.**

No Rule 1-3 auto-fixes applied; no Rule 4 architectural decisions surfaced. The plan's `<interfaces>` block gave the exact file contents verbatim; no judgment calls were required during execution.

## Authentication Gates

None encountered. Pure file-creation work; no external services involved.

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| 5 interface files present | `test -f src/ports/{mud-command-sink,broadcaster,now-provider,timer-provider,session-teardown-registry}.ts` | PASS |
| 3 default files present | `test -f src/ports/defaults/{now,timer,session-teardown}.ts` | PASS |
| Typecheck | `bun run typecheck` | PASS (zero errors) |
| Test suite | `bun test` | 31/31 pass (no regression from Plan 02) |
| D-28 MapStore port absent | `ls src/ports/map-store.ts 2>/dev/null \| wc -l` | 0 (absent, as required) |
| D-29 zero consumers | `grep -rn 'from "\.\.?/ports/' src/ --exclude-dir=ports \| wc -l` | 0 |
| No runtime code in interfaces | `grep -E '^(const\|function\|class\|export function\|export const) ' src/ports/*.ts` | 0 matches |
| No `any` anywhere | `grep -rE '\bany\b' src/ports/` | 0 matches |
| No `console.*` in defaults | `grep -rE 'console\.' src/ports/defaults/` | 0 matches |
| No Cyrillic | `grep -rP '[\x{0400}-\x{04FF}]' src/ports/` | 0 matches |
| No classes in defaults | `grep -rE '\bclass ' src/ports/defaults/` | 0 matches |
| File count | `find src/ports -type f -name '*.ts' \| wc -l` | 8 (5 interfaces + 3 defaults) |
| store.ts not modified by this plan | Plan 03 did not stage src/map/store.ts | confirmed |
| Exact-string contract (broadcaster import) | `grep -c 'import type { ServerEvent } from "../events.type.ts"' src/ports/broadcaster.ts` | 1 |
| Exact-string contract ([...hooks] snapshot) | `grep -c '\[\.\.\.hooks\]' src/ports/defaults/session-teardown.ts` | 1 |

## Commits

| Hash | Task | Message |
|------|------|---------|
| `505015d` | Task 1 | `feat(01-03): add five port interfaces (interface-only, pre-wired)` |
| `9d288c6` | Task 2 | `feat(01-03): add default port implementations (factory-DI)` |

Docs commit (this SUMMARY + STATE/ROADMAP updates) follows separately.

## Phase 2 Consumption Notes

For the Phase 2 planner:

- Import paths are `"../ports/<name>.ts"` from `src/controllers/*` (once that directory is created) or `"./ports/<name>.ts"` from `src/*.ts` modules.
- `import type { ... }` for all port imports (`verbatimModuleSyntax`).
- Default factories return fully typed objects — no cast or assertion needed on the return value.
- When Phase 2 wires a controller to `MudCommandSink`, the composition root in `server.ts` constructs it as:
  ```typescript
  const mudCommandSink: MudCommandSink = {
    send: (command, source) => mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, command, source),
  };
  ```
- When Phase 2 wires `Broadcaster`, the composition root constructs it as:
  ```typescript
  const broadcaster: Broadcaster = {
    broadcast: (event) => { for (const client of browserClients) sendServerEvent(client, event); },
  };
  ```
- `SessionTeardownRegistry` default can be swapped at the composition root if Phase 2 needs per-session registries rather than a process-wide one — the interface is agnostic to cardinality.

## Self-Check: PASSED

- All 8 created files confirmed present on disk
- Commit `505015d` confirmed in `git log`
- Commit `9d288c6` confirmed in `git log`
- Typecheck green, test suite 31/31 green, zero D-29 violations, D-28 invariant held
