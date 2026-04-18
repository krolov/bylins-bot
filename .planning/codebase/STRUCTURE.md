# Codebase Structure

**Analysis Date:** 2026-04-18

## Directory Layout

```
bylins-bot/
├── src/                           # All TypeScript source (server + browser)
│   ├── server.ts                  # Entry: HTTP + WebSocket + MUD proxy + orchestrator (1867 lines)
│   ├── mud-connection.ts          # TCP socket, telnet IAC, reconnect
│   ├── config.ts                  # Runtime config read from Bun.env
│   ├── profiles.ts                # Character profiles (login + combat flags)
│   ├── startup-script.ts          # Default MUD host/port/startup commands
│   ├── events.type.ts             # ClientEvent/ServerEvent discriminated unions
│   ├── db.ts                      # postgres() singleton
│   ├── combat-state.ts            # In-combat detector
│   ├── triggers.ts                # Reflex triggers (dodge, stand-up, assist, light)
│   ├── survival-script.ts         # Hunger/thirst auto-eat/drink
│   ├── gather-script.ts           # Auto-pickup berries/herbs/mushrooms
│   ├── repair-script.ts           # Equipment repair workflow
│   ├── bazaar-notifier.ts         # Bazaar watch + Telegram alerts
│   ├── container-tracker.ts       # Parses осм склад1/склад2/инв/equipment
│   ├── item-identify.ts           # Wiki-backed item identifier
│   ├── wiki.ts                    # Wiki HTTP client + HTML parser
│   ├── vorozhe-graph.ts           # Vorozhya quest route finder
│   ├── mob-resolver.ts            # Combat-name ↔ room-name mob probe
│   ├── gear-profile.ts            # Stat-weighted gear scorer
│   ├── equip-utils.ts             # Slot/wear-command mapping
│   ├── settings-normalizers.ts    # Coerce partial settings payloads
│   ├── farm2/                     # Farming controller (HP-recall, mob probe, tick loop)
│   │   ├── index.ts               # barrel — exports createFarm2Controller
│   │   ├── controller.ts          # Factory composition
│   │   ├── config.ts              # Defaults
│   │   ├── state.ts               # Farm2State + snapshot
│   │   ├── tick.ts                # Tick loop body
│   │   ├── mud-handler.ts         # MUD-text dispatch
│   │   ├── navigation.ts          # Next-direction chooser
│   │   ├── room.ts                # getZoneId(vnum)
│   │   ├── logger.ts              # Wrapper over deps.onLog
│   │   └── types.ts               # Farm2State/Deps/Stats/Config types
│   ├── zone-scripts/              # Scripted multi-step zone runs
│   │   ├── index.ts               # barrel
│   │   ├── controller.ts          # Step executor + playlist/loop orchestration
│   │   ├── farm-zone-executor2.ts # Stealth-farm executor (farm_zone2)
│   │   ├── playlists.ts           # Zone playlist definitions (10001+)
│   │   ├── types.ts               # ScriptStep union + Deps
│   │   └── zones/                 # One file per zone: 102, 103, 104, 111, 258, 280, 286
│   ├── map/                       # Automapper + pathfinder
│   │   ├── types.ts               # Direction, ParsedEvent, MapNode/Edge/Snapshot
│   │   ├── parser.ts              # MUD text → ParsedEvent[]
│   │   ├── parser.test.ts         # bun test
│   │   ├── tracker.ts             # TrackerState + current-room tracking
│   │   ├── tracker.test.ts        # bun test
│   │   ├── store.ts               # Postgres MapStore (785 lines)
│   │   ├── memory-store.ts        # In-memory MapStore (tests only)
│   │   ├── pathfinder.ts          # BFS path search
│   │   └── mover.ts               # Direction command + arrival wait
│   ├── compare-scan/              # Gear comparison (shop/bazaar/inventory)
│   │   ├── index.ts
│   │   ├── config.ts
│   │   ├── gear-scoring.ts
│   │   └── profiles/              # Character class configs
│   │       ├── merchant.ts
│   │       └── thief.ts
│   ├── client/                    # Browser bundle (entry: main.ts)
│   │   ├── main.ts                # DOM wiring + ServerEvent dispatcher (1029 lines)
│   │   ├── net.ts                 # WebSocket client
│   │   ├── bus.ts                 # Pub/sub with payload replay
│   │   ├── terminal.ts            # ANSI parser + terminal DOM render
│   │   ├── map-grid.ts            # Zone grid layout (1046 lines)
│   │   ├── nav-panel.ts           # Navigation UI
│   │   ├── inventory.ts           # Container/inventory render
│   │   ├── popups.ts              # Popup primitive
│   │   ├── splitters.ts           # Panel splitter UI
│   │   ├── constants.ts           # Zone metadata, hotkey defaults, direction constants
│   │   ├── types.ts               # Client-only types
│   │   └── modals/                # Lazy-loaded modal chunks
│   │       ├── farm-settings.ts
│   │       ├── survival.ts
│   │       ├── triggers.ts
│   │       ├── compare.ts
│   │       ├── item-db.ts
│   │       ├── global-map.ts
│   │       ├── hotkeys.ts
│   │       └── vorozhe.ts
│   └── utils/
│       └── timer.ts               # TickTimer
├── scripts/                       # CLI tools (bun run ...)
│   ├── build-client.ts            # Bundles src/client/main.ts → public/client.js
│   ├── smoke-test.ts              # bun run smoke
│   ├── gear-advisor.ts            # bun run gear
│   ├── tsp-route.ts               # Zone-script route TSP solver
│   ├── debug-zone-map.ts          # Zone-map inspection
│   ├── wiki.ts                    # Wiki CLI wrapper
│   ├── wiki-mcp.ts                # MCP server for wiki
│   ├── client-mcp.ts              # MCP server for client
│   ├── seed-items.ts              # DB seed
│   └── seed-market-sales.ts       # DB seed
├── public/                        # Served statics (built output + index.html)
│   ├── index.html                 # Shell — hand-edited, post-processed by build-client.ts
│   ├── client.js                  # Built from src/client/main.ts
│   ├── chunk-*.js                 # Code-split chunks (modals + shared)
│   ├── styles.css                 # Source stylesheet
│   └── styles.min.css             # Built from styles.css
├── deploy/                        # Deployment config
│   ├── Caddyfile                  # HTTPS + Basic Auth reverse proxy
│   └── docker-compose.yml         # Caddy + app compose
├── docs/                          # Manual documentation
│   ├── client-refactor-plan.md
│   ├── mud-zone-analysis-skill.md
│   ├── taty-starter-gear.md
│   └── wiki-stuff-api.md
├── .claude/skills/                # Claude skill definitions (gitnexus, zone-painting)
├── .planning/                     # GSD planning outputs
├── .gitnexus/                     # GitNexus code-intelligence index
├── node_modules/                  # bun install output (committed lockfile: bun.lock)
├── AGENTS.md                      # Agent-facing project guide
├── CLAUDE.md                      # Claude-specific project instructions
├── README.md                      # Russian user-facing docs
├── Dockerfile
├── ecosystem.config.cjs           # PM2 config
├── opencode.json                  # opencode agent config
├── package.json                   # Bun project manifest
├── bun.lock                       # Bun lockfile (commit to git)
├── tsconfig.json                  # ESNext + Bundler resolution + strict
└── .env / .env.example            # Env config (MUD host, DB URL, Telegram, proxies)
```

## Directory Purposes

**`src/`:**
- Purpose: All TypeScript source, both server and browser.
- Contains: A flat set of feature modules at the top level, plus subdirectories for larger concerns.
- Key files: `src/server.ts` (server entry), `src/client/main.ts` (browser entry), `src/events.type.ts` (wire protocol).

**`src/farm2/`:**
- Purpose: The modern farm controller (factory + tick loop + mob probe + HP-recall).
- Contains: One file per concern — state, tick, mud-handler, navigation, types.
- Key files: `src/farm2/controller.ts` is the factory; `src/farm2/types.ts` holds all shared types and regex constants.

**`src/zone-scripts/`:**
- Purpose: Declarative multi-step scripts for walking + fighting specific zones.
- Contains: Controller, executor, playlists, plus one `zones/NNN.ts` per scripted zone.
- Key files: `src/zone-scripts/types.ts` defines `ScriptStep`; `src/zone-scripts/zones/` is where new zones go.

**`src/map/`:**
- Purpose: Automapper — parse room descriptions, track current location, persist to Postgres, find paths.
- Contains: Pure-function parser + tracker + BFS pathfinder + two `MapStore` impls (Postgres + memory).
- Key files: `src/map/store.ts` is the only impl used in production; `src/map/parser.ts` and `tracker.ts` have tests.

**`src/client/`:**
- Purpose: Browser bundle — DOM wiring, WebSocket client, terminal, map grid, modals.
- Contains: Top-level flat modules + `modals/` for lazy-loaded dialogs.
- Key files: `src/client/main.ts` is the composition root; `src/client/bus.ts` decouples modals from main.

**`src/compare-scan/`:**
- Purpose: Scans shops/bazaar/inventory/guild-storage, scores gear, returns recommendations.
- Contains: One entry (`index.ts`), one scoring module, and `profiles/` for class-specific configs.

**`src/utils/`:**
- Purpose: Only `timer.ts` so far. Add genuinely shared utilities here.

**`scripts/`:**
- Purpose: CLI entry points invoked via `bun run <name>` (see `package.json::scripts`).
- Contains: Build, smoke test, gear advisor, MCP servers, DB seeders, zone-map tools.

**`public/`:**
- Purpose: Everything served as static files.
- Contains: Hand-edited `index.html` + `styles.css` (sources) + built `client.js`, `styles.min.css`, `chunk-*.js` (generated).
- Note: Built artifacts ARE committed (per `.gitignore` inspection) so the app can run without `bun run build:client`.

**`deploy/`:**
- Purpose: Docker + Caddy config for production (`sc.kerat.ru`).

**`.claude/skills/`:**
- Purpose: Claude-specific skill packs — gitnexus (code intelligence) and zone-painting.
- Contains: `SKILL.md` entry + `rules/*.md` subfiles per skill.

**`docs/`:**
- Purpose: Long-form developer notes (refactor plans, zone analysis, starter-gear guides, wiki API spec).

## Key File Locations

**Entry Points:**
- `src/server.ts`: Bun HTTP+WebSocket server entry.
- `src/client/main.ts`: Browser bundle entry.
- `scripts/build-client.ts`: Build tooling entry (invoked by `bun run build:client`).

**Configuration:**
- `src/config.ts`: Environment variables → `runtimeConfig` object.
- `src/profiles.ts`: Character login profiles + combat flags.
- `src/startup-script.ts`: Fallback MUD host/port/commands when no env override.
- `.env` / `.env.example`: `MUD_HOST`, `MUD_PORT`, `DATABASE_URL`, `WIKI_PROXIES`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- `tsconfig.json`: ESNext, strict, `moduleResolution: "Bundler"`, no emit.
- `ecosystem.config.cjs`: PM2 process config.
- `package.json`: `bun` scripts (dev/start/build/test/smoke/gear/typecheck).

**Core Logic:**
- `src/events.type.ts`: Every `ClientEvent`/`ServerEvent` on the WebSocket.
- `src/mud-connection.ts`: Telnet + reconnect + socket lifecycle.
- `src/map/store.ts`: All Postgres SQL.
- `src/zone-scripts/controller.ts`: Zone-script step executor.
- `src/farm2/controller.ts`: Farm controller composition.

**Testing:**
- `src/map/parser.test.ts`: MUD text parser tests (only test file with ~250 lines).
- `src/map/tracker.test.ts`: Location tracker tests.
- No other `*.test.ts` files in the repo.

## Naming Conventions

**Files:**
- `kebab-case.ts` for all TypeScript modules (`mud-connection.ts`, `gather-script.ts`, `container-tracker.ts`).
- `*.test.ts` for Bun test files (sibling to source).
- Zone files: `NNN.ts` where NNN is the zone id (`src/zone-scripts/zones/102.ts`, `104.ts`, `286.ts`).
- Barrel files: `index.ts` inside feature directories, re-exports only (`src/farm2/index.ts`, `src/zone-scripts/index.ts`).
- Import specifiers include `.ts` extension (`verbatimModuleSyntax` + `allowImportingTsExtensions` in tsconfig).

**Directories:**
- `kebab-case` for multi-word (`compare-scan/`, `zone-scripts/`).
- `camelCase` never used for directories.

**Symbols:**
- `camelCase` for functions, variables (`createFarm2Controller`, `runtimeConfig`, `sharedSession`).
- `PascalCase` for types, interfaces, classes (`MapStore`, `Session`, `ScriptStep`, `Farm2State`).
- `SCREAMING_SNAKE_CASE` for module-level constants/regexes (`ANSI_ESCAPE_RE`, `RECONNECT_DELAYS_MS`, `MAX_OUTPUT_CHUNKS`, `ZONE_102_ID`).
- Factory pattern: `createXxx()` returns an object; not `new Xxx()` (classes are rarely used).

## Where to Add New Code

**New zone script:**
- Primary code: `src/zone-scripts/zones/NNN.ts` — export `ZONE_NNN_ID`, `ZONE_NNN_NAME`, `zoneNNNSteps: ScriptStep[]`.
- Register in: `src/zone-scripts/controller.ts::ZONE_SCRIPTS` array (add a `{ zoneId, zoneName, hundreds, steps }` entry).
- Zone playlists: `src/zone-scripts/playlists.ts::ZONE_PLAYLISTS` (playlist id must be ≥ 10000).

**New ClientEvent / ServerEvent:**
- Add variant to union in: `src/events.type.ts`.
- Handle on server: `src/server.ts` — find the big `switch (event.type)` in the WebSocket message handler and add a `case`.
- Handle on client: `src/client/main.ts` — find the `ServerEvent` dispatcher and add a `case`, or subscribe via `bus.on(...)` from a modal.

**New controller / feature module:**
- Primary code: top-level `src/<feature>.ts` (flat) OR `src/<feature>/` (for multi-file features, with an `index.ts` barrel).
- Pattern: Export a `createXxx(deps: XxxDeps)` factory that returns an object of public methods.
- Wire in: `src/server.ts` — construct near other controllers, register `handleMudText` into `mudTextHandlers` if it listens to MUD text, add to `sessionTeardownHooks` if stateful.

**New browser modal:**
- Primary code: `src/client/modals/<name>.ts`.
- Pattern: Module-level side effects executed on first import; subscribes via `bus.on(...)` for server pushes; listens for click on its open-button inside its own module.
- Wire in: `src/client/main.ts` — dynamic `import("./modals/<name>.ts")` on first click of the open-button.

**New Postgres table / column:**
- Schema migrations: `src/map/store.ts::initialize()` — runs `CREATE TABLE IF NOT EXISTS ...` idempotently on every startup (no separate migration tool).
- Reads/writes: add method to `MapStore` interface + implement in both `src/map/store.ts` and `src/map/memory-store.ts`.

**New CLI script:**
- Primary code: `scripts/<name>.ts`.
- Wire in: `package.json::scripts` — add `"name": "bun run scripts/<name>.ts"`.

**New settings field (farm / zone-script / survival / triggers):**
- Type: `src/map/store.ts` (the public settings interfaces live there, re-exported from `src/events.type.ts`).
- Normalization: `src/settings-normalizers.ts` — add to `normalizeFarmZoneSettings` / `normalizeSurvivalSettings` / `normalizeZoneScriptSettings`.
- Browser form: corresponding modal in `src/client/modals/`.

**Shared utility:**
- If truly cross-cutting: `src/utils/<name>.ts`.
- If only used by one feature: keep inside that feature's directory.

## Special Directories

**`public/`:**
- Purpose: Static assets served by Bun + built client bundle.
- Generated: Partially — `client.js`, `chunk-*.js`, `styles.min.css` are built. `index.html` and `styles.css` are hand-edited sources.
- Committed: Yes — the built bundle is committed so deployment doesn't need a build step.

**`node_modules/`:**
- Purpose: Bun dependencies.
- Generated: Yes (`bun install`).
- Committed: No.

**`.gitnexus/`:**
- Purpose: GitNexus code-intelligence index (1240 symbols, 3019 relationships, 103 execution flows).
- Generated: Yes (`npx gitnexus analyze`).
- Committed: Check locally; typically kept out of git.

**`.planning/`:**
- Purpose: GSD planning artifacts (codebase maps, phase plans, execution logs).
- Generated: Yes (by `/gsd-map-codebase`, `/gsd-plan-phase`, etc.).
- Committed: Project-specific — inspect `.gitignore`.

**`.claude/skills/`:**
- Purpose: Skill definitions loaded by Claude Code (`gitnexus/` for code navigation, `zone-painting/` for zone work).
- Generated: No — hand-curated.
- Committed: Yes.

**`.opencode/`:**
- Purpose: opencode agent config.
- Committed: Typically yes.

**`deploy/`:**
- Purpose: Production deploy (Caddy + Docker Compose).
- Committed: Yes.

---

*Structure analysis: 2026-04-18*
