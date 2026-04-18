# Architecture

**Analysis Date:** 2026-04-18

## Pattern Overview

**Overall:** Event-driven single-process bot with a browser UI frontend. The Bun server runs a long-lived TCP session to a MUD game server and acts as both a proxy (forwarding raw bytes to WebSocket-connected browsers) and an autonomous agent (parsing MUD text, running farm/zone/survival scripts, persisting map state to Postgres).

**Key Characteristics:**
- **Functional-factory style** — modules export `createXxx()` factories that return handler objects with closed-over state. No OOP classes for domain logic.
- **Dependency injection via deps objects** — every controller (`createFarm2Controller`, `createZoneScriptController`, `createMudConnection`, `createSurvivalController`, `createGatherController`, `createTriggers`, `createBazaarNotifier`, `createContainerTracker`, `createItemIdentifier`, `createRepairController`, `createMapStore`) takes a typed `Deps` interface wiring it to the rest of the system. `src/server.ts` is the composition root.
- **Shared MUD text bus** — every text chunk from the MUD socket fans out to all interested controllers via `onMudText` callback in `src/mud-connection.ts` and a `mudTextHandlers: Set<Handler>` registered via `addMudTextListener`.
- **Discriminated-union message protocol** — `ClientEvent`/`ServerEvent` in `src/events.type.ts` drive WebSocket traffic.
- **Regex-first parsing** — the MUD speaks Russian over telnet with ANSI color; all parsing is pure regex against stripped text (see `src/map/parser.ts`, `src/combat-state.ts`, `src/triggers.ts`).
- **Persistent automapper** — Postgres stores rooms, edges, aliases, zone settings, items, chat, market sales. Memory store is available but not used at runtime (DATABASE_URL is required at startup).

## Layers

**Entry / Composition Root:**
- Purpose: Bootstraps runtime config, wires every controller, exposes HTTP + WebSocket + REST API, dispatches `ClientEvent` messages.
- Location: `src/server.ts` (1867 lines — monolithic by design; all wiring lives here)
- Contains: HTTP routes (`/api/config`, `/api/profiles`), WebSocket upgrade, MUD text pipeline, navigation/pathfinding orchestration, session teardown hooks.
- Depends on: every other `src/*` module.
- Used by: Bun runtime (`bun run src/server.ts`).

**MUD Transport:**
- Purpose: Owns the raw TCP socket to the MUD, handles telnet IAC negotiation, runs startup-command sequencing, reconnect backoff, keepalive.
- Location: `src/mud-connection.ts`
- Contains: `Session` state, `TelnetState`, `createMudConnection({ deps })`.
- Depends on: `src/config.ts`, `src/profiles.ts`, `src/events.type.ts`.
- Used by: `src/server.ts`.

**Domain Controllers (feature modules):**
- Purpose: Each controller owns one concern and exposes `handleMudText(text)` plus action methods.
- Location:
  - `src/farm2/` — legacy single-zone farming (HP-recall, mob probe, tick loop)
  - `src/zone-scripts/` — scripted multi-step zone runs (navigate, command, wait_text, farm_zone, farm_zone2)
  - `src/survival-script.ts` — hunger/thirst auto-eat/drink
  - `src/triggers.ts` — combat reflex triggers (dodge, stand up, rearm, assist, light)
  - `src/gather-script.ts` — auto-pickup of berries/herbs/mushrooms/branches
  - `src/repair-script.ts` — equipment repair workflow
  - `src/compare-scan/` — gear comparison against shops/bazaar/inventory
  - `src/bazaar-notifier.ts` — background bazaar price watch + Telegram alerts
  - `src/container-tracker.ts` — parses `осм склад1/склад2/базар/хлам/инв/equipment` output
  - `src/item-identify.ts` — identifies unknown items via wiki lookup
  - `src/combat-state.ts` — shared combat-in-progress flag
- Pattern: pure functional state + dependency-injected IO. No direct socket/db access.

**Map Layer:**
- Purpose: Parse room descriptions, track player location, maintain graph, find paths.
- Location: `src/map/`
  - `parser.ts` — turns MUD text chunks into `ParsedEvent[]` (room, movement, mobs, corpses)
  - `tracker.ts` — tracks current room vnum and pending-move state
  - `store.ts` — Postgres-backed `MapStore` (the only runtime implementation; Postgres is required)
  - `memory-store.ts` — in-memory `MapStore` (used only by tests)
  - `pathfinder.ts` — BFS over `MapSnapshot` edges
  - `mover.ts` — sends direction commands and resolves on arrival
- Pattern: pure functions + state objects (not classes). Every function takes explicit state.

**Persistence:**
- Purpose: Single Postgres connection + schema-agnostic `MapStore` interface.
- Location: `src/db.ts` (thin wrapper), `src/map/store.ts` (SQL).
- Library: `postgres` (porsager/postgres).
- Depends on: `DATABASE_URL` env var (required — server refuses to start without it).

**Browser Client:**
- Purpose: Terminal view, map grid, stat bars, container panels, modals for settings and tools.
- Location: `src/client/`
- Entry: `src/client/main.ts` (1029 lines — DOM wiring + dispatcher)
- Modules:
  - `net.ts` — WebSocket client with reconnect + pending queue
  - `bus.ts` — tiny pub/sub with payload replay for lazy-loaded modals
  - `terminal.ts` — ANSI parser + DOM rendering
  - `map-grid.ts` — zone-aware grid layout of rooms
  - `nav-panel.ts` — navigation UI (aliases, goto)
  - `inventory.ts` — container/inventory rendering
  - `popups.ts`, `splitters.ts` — UI primitives
  - `constants.ts`, `types.ts` — shared client types/constants
  - `modals/` — dynamically imported on first open (`farm-settings`, `survival`, `triggers`, `compare`, `item-db`, `global-map`, `hotkeys`, `vorozhe`)
- Build: `scripts/build-client.ts` bundles to `public/client.js` with code-splitting; HTML is post-processed to add `<link rel=modulepreload>` tags for eager chunks.

**Scripts / Tooling:**
- Purpose: One-off CLI utilities.
- Location: `scripts/`
  - `build-client.ts` — browser bundle build
  - `smoke-test.ts` — integration smoke
  - `gear-advisor.ts` — gear recommendation CLI
  - `debug-zone-map.ts`, `tsp-route.ts` — zone-script route planners
  - `wiki.ts`, `wiki-mcp.ts`, `client-mcp.ts` — wiki scraping + MCP servers
  - `seed-items.ts`, `seed-market-sales.ts` — DB seeding

## Data Flow

**MUD → Browser (primary inbound flow):**

1. MUD TCP socket receives bytes → `src/mud-connection.ts::decodeMudData()` strips telnet IAC, decodes UTF-8.
2. Decoded text is passed to `deps.onMudText(text, ws)` in `src/server.ts`.
3. The onMudText handler dispatches to:
   - `containerTracker.feedText/feedEquippedScan/feedPendingInspect` — container buffers
   - every registered `mudTextHandlers` (zone-scripts, assist, etc.)
   - `bazaarNotifier.handleMudText`
   - `broadcastServerEvent({type: "output", payload: {text}})` — raw passthrough to browser
   - `extractChatLines` → `chat_message` events + Postgres persist
   - `extractMarketSales` → Postgres persist
   - `LOOT_FROM_CORPSE_RE` / `PICKUP_FROM_GROUND_RE` → pending loot sort
   - `persistParsedMapData(text, ws)` which invokes:
     - `parseAndBroadcastStats` → `stats_update` event
     - `combatState.handleMudText` + transition detection
     - `triggers.handleMudText`
     - `survivalController.handleMudText` + `scheduleSurvivalTick`
     - `gatherController.handleMudText`
     - `itemIdentifier.handleChunk`
     - `feedText(parserState, text)` → room/movement events → `tracker` updates → `mapStore.upsertRoom/upsertEdge` → `map_update` broadcast
     - `farm2Controller.handleMudText`
     - `zoneScriptController.handleMudText`
     - `navigationController` step resolution

**Browser → MUD (command flow):**

1. User types command in terminal or clicks a UI action.
2. `src/client/main.ts` sends `ClientEvent` via `src/client/net.ts` over WebSocket.
3. `src/server.ts` WebSocket message handler switches on `event.type` and invokes the right controller (e.g. `farm2Controller.setEnabled`, `zoneScriptController.start`, `startNavigation`).
4. Controller calls `deps.sendCommand(cmd)` which delegates to `mudConnection.writeAndLogMudCommand` → TCP socket write + `trackOutgoingCommand` for tracker hints.

**State Management:**
- Server: all state is held as closures inside factory functions (`createXxx`). No global singletons except `runtimeConfig`, `sql` (Postgres client), and top-level `browserClients` / `mudTextHandlers` sets in `src/server.ts`.
- Browser: module-level variables in `src/client/main.ts` + local state inside factory modules (map-grid, terminal, etc.). No framework, no reactive store.
- Persistence: Postgres is the only durable store. Nothing is serialized to disk except `/var/log/bylins-bot/last-profile.txt` (last selected profile id) and log files.

## Key Abstractions

**MapStore:**
- Purpose: Typed interface over all Postgres reads/writes (rooms, edges, aliases, farm settings, zone-script settings, survival, triggers, items, chat, market, mob names).
- Examples: `src/map/store.ts` (Postgres impl), `src/map/memory-store.ts` (in-memory impl for tests).
- Pattern: Factory returns `MapStore` interface; consumers depend on interface, not implementation.

**Controller Factory:**
- Purpose: Encapsulates a subsystem with its state and exposes a small public API + dependency hooks.
- Examples: `src/farm2/controller.ts`, `src/zone-scripts/controller.ts`, `src/survival-script.ts::createSurvivalController`, `src/triggers.ts::createTriggers`, `src/gather-script.ts::createGatherController`, `src/mud-connection.ts::createMudConnection`.
- Pattern: `function createXxx(deps: XxxDeps) { ... return { method1, method2, ... }; }`. No `this`, no classes.

**ScriptStep (discriminated union):**
- Purpose: Declarative DSL for zone-script steps.
- Examples: `src/zone-scripts/types.ts` (definition), `src/zone-scripts/zones/*.ts` (instances like `zone102Steps`, `zone104Steps`).
- Pattern: `{ kind: "navigate" | "command" | "wait_text" | "command_and_wait" | "special_move" | "farm_zone" | "farm_zone2", ...payload }`; executor switches on `kind`.

**ParsedEvent (discriminated union):**
- Purpose: Output of the MUD text parser.
- Examples: `src/map/types.ts::ParsedEvent`.
- Pattern: `{ kind: "room" | "movement" | "movement_blocked" | "dark_room" | "mobs_in_room" | "corpses_in_room", ... }`.

**CharacterProfile:**
- Purpose: Per-character login + combat-style config.
- Examples: `src/profiles.ts` (profiles `voinmir`, `alrug`, `rinli`), passed via `createMudConnection` deps.
- Flags: `stealthCombat`, `merchantCombat`, `gearProfile`.

**ClientEvent / ServerEvent:**
- Purpose: WebSocket wire protocol (discriminated union).
- Examples: `src/events.type.ts`.
- Pattern: Every event is `{ type: string, payload?: ... }`; server switches on `type`.

**TickTimer:**
- Purpose: Cancellable single-shot scheduler for tick-driven controllers.
- Examples: `src/utils/timer.ts::createTickTimer`, used by `src/farm2/state.ts` and recall loop.

## Entry Points

**Server HTTP / WebSocket:**
- Location: `src/server.ts` (near top — `Bun.serve({ fetch, websocket, ... })`).
- Triggers: `bun run start` / `bun run dev`, HTTP requests on port `3000`, WebSocket upgrade on `/ws`.
- Responsibilities: Serves `public/index.html` + client bundle; handles WebSocket events; proxies to MUD.

**Browser Client:**
- Location: `src/client/main.ts` (loaded by `public/index.html` as `<script src="/client.js">`).
- Triggers: Browser navigation to `http://localhost:3000/`.
- Responsibilities: DOM wiring, WebSocket connection via `src/client/net.ts::createNet`, ServerEvent dispatcher.

**CLI Scripts:**
- `scripts/build-client.ts` — invoked by `bun run build:client`.
- `scripts/smoke-test.ts` — invoked by `bun run smoke`.
- `scripts/gear-advisor.ts` — invoked by `bun run gear`.

## Error Handling

**Strategy:** Lenient — no central error boundary. Controllers catch-and-log; the server keeps running on most failures. The one exception: `DATABASE_URL` missing throws at startup in `src/config.ts`.

**Patterns:**
- `try { ... } catch (error: unknown) { logEvent(ws, "error", error instanceof Error ? error.message : "Unknown error"); }` is the canonical form, used throughout `src/server.ts`.
- `void somePromise.catch((error) => logEvent(...))` for fire-and-forget async work (Postgres writes, map persist, wiki lookups).
- MUD text parsing is total — unknown lines are silently ignored, not thrown on.
- WebSocket disconnects trigger cleanup (`mudTextHandlers.clear()`, `combatState.reset()`, `survivalController.reset()`) via `sessionTeardownHooks` set.
- Navigation failures are surfaced as `status` events to the browser (e.g. "Навигация: путь не найден").

## Cross-Cutting Concerns

**Logging:** File-append to `/var/log/bylins-bot/mud-traffic.log` and `/var/log/bylins-bot/debug.log` via `appendLogLine` helper in `src/server.ts`. Each line is a single-line JSON-ish record with `session=...`, `direction=...`, `message=...`. No `console.log` in production paths.

**Validation:** Manual — `zod` is a dependency but not used pervasively. Settings normalizers in `src/settings-normalizers.ts` coerce partial `ClientEvent` payloads into typed `FarmZoneSettings`/`SurvivalSettings`/`ZoneScriptSettings`. Client settings validation is duplicated in `src/client/main.ts`.

**Authentication:** None in the app — access is gated by Caddy HTTP Basic Auth in `deploy/Caddyfile`. Per-character MUD login credentials live in `src/profiles.ts::startupCommands`.

**Configuration:** Environment variables read through `src/config.ts::runtimeConfig` (singleton). `Bun.env.*` is the source. No dotenv library — Bun loads `.env` natively. Profile-specific startup commands are hard-coded in `src/profiles.ts`.

**Process management:** PM2 (`ecosystem.config.cjs`). `pm2 restart bylins-bot` is the canonical reload. Auto-reconnect to MUD is built into `src/mud-connection.ts` with exponential backoff (`RECONNECT_DELAYS_MS`).

---

*Architecture analysis: 2026-04-18*
