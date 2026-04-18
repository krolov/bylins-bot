# Stack Research

**Domain:** Large-scale TypeScript monolith refactor (Bun + `postgres`, brownfield MUD bot)
**Researched:** 2026-04-18
**Confidence:** HIGH (all choices verified against current official docs as of April 2026; versions cross-checked against upstream GitHub/npm)

## Context This Serves

The milestone does four things:

1. Break up 4 monoliths (`server.ts` 1867, `client/main.ts` 1029, `client/map-grid.ts` 1046, `wiki.ts` 955) into factory-DI modules.
2. Introduce an event bus to replace the ad-hoc `onMudText` callback chain.
3. Add a Postgres migration framework that works with the existing `postgres` (porsager) driver.
4. Diagnose and fix a >15-second UI freeze after browser reload.

Every stack choice below is evaluated against: Bun 1.x runtime, TypeScript strict mode, existing `postgres` ^3.4.9 driver, existing factory pattern (`createXxx({deps})`), and the "preserve behaviour, refactor structure" constraint. Everything else is out of scope.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **mitt** | 3.0.1 | Typed event bus for MUD-text fan-out and cross-module signals | <200 bytes gzipped, framework-agnostic, first-class TypeScript generics (`mitt<Events>()`), zero runtime deps, works identically in Bun and browser. Drop-in replacement for the current `mudTextHandlers: Set<Handler>` with type safety. No Node/EventEmitter assumptions — pure ES. |
| **postgres-shift** | 0.1.0 (Dec 2022) | Postgres migration runner paired with `postgres` (porsager) | Authored by the same maintainer as the `postgres` driver, explicitly listed in the `postgres` README's "Migration tools" section. Takes the existing `sql` instance, reads numbered folders (`00001_initial/index.sql`), records progress in a tracking table, forward-only. Minimal code footprint. Verified in the `postgres` README as one of three officially suggested options alongside `ley` and `pgmg`. |
| **fast-check** | 4.7.0 | Property-based testing for parsers and state machines | Runner-agnostic (works inside `bun:test` via `fc.assert(fc.property(...))`). Actively maintained (v4.7.0 released April 2026 adds Unicode property support in `stringMatching`). Ideal for MUD text parser (`src/map/parser.ts`), `container-tracker` state, and trigger regexes — properties like "parser output for same input is stable" catch regressions refactors can introduce. |
| **Bun `--cpu-prof` / `--heap-prof`** | Bun 1.x built-in | Server-side profiling (flamegraphs, heap snapshots, allocation analysis) | Native to Bun 1.3+. `bun --cpu-prof server.ts` emits a Chrome DevTools-compatible `.cpuprofile`; `--heap-prof` emits a V8 `.heapsnapshot`. Markdown variants (`--cpu-prof-md`) are grep/LLM-friendly. No extra deps, zero integration cost. |
| **Chrome DevTools Performance panel** | Chrome 120+ | Browser-side profiling for the 15s reload hang | The only tool that shows main-thread long tasks, script evaluation time, DOM reflow/paint cost, and initial compile/parse cost together. The hang presents exactly as a "long task" blocking the main thread — this is what the Performance panel is designed to visualize. No library; it's a browser feature. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **mitata** | 1.0.23 | Microbenchmark harness for hot paths | Use only if profiling flags a specific hot function (e.g., `extractMobsFromRaw`, `getZoneSnapshot`). Bun-native, picosecond accuracy. Do NOT add until data shows a bottleneck needs it. |
| **bun:test snapshot matchers** (`toMatchSnapshot`, `toMatchInlineSnapshot`) | Built-in | Regression harness for parser output and persisted state | Capture current parser output against real MUD log fixtures from `/var/log/bylins-bot/mud-traffic.log.1`; any refactor that changes output fails loudly. Critical to preserve "bit-for-bit behaviour" constraint. Zero new dependency — already shipping with Bun. |
| **bun:test `expect.addSnapshotSerializer`** | Built-in | Normalize non-deterministic fields in snapshots | Use to strip timestamps/UUIDs before comparison so snapshots stay stable. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `bun --inspect server.ts` | Interactive debugging via WebKit Inspector | Opens `debug.bun.sh`; set breakpoints, walk through event-bus subscription chains during refactor. Use `--inspect-brk` for script startup bugs. |
| `bun --cpu-prof --cpu-prof-md` | Combined Chrome-DevTools + markdown CPU profile | Run during a representative workload (one farm cycle, one reload). Markdown output can be diffed across before/after commits. |
| Chrome DevTools → Performance → Record | Browser reload profiling | Record from page load until UI becomes responsive; filter by "Long tasks" in the Summary view. Enable "Memory" to catch heap-growth side effects. |
| Chrome DevTools → Coverage tab | Identify eager-loaded code that ran <10% | Will immediately show whether cytoscape (~500 KB) is executing on boot even when the global-map modal is closed. Directly tests the `CONCERNS.md` hypothesis about cytoscape. |
| `MIMALLOC_SHOW_STATS=1 bun ...` | Native-heap stats on exit | Use if JS heap looks clean but RSS grows — rules out native-side leaks in the `postgres` driver or Bun's WebSocket layer. |

## Installation

```bash
# Runtime (production) — added to dependencies
bun add mitt@^3.0.1

# Migrations (production, runs at startup) — added to dependencies
bun add postgres-shift@^0.1.0

# Dev-only — added to devDependencies
bun add -D fast-check@^4.7.0

# Optional, add only when profiling pinpoints a hot path
# bun add -D mitata@^1.0.23
```

No browser bundle additions — all profiling of the client happens via Chrome DevTools (browser-native, zero code impact).

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| **mitt** | **eventemitter3** 5.0.4 | If you need wildcard listeners, `once()`, or Node-EventEmitter API compatibility with third-party libraries. For the bylins-bot use case (typed fan-out with `on`/`off`/`emit`), mitt is lighter and has better TS inference. |
| **mitt** | **nanoevents** 9.1.0 | If you need the absolute smallest bundle (108 bytes brotli'd vs 200 gzipped). API is similar but returns an `unbind` function instead of `off()`. Marginal win; stick with mitt unless browser payload is critical. |
| **mitt** | **Custom typed bus** (~30 LOC, `Map<string, Set<Handler>>`) | Only if you want zero external dependencies. The project already has this pattern via `mudTextHandlers: Set<Handler>` — formalizing into a typed module is ~2 hours of work. Mitt's edge: battle-tested, documented, and saves future-you from reinventing `.once()`, error isolation, listener-count accounting. |
| **mitt** | **RxJS** 7.x | Only if you need operators (`debounceTime`, `distinctUntilChanged`, `scan`). The MUD-text pipeline could benefit from `debounceTime(200)` for `broadcastMapSnapshot` — but 8 kB min+gz + learning curve vs a 3-line `setTimeout`-based debounce. Don't introduce RxJS mid-refactor; it changes the project's mental model. |
| **postgres-shift** | **pgmg** (JAForbes) | If you need transactional migrations with auto-wrap, JS migrations with the `sql` object, and richer tooling. pgmg has OOTB postgres.js support. Slightly more features but pre-1.0 with a pending major version on the `next` branch — risky to adopt mid-refactor. |
| **postgres-shift** | **ley** 0.8.0 | If you want driver-agnostic migrations (switch DBs later). Last release Oct 2022, WIP status — maintenance concern. |
| **postgres-shift** | **node-pg-migrate** 8.0.4 | Most mature option (53 releases, actively maintained Dec 2025). DO NOT USE — it requires the `pg` driver as a direct dependency, which conflicts with the "stack is fixed on `postgres` porsager" constraint. Forces a second DB client in the process. |
| **postgres-shift** | **Umzug** 3.8.2 | Database-agnostic, TypeScript-first, 2024 release. Requires writing a custom Storage adapter for `postgres` porsager (~50 LOC). Overkill for a single project with forward-only needs. Use if you later need migration metadata introspection, rollback UI, or multi-environment orchestration. |
| **postgres-shift** | **Roll-your-own** (`schema_migrations` table + `sql.file()` loop) | Viable — `postgres` porsager has `sql.file(path)` built in. ~40 LOC covers: create `schema_migrations(id int primary key, name text, applied_at timestamptz)`, `SELECT id FROM schema_migrations`, iterate `*.sql` files in order, `BEGIN/COMMIT` each. Fits the "factory, no magic" house style perfectly. Choose this over postgres-shift IF you want zero new dependencies and full control — the implementation cost is < reading postgres-shift's source. **Recommendation: pick postgres-shift for signal ("we use the tool the driver author wrote") OR roll-your-own for minimalism. Both are correct; avoid umzug/node-pg-migrate.** |
| **fast-check** | **No PBT, snapshot tests only** | For pure parsers where the input space is well-enumerated (e.g., mob block regex on fixed ANSI templates), snapshot tests against real log fixtures are sufficient. Add fast-check only where input variation is wide (grid-layout algorithm for `map-layout.ts`, zone BFS pathfinder). |
| **fast-check** | **Hand-written table-driven tests** | Cheaper to write; worse at finding edge cases. Use for things with obvious input space (e.g., chat-filter name list). |
| **Bun `--cpu-prof`** | **clinic.js / 0x** | Node.js ecosystem tools — don't work on Bun (require V8 internals). Not applicable. |
| **Bun `--cpu-prof`** | **`import.meta.url` + `performance.now()` timing** | Fine for spot-measuring a suspected function, e.g., wrap `persistParsedMapData` and log duration. Complements profiling; doesn't replace it. Use for continuous "is this still fast?" assertions in dev mode. |
| **Chrome DevTools Performance panel** | **Firefox Profiler** | Alternative with better thread visualization. Chrome is enough; Caddy Basic Auth already works with it; no extra setup. |
| **Chrome DevTools Performance panel** | **Web Vitals lib + `PerformanceObserver(longtask)`** | Programmatic detection — useful for logging hang events in production. Add ONLY after fixing the current hang; don't try to diagnose with telemetry when a manual profile trace is one click away. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Prisma, Drizzle, Kysely, TypeORM, Sequelize** | Project stack is locked on `postgres` porsager (tagged-template SQL with strong types). Introducing an ORM/query builder doubles the mental model, invalidates every `sql` call in `map/store.ts`, and is explicitly out of scope in `PROJECT.md`. | Keep `postgres` porsager. For migrations, use postgres-shift or roll-your-own. |
| **node-pg-migrate** | Hard-requires the `pg` driver as a direct dep. Dual-driver process is waste. | postgres-shift, pgmg, or a ~40-line roll-your-own runner. |
| **Knex migrations** | Same dual-driver problem; brings a whole query builder along. | Same as above. |
| **Flyway / Sqitch / Liquibase** | External binaries. Adds a deploy step, breaks the "just Bun + Postgres" model described in `STACK.md` (codebase). | Keep migrations as Bun-executable scripts run at server startup. |
| **Redux / Zustand / MobX** | The project has zero "store" in the client beyond a WS-bus — introducing a state-management lib for a refactor is scope creep and contradicts the functional factory pattern in `PROJECT.md`. The client hang isn't a state-management problem, it's a CPU problem. | Keep existing `src/client/bus.ts` + DOM updates. Event bus (`mitt`) only for cross-module signalling, NOT reactive state. |
| **Node `EventEmitter` (`node:events`)** | Works fine on Bun, but brings no type safety. All listeners are `(...args: any[]) => void`. Rejects the project's `no-any` rule. | mitt with `type Events = { mudText: string; roomEntered: Room; ... }`. |
| **RxJS** | 8 kB min+gz in the client bundle for features we don't need; steep onboarding; forces a new mental model (Observables vs callbacks) in the middle of a "preserve behaviour" refactor. | mitt for fan-out, plain `setTimeout`/`queueMicrotask` for debouncing. |
| **Jest / Vitest** | Already have `bun:test` — fastest, built-in, supports snapshots, inline snapshots, and (via fast-check) property-based assertions. Adding another runner is pure cost. | `bun:test`. Use `bun test --update-snapshots` to refresh. |
| **clinic.js, 0x, nodemon, ndb** | Node-specific; rely on V8 inspector internals that Bun uses JavaScriptCore equivalents for. Won't attach. | `bun --cpu-prof`, `bun --inspect`, `debug.bun.sh`. |
| **Sinon (for spies/mocks)** | `bun:test` has `mock()`, `spyOn()`, `jest.fn()`-compatible APIs built in. | `bun:test`'s built-in mock. |
| **Cytoscape alternative (d3-force, react-flow, vis.js)** | Scope creep. The hang is likely because cytoscape is eager-loaded, not because cytoscape itself is wrong. Fix the load pattern first (lazy import when modal opens), then measure. Replacing the graph lib is a separate decision that doesn't belong in this milestone. | Keep `cytoscape@3.33.2`. Lazy-load in `src/client/modals/global-map.ts`. Measure with DevTools Coverage tab before considering replacement. |

## Stack Patterns by Variant

**If the UI hang turns out to be cytoscape eager-load:**
- Convert `import cytoscape from 'cytoscape'` in `src/client/map-grid.ts` and `src/client/modals/global-map.ts` to dynamic `await import('cytoscape')` inside the modal-open handler.
- `Bun.build` already does `splitting: true` — dynamic imports will emit a separate chunk.
- `scripts/build-client.ts` already inserts `<link rel="modulepreload">` for eager chunks; REMOVE cytoscape from the preload markers so it loads on-demand.

**If the UI hang turns out to be initial map snapshot processing:**
- The server sends a full zone snapshot on WS connect (see `server.ts:1286` broadcast). If the client's `renderGridMap` processes all rooms synchronously, a 100-room zone = long task.
- Switch to incremental rendering: `requestIdleCallback` or batched `requestAnimationFrame` for node insertion.
- Add a `map_delta` event type (per `CONCERNS.md:136`) and invalidate snapshot cache only on `upsertRoom`/`upsertEdge`.

**If the UI hang turns out to be main.ts bootstrap work:**
- Move hotkey binding, profile loading, and zone-script panel wiring into idle callbacks (`requestIdleCallback(fn, { timeout: 200 })`).
- The factory DI split proposed in `CONCERNS.md` already gives natural deferral points.

**If migrations need more than SQL (e.g., data backfill):**
- postgres-shift supports `index.js` with access to `sql` — write a JS migration. File name convention: `00007_backfill_has_wiki_data/index.js` exports `async ({ sql }) => { await sql\`UPDATE game_items ...\` }`.
- Roll-your-own runner also trivially supports this: check extension, `sql.file(path)` for `.sql`, `import(path)` for `.js/.ts`.

**If the event bus needs cross-process coordination (scaling path, not now):**
- Bun has native `BroadcastChannel` (fully implemented per Bun docs). Later milestone work could wrap mitt in a BroadcastChannel-backed transport. Irrelevant to this milestone — single-user, single-process.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `mitt@^3.0.1` | Bun 1.x, browser, any TS version | Pure ES module, zero runtime deps. Types ship in the package. Works identically on server and in the browser bundle. |
| `postgres-shift@^0.1.0` | `postgres@^3.x` (porsager) | Designed for postgres.js; pass the existing `sql` instance. Not a separate client connection. Project uses `postgres@^3.4.7`, current upstream is 3.4.9 — compatible. |
| `fast-check@^4.7.0` | TypeScript ≥5.0, any test runner, Bun 1.x | v4.x requires TS 5.0+; project has TS 5.9.2. Framework-agnostic — `fc.assert(fc.property(...))` throws on failure, `bun:test` catches. |
| `mitata@^1.0.23` | Bun 1.x (native), Node, Deno | Dev-only. Bun-native; use `bun add mitata`. Hardware-counter extension is Linux-only (irrelevant for dev machines). |
| Bun `--cpu-prof`/`--heap-prof` | Bun 1.3+ | Flags are stable as of Bun 1.3. If the project is still on an older Bun, upgrade `oven/bun:1` in the Dockerfile — semver-compatible, no code changes needed. |
| `postgres@^3.4.9` | Bun 1.x, Node ≥12 | Already in use. Latest as of April 2026 is 3.4.9. Project has ^3.4.7 — patch bump only, no migration needed. |
| `cytoscape@^3.33.2` | Browser, ES modules | Already in use (3.33.1). Latest is 3.33.2. Keep as-is; address via lazy-loading. |

## Fit Against Constraints

| Constraint (from PROJECT.md) | How stack satisfies it |
|------------------------------|------------------------|
| Bun + TypeScript strict + Postgres (porsager) locked | All choices are either pure-ESM libs with TS types (mitt, fast-check) or extensions of the existing `sql` client (postgres-shift). Zero additions at the runtime/DB layer. |
| Factory pattern `createXxx({deps})`, no classes in domain logic | mitt's API is `const bus = mitt<Events>()` — a factory that returns a typed object. Fits exactly. Postgres-shift is a function call, not a class. fast-check is functional (`fc.assert`, `fc.property`, generators). |
| Behaviour preservation (bit-for-bit) | Snapshot tests of parser output against real MUD log fixtures lock behaviour. fast-check catches boundary cases the snapshots miss. `bun --cpu-prof` before/after reveals unintended perf regressions. |
| GitNexus `impact` + `rename` refactor workflow | All choices are library-level, not language/runtime-level — don't invalidate the graph. Adding mitt replaces `onMudText` callback registrations 1:1 (each `mudConnection.onMudText(...)` becomes `bus.on('mudText', ...)`); GitNexus will see the change as a normal rename. |
| `no-any`, no empty-catch, no server `console.log` | mitt is fully typed via the events generic. fast-check forces explicit types on generators. Profilers emit files, not logs — no `console.log` drift. |

## Critical Handoff Notes for Roadmap

1. **Event bus (mitt) should land FIRST, before extracting modules.** The new factories (`stats-parser`, `chat-parser`, `navigation-controller`, `browser-ws`) need a wiring mechanism. Introducing mitt up-front means each extracted module subscribes to `bus.on('mudText', ...)` rather than threading callbacks through `createX({onMudText})` — cleaner signature, easier to test, less churn.

2. **Migration framework should land BEFORE any schema changes.** Currently `mapStore.initialize()` grows inline. Before the first phase adds a new column (e.g., to split stats state into its own table), convert existing inline `ALTER TABLE` blocks into numbered migrations (`00001_initial.sql`, `00002_farm_zone_settings_cleanup.sql`, `00003_has_wiki_data.sql`). Then all subsequent work uses the framework.

3. **Profile the UI hang BEFORE refactoring the client.** A 15-second freeze is almost certainly ONE of three things: (a) cytoscape eager-load, (b) synchronous full-snapshot render, (c) bootstrap work in main.ts. A 10-minute Chrome DevTools Performance recording identifies which one; that determines whether client-refactor order should be `map-grid → main → wiki` (hang = rendering) or `main → map-grid → wiki` (hang = bootstrap). Don't start the client split blind.

4. **Test harness should use snapshots for the parser, fast-check for algorithms.** Priority order matching `CONCERNS.md` test-gap list: (a) snapshot `parser.ts` output against `/var/log/bylins-bot/mud-traffic.log.1` fixtures BEFORE touching it, (b) fast-check `map-layout.ts` grid algorithm when extracting it from `map-grid.ts`, (c) snapshot `container-tracker` state transitions, (d) fast-check `pathfinder.ts` BFS invariants. Fast-check isn't universal — use it where input space is open.

5. **`mitata` is optional.** Don't install it preemptively. Only reach for it if `--cpu-prof` points at a specific hot function (e.g., ANSI regex) and you need to iterate on a micro-optimization. The profile flags alone will carry 95% of the work.

## Confidence by Dimension

| Area | Confidence | Source verification |
|------|------------|---------------------|
| Event bus (mitt) | HIGH | Upstream README + GitHub (version 3.0.1 confirmed, bundle size confirmed, TS generics confirmed). Direct replacement for existing callback pattern. |
| Migration framework (postgres-shift + roll-your-own fallback) | HIGH | postgres.js README directly recommends postgres-shift, ley, pgmg. Same author as the driver. Known caveat: last release Dec 2022 — not a blocker because (a) the tool is 1 file of SQL execution logic, (b) roll-your-own in the same style is trivial if upstream stalls. node-pg-migrate driver-incompatibility verified from its README. |
| Refactor safety (bun:test snapshots + fast-check) | HIGH | bun:test snapshot API verified from official Bun docs (April 2026). fast-check 4.7.0 release confirmed from upstream, framework-agnostic behavior verified from project README. |
| Server profiling (Bun `--cpu-prof` / `--heap-prof`) | HIGH | Verified from official Bun benchmarking docs. Chrome-compatible `.cpuprofile` format. Stable in Bun 1.3+. |
| Client profiling (Chrome DevTools Performance panel) | HIGH | Industry-standard. No ambiguity. |
| `mitata` for micro-benchmarks | MEDIUM | Verified from Bun docs as the recommended microbenchmarker. "MEDIUM" because it's optional — recommending it without evidence of need would be premature. |
| cytoscape lazy-load vs replacement | MEDIUM | The hypothesis that cytoscape is the hang cause is plausible but unverified until a profile trace confirms. Stack position is "keep + lazy-load"; verdict on replacement deferred until after profiling. |

## Sources

- Bun docs (project benchmarking & profiling): https://bun.com/docs/project/benchmarking — HIGH — `--cpu-prof`, `--heap-prof`, `bun:jsc` heap stats, `MIMALLOC_SHOW_STATS`, mitata recommendation.
- Bun docs (debugging): https://bun.sh/docs/runtime/debugger — HIGH — `--inspect` / `--inspect-brk` / `debug.bun.sh`.
- Bun docs (Node compatibility): https://bun.sh/docs/runtime/nodejs-apis — HIGH — `node:inspector` Profiler support, `node:perf_hooks` status, `BroadcastChannel` fully implemented.
- Bun docs (snapshot testing): https://bun.sh/docs/test/snapshots — HIGH — `toMatchSnapshot`, `toMatchInlineSnapshot`, `--update-snapshots`, property matchers, custom serializers.
- mitt GitHub: https://github.com/developit/mitt — HIGH — v3.0.1, <200 bytes gzipped, TS generics via `mitt<Events>()`.
- eventemitter3 GitHub: https://github.com/primus/eventemitter3 — HIGH — v5.0.4 (Jan 2026).
- nanoevents GitHub: https://github.com/ai/nanoevents — HIGH — v9.1.0 (Oct 2024), 108 bytes brotli.
- postgres (porsager) GitHub + README: https://github.com/porsager/postgres — HIGH — v3.4.9 (April 2026), Bun compatibility explicit, "Migration tools" section recommends postgres-shift / ley / pgmg.
- postgres-shift GitHub: https://github.com/porsager/postgres-shift — HIGH — authored by the postgres.js maintainer, designed for postgres.js; v0.1.0 Dec 2022 (maintenance caveat noted).
- ley GitHub: https://github.com/lukeed/ley — MEDIUM — v0.8.0 Oct 2022, WIP status; works with porsager/postgres but maintenance concern.
- pgmg GitHub: https://github.com/JAForbes/pgmg — MEDIUM — OOTB postgres.js support; pending major on `next` branch (version risk).
- node-pg-migrate GitHub: https://github.com/salsita/node-pg-migrate — HIGH — v8.0.4 Dec 2025, actively maintained, BUT requires `pg` driver (disqualifying).
- Umzug GitHub: https://github.com/sequelize/umzug — HIGH — v3.8.2 Sept 2024, database-agnostic (would need custom Storage adapter).
- fast-check GitHub + docs: https://github.com/dubzzz/fast-check, https://fast-check.dev — HIGH — v4.7.0 (April 2026), framework-agnostic, TS ≥5.0.
- mitata GitHub: https://github.com/evanwashere/mitata — HIGH — v1.0.23 Dec 2024, Bun native; recommended by Bun docs.
- cytoscape GitHub: https://github.com/cytoscape/cytoscape.js — HIGH — v3.33.2 April 2026.

---
*Stack research for: Bun/TypeScript monolith refactor with Postgres (porsager) migrations, event bus, and UI hang diagnosis*
*Researched: 2026-04-18*
