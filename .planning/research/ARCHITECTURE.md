# Architecture Research

**Domain:** Brownfield Bun/TypeScript MUD bot — decomposing a 1867-line composition root, introducing a typed event bus, splitting a 1029-line browser bootstrap.
**Researched:** 2026-04-18
**Confidence:** HIGH for patterns (well-established TS/Node patterns, matches existing codebase style); MEDIUM for ordering heuristics (informed by observed coupling in `server.ts`, but order choices are judgement calls — any of them work if executed carefully).

---

## 0. Executive Summary — The Shape We Want

Three intertwined problems, three compatible solutions:

1. **Monolith composition root** (`server.ts`) → extract **domain controllers** that own their state and ports, keep `server.ts` as a **thin wiring layer** (target ≤ 400 LOC). Keep the existing `createXxx({deps})` factory-DI style — no classes, no DI container.
2. **Callback-chain fan-out** (`onMudText` + `mudTextHandlers: Set<Handler>`) → introduce a **typed event bus** (`MudEventBus`) with discriminated-union events, typed `on/emit/off`, and a strangler-fig migration (bus runs in parallel with callbacks; controllers opt in one at a time).
3. **Monolithic browser bootstrap** (`client/main.ts`) → split into **feature modules** (`hotkeys/`, `script-panel/`, `stats-bar/`, `chat/`) wired by a slim `main.ts` bootstrap that owns DOM-element queries and app-level composition only.

The unifying principle: **ports-and-adapters by convention**, not by framework. Each controller declares a `Deps` interface (its "ports") and stays IO-free; `server.ts` is the **only** place that adapters (Postgres, WebSocket broadcast, MUD socket writes) bind to ports. This is hexagonal architecture wearing functional clothes — which is exactly what `createFarm2Controller` already does today.

---

## 1. Standard Architecture

### 1.1 Target System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Composition Root: src/server.ts  (target: < 400 LOC, wiring only)   │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────┐  │
│  │ HTTP+WS Host   │  │ Session        │  │ MudEventBus (typed)    │  │
│  │ (Bun.serve)    │  │ (mud-conn ref) │  │ emit() + on() + off()  │  │
│  └────────┬───────┘  └────────┬───────┘  └───────────┬────────────┘  │
└───────────┼───────────────────┼──────────────────────┼───────────────┘
            │                   │                      │
            ↓                   ↓                      ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Controllers (domain layer — pure except through deps)               │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌──────────┐│
│  │ navigation-   │ │ farm2         │ │ zone-scripts  │ │ triggers ││
│  │ controller    │ │ (existing)    │ │ (existing)    │ │          ││
│  └───────────────┘ └───────────────┘ └───────────────┘ └──────────┘│
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌──────────┐│
│  │ survival      │ │ gather        │ │ repair        │ │ bazaar   ││
│  │               │ │               │ │               │ │ notifier ││
│  └───────────────┘ └───────────────┘ └───────────────┘ └──────────┘│
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐             │
│  │ stats-parser  │ │ chat-parser   │ │ loot-sort     │  (NEW —     │
│  │ (extract)     │ │ (extract)     │ │ (extract)     │   extract   │
│  └───────────────┘ └───────────────┘ └───────────────┘   from      │
│                                                          server.ts)│
└──────────────────────┬──────────────────────────────────────────────┘
                       │ (controllers only talk to ports via deps)
                       ↓
┌─────────────────────────────────────────────────────────────────────┐
│  Ports (typed interfaces) → Adapters (implementations in server.ts) │
│  MapStore  │  MudCommandSink  │  BrowserBroadcaster  │  Logger      │
│  ↓            ↓                   ↓                      ↓          │
│  Postgres  │  mud-connection   │  browserClients Set    │  log file │
└─────────────────────────────────────────────────────────────────────┘
```

**What moved where, conceptually:**

| Concept | Today (server.ts) | After refactor |
|---|---|---|
| Wiring | Lines 1–1867 mixed with logic | Lines 1–~400, ONLY factory construction + route registration |
| MUD-text fan-out | `mudTextHandlers: Set<Handler>` (lines 63, 419, 440, 522) | `MudEventBus` — typed emit/on, handlers live IN controllers, not server.ts |
| Stats parsing (lines 655–728) | Mutable module-level `let statsHp`, `let statsLevel`, … | `createStatsController({bus, onStatsChange})` — closure state |
| Chat extraction (lines 133–175) | Inline name lists + regex | `createChatController({bus, mapStore})` |
| Market sales (lines 177–239) | Inline regex + broadcast | `createMarketSalesController({bus, mapStore})` |
| Loot sort (lines 551–620) | Free functions + module-level `pendingLootItems` | `createLootSortController({bus, mudCommand, mapStore})` |
| Navigation (lines 399–413, 1051+) | Module-level `navigationState` + free functions | `createNavigationController({bus, mover, pathfinder, mapStore})` |
| Browser WS routing | Inline `switch (event.type)` | `createBrowserGateway({bus, controllers})` — the only thing that knows `ClientEvent` ↔ controller |

### 1.2 Component Responsibilities

| Component | Responsibility | Shape |
|---|---|---|
| **`src/server.ts`** | Composition root: build adapters, construct bus, construct controllers in dep-order, register HTTP/WS handlers, wire teardown hooks. **Zero domain logic.** | Imperative top-level code, no exports |
| **`src/bus/mud-bus.ts`** | Typed pub/sub for MUD-originated events. Closed set of event types (discriminated union). Sync delivery. No backpressure. | `createMudBus(): MudEventBus` |
| **`src/bus/types.ts`** | `MudEvent` discriminated union, `MudEventMap` type map, `MudEventBus` interface | Types only |
| **`src/controllers/navigation.ts`** | Path-finding + step execution + `onceRoomChanged` semantics | `createNavigationController(deps) => NavigationController` |
| **`src/controllers/stats.ts`** | Parse HP/energy/level from MUD text, broadcast, notify farm | `createStatsController(deps) => StatsController` |
| **`src/controllers/chat.ts`** | Extract chat lines, persist, broadcast | `createChatController(deps) => ChatController` |
| **`src/controllers/market-sales.ts`** | Extract bazaar/auction sale lines, persist | `createMarketSalesController(deps) => MarketSalesController` |
| **`src/controllers/loot-sort.ts`** | Buffer loot names, schedule sort, run sort-to-container | `createLootSortController(deps) => LootSortController` |
| **`src/adapters/browser-gateway.ts`** | Own `browserClients: Set<WS>`, provide `broadcast(event)` port, route `ClientEvent` → controller methods | `createBrowserGateway(deps) => BrowserGateway` |
| **`src/adapters/mud-command-sink.ts`** | Thin facade over `mudConnection.writeAndLogMudCommand` — the single port controllers use to send commands | `createMudCommandSink(deps) => MudCommandSink` |
| **`src/ports/`** | Pure interfaces — `MapStore`, `MudCommandSink`, `BrowserBroadcaster`, `Logger`, `MudEventBus` | Types only, no runtime code |

**Direction of dependencies (strictly enforced):**
```
ports   ←  controllers  ←  adapters  ←  server.ts
  ↑                                         │
  └── (types only, everybody imports) ──────┘
```

No controller imports `server.ts`. No controller imports another controller (they communicate via bus or via explicit deps passed by `server.ts`). Adapters may import ports. `server.ts` imports everything.

---

## 2. Recommended Project Structure

```
src/
├── server.ts                         # Composition root (≤ 400 LOC)
├── config.ts                         # runtimeConfig (existing)
├── profiles.ts                       # (existing)
├── events.type.ts                    # WS wire protocol (existing)
├── db.ts                             # (existing)
│
├── ports/                            # NEW — typed interfaces, no runtime
│   ├── mud-command-sink.ts           # interface MudCommandSink
│   ├── browser-broadcaster.ts        # interface BrowserBroadcaster
│   ├── logger.ts                     # interface Logger
│   └── index.ts                      # barrel
│
├── bus/                              # NEW — typed event bus
│   ├── types.ts                      # MudEvent union, MudEventMap, MudEventBus interface
│   ├── mud-bus.ts                    # createMudBus()
│   ├── mud-bus.test.ts               # unit tests for bus semantics
│   └── index.ts                      # barrel
│
├── adapters/                         # NEW — infrastructure glue
│   ├── browser-gateway.ts            # WS session + ClientEvent routing + broadcast
│   ├── mud-command-sink.ts           # facade over mud-connection.writeAndLogMudCommand
│   └── logger.ts                     # file-append logEvent (moved from server.ts)
│
├── controllers/                      # NEW folder — houses extracted controllers
│   ├── navigation.ts                 # (from server.ts lines 399–413, 1051+)
│   ├── stats.ts                      # (from server.ts lines 655–728)
│   ├── chat.ts                       # (from server.ts lines 133–175)
│   ├── market-sales.ts               # (from server.ts lines 177–239)
│   ├── loot-sort.ts                  # (from server.ts lines 551–620)
│   ├── stats.test.ts                 # unit tests
│   └── chat.test.ts                  # unit tests
│
├── mud-connection.ts                 # (existing — stays)
├── combat-state.ts                   # (existing — stays)
├── triggers.ts                       # (existing — may move to controllers/)
├── survival-script.ts                # (existing — may move to controllers/)
├── gather-script.ts                  # (existing)
├── repair-script.ts                  # (existing)
├── bazaar-notifier.ts                # (existing)
├── container-tracker.ts              # (existing)
├── item-identify.ts                  # (existing)
├── farm2/                            # (existing — gold standard structure)
├── zone-scripts/                     # (existing)
├── map/                              # (existing)
├── compare-scan/                     # (existing)
├── utils/                            # (existing)
│   └── timer.ts
│
├── client/                           # Browser bundle
│   ├── main.ts                       # Bootstrap (≤ 250 LOC) — DOM queries + wiring
│   ├── net.ts                        # (existing)
│   ├── bus.ts                        # (existing tiny pub-sub — stays as-is)
│   ├── terminal.ts                   # (existing)
│   ├── map-grid.ts                   # (split into layout/render/interactions — separate milestone task)
│   ├── nav-panel.ts                  # (existing)
│   ├── inventory.ts                  # (existing)
│   ├── popups.ts                     # (existing)
│   ├── splitters.ts                  # (existing)
│   ├── constants.ts                  # (existing)
│   ├── types.ts                      # (existing)
│   ├── features/                     # NEW — feature modules split out of main.ts
│   │   ├── hotkeys.ts                # ~100 LOC (from main.ts lines 935–997)
│   │   ├── script-panel.ts           # ~200 LOC (panel render + loop config)
│   │   ├── stats-bar.ts              # ~50 LOC (HP/energy bar rendering)
│   │   ├── chat-pane.ts              # ~80 LOC (chat output + clear)
│   │   └── connect-form.ts           # ~120 LOC (connect/disconnect, profile select)
│   ├── event-router.ts               # NEW — ServerEvent dispatcher (from main.ts handleServerEvent)
│   └── modals/                       # (existing — lazy loaded)
```

### 2.1 Structure Rationale

- **`ports/`, `adapters/`, `controllers/`** — explicit ports-and-adapters naming makes the dependency direction self-documenting. A reviewer sees `controllers/navigation.ts` importing only from `ports/`, `bus/`, and `map/` → OK. They see it importing from `adapters/` → RED FLAG.
- **`bus/` as its own folder** — the bus is infrastructure, not domain. Tests live beside it. A single barrel (`bus/index.ts`) keeps imports readable.
- **`controllers/` new, but `farm2/` and `zone-scripts/` stay put** — those are already multi-file feature folders with their own internal structure (state/tick/mud-handler). Moving them would be churn for no benefit. The "controllers/" folder is for the single-file refugees we're evicting from `server.ts`.
- **`client/features/`** — mirrors the server-side decomposition: each feature owns its DOM queries, hotkey bindings, and bus subscriptions. `main.ts` becomes a boot script.
- **No classes anywhere** — matches existing convention (`CONVENTIONS.md` line 177: "No classes. No `new`.").

---

## 3. Architectural Patterns

### Pattern 1: Typed Event Bus with Discriminated Unions

**What:** Replace the untyped `mudTextHandlers: Set<(text: string) => void>` with a typed bus where each event is a named variant, handlers receive fully-typed payloads, and `tsc` catches subscription-emission mismatches.

**When to use:** When multiple controllers must react to the same source event (MUD text chunks). When you want to add/remove listeners without touching `server.ts`. When you want `tsc` to enforce that emitters and subscribers agree on the shape.

**When NOT to use:** See section 6. Short answer: 1:1 synchronous calls, request/response flows, and tightly coupled state-machines should stay as direct method calls through `deps`.

**Trade-offs:**
- **Pros:** Decouples controllers from `server.ts`. Enables unit tests (construct a bus, emit events, assert controller output). Fully type-safe. No runtime dependency.
- **Cons:** Slight indirection (stack traces go through `emit`). Easy to over-apply — the bus is for **fan-out**, not for RPC-style calls.

**Event bus shape — design decisions:**

| Question | Decision | Why |
|---|---|---|
| What events? | Only MUD-derived events (`mud_text_raw`, `room_entered`, `combat_started`, `stats_changed`, `combat_ended`, `session_teardown`). | Keep scope tight. NOT a generic "application bus". |
| Sync or async? | **Sync** (handlers run inline during `emit`). | Matches current callback semantics. Avoids reordering bugs. Errors inside handlers are caught per-handler. |
| Wildcard? | **Yes**, via `on("*", handler)` — used by the raw logger and session teardown; not by domain code. | Matches `mitt`/`nanoevents` convention. Handy for debug trace. |
| Backpressure? | **None**. | Sync delivery; one fanout per MUD text chunk (~30/sec peak). Not a queue. |
| Handler errors? | **Each handler try/catch'd individually**; failure logged via injected `Logger`, does not abort other handlers. | Matches `onMudText` current tolerance. |
| Unsubscribe? | `on()` returns an unsubscribe function (closure). | Cleaner than `off(type, handler)` reference matching. Matches `nanoevents` API. |
| Once? | `once(type, handler)` helper built on top of `on()`. | Needed to replace `onceMudText` and `onceRoomChanged` (server.ts 422, 622). |

**Type design:**

```typescript
// src/bus/types.ts
import type { Direction, ParsedRoom } from "../map/types.ts";

export type MudEvent =
  | { kind: "mud_text_raw"; text: string }
  | { kind: "room_entered"; vnum: number; room: ParsedRoom }
  | { kind: "room_description_refreshed"; vnum: number }
  | { kind: "movement"; direction: Direction; fromVnum: number | null }
  | { kind: "movement_blocked"; direction: Direction }
  | { kind: "stats_changed"; hp: number; hpMax: number; energy: number; energyMax: number }
  | { kind: "combat_started"; target: string }
  | { kind: "combat_ended" }
  | { kind: "mobs_in_room"; vnum: number; mobs: string[] }
  | { kind: "corpses_in_room"; vnum: number; count: number }
  | { kind: "session_teardown" };

// Index-by-kind map (cleaner than repetitive overloads)
export type MudEventMap = {
  [E in MudEvent as E["kind"]]: E;
};

export type Unsubscribe = () => void;

export interface MudEventBus {
  emit<K extends MudEvent["kind"]>(event: Extract<MudEvent, { kind: K }>): void;
  on<K extends MudEvent["kind"]>(
    kind: K,
    handler: (event: Extract<MudEvent, { kind: K }>) => void,
  ): Unsubscribe;
  once<K extends MudEvent["kind"]>(
    kind: K,
    handler: (event: Extract<MudEvent, { kind: K }>) => void,
  ): Unsubscribe;
  onAny(handler: (event: MudEvent) => void): Unsubscribe;
  clear(): void;
}
```

**Implementation:**

```typescript
// src/bus/mud-bus.ts
import type { Logger } from "../ports/logger.ts";
import type { MudEvent, MudEventBus, Unsubscribe } from "./types.ts";

export interface MudBusDependencies {
  logger: Logger;
}

export function createMudBus(deps: MudBusDependencies): MudEventBus {
  type Handler = (event: MudEvent) => void;

  const handlersByKind = new Map<MudEvent["kind"], Set<Handler>>();
  const anyHandlers = new Set<Handler>();

  function emit<K extends MudEvent["kind"]>(event: Extract<MudEvent, { kind: K }>): void {
    const bucket = handlersByKind.get(event.kind);
    if (bucket) {
      for (const handler of bucket) {
        try {
          handler(event);
        } catch (error: unknown) {
          deps.logger.error(
            error instanceof Error ? `[bus] handler error for ${event.kind}: ${error.message}` : "[bus] handler error",
          );
        }
      }
    }
    for (const handler of anyHandlers) {
      try {
        handler(event);
      } catch (error: unknown) {
        deps.logger.error(
          error instanceof Error ? `[bus] wildcard handler error for ${event.kind}: ${error.message}` : "[bus] wildcard error",
        );
      }
    }
  }

  function on<K extends MudEvent["kind"]>(
    kind: K,
    handler: (event: Extract<MudEvent, { kind: K }>) => void,
  ): Unsubscribe {
    let bucket = handlersByKind.get(kind);
    if (!bucket) {
      bucket = new Set();
      handlersByKind.set(kind, bucket);
    }
    // Type-erase on insertion; reconstituted correctly in emit.
    bucket.add(handler as Handler);
    return () => {
      bucket!.delete(handler as Handler);
    };
  }

  function once<K extends MudEvent["kind"]>(
    kind: K,
    handler: (event: Extract<MudEvent, { kind: K }>) => void,
  ): Unsubscribe {
    const unsubscribe = on(kind, (event) => {
      unsubscribe();
      handler(event);
    });
    return unsubscribe;
  }

  function onAny(handler: (event: MudEvent) => void): Unsubscribe {
    anyHandlers.add(handler);
    return () => {
      anyHandlers.delete(handler);
    };
  }

  function clear(): void {
    handlersByKind.clear();
    anyHandlers.clear();
  }

  return { emit, on, once, onAny, clear };
}
```

**Key safety properties:**
- `emit<K>` uses `Extract<MudEvent, { kind: K }>` — you can only emit events whose payload shape matches `K`.
- `on<K>` handler receives the exact subtype — in the `"stats_changed"` handler, TypeScript knows `event.hp: number` exists.
- No `any`, no `as unknown as`, no casts escape the module boundary. The single internal cast (`handler as Handler`) is hidden inside the closure.
- `Set<Handler>` preserves insertion order in V8/Bun; `emit` iteration is deterministic.

### Pattern 2: Controller Factory with Explicit Port Interface

**What:** Every extracted module exports `createXxx(deps: XxxDependencies): XxxController`. The `Dependencies` interface is the controller's contract with the outside world — all IO happens through it.

**When to use:** Every stateful module (which is nearly everything except pure parsers).

**Trade-offs:**
- **Pros:** Unit-testable (pass mock deps). Composable (swap adapters without touching logic). Matches codebase convention — `farm2`, `zone-scripts`, `survival`, `triggers` all already do this.
- **Cons:** Requires up-front thinking about the port shape. Deps interface can drift from consumer — pin it by naming it `<Module>Dependencies` (per `CONVENTIONS.md` line 25) and colocating in the module.

**Example — extracted `stats` controller:**

```typescript
// src/controllers/stats.ts
import type { MudEventBus } from "../bus/types.ts";
import type { BrowserBroadcaster } from "../ports/browser-broadcaster.ts";
import type { Logger } from "../ports/logger.ts";

const MAX_STATS_REGEXP =
  /Вы можете выдержать \d+\((\d+)\) единиц[а-я]* повреждения.*?пройти \d+\((\d+)\) верст/i;
const PROMPT_STATS_REGEXP =
  /(\d+)H\s+(\d+)M\s+(\d+)o\s+Зауч:\d+\s+ОЗ:\d+.*?(\d+)L\s+\d+G/;
const PROMPT_LEVEL_REGEXP = /(\d+)L\s+\d+G/;
const ANSI_ESCAPE_REGEXP = /\u001b\[[0-9;]*m/g;
const RAZB_REGEXP = /максимальной разницей в (\d+) уровн/i;

export interface StatsSnapshot {
  hp: number;
  hpMax: number;
  energy: number;
  energyMax: number;
  level: number;
  dsu: number;
  razb: number;
}

export interface StatsControllerDependencies {
  bus: MudEventBus;
  broadcaster: BrowserBroadcaster;
  logger: Logger;
}

export interface StatsController {
  getSnapshot(): StatsSnapshot;
  reset(): void;
}

export function createStatsController(deps: StatsControllerDependencies): StatsController {
  const state: StatsSnapshot = {
    hp: 0, hpMax: 0, energy: 0, energyMax: 0, level: 0, dsu: 0, razb: 5,
  };

  function parseAndEmit(text: string): void {
    let changed = false;

    const maxMatch = MAX_STATS_REGEXP.exec(text);
    if (maxMatch) {
      const hpMax = Number(maxMatch[1]);
      const energyMax = Number(maxMatch[2]);
      if (hpMax !== state.hpMax || energyMax !== state.energyMax) {
        state.hpMax = hpMax;
        state.energyMax = energyMax;
        changed = true;
      }
    }

    const stripped = text.replace(ANSI_ESCAPE_REGEXP, "");
    const promptMatch = PROMPT_STATS_REGEXP.exec(stripped);
    if (promptMatch) {
      const hp = Number(promptMatch[1]);
      const energy = Number(promptMatch[2]);
      const dsu = Number(promptMatch[3]);
      const level = Number(promptMatch[4]);
      if (hp !== state.hp || energy !== state.energy) {
        state.hp = hp; state.energy = energy; changed = true;
      }
      if (dsu !== state.dsu) state.dsu = dsu;
      if (level !== 0 && level !== state.level) state.level = level;
    } else {
      const levelMatch = PROMPT_LEVEL_REGEXP.exec(stripped);
      if (levelMatch) {
        const level = Number(levelMatch[1]);
        if (level !== 0 && level !== state.level) state.level = level;
      }
    }

    const razbMatch = RAZB_REGEXP.exec(stripped);
    if (razbMatch) state.razb = Number(razbMatch[1]);

    if (changed) {
      deps.broadcaster.broadcast({
        type: "stats_update",
        payload: { hp: state.hp, hpMax: state.hpMax, energy: state.energy, energyMax: state.energyMax },
      });
      deps.bus.emit({
        kind: "stats_changed",
        hp: state.hp, hpMax: state.hpMax, energy: state.energy, energyMax: state.energyMax,
      });
    }
  }

  deps.bus.on("mud_text_raw", (event) => parseAndEmit(event.text));
  deps.bus.on("session_teardown", () => {
    state.hp = 0; state.hpMax = 0; state.energy = 0; state.energyMax = 0;
    state.level = 0; state.dsu = 0; state.razb = 5;
  });

  return {
    getSnapshot() { return { ...state }; },
    reset() {
      state.hp = 0; state.hpMax = 0; state.energy = 0; state.energyMax = 0;
      state.level = 0; state.dsu = 0; state.razb = 5;
    },
  };
}
```

**Key properties:**
- Takes ONLY three ports: bus, broadcaster, logger. No DB, no socket. No direct reference to other controllers.
- Emits `stats_changed` — farm2 can subscribe to it later (replacing the current `farm2Controller.updateStats(...)` call at server.ts:721).
- Zero module-level mutable state outside the factory closure — matches `CONVENTIONS.md`.
- Unit test: construct a fake bus, emit `mud_text_raw`, assert `broadcaster.broadcast` was called with the right payload.

### Pattern 3: Strangler-Fig Migration (Parallel Bus + Shim)

**What:** Don't delete the `onMudText` + `mudTextHandlers` callback chain. Instead, add the bus **next to it**, emit from the same central dispatch point, and migrate controllers one-at-a-time. Delete the callback machinery only when the last consumer has moved.

**When to use:** Any non-trivial refactor with zero test coverage on the hot path. Big-bang is unacceptable — the only regression test is running the bot against a live MUD.

**Trade-offs:**
- **Pros:** Each step is individually revertible. Behaviour-preservation is maintained by construction (old path still runs until new path proves itself). Can ship partial progress.
- **Cons:** Temporary duplication (two ways to receive text). Slight runtime overhead during migration window (~1 day per controller). Requires discipline to actually complete the migration — "temporary shim" easily becomes permanent.

**Concrete migration plan — 5 phases:**

**Phase A — Introduce bus, no consumers yet (1 PR):**

```typescript
// server.ts — inside existing createMudConnection onMudText:
const mudBus = createMudBus({ logger });
// ... existing handler code continues unchanged ...
onMudText: (text, ws) => {
  // NEW: emit to bus first (parallel path)
  mudBus.emit({ kind: "mud_text_raw", text });

  // OLD: everything else stays exactly as-is
  containerTracker.feedText(text);
  // ... all the other handlers ...
  for (const handler of mudTextHandlers) handler(text);
  // ...
}
```

Nothing uses the bus yet. `tsc` passes. Behaviour identical. This is the safe landing point.

**Phase B — Migrate first consumer (stats, smallest):**

1. Create `src/controllers/stats.ts` as shown in Pattern 2.
2. In `server.ts`, construct `const statsController = createStatsController({bus: mudBus, broadcaster, logger})` ONCE, near bus creation.
3. Delete the inline `parseAndBroadcastStats(text)` call in `onMudText`.
4. Delete module-level `statsHp`, `statsHpMax`, … `statsRazb` variables.
5. Replace `statsLevel` / `statsDsu` / `statsRazb` accessors (used by `triggers` at server.ts:389–391) with `statsController.getSnapshot()`.
6. Typecheck, run the bot, verify stats update in UI.

At this point stats-parsing is entirely off the callback chain. The bus has its first real consumer.

**Phase C — Migrate `onceMudText` shim:**

The tricky case: `onceMudText(pattern, timeoutMs)` (server.ts:422) adds a transient text-matcher. Replace with `bus.once("mud_text_raw", event => pattern.test(event.text) ? resolve() : keepWaiting())`:

```typescript
// src/controllers/navigation.ts (excerpt)
function onceTextMatches(pattern: RegExp, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      unsubscribe();
      reject(new Error(`wait_text timeout: ${pattern.source}`));
    }, timeoutMs);
    const unsubscribe = deps.bus.on("mud_text_raw", (event) => {
      if (done) return;
      if (pattern.test(event.text)) {
        done = true;
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}
```

**Phase D — Migrate remaining consumers one per PR:**
chat → market-sales → loot-sort → navigation → (optional: triggers/survival/gather via `bus.on("stats_changed")`, `bus.on("combat_started")`).

**Phase E — Remove old callback chain:**
Once no consumer uses `mudTextHandlers` or `addMudTextListener` (check via `gitnexus_impact({target: "mudTextHandlers"})`), delete:
- `mudTextHandlers: Set<Handler>` (server.ts:419)
- `sessionTeardownHooks: Set<() => void>` (replaced by `bus.on("session_teardown", …)` inside each controller)
- `registerTextHandler` / `unregisterTextHandler` / `addMudTextListener` deps across `zone-scripts`, `repair-script`, etc.
- The `for (const handler of mudTextHandlers)` loop in the dispatch.

### Pattern 4: Thin Composition Root — the ≤ 400-line recipe

**What should be IN `server.ts` after refactor:**
1. `import` statements (~50 lines).
2. Log-file setup (`mkdirSync`, `appendFileSync`).
3. Adapter construction in the correct order:
   - `const logger = createFileLogger({…})`
   - `const sql` (already in `db.ts`)
   - `const mapStore = createMapStore(sql)`
   - `const bus = createMudBus({ logger })`
   - `const broadcaster = createBrowserGateway({ browserClients: new Set() })`
   - `const mudCommandSink = createMudCommandSink({ mudConnection, session })`
4. Controller construction (10–15 lines each, with deps objects).
5. `Bun.serve({ fetch, websocket })` with handlers that delegate to `broadcaster` and controllers.
6. Last-profile file read/write helpers (could also move to `src/adapters/profile-persistence.ts`).

**What should NOT be in `server.ts`:**
- Any regex.
- Any parsing logic.
- Any business rule (e.g. "if stats.hp < threshold, recall").
- Any mutable module-level state beyond `browserClients` and `activeProfileId`.
- Any HTTP route body longer than 5 lines (extract to `src/adapters/http-routes/*`).

**LOC budget:**
```
imports                                  ~50
log setup + last-profile helpers         ~30
adapters construction                    ~40
controllers construction                 ~150
Bun.serve + fetch + websocket handlers   ~100
————————————————————————————————————————
Total target                             ~370 LOC
```

### Pattern 5: Frontend — Feature Modules + Bootstrap

**Target shape for `src/client/main.ts`:**

```typescript
// src/client/main.ts (target ≤ 250 LOC)

// 1. DOM element queries (required-element pattern, existing)
const elements = {
  output: requireElement<HTMLElement>("#output"),
  commandInput: requireElement<HTMLInputElement>("#command-input"),
  // ... ~40 of these, but consolidated to ONE object, not scattered
};

// 2. Core infrastructure
const net = createNet({ /* ... */ });
const terminal = createTerminal({ /* ... */ });
const navPanel = createNavPanel({ /* ... */ });
const mapGrid = createMapGrid({ /* ... */ });

// 3. Feature modules (NEW folders)
import { createHotkeysFeature } from "./features/hotkeys.ts";
import { createScriptPanel } from "./features/script-panel.ts";
import { createStatsBar } from "./features/stats-bar.ts";
import { createChatPane } from "./features/chat-pane.ts";
import { createConnectForm } from "./features/connect-form.ts";

const hotkeys = createHotkeysFeature({ elements, sendClientEvent, /* ... */ });
const scriptPanel = createScriptPanel({ elements, sendClientEvent, /* ... */ });
const statsBar = createStatsBar({ elements });
const chatPane = createChatPane({ elements });
const connectForm = createConnectForm({ elements, net, /* ... */ });

// 4. Server-event dispatcher (extracted)
import { createServerEventRouter } from "./event-router.ts";
const router = createServerEventRouter({
  terminal, navPanel, mapGrid, hotkeys, scriptPanel, statsBar, chatPane,
});
net.onMessage(router.dispatch);

// 5. Boot
initSplitters();
void connectForm.init();
```

**Hotkeys extraction shape (from main.ts lines 935–997):**

```typescript
// src/client/features/hotkeys.ts
import type { HotkeyEntry } from "../types.ts";
import { DEFAULT_HOTKEYS } from "../constants.ts";
import * as bus from "../bus.ts";

const HOTKEYS_STORAGE_KEY = "bylins-hotkeys-v1";

export interface HotkeysFeatureDependencies {
  sendCommand(command: string): void;
  appendTerminalLine(text: string): void;
  openHotkeysModal(): Promise<void>;
}

export interface HotkeysFeature {
  getHotkeys(): HotkeyEntry[];
  setCombatState(inCombat: boolean, enemy: string): void;
}

export function createHotkeysFeature(deps: HotkeysFeatureDependencies): HotkeysFeature {
  let hotkeys = load();
  let inCombat = false;
  let lastEnemy = "";

  function load(): HotkeyEntry[] { /* ...existing loadHotkeys logic... */ }
  function save(): void { localStorage.setItem(HOTKEYS_STORAGE_KEY, JSON.stringify(hotkeys)); }

  document.addEventListener("keydown", (event) => { /* existing handler */ });

  bus.on("hotkeys_request", () => bus.emit("hotkeys_state", hotkeys));
  bus.on("hotkeys_save", (entries) => { hotkeys = entries as HotkeyEntry[]; save(); });

  return {
    getHotkeys: () => [...hotkeys],
    setCombatState: (v, enemy) => { inCombat = v; lastEnemy = enemy; },
  };
}
```

**Script-panel extraction shape:** Similar pattern — takes DOM elements + `sendClientEvent` as deps, owns the ~200 lines currently scattered across main.ts:290–363 (`refreshScriptToggleBtn`, `renderScriptSteps`, loop-config handling).

**Direction of deps on the frontend:**
```
main.ts  →  features/*  →  bus.ts / constants.ts / types.ts
main.ts  →  net.ts, terminal.ts, map-grid.ts, nav-panel.ts
event-router.ts  →  features/* (receives references, invokes setters)
```

Features never import each other directly. Shared state goes through the existing `bus.ts` (tiny pub/sub, ~27 lines, good as-is). `event-router.ts` is the client-side analog of `browser-gateway.ts` — it owns the `switch (event.type)`.

---

## 4. Data Flow

### 4.1 MUD → Browser (after refactor)

```
MUD TCP bytes
    ↓
mud-connection.ts (telnet, decode)
    ↓
mud-connection.onMudText(text)  ← the ONLY caller of bus.emit("mud_text_raw", …)
    ↓
bus.emit({ kind: "mud_text_raw", text })
    │
    ├─→ stats-controller        → bus.emit({ kind: "stats_changed", ... })
    │                              ↓
    │                          broadcaster.broadcast({type: "stats_update", ...})
    │                              ↓
    │                          WebSocket → client/event-router → stats-bar feature
    │
    ├─→ chat-controller         → broadcaster.broadcast({type: "chat_message"})
    │                              + mapStore.saveChatMessage()
    │
    ├─→ market-sales-controller → mapStore.saveMarketSale()
    │
    ├─→ loot-sort-controller    → (buffer + timer → sort to container via mudCommandSink)
    │
    ├─→ map-controller          → mapStore.upsertRoom/upsertEdge
    │                              ↓
    │                          bus.emit({ kind: "room_entered", vnum, room })
    │                              ↓
    │                          navigation-controller (step resolution)
    │                          farm2-controller (HP recall decisions)
    │                          zone-scripts-controller (step progress)
    │
    ├─→ triggers                (unchanged — already a controller)
    ├─→ survival                (unchanged)
    ├─→ gather                  (unchanged)
    └─→ container-tracker       (unchanged — still feeds via direct call)
```

Notable: **`container-tracker` stays on direct-call** (see section 6 — tight coupling to specific text-format, no other consumer needs it). The bus is for fan-out, not for everything.

### 4.2 Browser → MUD

```
User action (click, keypress, type)
    ↓
main.ts / feature module → sendClientEvent({type, payload})
    ↓
net.ts → WebSocket send
    ↓
browser-gateway (server) receives ClientEvent
    ↓
switch (event.type) → controller.method(payload)
    ↓
controller uses injected mudCommandSink
    ↓
mud-connection.writeAndLogMudCommand → TCP socket
```

**Key:** `browser-gateway.ts` is the only file that knows the `ClientEvent` union. Controllers receive typed calls to their public API (`navigationController.start(targetVnum)`, `farm2Controller.setEnabled(flag)`, …) — they don't see the wire protocol.

### 4.3 State Management

- **Server:** State lives in controller closures (factory pattern). No Redux, no reactive store, no observables. The bus is for **events**, not **state** — controllers query other controllers' state via their public API (e.g. `combatState.getInCombat()`, `statsController.getSnapshot()`).
- **Browser:** Same pattern. The tiny `client/bus.ts` stays — it's a payload-caching pub/sub that solves the specific "modal loads after event already arrived" problem. No framework, no reactivity.
- **Persistence:** Postgres only. Browser persists hotkeys + splitter sizes to `localStorage`; server persists last-profile to a flat file in `/var/log/bylins-bot/`.

---

## 5. Dependency Direction Rules (enforced by convention)

**Rule 1 — `ports/` depends on nothing.** Types only. No runtime code.

**Rule 2 — `controllers/` may import:** `ports/`, `bus/`, `map/` (shared types), `utils/`, `events.type.ts` (wire types), other `controllers/` ONLY as types in Deps interfaces (never construct them). `farm2/` and `zone-scripts/` follow the same rule.

**Rule 3 — `controllers/` may NOT import:** `server.ts`, `adapters/*`, `db.ts`, `mud-connection.ts`, any other controller's implementation.

**Rule 4 — `adapters/` may import:** `ports/`, `bus/`, `db.ts`, `mud-connection.ts`, framework APIs (`Bun`, `postgres`).

**Rule 5 — `server.ts` imports everything.** It is the composition root. This is the only place `createXxx` factories are called to build the real graph.

**Rule 6 — `client/features/*` may import:** `client/bus.ts`, `client/constants.ts`, `client/types.ts`, `events.type.ts`. NOT each other, NOT `main.ts`, NOT `net.ts` directly (pass `sendCommand` as a dep).

**Rule 7 — No circular imports.** Enforced by rules 1–6; verify with `gitnexus_cypher` query if suspicious.

**How to verify a PR does not regress these rules:**

```bash
# Cypher query to find controller → server.ts imports (should be empty):
gitnexus_cypher({
  query: `MATCH (c:Module)-[:IMPORTS]->(s:Module)
          WHERE c.path STARTS WITH 'src/controllers/'
            AND s.path = 'src/server.ts'
          RETURN c.path`
})

# Cypher query to find controller → adapter imports (should be empty):
gitnexus_cypher({
  query: `MATCH (c:Module)-[:IMPORTS]->(a:Module)
          WHERE c.path STARTS WITH 'src/controllers/'
            AND a.path STARTS WITH 'src/adapters/'
          RETURN c.path, a.path`
})
```

---

## 6. When NOT to Use the Bus — Direct Deps Wins

The bus is for **fan-out** (one source, many consumers). These cases should stay on direct-call:

| Case | Why direct | Example |
|---|---|---|
| **Request/response** | Bus has no reply mechanism; faking it with correlation IDs is worse than a method call. | `refreshCurrentRoom(timeoutMs)` returns the new vnum — use `mover.refresh()` directly. |
| **Tightly coupled state machines** | `mud-connection` ↔ `mover` ↔ `session` — they share a single logical lifecycle. Bus adds indirection, no decoupling payoff. | `mover.move(direction)` calling `mudConnection.writeAndLogMudCommand`. |
| **1:1 synchronous calls** | If exactly one caller invokes exactly one callee, there's nothing to fan-out. Direct method is simpler. | `containerTracker.feedEquippedScan(text)` — only `onMudText` dispatcher calls it, only container-tracker consumes. |
| **Command sink (port)** | Commands to MUD are point-to-point; every controller wants to send commands; there's only one socket. Modelling commands as bus events would require a consumer, which would just write to the socket. Collapse to a port. | `mudCommandSink.send(cmd, source)` |
| **Browser broadcast** | Same as above, in the other direction. | `broadcaster.broadcast(serverEvent)` |
| **Pure queries** | `getSnapshot()`, `getInCombat()`, `getCurrentRoomId()` are value reads. Bus is the wrong shape. | `combatState.getInCombat()` |
| **Typed RPC to a single controller** | If `BrowserGateway` wants to invoke `navigationController.start(vnum)`, that's a direct dependency with a typed call, not a "please navigate" event. | `switch (event.type)` in browser-gateway |

**Rule of thumb:** If you'd be tempted to `bus.emit("please_do_x")` and exactly one handler would handle it, make a port interface instead. If you'd emit `"x_happened"` and 2+ handlers care, it's a bus event.

---

## 7. Refactor Order — What Comes Out of server.ts First, Why

Ordered by **cost × risk × unlock-value**. Each step delivers a shippable, revertible PR.

### Step 0: Groundwork (1 PR)

**Deliverable:** `ports/`, `adapters/`, `bus/` folders created; `MudEvent` union defined (event kinds stubbed for what exists today); `createMudBus` implemented + tested; `server.ts` constructs the bus and emits `mud_text_raw` alongside the existing callback chain.

**Risk:** Near-zero — no existing code path changes.

**Why first:** Unblocks every subsequent step. Establishes the folder convention.

**Success metric:** Bot runs, all farm/zone scripts work identically; `git diff` shows no logic changes.

---

### Step 1: Extract `stats` controller (1 PR, ~200 LOC moved)

**Deliverable:** `src/controllers/stats.ts` + unit tests; `statsHp`/`statsHpMax`/… module-level vars deleted from server.ts; `farm2Controller.updateStats` invocation replaced by `farm2` subscribing to `bus.on("stats_changed", …)`.

**Risk:** Low — stats parsing is pure regex, easy to test; no cross-controller dependencies beyond the existing `triggers` reads (now `statsController.getSnapshot()`).

**Why second:** Smallest self-contained unit. Proves the bus pattern end-to-end (emit → subscribe → broadcast). Removes 7 mutable module-level variables from server.ts, which is a disproportionate readability win.

**LOC impact:** server.ts -~75 (stats vars + parse function + broadcast); new stats.ts +~150; net +75 but modularized.

---

### Step 2: Extract `chat` and `market-sales` controllers (1 PR each, ~100 LOC each)

**Deliverable:** Chat-line extraction + Postgres persist moves to `src/controllers/chat.ts`. Bazaar/auction extraction moves to `src/controllers/market-sales.ts`.

**Risk:** Low — pure parsers with well-defined outputs.

**Why next:** Both are independent of other controllers. Both are regex-heavy blocks that bloat server.ts. Both are easy to test.

---

### Step 3: Extract `loot-sort` controller (1 PR)

**Deliverable:** `src/controllers/loot-sort.ts` owns `pendingLootItems`, `rashodExemptKeywords`, `scheduleLootSort`, `sortLootedItems`, `autoSortInventory`. Subscribes to `bus.on("mud_text_raw")` for pattern-matching. Exposes `autoSortInventory()` publicly (called by zone-scripts).

**Risk:** Medium — has interactions with `containerTracker.waitForInspectResult` (a request/response port), gather-script's `onPickupForRaskhod` callback, and zone-scripts' `autoSortInventory` dependency. Model the gather → loot-sort interaction through a new bus event (`item_picked_up_for_raskhod`) OR keep it as a dep-injected callback — both work; pick the one with fewer PR diffs.

**Why now:** Loot-sort has the most tangled internal state among the "small extractions". Extracting it before the big navigation refactor simplifies later steps.

---

### Step 4: Extract `navigation` controller (1 PR, the biggest — ~760 LOC)

**Deliverable:** `src/controllers/navigation.ts` owns `navigationState`, `startNavigation`, `startNavigationToNearest`, step-resolution logic, `onceRoomChanged` (now `bus.once("room_entered")`). `server.ts` invokes `navigationController.start(targetVnum, ws)` from the WS handler.

**Risk:** Higher — this is the meatiest extraction. BUT by this point the bus pattern is established, `statsController` is living proof, and you have ~3 prior PRs of muscle memory.

**Mitigation:** Before extracting, run `gitnexus_impact({target: "startNavigation", direction: "upstream"})` to enumerate every call site. Extract in a two-pass PR: first pass moves the code behind a thin shim (`function startNavigation(ws, vnum) { return navigationController.start(ws, vnum); }`), second pass updates call sites and deletes the shim.

**Why this order:** Extracting navigation first would be tempting (largest LOC win), BUT the bus must exist first (to replace `onceRoomChanged`), and the `stats`/`chat`/`loot-sort` extractions teach the pattern on safer ground.

---

### Step 5: Extract `browser-gateway` adapter (1 PR)

**Deliverable:** `src/adapters/browser-gateway.ts` owns `browserClients: Set<BunServerWebSocket>`, `broadcastServerEvent`, `sendServerEvent`, and the big `switch (event.type)` in the WS message handler. Exposes `BrowserBroadcaster` port. server.ts constructs it with a `controllers` record.

**Risk:** Medium — touches the WebSocket contract. Unit-test by sending fake `ClientEvent` payloads and asserting controller methods called.

**Why now:** By this point every controller is extracted; now collapse the WS plumbing into one place.

---

### Step 6: Migrate remaining `addMudTextListener` consumers (1–2 PRs)

**Deliverable:** `zone-scripts`, `repair-script` stop taking `registerTextHandler`/`unregisterTextHandler` / `addMudTextListener` in their deps. Instead they accept `bus` and subscribe/unsubscribe via bus directly.

**Risk:** Low per controller.

**Why near-last:** These controllers are not monolith-bound — they already live in their own folders. Migrating them doesn't shrink server.ts, but cleans up the deps interfaces.

---

### Step 7: Delete the old callback chain (1 small PR)

**Deliverable:** `mudTextHandlers: Set<Handler>` deleted. `sessionTeardownHooks` deleted (replaced by `bus.on("session_teardown", …)` in each controller's factory). `for (const handler of mudTextHandlers) handler(text)` line removed.

**Risk:** Minimal IF the prior PRs actually removed all consumers. Use `gitnexus_impact` to verify.

**Why last:** The big cleanup. By now server.ts is close to the 400-LOC target.

---

### Step 8 (parallel track): Client-side refactor

Can run in parallel to server steps 1–7. Order:

1. Extract `client/features/hotkeys.ts` (~100 LOC out of main.ts).
2. Extract `client/features/script-panel.ts` (~200 LOC — the biggest win).
3. Extract `client/features/stats-bar.ts`, `chat-pane.ts`, `connect-form.ts`.
4. Extract `client/event-router.ts` (the ServerEvent dispatcher).
5. main.ts reduces to ~250 LOC of DOM queries + feature wiring.

---

### Step 9 (separate milestone, out of scope for THIS architecture): 

- `map-grid.ts` split (1046 LOC → layout/render/interactions — internal to the module, no architectural shift).
- `wiki.ts` split (similar — internal).
- Migration framework for Postgres (replaces ad-hoc `CREATE TABLE IF NOT EXISTS`).
- Frontend reload-hang diagnostic — likely map-snapshot broadcast throttling + Cytoscape lazy-load, NOT an architecture concern.
- Tests for critical paths — separate phase per PROJECT.md plan.

---

## 8. Scaling Considerations

This is a single-user tool. Scaling is not the problem. **Complexity is.** The table below is mostly reassurance that this architecture doesn't paint into a corner.

| Scale | Architecture adjustment |
|---|---|
| 1 user, 1 session (current) | Everything above. Bus is sync, in-process, no queue. |
| 1 user, 2 sessions (multi-char) | Explicit "Out of Scope" in PROJECT.md. If ever needed: one bus per session, one composition root per session; sessions isolated, no shared mutable state in `controllers/`. The factory pattern already supports this — `createXxx(deps)` can be called N times with N different deps. |
| Multi-user SaaS | Not a goal. Would require tenant isolation at the DB level and session routing — different project. |

**Bottleneck candidates inside the bus:**
- Each `emit` is O(handlers-for-this-kind). Current handler count per kind: 2–5. Even at 30 emits/sec, this is ~150 handler calls/sec. Non-issue for decades.
- Wildcard handlers run on every emit. Limit wildcard use to logging/debug (one instance). Don't put business logic on `onAny`.

---

## 9. Anti-Patterns

### Anti-Pattern 1: The bus as a global singleton

**What people do:** `export const bus = createMudBus(...)` at module scope; every controller imports it.

**Why it's wrong:** Breaks testability (can't inject a mock), creates import cycles, violates the "controllers don't import server.ts" rule transitively.

**Do this instead:** Bus flows through `deps`. `server.ts` creates one bus, passes its reference into every controller's Deps. Controllers never import the bus instance, only its type.

### Anti-Pattern 2: Over-busification

**What people do:** Every controller-to-controller call becomes a bus event. `bus.emit("farm_should_toggle", …)`.

**Why it's wrong:** Turns type-safe method calls into stringly-typed message passing. Lose IDE navigation ("find all callers"). Lose `tsc`'s reachability analysis.

**Do this instead:** If exactly one controller produces and exactly one consumes, use a direct method call. The bus is for one-to-many fan-out. See section 6.

### Anti-Pattern 3: Domain logic in adapters

**What people do:** Stuff parsing regex or business rules into `browser-gateway.ts` because it's handy.

**Why it's wrong:** Adapters are glue. Business logic lives in controllers where it can be unit-tested with fake deps.

**Do this instead:** Adapters translate between the outside world (WebSocket, Postgres) and ports. Nothing else.

### Anti-Pattern 4: "I'll add tests later" for the bus

**What people do:** Ship the bus without tests, assume it works.

**Why it's wrong:** The bus is infrastructure — every single controller will break catastrophically if subscribe-order or handler-error-isolation regresses. Unlike game logic, bus semantics are fully testable in isolation.

**Do this instead:** `src/bus/mud-bus.test.ts` day one. Test: emit with no handlers, emit with one, emit with many; unsubscribe mid-emit; handler throws → other handlers still fire; wildcard receives typed event; `once` fires once.

### Anti-Pattern 5: Mutable module-level state in extracted controllers

**What people do:** Move code from server.ts to `controllers/stats.ts` but keep `let statsHp = 0` at module scope.

**Why it's wrong:** Multi-session becomes impossible. Tests pollute each other. Regresses the "no module-level mutable state" convention the farm2/zone-scripts modules already honor.

**Do this instead:** State lives INSIDE the factory closure — `function createStatsController() { const state = {...}; return {...}; }`. See Pattern 2 code.

### Anti-Pattern 6: Deps interfaces that leak implementation

**What people do:** `interface StatsDependencies { sql: postgres.Sql; mudConnection: MudConnection; }`.

**Why it's wrong:** Couples the controller to specific adapters. Un-mockable. Un-reusable.

**Do this instead:** Depend on ports: `interface StatsDependencies { mapStore: MapStore; bus: MudEventBus; logger: Logger; }`. Ports are narrow, behaviour-focused interfaces.

### Anti-Pattern 7: Big-bang rewrite

**What people do:** "Let's do it all in one PR."

**Why it's wrong:** Impossible to review. Impossible to bisect if something breaks. Revert means losing everything.

**Do this instead:** The 9-step plan above. Each step is a revertible PR. Behaviour preserved at every step. See Pattern 3 (strangler fig).

---

## 10. Integration Points

### 10.1 Between layers

| Boundary | Communication | Notes |
|---|---|---|
| `mud-connection` ↔ `bus` | `mud-connection` calls `bus.emit({kind: "mud_text_raw", text})` via its existing `onMudText` dep. | One emit-site in the whole codebase. |
| controllers ↔ `bus` | `on(kind, handler)` in factory; returned `unsubscribe` optionally stored for teardown. | Sync delivery. |
| controllers ↔ `MapStore` | Injected via deps. Interface-based, mock-able in tests. | Unchanged pattern from farm2. |
| controllers ↔ `MudCommandSink` | Injected via deps. Single method: `send(command, source)`. | Replaces scattered `mudConnection.writeAndLogMudCommand(null, …)` sites. |
| controllers ↔ `BrowserBroadcaster` | Injected via deps. Method: `broadcast(serverEvent)`. | Replaces direct `broadcastServerEvent(…)` calls. |
| `browser-gateway` ↔ controllers | Gateway holds references (one field per controller); dispatches `ClientEvent` via `switch` to the right method. | The only file that knows the `ClientEvent` union. |

### 10.2 Client ↔ Server

- **Unchanged wire protocol** (`ClientEvent`/`ServerEvent` in `src/events.type.ts`). The refactor is structural, not protocol-level.
- Single WebSocket connection, same as today. `browser-gateway` replaces the inline handler but uses the same framing.

---

## 11. Verification & Testing Strategy (for this architecture, not the full test phase)

**Unit-testable immediately after extraction:**
- `src/bus/mud-bus.test.ts` — bus semantics (see anti-pattern 4).
- `src/controllers/stats.test.ts` — feed fake text via a mock bus, assert snapshot + broadcast.
- `src/controllers/chat.test.ts` — extraction logic.
- `src/controllers/market-sales.test.ts` — regex cases.
- `src/controllers/loot-sort.test.ts` — buffer + timer behaviour with fake timers.

**Integration-test via GitNexus queries:**
- Before each commit: `gitnexus_detect_changes({scope: "staged"})` — verify only expected symbols affected.
- Before each extraction: `gitnexus_impact({target: "<function>", direction: "upstream"})` — enumerate callers.
- Boundary check: Cypher query from section 5 rule 3 — ensure no `controllers/*` imports `server.ts` or `adapters/*`.

**Behavioural regression:** manual — run bot against live MUD with a log comparison script (outside scope of this research, but mentioned in PROJECT.md constraints).

---

## Sources

- **Codebase ground truth:** `.planning/PROJECT.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`, `.planning/codebase/CONVENTIONS.md` (read in full). Confidence HIGH — primary source.
- **Live code inspection:** `src/server.ts` (lines 1–800 read), `src/mud-connection.ts` (header read), `src/client/main.ts` (hotkeys section read), `src/client/bus.ts` (full), `src/client/map-grid.ts` (header). Confidence HIGH — primary source.
- **Existing gold-standard module:** `src/farm2/` — the recommended controller shape mirrors its proven layout (controller.ts/state.ts/tick.ts/types.ts split). Confidence HIGH.
- **TypeScript event-bus patterns:** Derived from well-established patterns in the TS ecosystem — `mitt`, `nanoevents`, `tiny-typed-emitter`, Node's native `EventEmitter` with typed subclasses. The `Extract<Union, {kind: K}>` + index map pattern is the canonical strict-TS solution. Confidence MEDIUM (training-data based; no Context7 or web access available in this environment).
- **Hexagonal/ports-and-adapters pattern:** Alistair Cockburn (2005), widely adopted. The `createXxx({deps})` factory-with-ports shape is a lightweight TS-idiomatic expression of it — matches existing `farm2`/`zone-scripts` style. Confidence HIGH.
- **Strangler-fig migration:** Martin Fowler. Standard pattern for brownfield refactors of untested code. Confidence HIGH.

### Confidence Summary

| Claim | Confidence | Basis |
|---|---|---|
| Current codebase shape and coupling | HIGH | Read the files directly |
| Target folder structure fits existing conventions | HIGH | Matches `CONVENTIONS.md` explicitly |
| Typed event bus API shape (Extract + kind index) | HIGH | Standard TS pattern, used by production libraries; fully checked against strict mode |
| Strangler-fig is the right migration strategy | HIGH | Standard pattern; only viable approach given zero test coverage on hot path |
| server.ts 400-LOC target is achievable | MEDIUM | Rough estimate from counting what moves out (~1500 LOC) and what stays (~350–400) |
| Refactor order (stats before navigation) | MEDIUM | Judgement call based on coupling read from server.ts — any order works; this one minimizes risk |
| Client 250-LOC main.ts target | MEDIUM | Based on counting function groups in current main.ts |
| Sync bus with no backpressure is sufficient | HIGH | Current callback chain is sync; matching its semantics is strictly safer than async |

### Open Questions (for phase-specific research later)

- **Loot-sort ↔ gather-script interaction** (server.ts:346 `onPickupForRaskhod`): should this be a bus event or stay as a direct callback? Probably direct (single consumer), but decide when extracting loot-sort.
- **Should `combat-state` emit via bus or stay queryable?** Today triggers/survival/zone-scripts query `combatState.getInCombat()` synchronously. Keeping it a pure state holder (no bus events) is simpler; but emitting `combat_started`/`combat_ended` would let farm2's tick loop react without polling. Decide during triggers extraction.
- **Browser `event-router.ts` vs modal-direct-subscribe:** current `src/client/bus.ts` has payload replay, which is clever. Keep it for modals. But do we want TWO buses (existing for modals, new one for server-events)? Or use the existing bus for both? Minor — decide when extracting.
- **Memory-store MapStore in production?** Current setup throws without `DATABASE_URL`. An in-memory fallback could make local dev/testing smoother. Out of scope for this architecture but worth noting.

---

*Architecture research for: bylins-bot monolith decomposition*
*Researched: 2026-04-18*
