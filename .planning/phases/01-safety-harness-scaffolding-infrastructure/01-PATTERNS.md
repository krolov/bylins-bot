# Phase 01: Safety Harness + Scaffolding Infrastructure — Pattern Map

**Mapped:** 2026-04-18
**Files analyzed:** 25 new/modified files (per CONTEXT.md D-01..D-37)
**Analogs found:** 22 / 25 (3 have no direct in-repo analog — use research patterns)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/bus/mud-event-bus.ts` | infrastructure-factory | pub/sub fan-out | `src/map/memory-store.ts` (factory shape) + `src/utils/timer.ts` (closure-state factory) | role-match |
| `src/bus/mud-event-bus.test.ts` | test | request-response | `src/map/parser.test.ts` | exact |
| `src/ports/mud-command-sink.ts` | port-interface | command sink | extracted from `src/server.ts:1831-1832` `registerTextHandler/unregisterTextHandler` + `createZoneScriptController` deps (`src/zone-scripts/types.ts`) | role-match |
| `src/ports/broadcaster.ts` | port-interface | fan-out | extracted from `broadcastServerEvent` signature in `src/server.ts` | role-match |
| `src/ports/now-provider.ts` | port-interface | pure-value | new — no in-repo analog (use research ARCHITECTURE.md §3 port shape) | no-analog |
| `src/ports/timer-provider.ts` | port-interface | scheduler | abstraction over `src/utils/timer.ts` + globalThis timers | role-match |
| `src/ports/session-teardown-registry.ts` | port-interface | registry | `src/server.ts:420` `sessionTeardownHooks = new Set<() => void>()` | exact |
| `src/ports/defaults/now.ts` | default-impl | pure-value | trivial — `() => Date.now()` | no-analog |
| `src/ports/defaults/timer.ts` | default-impl | scheduler | `src/utils/timer.ts::createTickTimer` | role-match |
| `src/ports/defaults/session-teardown.ts` | default-impl | registry | `src/server.ts:420,124` Set + iterate-all | exact |
| `src/map/migrations/runner.ts` | infrastructure-factory | database DDL | `src/map/store.ts::initialize()` (what it replaces) + `src/db.ts` (postgres client import pattern) | role-match |
| `src/map/migrations/20260418180000-baseline.sql` | migration | DDL | `src/map/store.ts::initialize()` CREATE TABLE statements (the content being captured) | exact |
| `src/map/migrations/20260418180100-add-has-wiki-data.sql` | migration | DDL | `src/map/store.ts:241-245` (inline `ALTER TABLE`) | exact |
| `src/map/migrations/20260418180200-drop-farm-zone-settings.sql` | migration | DDL | `src/map/store.ts:184-199` (inline `DO $$ BEGIN ... DROP TABLE` guard) | exact |
| `scripts/extract-baseline.ts` | cli-script | file I/O | `scripts/smoke-test.ts` (cli structure) + `src/server.ts::logEvent` log format to parse | role-match |
| `scripts/parser-snapshot.ts` | cli-script | batch transform | `scripts/smoke-test.ts` (cli shape) + `src/map/parser.ts::feedText` (the parser being driven) | role-match |
| `scripts/replay-harness.ts` | cli-script | batch transform | `src/server.ts::onMudText` (the side-effects being captured) + `src/map/memory-store.ts` (Mock MapStore template) | role-match |
| `snapshots/parser-before.jsonl` | data-artifact | committed data | (committed output of `scripts/parser-snapshot.ts`) | no-analog |
| `snapshots/replay-before.jsonl` | data-artifact | committed data | (committed output of `scripts/replay-harness.ts`) | no-analog |
| `docs/mud-phrases.md` | documentation | human-curated | `docs/client-refactor-plan.md`, `docs/mud-zone-analysis-skill.md` | role-match |
| `docs/refactor-playbook.md` | documentation | human-curated | `docs/client-refactor-plan.md` | role-match |
| `.githooks/pre-commit` | shell-script | event-driven | no in-repo analog — use standard git hook template | no-analog |
| `.gitignore` (modified) | config | — | existing `.gitignore` | exact |
| `package.json` (modified) | config | — | existing `package.json::scripts` section | exact |
| `src/map/store.ts` (modified, `initialize()`) | modified-module | DDL | replaces current `src/map/store.ts:162-267` with `await runMigrations(database)` | exact |

## Pattern Assignments

### `src/bus/mud-event-bus.ts` (infrastructure-factory, pub/sub)

**Analogs:**
- `src/map/memory-store.ts:1-211` — factory returning object, closed-over Maps as internal state (no classes, no `new`)
- `src/utils/timer.ts:1-27` — tiny factory with `let handle = null` closure state + returned object API
- `src/server.ts:419-442` — current `mudTextHandlers: Set<Handler>` semantics (snapshot-before-iterate, self-remove during dispatch)

**Imports pattern** (mirror `src/map/memory-store.ts:1-2` — type-only imports with `.ts` extension per `verbatimModuleSyntax`):
```typescript
import type { MudEvent, MudEventBus, MudEventHandler, Unsubscribe } from "./types.ts";
```

**Factory shape** (mirror `src/map/memory-store.ts:4-11` — `export function createXxx(): MapStore { const state = ...; return { method1, method2 }; }`):
```typescript
// From memory-store.ts (lines 4-11) — template to follow
export function createMemoryMapStore(): MapStore {
  const rooms = new Map<number, MapNode>();
  const edges = new Map<string, MapEdge>();
  // ...
  return {
    async initialize(): Promise<void> {},
    async upsertRoom(vnum, name, exits, closedExits): Promise<void> { /* ... */ },
    // ...
  };
}
```

**Closure-state + cancel semantics** (mirror `src/utils/timer.ts:6-27`):
```typescript
// From utils/timer.ts — closed-over handle + clear method
export function createTickTimer(): TickTimer {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(runFn, delayMs) { /* clear prior, setTimeout new */ },
    clear() { if (handle !== null) { clearTimeout(handle); handle = null; } },
  };
}
```

**Listener-snapshot-before-iterate pattern** (mirror current `src/server.ts:63` iteration + CRITICAL pitfall from PITFALLS.md §1):
```typescript
// Current server.ts line 63 — reference for what the bus must preserve:
for (const handler of mudTextHandlers) handler(text);
// New bus emit() must copy-then-iterate so self-removing handlers (see onceMudText server.ts:422-442) don't break mid-dispatch:
for (const handler of [...bucket]) {
  try { handler(event); } catch (error: unknown) { /* logEvent */ }
}
```

**Self-remove during dispatch** (`src/server.ts:422-442` — `onceMudText` uses `mudTextHandlers.delete(handler)` from inside handler closure; bus must support this exact semantic):
```typescript
// server.ts:422-442 — the semantic to preserve
function onceMudText(pattern: RegExp, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      mudTextHandlers.delete(handler);  // deletes from inside the Set while dispatch may still be iterating
      reject(new Error(`wait_text timeout: ${pattern.source}`));
    }, timeoutMs);
    const handler = (text: string) => {
      if (pattern.test(text)) {
        mudTextHandlers.delete(handler);  // handler removes itself
        resolve();
      }
    };
    mudTextHandlers.add(handler);
  });
}
```

**Discriminated-union event type** (mirror `src/zone-scripts/types.ts:14+` and `src/map/types.ts::ParsedEvent` — `kind`-tagged union per CONVENTIONS.md:207):
```typescript
// Phase 1: exactly one variant, union stub ready for Phase 2 extension
export type MudEvent =
  | { kind: "mud_text_raw"; text: string };
// Phase 2 will add: session_teardown, room_parsed, combat_started, stats_changed, etc.
```

**Error handling inside handler dispatch** (mirror `src/server.ts:73-75,111-112` — narrow `unknown` then route to `logEvent`; per AGENTS.md "no empty catch"):
```typescript
// Canonical form from server.ts:73-75
void mapStore.saveChatMessage(msg.text, msg.timestamp).catch((error: unknown) => {
  logEvent(ws, "error", error instanceof Error ? `Chat persist error: ${error.message}` : "Chat persist error.");
});
```
Bus handler try/catch must use the same narrowing idiom and route via injected `onError` dep (NOT `console.log` — AGENTS.md:317).

**Return-value subscribe = unsubscribe closure** (mirror `src/server.ts:523-526`):
```typescript
// server.ts:523-526 — the canonical "subscribe returns unsubscribe" shape
addMudTextListener: (handler) => {
  mudTextHandlers.add(handler);
  return () => mudTextHandlers.delete(handler);
},
```

**Deps interface naming** (per CONVENTIONS.md:25 — suffix `Dependencies`, declared in same file):
```typescript
export interface MudEventBusDependencies {
  onError(message: string): void;  // routes to logEvent in server.ts composition
}
```

---

### `src/bus/mud-event-bus.test.ts` (test, request-response)

**Analog:** `src/map/parser.test.ts:1-255` (the ONE canonical test file in the repo — all bun:test conventions live here)

**Imports pattern** (copy `src/map/parser.test.ts:1-2` verbatim):
```typescript
import { describe, expect, test } from "bun:test";
import { createMudBus } from "./mud-event-bus";
```

**Describe/test layout** (mirror `src/map/parser.test.ts:4-20`):
```typescript
// parser.test.ts:4-20 — the template to copy
describe("feedText", () => {
  test("parses room header and exits from one chunk", () => {
    const state = createParserState();
    const events = feedText(state, "Комната отдыха [6049]\n[ Exits: n s d ]\n");
    expect(events).toEqual([/* ... */]);
  });
});
```

**Test cases required by D-25** (emit-no-handlers, many-handlers, self-remove mid-dispatch, once auto-unsub, onAny, error isolation, typed payload). For error-isolation test, use `bun:test` `mock()` / `spyOn()` (built-in per AGENTS.md:362 "No mocking framework needed"):
```typescript
// Pattern: construct bus with stub onError, verify one throwing handler doesn't block the next
const errors: string[] = [];
const bus = createMudBus({ onError: (msg) => errors.push(msg) });
let secondCalled = false;
bus.on("mud_text_raw", () => { throw new Error("boom"); });
bus.on("mud_text_raw", () => { secondCalled = true; });
bus.emit({ kind: "mud_text_raw", text: "x" });
expect(secondCalled).toBe(true);
expect(errors.length).toBe(1);
```

**No classes / no `new`** (AGENTS.md:176, CONVENTIONS.md:177). No `jest.fn()` — use simple closure-over-array counters.

---

### `src/ports/*.ts` (port-interface, pure types)

**Rule per CONTEXT D-26:** `src/ports/` contains ONLY `interface`/`type` declarations. No classes, no factories, no runtime code. Default impls live in `src/ports/defaults/`.

#### `src/ports/mud-command-sink.ts`

**Analog:** `src/zone-scripts/types.ts:208` (`addMudTextListener`) + `src/server.ts:478-482` (`sendCommand` closure in zoneScriptController deps) — extract the TWO signatures the sink exposes.

**Signatures to extract** (from `src/server.ts:478-482,530-533`):
```typescript
// server.ts:478-482 — the raw-send shape
sendCommand: (command) => {
  if (!sharedSession.tcpSocket || !sharedSession.connected) return;
  mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, command, "zone-script");
},
```

**Interface pattern** (mirror `src/zone-scripts/types.ts:208` shape — `addMudTextListener(handler): () => void`):
```typescript
// Phase 1 port shape (planner chooses final name):
export interface MudCommandSink {
  send(command: string, source: string): void;
}
```

Exit test: no runtime code in file. Only `export interface` / `export type`. Verify with `grep -E "^(const|function|class|export function|export const)" src/ports/mud-command-sink.ts` → empty.

#### `src/ports/broadcaster.ts`

**Analog:** `src/server.ts::broadcastServerEvent` call sites (e.g. `src/server.ts:66,72`).

**Signature extraction** (from `src/server.ts:66`):
```typescript
// server.ts:66 — canonical broadcast call
broadcastServerEvent({ type: "output", payload: { text } });
```

**Interface shape:**
```typescript
import type { ServerEvent } from "../events.type.ts";
export interface Broadcaster {
  broadcast(event: ServerEvent): void;
}
```

#### `src/ports/now-provider.ts`

**No in-repo analog.** Per CONTEXT D-14 / RESEARCH ARCHITECTURE.md §3 port shape:
```typescript
export interface NowProvider {
  now(): number;
}
```

#### `src/ports/timer-provider.ts`

**Analog:** abstract over `globalThis.setTimeout/setInterval` + mirrors `src/mud-connection.ts:100-119` timer-clear patterns.

**Signature extraction** (from `src/mud-connection.ts:40-44`):
```typescript
// mud-connection.ts:40-44 — current timer-handle types that drive the port shape
keepaliveTimer?: ReturnType<typeof setInterval>;
reconnectTimer?: ReturnType<typeof setTimeout>;
```

**Interface shape** (per D-14):
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

#### `src/ports/session-teardown-registry.ts`

**Analog:** `src/server.ts:420` (the Set) + `src/server.ts:124` (iteration) + `src/server.ts:535` (register call).

**Current implementation** (excerpts from `src/server.ts`):
```typescript
// server.ts:420
const sessionTeardownHooks = new Set<() => void>();
// server.ts:535 — register
sessionTeardownHooks.add(() => zoneScriptController.handleSessionClosed());
// server.ts:124 — invokeAll
for (const hook of sessionTeardownHooks) hook();
```

**Interface shape:**
```typescript
export interface SessionTeardownRegistry {
  register(hook: () => void): () => void;  // returns unregister closure (match bus pattern)
  invokeAll(): void;
}
```

---

### `src/ports/defaults/*.ts` (default-impl)

**Rule:** Default impls are the simplest real code. Factory form per CONVENTIONS.md:179.

#### `src/ports/defaults/now.ts`
```typescript
import type { NowProvider } from "../now-provider.ts";
export function createDefaultNowProvider(): NowProvider {
  return { now: () => Date.now() };
}
```

#### `src/ports/defaults/timer.ts`

**Analog:** `src/utils/timer.ts` (for factory shape); globalThis timers are the real impl:
```typescript
import type { TimerProvider } from "../timer-provider.ts";
export function createDefaultTimerProvider(): TimerProvider {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h),
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
    clearInterval: (h) => globalThis.clearInterval(h),
  };
}
```

#### `src/ports/defaults/session-teardown.ts`

**Analog:** `src/server.ts:420,124,535` — Set + add + for..of. Mirror exactly:
```typescript
import type { SessionTeardownRegistry } from "../session-teardown-registry.ts";
export function createDefaultSessionTeardownRegistry(): SessionTeardownRegistry {
  const hooks = new Set<() => void>();
  return {
    register(hook) { hooks.add(hook); return () => hooks.delete(hook); },
    invokeAll() { for (const hook of [...hooks]) hook(); },  // snapshot-before-iterate per Pitfall 1
  };
}
```
Note the `[...hooks]` snapshot — matches bus-emit defensive-copy semantic; prevents register/unregister during teardown from breaking iteration.

---

### `src/map/migrations/runner.ts` (infrastructure-factory, DDL)

**Analog:**
- `src/map/store.ts:162-267` — what it replaces (`initialize()` + inline DDL)
- `src/db.ts:1-7` — `postgres` client import + `ReturnType<typeof postgres>` type alias (re-use)

**Imports pattern** (mirror `src/map/store.ts:1,2` + `src/db.ts:1,4`):
```typescript
// db.ts:1,4 — already established
import postgres from "postgres";
export type DatabaseClient = ReturnType<typeof postgres>;
// runner.ts should import this type:
import type { DatabaseClient } from "../../db.ts";
```

**Factory shape** (mirror `src/map/store.ts:162` — `export function createMapStore(database: DatabaseClient): MapStore`):
```typescript
// Shape to follow — factory over database client
export async function runMigrations(database: DatabaseClient): Promise<void> {
  // ~40 LOC per CONTEXT D-30
}
```

**Tagged-template SQL only** (AGENTS.md:326, CONVENTIONS.md:272) — never string concat. For reading `.sql` files, use `sql.file()` per postgres.js API:
```typescript
// Pattern: tagged-template queries from store.ts:165-175 (the canonical in-repo form)
await database`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;
```

**Advisory lock pattern** (CONTEXT D-33, hash 727465 = "bylins"):
```typescript
await database.begin(async (tx) => {
  await tx`SELECT pg_advisory_xact_lock(727465)`;
  // ... apply migrations inside transaction
});
```

**Baseline-pump logic** (CONTEXT D-31) — check existence of `map_rooms` (prod indicator) AND absence of `schema_migrations` → seed without running. Mirror the `DO $$ BEGIN ... END $$` conditional pattern from `src/map/store.ts:184-199`:
```sql
-- store.ts:184-199 — the canonical conditional-DDL block to mirror
DO $$ BEGIN
  IF EXISTS (...) AND NOT EXISTS (...) THEN
    DROP TABLE farm_zone_settings;
  END IF;
END $$
```

**Logging** (CONTEXT D-35) — one `logEvent(null, "session", "applied migration ${id}")` per applied migration. Runner takes an `onLog(message: string): void` dep per CONVENTIONS.md:113-121 (sub-modules log via injected callback, not direct `logEvent`). AGENTS.md:320 — log messages MUST be in English.

**Error handling** — fail-fast per CONTEXT D-35. Abort transaction (it rolls back on throw), re-throw, let process crash:
```typescript
// Canonical narrowing from store.ts-pattern + server.ts:73
try {
  await applyMigration(tx, id);
} catch (error: unknown) {
  throw new Error(`Migration ${id} failed: ${error instanceof Error ? error.message : "unknown"}`);
}
```

---

### `src/map/migrations/20260418180000-baseline.sql` (migration, DDL)

**Analog:** `src/map/store.ts:162-267` — THE source. The baseline file is a `pg_dump --schema-only` of current prod, cleanup `OWNER TO`/`GRANT`/`SET` lines, then commit. Content matches the CREATE TABLE statements currently in `initialize()` (store.ts:165-175, 177-183, 201-209, 211-217, 219-226, 228-238, 248-258, 260-262, 264-266).

**Destructive/idempotent check** (PITFALLS.md §5):
- All CREATE TABLE must be `IF NOT EXISTS` (already the case).
- `CREATE INDEX IF NOT EXISTS` — matches `store.ts:260-266`.
- No `DROP TABLE` in baseline — that is a SEPARATE migration file (`20260418180200-drop-farm-zone-settings.sql`).

**Example content** (directly from `store.ts:165-175`):
```sql
CREATE TABLE IF NOT EXISTS map_rooms (
  vnum INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  exits TEXT[] NOT NULL DEFAULT '{}',
  closed_exits TEXT[] NOT NULL DEFAULT '{}',
  visited BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### `src/map/migrations/20260418180100-add-has-wiki-data.sql` (migration, DDL)

**Analog:** `src/map/store.ts:240-246` — extract verbatim:
```sql
-- store.ts:240-242
ALTER TABLE game_items ADD COLUMN IF NOT EXISTS has_wiki_data BOOLEAN NOT NULL DEFAULT FALSE;
-- store.ts:244-246
ALTER TABLE game_items ADD COLUMN IF NOT EXISTS has_game_data BOOLEAN NOT NULL DEFAULT FALSE;
```

`IF NOT EXISTS` makes idempotent (PITFALLS.md §5 rule).

---

### `src/map/migrations/20260418180200-drop-farm-zone-settings.sql` (migration, DDL)

**Analog:** `src/map/store.ts:184-199` — the `DO $$ BEGIN ... DROP TABLE` guard. Extract verbatim:
```sql
-- store.ts:184-199 — the exact guard
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'farm_zone_settings'
      AND constraint_type = 'PRIMARY KEY'
      AND constraint_name = 'farm_zone_settings_pkey'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'farm_zone_settings'
      AND column_name = 'profile_id'
  ) THEN
    DROP TABLE farm_zone_settings;
  END IF;
END $$;
```

**Warning per CONTEXT "specifics" + PITFALLS.md §5:** this is the only destructive migration in Phase 1 — requires a dedicated playbook card in `docs/refactor-playbook.md` ("destructive migrations list") and `pg_dump` backup before prod-apply.

---

### `src/map/store.ts` (modified-module, DDL removal)

**Current state:** `initialize()` spans lines 162-267, contains 10 inline `CREATE TABLE IF NOT EXISTS`, 2 inline `ALTER TABLE ADD COLUMN IF NOT EXISTS`, 1 `DO $$ ... DROP TABLE` guard, 2 `CREATE INDEX IF NOT EXISTS`.

**Target state:** Everything between line 164 `async initialize(): Promise<void> {` and line 267 `},` collapses to a single line:
```typescript
async initialize(): Promise<void> {
  await runMigrations(database);
},
```

**Import addition:** Add `import { runMigrations } from "./migrations/runner.ts";` to the top of `store.ts`.

**GitNexus pre-flight (CLAUDE.md rule):**
- `gitnexus_impact({target: "initialize", direction: "upstream"})` — enumerate callers of `mapStore.initialize()` (likely just `server.ts` startup).
- After edit: `gitnexus_detect_changes({scope: "staged"})` — verify ONLY `src/map/store.ts` changed (and new `src/map/migrations/*` files added).

---

### `scripts/extract-baseline.ts` (cli-script, file I/O)

**Analog:** `scripts/smoke-test.ts:1-60` (cli shape: pure Bun script, comment-header describing purpose + "Run: bun run scripts/X.ts").

**Header pattern** (mirror `scripts/smoke-test.ts:1-11`):
```typescript
// Extracts a 30-min baseline window from /var/log/bylins-bot/mud-traffic.log
// into .fixtures/mud-traffic-baseline.log for regression-oracle use.
//
// Run: bun run scripts/extract-baseline.ts [--minutes 30] [--start <ISO>]
```

**Log format to parse** (from `src/server.ts:898`):
```typescript
// server.ts:898 — the exact log-line format extract-baseline reads
appendLogLine(`[${timestamp}] session=${sessionId} direction=${direction} message=${JSON.stringify(message)}${suffix ? ` ${suffix}` : ""}`);
```

Parser reverse-engineers: `^\[(?<ts>[^\]]+)\] session=(?<session>\S+) direction=(?<direction>\S+) message=(?<message>".*")( .*)?$`, then `JSON.parse` on the `message` capture to get the real string (which may contain escaped `\r\n` and ANSI `\u001b[...m`).

**CONTEXT D-03 says:** baseline file keeps log format as-is (timestamped lines with escaped `\r\n` / ANSI).

**Output destination** (CONTEXT D-04): `.fixtures/mud-traffic-baseline.log` — gitignored.

---

### `scripts/parser-snapshot.ts` (cli-script, batch transform)

**Analogs:**
- `scripts/smoke-test.ts:1-11` (cli header format)
- `src/map/parser.ts::feedText` + `createParserState` — the parser being driven
- `src/map/parser.test.ts:5-20` — reference for creating a fresh parser state per input

**Core loop pattern** (from parser.test.ts test layout + CONTEXT D-11):
```typescript
import { createParserState, feedText } from "../src/map/parser.ts";
// Read baseline, filter direction=mud-in lines, de-escape messages, feed through parser
const state = createParserState();
for (const [chunkIndex, chunk] of chunks.entries()) {
  const events = feedText(state, chunk);
  out.write(JSON.stringify({ chunkIndex, events }) + "\n");
}
```

**De-escaping rule** (CONTEXT "code_context" §ANSI handling): baseline stores escape-sequences in `\u001b[...]` and `\\r\\n` form; must de-escape before feeding to parser (`JSON.parse`-d messages will already have real `\u001b` and `\r\n`).

**Output format** (CONTEXT D-11): `snapshots/parser-before.jsonl` initial / `snapshots/parser-after.jsonl` per-run, each line = `{chunkIndex, events: ParsedEvent[]}`.

**Diff strategy** (CONTEXT D-12): JSONL + deep-diff (library choice deferred to planner per "Claude's Discretion").

---

### `scripts/replay-harness.ts` (cli-script, batch transform)

**Analogs:**
- `src/server.ts:59-113` — the onMudText dispatch that generates the side-effects we're capturing
- `src/map/memory-store.ts:1-211` — template for the Mock MapStore (CONTEXT D-07 says spy records method calls as a sequence)

**Side-effects to capture** (CONTEXT D-06) — exhaustive list from `src/server.ts:59-113`:
```typescript
// server.ts:59-113 — every side-effect line that must be recorded
containerTracker.feedText(text);                                // fn call + args
containerTracker.feedEquippedScan(text);
containerTracker.feedPendingInspect(text);
for (const handler of mudTextHandlers) handler(text);           // handler invocations
bazaarNotifier.handleMudText(text);
broadcastServerEvent({ type: "output", payload: { text } });    // WS broadcast
void mapStore.saveChatMessage(...);                             // DB call + args
void mapStore.saveMarketSale(...);
scheduleLootSort();                                             // timer schedule
void persistParsedMapData(text, ws);                            // parser → upsertRoom/upsertEdge
```

**Mock MapStore** (CONTEXT D-07) — use `src/map/memory-store.ts` as template, but replace bodies with spy-recorders:
```typescript
// memory-store.ts:11-13 — reference for shape
async initialize(): Promise<void> {},
async upsertRoom(vnum, name, exits, closedExits): Promise<void> {
  rooms.set(vnum, { ... });
},
// Harness variant: every method pushes {method, args} to a spy log
const calls: Array<{method: string; args: unknown[]}> = [];
async upsertRoom(vnum, name, exits, closedExits): Promise<void> {
  calls.push({method: "upsertRoom", args: [vnum, name, exits, closedExits]});
},
```

**Determinism** (CONTEXT D-10): inject `NowProvider`/`TimerProvider` fakes (counter-ms clock seeded from baseline timestamp). These are the ports from `src/ports/` that Phase 1 creates.

**Output format** (CONTEXT D-08): JSONL, one side-effect per line with `{kind, args, meta}`.

---

### `docs/mud-phrases.md` (documentation)

**Analog:** `docs/client-refactor-plan.md` + `docs/mud-zone-analysis-skill.md` — existing long-form developer-notes structure.

**Structure per CONTEXT D-16:** Plain markdown, `## <file>` → `### <feature>` → regex literal + purpose + example.

**Initial grep per CONTEXT D-17:**
```bash
grep -rn 'new RegExp(\|[A-Z_]*_RE\s*=\|[A-Z_]*REGEXP\s*=' src/
```

**Files to enumerate** (from CONVENTIONS.md:29 — regex constants use `_REGEXP` / `_RE` suffix):
- `src/triggers.ts` — dodge / stand-up / rearm / assist / light
- `src/survival-script.ts` — hunger / thirst
- `src/server.ts:35` — `ANSI_ESCAPE_RE`, `LOOT_FROM_CORPSE_RE`, `PICKUP_FROM_GROUND_RE`, `MAX_STATS_REGEXP`, `PROMPT_STATS_REGEXP` (lines ~655-728 per CONCERNS)
- `src/bazaar-notifier.ts:16` — `ANSI_ESCAPE_RE`, `BAZAAR_SALE_RE`, `AUCTION_SALE_RE`
- `src/map/parser.ts:3-16` — `ANSI_SEQUENCE_REGEXP`, `ROOM_HEADER_REGEXP`, `EXITS_LINE_REGEXP`, `MOVEMENT_BLOCKED_REGEXP`, `FLEE_REGEXP`, `DARK_ROOM_REGEXP`, `MOVEMENT_REGEXP`, `MOB_ANSI_BLOCK_REGEXP`, `ITEM_ANSI_BLOCK_REGEXP`, `CORPSE_LINE_REGEXP`
- `src/farm2/types.ts:10-17` — `ANSI_SEQUENCE_REGEXP`, `ROOM_PROMPT_REGEXP`, `TARGET_NOT_VISIBLE_REGEXP`, `MOB_ARRIVAL_REGEXP`, `TARGET_PREFIX_REGEXP`, `DARK_ROOM_REGEXP`, `MOB_DEATH_REGEXP`
- `src/gather-script.ts`
- `src/combat-state.ts`

---

### `docs/refactor-playbook.md` (documentation)

**Analog:** `docs/client-refactor-plan.md` — prior refactor doc; follow its long-form structure.

**Required sections per CONTEXT D-19:**
1. Pre-flight checklist (gitnexus_impact → detect_changes → replay:check → bun test → parser snapshot zero-diff)
2. Commit convention (`refactor(phaseN): <what>`, one PR = one extraction + its bus subscriber)
3. Regression definition (strict byte-equality baseline diff; any diff blocks merge)
4. Baseline fixture restore instructions (from `/var/log/bylins-bot/mud-traffic.log`)
5. Harness local-run instructions
6. Destructive-migrations list (per "specifics" — includes `20260418180200-drop-farm-zone-settings.sql`)
7. `.githooks/pre-commit` setup: `git config core.hooksPath .githooks` (CONTEXT D-20)

---

### `.githooks/pre-commit` (shell-script)

**No in-repo analog** — use standard git-hook template. Shell script (not husky per CONTEXT D-09).

**Required behaviour (CONTEXT D-09):** triggers `bun run replay:check` on:
- branch name matching `refactor/*`, OR
- commit message containing `refactor(`

```bash
#!/usr/bin/env bash
set -euo pipefail
branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo '')"
commit_msg_file="${1:-.git/COMMIT_EDITMSG}"
commit_msg="$(cat "$commit_msg_file" 2>/dev/null || echo '')"
if [[ "$branch" == refactor/* ]] || [[ "$commit_msg" == *"refactor("* ]]; then
  bun run replay:check
fi
```

---

### `.gitignore` (config, modified)

**Current state** (`.gitignore` read verbatim):
```
node_modules/
bun.lock
dist/
public/client.js
public/client.js.map
public/chunk-*.js
public/chunk-*.js.map
public/styles.min.css
src/client.js
src/client.js.map
.env
scripts/wiki-mcp-cache.json
.gitnexus
```

**Addition per CONTEXT D-04:** append `.fixtures/`.

**Note:** Per CONTEXT D-04 `.fixtures/` gitignored, but per CONTEXT D-11/D-13 `snapshots/` is COMMITTED ("behaviour of record"). Do NOT add `snapshots/` to `.gitignore`.

---

### `package.json` (config, modified)

**Current scripts** (`package.json:11-20`):
```json
"scripts": {
  "dev": "bun run build:client && bun --watch src/server.ts",
  "start": "bun run build:client && bun run src/server.ts",
  "build:client": "bun run scripts/build-client.ts",
  "typecheck": "tsc --noEmit",
  "build": "bun run build:client && bun run typecheck",
  "test": "bun test",
  "smoke": "bun run build:client && bun run scripts/smoke-test.ts",
  "gear": "bun run scripts/gear-advisor.ts"
}
```

**Additions per CONTEXT "Integration Points":**
```json
"baseline:extract": "bun run scripts/extract-baseline.ts",
"parser:snapshot": "bun run scripts/parser-snapshot.ts",
"replay:check": "bun run scripts/replay-harness.ts",
"migrate": "bun run -e 'import { runMigrations } from \"./src/map/migrations/runner.ts\"; import { sql } from \"./src/db.ts\"; await runMigrations(sql); process.exit(0);'",
"migrate:status": "bun run scripts/migrate-status.ts"
```

(planner may adjust exact cmd strings; no new dependencies added in Phase 1 per CONTEXT D-21 / D-30).

---

## Shared Patterns

### Factory-DI (applies to: mud-event-bus.ts, migrations/runner.ts, ports/defaults/*)

**Source:** `src/map/memory-store.ts` + `src/utils/timer.ts` + `src/farm2/controller.ts`
**Rule (CONVENTIONS.md:177, AGENTS.md):** No classes. No `new`. No global singletons. `export function createXxx(deps: XxxDependencies): Xxx { const state = ...; return { method1, method2 }; }`

**Canonical excerpt** (`src/map/memory-store.ts:4-11`):
```typescript
export function createMemoryMapStore(): MapStore {
  const rooms = new Map<number, MapNode>();      // closure state
  const edges = new Map<string, MapEdge>();
  return {                                        // return object of public methods
    async initialize(): Promise<void> {},
    async upsertRoom(...): Promise<void> { rooms.set(...); },
  };
}
```

### Error Handling (applies to: bus error isolation, migration runner, replay harness)

**Source:** `src/server.ts:73-75` + AGENTS.md:300-313
**Rule:** Narrow `unknown` before `.message`. No custom error classes. No empty catch.

**Canonical excerpt:**
```typescript
void persistData(ws).catch((error: unknown) => {
  logEvent(ws, "error", error instanceof Error ? `Persist error: ${error.message}` : "Persist error.");
});
```

### Logging (applies to: bus error handler, migration runner, replay harness)

**Source:** `src/server.ts:883-898` (`logEvent` signature) + `src/farm2/logger.ts` (module-prefixed sub-logger) + CONVENTIONS.md:113-130
**Rule:**
- Server code uses `logEvent(ws, direction, message, details?)` directly.
- Sub-modules take `onLog: (message: string) => void` dep in their `Dependencies` interface, call `deps.onLog(...)`, which `server.ts` routes to `logEvent(null, "session", ...)`.
- Every line prefixed with `[module-name]` (e.g. `[bus] handler error for mud_text_raw: ...`, `[migrations] applied 20260418180000-baseline.sql`).
- All log messages MUST be in English (AGENTS.md:320).
- No `console.*` in server code (AGENTS.md:317).

**Canonical excerpt** (`src/server.ts:883-898`):
```typescript
function logEvent(
  ws: BunServerWebSocket | null,
  direction: "session" | "mud-in" | "mud-out" | "browser-in" | "browser-out" | "error",
  message: string,
  details?: Record<string, string | number | boolean | null | undefined>,
): void {
  const timestamp = new Date().toISOString();
  const sessionId = ws?.data.sessionId ?? "system";
  // ... appendLogLine(...)
}
```

### Imports (applies to: all new .ts files)

**Source:** CONVENTIONS.md:53-71 + `src/map/memory-store.ts:1-2` + `src/farm2/controller.ts:1-7`
**Rule:**
- External first, then `node:` builtins, then relative `./foo.ts` (explicit `.ts` extension — `allowImportingTsExtensions`).
- Type-only imports use `import type` (`verbatimModuleSyntax`).
- No path aliases.

**Canonical excerpt** (`src/farm2/controller.ts:1-7`):
```typescript
import { defaultConfig } from "./config.ts";
import { createInitialState, getStateSnapshot, setEnabled, disable, enable } from "./state.ts";
import { scheduleTick, runTick } from "./tick.ts";
import { handleMudText, handleSessionClosed } from "./mud-handler.ts";
import { resolveAttackTarget } from "../mob-resolver.ts";
import { createLogger } from "./logger.ts";
import type { Farm2ControllerDependencies, Farm2StateSnapshot, Farm2Stats } from "./types.ts";
```

### Discriminated Unions (applies to: MudEvent in bus types)

**Source:** `src/map/types.ts::ParsedEvent` + `src/zone-scripts/types.ts::ScriptStep` + CONVENTIONS.md:207-217
**Rule:** `kind` property (lowercase string), one variant per file where relevant. `Extract<Union, {kind: K}>` for type-narrowing in emit/on. No `any`.

**Canonical excerpt** (CONVENTIONS.md:209-215):
```typescript
type ParsedEvent =
  | { kind: "room"; room: ParsedRoom }
  | { kind: "movement"; direction: Direction }
  | { kind: "movement_blocked" };
```

### Test Layout (applies to: mud-event-bus.test.ts)

**Source:** `src/map/parser.test.ts` + `src/map/tracker.test.ts` + AGENTS.md:357-375
**Rule:**
- Co-located `<source>.test.ts`
- Import: `import { describe, expect, test } from "bun:test";`
- `describe("<function or subject>", () => { test("...", () => { ... }) })`
- `expect(x).toEqual(...)` / `.toBe(...)` — standard Jest API
- No separate mocking framework — use plain closures or bun:test's built-in `mock()` / `spyOn()` if needed
- `satisfies <Type>` for typed literals (CONVENTIONS.md:219-225)

### Naming (applies to all files)

**Source:** CONVENTIONS.md:6-40 + STRUCTURE.md:211-228
**Rules:**
- Files: `kebab-case.ts` — e.g. `mud-event-bus.ts`, `now-provider.ts`, `session-teardown-registry.ts`
- Functions: `camelCase`, factories prefixed `create*`
- Types/Interfaces: `PascalCase`; Deps suffix `Dependencies` — e.g. `MudEventBusDependencies`
- Constants: `SCREAMING_SNAKE_CASE` with semantic suffix — `ANSI_ESCAPE_RE`, `ADVISORY_LOCK_ID`, `DEFAULT_TIMEOUT_MS`
- Numeric literals: `10_000`, `30_000` (underscore separator for readability, CONVENTIONS.md:32)
- Imports include `.ts` extension (STRUCTURE.md:218)

### GitNexus Pre-Flight (applies to all file modifications)

**Source:** CLAUDE.md (top of project instructions) + CONTEXT D-19 playbook
**Rule:**
1. Before editing `src/map/store.ts::initialize`: `gitnexus_impact({target: "initialize", direction: "upstream"})`.
2. Before committing: `gitnexus_detect_changes({scope: "staged"})` — verify ONLY expected files changed.
3. No find-and-replace renames — use `gitnexus_rename({dry_run: true})`.

## No Analog Found

| File | Role | Reason | What to Use Instead |
|------|------|--------|---------------------|
| `src/ports/now-provider.ts` | port-interface | No existing clock abstraction in repo (current code uses `Date.now()` directly) | `.planning/research/ARCHITECTURE.md` §3 port shape + CONTEXT D-14 |
| `src/ports/defaults/now.ts` | default-impl | Trivial wrapper over `Date.now()` | Follow factory rule from CONVENTIONS.md:179 |
| `snapshots/parser-before.jsonl` | data-artifact | Output of `scripts/parser-snapshot.ts` first run — no pre-existing fixture | Generate via harness; commit as-is |
| `snapshots/replay-before.jsonl` | data-artifact | Output of `scripts/replay-harness.ts` first run | Generate via harness; commit as-is |
| `.githooks/pre-commit` | shell-script | No existing git-hook in repo | Standard bash template (provided above) |

## Metadata

**Analog search scope:** `src/`, `scripts/`, `docs/`, root config files (`package.json`, `.gitignore`, `tsconfig.json`), `AGENTS.md`, `CLAUDE.md`
**Files scanned for analogs:** 20 (read in full or targeted ranges)
**Key analog files:**
- `src/map/memory-store.ts` — factory-DI template, Mock MapStore base
- `src/map/parser.test.ts` — bun:test conventions
- `src/map/parser.ts` — parser signatures for snapshot script
- `src/map/store.ts:162-267` — current inline DDL being replaced
- `src/utils/timer.ts` — closure-state factory shape
- `src/server.ts:35,59-113,419-442,523-526,875-920` — logEvent, mudTextHandlers, ANSI_ESCAPE_RE, session-teardown Set
- `src/mud-connection.ts:59-73,298` — Deps interface shape, onSessionTeardown callpoint
- `src/farm2/controller.ts`, `src/farm2/types.ts` — Dependencies interface naming + factory composition
- `src/db.ts` — postgres client + `DatabaseClient` type
- `src/zone-scripts/types.ts:208` — `addMudTextListener` signature for MudCommandSink port
- `package.json`, `.gitignore` — config current state
- `AGENTS.md` — no-empty-catch, no-any, no-console, English-only logs
- `CLAUDE.md` — gitnexus pre-flight rules

**Pattern extraction date:** 2026-04-18

---

*Pattern map for: Phase 1 safety-harness-scaffolding-infrastructure*
*Produced: 2026-04-18*
