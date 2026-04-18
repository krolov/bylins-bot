# Coding Conventions

**Analysis Date:** 2026-04-18

## Naming Patterns

**Files:**
- `kebab-case.ts` for all source and test files — `farm-script.ts`, `combat-state.ts`, `mob-resolver.ts`, `parser.test.ts`
- Co-located test files use `<source>.test.ts` — `src/map/parser.ts` + `src/map/parser.test.ts`
- No `index.ts` barrel files except at module folder boundaries (`src/farm2/index.ts` re-exports only the public factory + snapshot type)

**Functions:**
- `camelCase` — `createFarm2Controller`, `findPath`, `processParsedEvents`, `trackOutgoingCommand`
- Factory/constructor functions prefixed with `create` — `createFarmController`, `createTrackerState`, `createMapStore`, `createLogger`, `createTickTimer`
- Predicate helpers use `is`/`has` prefixes — `isInCombat`, `hasPendingMoveExpired`
- Event handlers prefixed with `handle` or `on` — `handleMudText`, `handleSessionClosed`, `onLog`, `onStateChange`

**Variables:**
- `camelCase` for locals and parameters — `currentRoomId`, `pendingMove`, `zoneId`
- `Bun.env.UPPER_SNAKE_CASE` for env var reads (only in `src/config.ts`)

**Types / Interfaces:**
- `PascalCase` — `RuntimeConfig`, `MapSnapshot`, `ParsedEvent`, `Farm2ControllerDependencies`, `TrackerState`
- Discriminated union members use lowercase `kind` values — `{ kind: "room" }`, `{ kind: "movement_blocked" }`
- Dependency-injection interfaces suffixed with `Dependencies` — `Farm2ControllerDependencies`, `SurvivalControllerDependencies`, `GatherControllerDependencies`, `TriggerDependencies`, `MoverDependencies`

**Constants:**
- Module-scoped primitive constants use `SCREAMING_SNAKE_CASE` with semantic suffix:
  - Regexps: `ANSI_SEQUENCE_REGEXP`, `MOVEMENT_BLOCKED_REGEXP`, `ROOM_HEADER_REGEXP`
  - Timeouts/delays: `DEFAULT_RETRY_DELAY_MS`, `PENDING_MOVE_TTL_MS`, `COOLDOWN_MS`, `RECALL_REPEAT_INTERVAL_MS`
  - Maps: `COMMAND_TO_DIRECTION`, `OPPOSITE_DIRECTION`, `EXIT_TOKEN_TO_DIRECTION`
- Numeric literals use underscore separators for readability — `10_000`, `30_000`, `5_000`

**Database vs Domain fields:**
- Raw PostgreSQL rows use `snake_case` — `from_vnum`, `to_vnum`, `is_portal`
- Exposed domain objects use `camelCase` — `fromVnum`, `toVnum`, `isPortal` (see `MapEdge` in `src/map/types.ts`)
- Mapping between the two happens in store implementations (`src/map/store.ts`)

## Code Style

**Formatting:**
- No formatter configured (no Prettier, Biome, or EditorConfig)
- Observed conventions: 2-space indentation, double-quoted strings, trailing commas in multiline literals, semicolons at statement ends
- Do NOT add Prettier/ESLint without explicit request (see `AGENTS.md`)

**Linting:**
- No linter configured — `tsc --noEmit` (`bun run typecheck`) is the only static check
- `"strict": true` in `tsconfig.json`
- `"verbatimModuleSyntax": true` forces explicit `import type`
- `"allowImportingTsExtensions": true` requires `.ts` extension on relative imports

## Import Organization

**Order (separated by blank lines):**
1. External packages — `import postgres from "postgres"`, `import { z } from "zod"`
2. Node builtins with `node:` prefix — `import { appendFileSync } from "node:fs"`
3. Internal relative paths WITH explicit `.ts` extension — `import { createCombatState } from "./combat-state.ts"`
4. Test framework (test files only) — `import { describe, test, expect } from "bun:test"`

**Type-only imports:**
- MUST use `import type` for types/interfaces due to `verbatimModuleSyntax`:
  ```ts
  import type { Direction, MapSnapshot } from "./map/types.ts";
  import type { CombatState } from "./combat-state.ts";
  ```
- Value and type imports from the same module go on separate lines

**Path aliases:**
- None — always use relative paths

## Error Handling

**Narrow `unknown` before accessing `.message`:**
```ts
void persistData(ws).catch((error: unknown) => {
  logEvent(ws, "error", error instanceof Error ? `Persist error: ${error.message}` : "Persist error.");
});
```
See `src/server.ts:73`, `src/bazaar-notifier.ts:92`, `src/mud-connection.ts:466`.

**Plain `Error` throws — no custom error classes:**
```ts
if (!runtimeConfig.databaseUrl) {
  throw new Error("DATABASE_URL is required. Refusing to start...");
}
```
See `src/config.ts:110`, `src/client/main.ts:30`, `src/zone-scripts/controller.ts:115`.

**Fire-and-forget with explicit `void` + `.catch`:**
- Never leave a Promise un-awaited without `void` prefix and `.catch` handler
- Example: `void mapStore.saveChatMessage(...).catch((error: unknown) => { ... })` (`src/server.ts:73`)

**Never use empty catch blocks or silent swallow:**
- Exception: tolerated only when writing to a best-effort cache (`src/compare-scan/index.ts:263` uses `.catch(() => {})` for non-critical upsert)

**Startup validation:**
- Throw in `src/config.ts` if required env is missing — the server must refuse to start

**DOM/UI required-element pattern (`src/client/`):**
```ts
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required UI element: ${selector}`);
  return element;
}
```
Used at the top of every client module (`src/client/main.ts`, `src/client/nav-panel.ts`, `src/client/popups.ts`).

## Logging

**Framework:** None — custom `logEvent` in `src/server.ts` writes to `/var/log/bylins-bot/mud-traffic.log` in a structured plain-text format.

**No `console.*` in server code.** In sub-modules, log through injected `onLog` / `onDebugLog` callbacks:
```ts
export interface SurvivalControllerDependencies {
  sendCommand(command: string): void;
  isInCombat(): boolean;
  onLog(message: string): void;
  onDebugLog(message: string): void;
}
```

**Prefix convention:** Each module prefixes its log lines with its name in brackets:
```ts
// src/farm2/logger.ts
info(message: string): void { deps.onLog(`[farm2] ${message}`); }
```
See `[bazaar-notifier]`, `[farm2]`, etc.

**Language:** All log messages MUST be in **English**. Russian strings in log output are not allowed in server code. (UI-facing messages in client code and game command text are the only exception.)

**Env-var access:** Use `Bun.env` (NOT `process.env`). Centralized in `src/config.ts`; no other file should read `Bun.env` directly.

## Comments

**When to comment:**
- Regexp constants often have an explanatory Russian comment above them showing the matched phrase (see `src/triggers.ts:16`, `src/gather-script.ts:4`)
- Complex domain logic (zone mapping, combat detection, discriminated-union step kinds) uses multi-line JSDoc — see `src/zone-scripts/types.ts:10-80`
- Code sections use a divider comment `// ----- Section Name -----` in longer files (`src/zone-scripts/types.ts:1-3`)

**JSDoc:**
- Used sparingly, primarily on public discriminated-union members and exported types (`src/zone-scripts/types.ts`)
- Not required on every exported function — code is expected to be self-documenting via naming

**Inline comments:**
- Tolerable for "why not what" — see `src/farm2/controller.ts:32` (`// sets enabled=false, publishes state to UI`)

## Function Design

**Explicit return types on all exported functions:**
```ts
export function createTrackerState(): TrackerState { ... }
export function processParsedEvents(state: TrackerState, events: ParsedEvent[]): TrackerResult { ... }
export function findPath(snapshot: MapSnapshot, fromVnum: number, toVnum: number): PathStep[] | null { ... }
```

**Parameters:**
- Functions with >3 parameters use an `options` object:
  ```ts
  handleMudText(state, deps, text, options: {
    roomChanged: boolean;
    roomDescriptionReceived: boolean;
    currentRoomId: number | null;
    mobsInRoom: string[];
    combatMobNames: string[];
    corpseCount: number;
  })
  ```
- State-manipulating helpers take `state` as first parameter, `deps` second (`src/farm2/state.ts`, `src/farm2/tick.ts`)

**Return values:**
- `null` (not `undefined`) for "not found" cases — `getCurrentRoomId(): number | null`, `findPath(): PathStep[] | null`
- Discriminated-union returns for multi-mode results — `MoveResult`, `StealthMoveResult`

## Module Architecture — Factory Pattern

**No classes. No `new`. No global singletons** (except postgres client `sql` in `src/db.ts` and `runtimeConfig` in `src/config.ts`).

All stateful modules use a **`create*` factory** that accepts a `deps` object:
```ts
export function createFarm2Controller(deps: Farm2ControllerDependencies) {
  const state = createInitialState(defaultConfig());
  // ...private helpers...
  return {
    getState(): Farm2StateSnapshot { ... },
    setEnabled(enabled: boolean): void { ... },
    updateStats(stats: Farm2Stats): void { ... },
  };
}
```

**Dependency injection rules:**
- All side-effectful operations (`sendCommand`, `onLog`, `onStateChange`, DB queries) come through `deps`
- The returned object exposes only the public API — private state is closure-scoped
- `deps` interfaces are named `<Module>Dependencies` and declared in the same file or a sibling `types.ts`

**State split pattern (`src/farm2/`):**
- `types.ts` — interfaces + deps + constants
- `state.ts` — `createInitialState`, reducers over state
- `controller.ts` — factory wiring `state` + `tick` + `mud-handler` together
- `tick.ts` — scheduling logic
- `mud-handler.ts` — parses incoming MUD text
- `index.ts` — barrel exporting only public factory + snapshot type

## TypeScript Idioms

**Discriminated unions for event / step / result types:**
```ts
type ParsedEvent =
  | { kind: "room"; room: ParsedRoom }
  | { kind: "movement"; direction: Direction }
  | { kind: "movement_blocked" }
  | { kind: "dark_room" }
  | { kind: "mobs_in_room"; mobs: string[] }
  | { kind: "corpses_in_room"; count: number };
```
Same pattern in `ScriptStep` (`src/zone-scripts/types.ts:14`), `ClientEvent` / `ServerEvent` (`src/events.type.ts`).

**`satisfies` in tests** for typed literals:
```ts
const result = processParsedEvents(state, [
  { kind: "movement_blocked" },
] satisfies ParsedEvent[]);
```
See `src/map/tracker.test.ts:114`.

**Never use `any`, `as any`, `@ts-ignore`, `@ts-expect-error`.**

**Prefer `ReturnType<typeof fn>` / `Awaited<ReturnType<...>>`** for derived types:
```ts
export type DatabaseClient = ReturnType<typeof postgres>;
```
See `src/db.ts:4`.

**`switch` over discriminated union `kind`:**
```ts
switch (event.kind) {
  case "movement": ...
  case "movement_blocked": ...
  case "dark_room": ...
  case "room": { ... break; }
}
```
`noFallthroughCasesInSwitch` is enabled — wrap blocks with `{}` when declaring `const`.

## Async Patterns

**`async/await` throughout.** Raw Promise chains are not used.

**Parallel operations use `Promise.all` destructuring:**
```ts
const [zoneSettings, mobNames] = await Promise.all([
  deps.getZoneSettings(zoneId),
  deps.getMobCombatNamesByZone(zoneId),
]);
```
See `src/farm2/state.ts:117`, `src/client/main.ts:601`.

**Never `await` inside a loop when parallel is possible.**

**Fire-and-forget always uses `void fn().catch(...)`.** Never a bare unhandled Promise.

**AbortController for cancellation** (zone-scripts):
```ts
function sleep(ms: number, signal: AbortSignal): Promise<void>
if (signal.aborted) throw new Error("aborted");
```
See `src/zone-scripts/controller.ts:115`.

## Database Conventions (`postgres.js`)

**Tagged template literals only — never string concatenation:**
```ts
const rows = await sql`
  SELECT * FROM map_edges WHERE from_vnum = ${vnum}
`;
```

**Schema in `initialize()` with `IF NOT EXISTS` guards** — no migration framework:
```ts
await sql`CREATE TABLE IF NOT EXISTS map_edges (...)`;
```

**Upserts via `ON CONFLICT ... DO UPDATE`:**
```ts
await sql`
  INSERT INTO map_edges ${sql(edge)}
  ON CONFLICT (from_vnum, direction) DO UPDATE SET to_vnum = EXCLUDED.to_vnum
`;
```

**Single shared `sql` client** exported from `src/db.ts:6`.

## Module Design

**Exports:**
- Named exports only — no `export default`
- Re-exports from package `index.ts` are narrow:
  ```ts
  // src/farm2/index.ts
  export { createFarm2Controller } from "./controller.ts";
  export type { Farm2StateSnapshot } from "./types.ts";
  ```

**Barrel files:**
- Used only for folder-level public API (`src/farm2/index.ts`, `src/zone-scripts/index.ts`)
- Do NOT use barrel files for internal re-exports inside the same folder

**Co-location:**
- Tests live next to source — `src/map/parser.ts` + `src/map/parser.test.ts`
- Types live in a sibling `types.ts` when shared across a folder (`src/farm2/types.ts`, `src/zone-scripts/types.ts`, `src/map/types.ts`, `src/client/types.ts`)

---

*Convention analysis: 2026-04-18*
