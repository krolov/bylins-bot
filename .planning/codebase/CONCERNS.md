# Codebase Concerns

**Analysis Date:** 2026-04-18

## Tech Debt

**Monolithic `src/server.ts` (1867 lines):**
- Issue: Single file owns MUD text handling, chat/market extraction, navigation, stats parsing, auto-sort, WebSocket event handlers, DB persistence coordination, session bootstrap, and more. It is by far the largest server-side file and dwarfs its nearest neighbor (`client/map-grid.ts` at 1046 lines).
- Files: `src/server.ts`
- Impact: High change cost — any new feature touches this file, making merges risky, testing hard (zero tests for server module), and cognitive load enormous. `gitnexus_impact` on symbols defined here will almost always flag HIGH risk. Hot-reload takes longer and reasoning about global mutable state (`statsHp`, `statsEnergy`, `currentRoomMobs`, `pendingLootItems`, `rashodExemptKeywords`, `navigationState`, `activeProfileId`, etc.) gets harder.
- Fix approach: Extract discrete concerns into factory modules following the project's existing factory pattern: (1) `src/stats-parser.ts` (the `MAX_STATS_REGEXP`/`PROMPT_STATS_REGEXP` block around lines 643–725 plus `statsHp*`/`statsEnergy*` module-level `let`s), (2) `src/chat-parser.ts` (`CHAT_FILTER_NAMES`, `isChatLine`, `extractChatLines`, `extractMarketSales` lines 133–239), (3) `src/loot-sort.ts` (`scheduleLootSort`, `sortLootedItems`, `autoSortInventory`, `pendingLootItems` lines 551–620), (4) `src/navigation-controller.ts` (`NavigationState`, `startNavigation`, `startNavigationToNearest`, `onceRoomChanged` lines 399–1160), (5) `src/browser-ws.ts` (the WebSocket `message` handler starting around line 1600). Remaining `server.ts` should be a thin wiring file under ~400 lines.

**Monolithic `src/client/main.ts` (1029 lines):**
- Issue: Even after the documented client refactor (see `docs/client-refactor-plan.md`), `main.ts` still grew large. It contains DOM bootstrap, hotkey system, loop config persistence, zone-script wiring, reconnect logic, and default loading.
- Files: `src/client/main.ts`
- Impact: Same as server — hard to reason about, cannot test with `bun:test` because of DOM access.
- Fix approach: Extract the hotkey system (`loadHotkeys`, `saveHotkeys`, the two `keydown` handlers around lines 935–997) into `src/client/hotkeys.ts`; extract script-loop config into `src/client/zone-script-panel.ts`; keep `main.ts` as pure bootstrap.

**`src/client/map-grid.ts` (1046 lines):**
- Issue: Map rendering, grid layout algorithm, zone graph rendering, and pointer handlers all co-located.
- Files: `src/client/map-grid.ts`
- Impact: Any change to map rendering forces re-reasoning about the entire grid layout.
- Fix approach: Split into `map-layout.ts` (pure grid algorithm + tests), `map-render.ts` (DOM), `map-interactions.ts` (pointer).

**`src/wiki.ts` (955 lines):**
- Issue: HTTP client + HTML scraping + parsing logic + caching + gear-slot catalog all in one module.
- Files: `src/wiki.ts`
- Impact: Wiki format drift (external dependency) requires wading through 955 lines to locate the affected parser.
- Fix approach: Split into `wiki/client.ts` (HTTP + proxies), `wiki/parser.ts` (HTML → structured data), `wiki/slots.ts` (slot constants).

**`any` in chat-filter comment but no `as any` elsewhere:**
- Issue: The codebase enforces no-`any` via `AGENTS.md` — grep confirms zero `@ts-ignore`, `@ts-expect-error`, or `as any`. Good.
- Files: None.
- Impact: None — this is a win worth preserving. Guard against regression in future PRs.
- Fix approach: N/A (monitor).

**Ad-hoc migration-via-`ALTER TABLE IF NOT EXISTS`:**
- Issue: `mapStore.initialize()` in `src/map/store.ts` performs schema evolution inline: `ALTER TABLE game_items ADD COLUMN IF NOT EXISTS has_wiki_data ...` (lines 241, 245) and a destructive `DROP TABLE farm_zone_settings` guarded by a pre-migration check (lines 184–199). There is no migration framework, no versioning, no rollback.
- Files: `src/map/store.ts`
- Impact: As schema evolves, this function grows; order matters and there is no way to tell which migrations already ran on production. A future `DROP TABLE` executed on fresh install versus upgraded install behaves differently. Any failed `initialize()` call leaves the DB in a half-migrated state with no recovery path.
- Fix approach: Introduce a lightweight `schema_migrations` table tracking applied migration IDs; keep migrations as numbered SQL scripts in `src/map/migrations/`. Run them idempotently at startup.

**Zone route data inlined with TODO markers:**
- Issue: `src/zone-scripts/zones/286.ts:112` contains `// TODO(temp): 28633, 28632 исключены из маршрута` and `src/zone-scripts/zones/104.ts:27` contains `// ВРЕМЕННО: комнаты западнее 10418 (дом + второй этаж, 12 комнат) исключены`. Recent commit `34c6644` calls these out explicitly as "временно убраны". These rooms are commented out inside route arrays with no tracking.
- Files: `src/zone-scripts/zones/286.ts:112`, `src/zone-scripts/zones/104.ts:27-32`
- Impact: Suboptimal farming routes; missing loot; temporary workaround persists indefinitely. No issue tracker link.
- Fix approach: Investigate why each vnum is skipped (pathfinding failure? dangerous mob? missing edge in DB?), file the root cause, and either repair the map data or add an explicit `skipVnums` field to `ScriptStep` with a reason.

**Mutable module-level state in `server.ts`:**
- Issue: ~15+ module-level `let` variables maintain runtime state: `statsHp`, `statsHpMax`, `statsEnergy`, `statsEnergyMax`, `statsLevel`, `statsDsu`, `statsRazb`, `activeProfileId`, `mapRecordingEnabled`, `debugLogEnabled`, `zoneScriptSettings`, `lootSortTimer`, `survivalTickTimer`, `survivalTickRunning`, `currentRoomCorpseCount`.
- Files: `src/server.ts` (lines 252–258, 655–661, etc.)
- Impact: Contradicts the project's stated "factory pattern, no globals except server.ts top" rule — but server.ts itself accumulates so much mutable state that behavior is untestable and racy (the rule allows it, the accumulation punishes you for using the allowance).
- Fix approach: Move each cluster into its factory: stats → `createStatsTracker({ broadcastStats })`, session → `createSessionState({ onProfileChange })`, survival timer → already has a controller, just move the timer handle into it.

## Known Bugs

**Non-atomic edge conflict resolution in `mapStore.upsertEdge`:**
- Symptoms: If two parallel `upsertEdge` calls hit the same `(from_vnum, direction)` conflict simultaneously, both can read the same conflicts set and only one commits, or both delete and recreate. Result: flapping edges / lost portal flag.
- Files: `src/map/store.ts:283-322`
- Trigger: Concurrent room parsing (e.g., player teleports and parser emits events while a prior `upsertEdge` is still awaiting).
- Workaround: Single-writer assumption — server processes MUD text sequentially. Verify nothing calls `upsertEdge` concurrently (e.g., no `Promise.all([upsertEdge, upsertEdge])`).

**`console.log` leaks in server code:**
- Symptoms: Server-code style rule in `AGENTS.md:317` says "No `console.log` / `console.error` anywhere in server code." Grep finds 10 `console.*` calls in `server.ts` and 4 in `client/map-grid.ts`.
- Files: `src/server.ts` (10 occurrences), `src/client/map-grid.ts` (4 occurrences — less severe since client is allowed browser logging)
- Trigger: Startup (`console.log` at server.ts line 1863), possibly error paths.
- Workaround: Replace with `logEvent(null, "session", ...)` per project rule.

**Unhandled empty-catch in `readLastProfileId`/`saveLastProfileId`:**
- Symptoms: `server.ts:38-51` catches all errors silently. If the profile file is corrupt or disk is full, the user sees no warning — the app just reverts to default profile on every start.
- Files: `src/server.ts:38-51`
- Trigger: Disk full, permission denied on `/var/log/bylins-bot/last-profile.txt`.
- Workaround: Log via `logEvent(null, "error", ...)` instead of empty `catch {}`. Violates `AGENTS.md:313` "Never use empty catch blocks."

**Auto-reconnect backoff can grow unbounded attempt counter:**
- Symptoms: `src/mud-connection.ts:307-317` uses `session.reconnectAttempt += 1` with `RECONNECT_DELAYS_MS[attempt] ?? RECONNECT_RETRY_INTERVAL_MS`. If the MUD stays down for hours, `reconnectAttempt` keeps growing beyond array length. The `?? RECONNECT_RETRY_INTERVAL_MS` fallback works, but the counter is never reset on prolonged failure (only on success at line 385).
- Files: `src/mud-connection.ts:307-317, 385`
- Trigger: Extended MUD outage followed by user-triggered teardown.
- Workaround: Cap the counter at `RECONNECT_DELAYS_MS.length` to avoid integer overflow semantics.

**`statsRazb` initialized to 5 with no parser:**
- Symptoms: `src/server.ts:661` sets `let statsRazb = 5;` and a chat command `"дсу"` prints it (line 929), but there is no regex updating `statsRazb` from MUD output — it's a constant masquerading as parsed state.
- Files: `src/server.ts:661, 929`
- Trigger: Any user typing `дсу` gets a hardcoded "Разбег: 5" value.
- Workaround: Parse `Разбег:` from score output or remove the unused variable and the message.

**`rashodExemptKeywords` race window:**
- Symptoms: `server.ts:347-349` adds a gather-pickup keyword to a Set, then schedules deletion after 10_000ms. If the pickup is looted just after the timer fires, the keyword is treated as non-exempt and auto-sorted to "base"/"hlam" incorrectly.
- Files: `src/server.ts:346-350, 105`
- Trigger: Network latency or slow MUD.
- Workaround: Use a timestamped map and check "exempt until X" in `PICKUP_FROM_GROUND_RE` handler rather than relying on setTimeout deletion.

## Security Considerations

**CRITICAL: MUD account password committed to source:**
- Risk: The string `"respect1"` appears in `src/profiles.ts`, `src/startup-script.ts`, `ecosystem.config.cjs`, and `.env.example` as the third element of `startupCommands` — which is the password sent after character-name login. This is almost certainly the actual production MUD password for three characters (`воинмир`, `алруг`, `ринли`).
- Files: `src/profiles.ts:22,29,37`, `src/startup-script.ts:13`, `ecosystem.config.cjs:22`, `.env.example:13`
- Current mitigation: None. `.gitignore` excludes `.env`, but the password is hardcoded in non-ignored TypeScript and the PM2 ecosystem file.
- Recommendations: (1) Rotate the MUD password immediately, (2) Move passwords to `.env` only (e.g., `MUD_PASSWORD_VOINMIR`, `MUD_PASSWORD_ALRUG`, `MUD_PASSWORD_RINLI`), (3) `CharacterProfile.startupCommands` should accept a password placeholder resolved at runtime from env, (4) Audit git history for the leaked password and consider git-filter-repo if the repo is public. The game repo is explicitly listed at `https://github.com/bylins/mud` — assume the deployment is a public target.

**Telegram bot token read from env, but logged on startup:**
- Risk: `runtimeConfig.telegramBotToken` is injected into `createBazaarNotifier` at `server.ts:529`. While not logged directly, any error thrown from `fetch` in `bazaar-notifier.ts:72-80` that echoes the request URL would include the token in the path (`/bot${token}/sendMessage`).
- Files: `src/bazaar-notifier.ts:71-80`
- Current mitigation: Token is read from env only and not logged intentionally.
- Recommendations: Ensure all error handling for Telegram calls strips URL before logging. Add a `try/catch` around `fetch` that formats errors as `"Telegram API error: ${status}"` without the URL.

**No rate limiting / auth on the browser WebSocket:**
- Risk: The Bun server accepts any WebSocket connection at `/ws` and trusts it to send commands (`type: "send"`) which are forwarded raw to the MUD TCP socket.
- Files: `src/server.ts` (WS handler ~line 1600), deploy config relies on Caddy Basic Auth.
- Current mitigation: Caddy reverse proxy enforces HTTP Basic Auth (`BASIC_AUTH_PASSWORD_HASH` in `ecosystem.config.cjs:28`). Local-network exposure on `0.0.0.0:3211` is unprotected.
- Recommendations: Bind server to `127.0.0.1` by default (currently `HOST=0.0.0.0`). Add a server-side token check for WS upgrade when `NODE_ENV=production`. Never run without Caddy in front.

**Placeholder Basic Auth hash shipped in repo:**
- Risk: `ecosystem.config.cjs:28` has `BASIC_AUTH_PASSWORD_HASH: "$2a$14$replace_me_with_a_real_hash"`. If a developer runs PM2 using this file verbatim, Caddy will reject all auth (harmless) — but the fact that real credentials could be committed here is concerning.
- Files: `ecosystem.config.cjs:28`
- Current mitigation: Placeholder string.
- Recommendations: Make `ecosystem.config.cjs` read from `.env` via `require("dotenv").config()` at the top and reference `process.env.BASIC_AUTH_PASSWORD_HASH`. Document this in README.

**PostgreSQL credentials in default value:**
- Risk: `scripts/debug-zone-map.ts:8`, `scripts/wiki-mcp.ts:11`, and `scripts/tsp-route.ts:70` all contain the literal fallback `"postgres://bylins:bylins@localhost:5432/bylins_bot"`. `ecosystem.config.cjs:25` also uses it.
- Files: `scripts/debug-zone-map.ts:8`, `scripts/wiki-mcp.ts:11`, `scripts/tsp-route.ts:70`, `ecosystem.config.cjs:25`
- Current mitigation: Postgres listens on localhost only.
- Recommendations: Remove defaults; fail fast if `DATABASE_URL` is missing (matches behavior in `src/config.ts:109-111`).

**Text from MUD passed to regex without length cap:**
- Risk: The MUD can send arbitrarily long chunks. `persistParsedMapData` and related handlers run many regexes on the whole chunk (e.g., `LOOT_FROM_CORPSE_RE.exec` loop in `server.ts:87-96`). No chunk size limit — a malicious or malfunctioning MUD could ReDoS the bot.
- Files: `src/server.ts:87-108, 199-239`
- Current mitigation: Regexes are mostly non-catastrophic, but `BAZAAR_SALE_RE`, `PROMPT_STATS_REGEXP` have backtracking potential on adversarial input.
- Recommendations: Truncate incoming chunks at e.g. 64 KB; audit regexes for catastrophic backtracking.

## Performance Bottlenecks

**Full map snapshot broadcast on every room change:**
- Problem: `persistParsedMapData` at `server.ts:1286` calls `broadcastMapSnapshot("map_update")` which runs `mapStore.getZoneSnapshot(currentVnum)` — two full SELECTs on `map_rooms`/`map_edges` filtered by zone range (100 rooms max). Then serializes to JSON and broadcasts to all browser clients.
- Files: `src/server.ts:1286`, `src/map/store.ts:363-411`
- Cause: No incremental update protocol — the client always receives the full zone. On farm runs with 2-second ticks, this executes 30x/minute.
- Improvement path: (1) Cache the snapshot and invalidate only on `upsertRoom`/`upsertEdge` for the affected zone. (2) Add a `map_delta` event type with just the changed rooms/edges. (3) Debounce broadcasts to 200ms.

**Sequential DB writes in parser pipeline:**
- Problem: `persistParsedMapData` loop at `server.ts:1277-1283` awaits `upsertRoom` then `upsertEdge` in order, blocking the MUD text handler for 1–5ms per edge. In rooms with 4 exits this adds latency to the next read.
- Files: `src/server.ts:1277-1283`
- Cause: `await` inside `for..of` instead of parallel. AGENTS.md:354 explicitly calls this out as an anti-pattern: "Never `await` inside a loop when parallel execution is possible — use `Promise.all`."
- Improvement path: Replace with `await Promise.all(rooms.map(r => mapStore.upsertRoom(...)))` and the same for edges. Note: the sequential write is currently safer against the `upsertEdge` conflict race (see Known Bugs) — fix that first.

**`autoSortInventory` blocks on `"инв"` round-trip:**
- Problem: Every kill with loot triggers `autoSortInventory()` which sends `инв`, waits 3s for `Вы несете:` response, then issues one `пол ${kw} ${target}` per item serially. For 10 items this is up to 4 seconds of blocking the farm loop, during which the character is idle in a hostile zone.
- Files: `src/server.ts:551-563, 566-608`
- Cause: Synchronous inventory inspection in the hot loot path.
- Improvement path: Maintain the inventory list in `containerTracker` (which already handles `feedPendingInspect`) so that `autoSortInventory` can dispatch `пол` commands immediately without a round-trip. Only send `инв` when stale.

**`extractMobsFromRaw` runs a global regex across every received chunk:**
- Problem: `src/map/parser.ts:146-165` calls `MOB_ANSI_BLOCK_REGEXP.exec` in a loop over the raw buffer on every received MUD packet. For text-heavy rooms the regex scans hundreds of bytes looking for ANSI codes.
- Files: `src/map/parser.ts:146-185`
- Cause: No early-out when no ANSI escape is present. The `PROMPT_MANA_ANSI_REGEXP` replacement is also unconditional.
- Improvement path: Early-return if `rawText.indexOf("\u001b[1;31m") === -1 && rawText.indexOf("\u001b[1;33m") === -1`.

**Client-side `renderGridMap` / `renderZoneMap`:**
- Problem: Per `docs/client-refactor-plan.md`, the original `client.ts` was 5525 lines and the map rendering was a known performance bottleneck. After refactor, `map-grid.ts` is 1046 lines — presumed improved but rendering still redraws all nodes on any snapshot.
- Files: `src/client/map-grid.ts`
- Cause: No DOM diff / virtualization.
- Improvement path: Use Cytoscape's `json()` patch API (already a dependency, see `package.json:7`) or limit redraw to changed vnums.

## Fragile Areas

**MUD text parser relies on ANSI color codes to identify mobs:**
- Files: `src/map/parser.ts:11-13, 146-165`
- Why fragile: Mobs are detected by `\u001b[1;31m...\u001b[0m` (red) and items/corpses by `\u001b[1;33m...\u001b[0m` (yellow). If the MUD admins change the palette, or a user disables color, mob detection silently returns no targets — farming stops working with no error.
- Safe modification: Always run `src/map/parser.test.ts` after changes; add integration test with sample logs from `/var/log/bylins-bot/mud-traffic.log.1`.
- Test coverage: `parser.test.ts` exists but only 254 lines of tests for 281 lines of parser — edge cases (multi-line mob blocks, interleaved items) may be uncovered.

**Regex-heavy Russian MUD text matching:**
- Files: `src/triggers.ts` (~20 regexes), `src/survival-script.ts:5-10`, `src/server.ts:644-648, 178-186`, `src/bazaar-notifier.ts:1-14`, `src/zone-scripts/farm-zone-executor2.ts:51-54`
- Why fragile: Russian game-text phrases are hardcoded. MUD developers shipping a typo-fix or rewording breaks dodge-triggers, survival-controller, bazaar notification, and all combat detection.
- Safe modification: Maintain a `docs/mud-phrases.md` index that lists every hardcoded phrase by file and purpose. Update when MUD updates.
- Test coverage: Zero tests for regex phrases. Consider capturing real MUD logs as fixtures.

**`containerTracker` implicit state machine:**
- Files: `src/container-tracker.ts`
- Why fragile: Tracks inventory, equipped items, container contents, and pending inspect results across multiple MUD message types. `server.ts:60-63` dispatches every raw text chunk through four separate feed methods. Timing between `startEquippedScan()` and arriving `equipment` output must line up; race windows are not enforced.
- Safe modification: Add unit tests with sample equipment and inventory texts. Validate that `waitForInspectResult` times out cleanly.
- Test coverage: None detected (no `container-tracker.test.ts`).

**`farm2` combat detection depends on prompt parsing:**
- Files: `src/farm2/`, `src/combat-state.ts`
- Why fragile: `CHARMIE_INJURED_PATTERN` at `zone-scripts/farm-zone-executor2.ts:64` and prompt-mob-block regexes at `src/server.ts:647` rely on exact prompt format: `50H 86M 1421o Зауч:0 ОЗ:0 2L 5G Вых:СВЮЗ>`. If a user rearranges their prompt in-game, stats and combat detection break.
- Safe modification: Document the required prompt format in AGENTS.md (not currently). Add a startup check that verifies the prompt format after first `score`.
- Test coverage: None for prompt parsing.

**Edge conflict resolution assumes single-writer:**
- Files: `src/map/store.ts:283-322`
- Why fragile: See Known Bugs. The SELECT-then-DELETE-then-INSERT pattern is not atomic across concurrent calls. Current serial usage is safe, but refactoring to parallel writes will introduce data corruption.
- Safe modification: Before parallelizing DB writes, wrap the conflict path in a transaction or use a single INSERT with a deferred constraint check.
- Test coverage: None (no `store.test.ts`).

**TSP route optimization script (`scripts/tsp-route.ts`):**
- Files: `scripts/tsp-route.ts` (245 lines)
- Why fragile: Standalone script generates optimized route orderings for zone-scripts but is not integrated. Manual workflow — developer runs it, copies output into a `zones/*.ts` file.
- Safe modification: Consider wiring its output into a DB-stored route to avoid hand-edits that generate the TODO(temp) workarounds already present.

## Scaling Limits

**Single MUD session per server instance:**
- Current capacity: 1 active MUD connection. `mudConnection` singleton created at `server.ts:55` — no multi-character support.
- Limit: One character online at a time. Profile switching requires reconnect.
- Scaling path: Make `mudConnection` keyed by `profileId`; allow multiple concurrent sessions. Likely a large refactor touching `sharedSession` references in server.ts.

**All map data in a single Postgres instance:**
- Current capacity: Unbounded rooms/edges but single-DB. `map_rooms`, `map_edges`, `game_items`, `market_sales` all grow unboundedly.
- Limit: Disk + query performance. Indices exist on `market_sales` but `map_rooms`/`map_edges` rely on primary keys. As the map grows, `getSnapshot(currentVnum)` with no zone filter returns ALL rooms.
- Scaling path: `getSnapshot` at `src/map/store.ts:324-361` should filter by zone by default. `getZoneSnapshot` already exists — deprecate the unfiltered version or rename to `getAllRooms()`.

**In-memory chat/output buffers:**
- Current capacity: `recentOutputChunks` capped at `MAX_OUTPUT_CHUNKS = 200`. Chat messages live in `chat_messages` table with no retention policy.
- Limit: `chat_messages` grows forever. After a year of 24/7 running, table could be multi-million rows.
- Scaling path: Add `DELETE FROM chat_messages WHERE created_at < NOW() - INTERVAL '30 days'` cron.

**Log files written synchronously:**
- Current capacity: `appendFileSync` in `server.ts:865-871`.
- Limit: High-throughput log events block the event loop. During a combat burst with 50 mud-in events/sec, sync fs writes become a bottleneck.
- Scaling path: Switch to `createWriteStream` with a buffered writable, or batch via `setImmediate`.

## Dependencies at Risk

**`@ladybugdb/core`:**
- Risk: Listed in `devDependencies` at `package.json:22` with no apparent usage in `src/` (grep returns nothing). Might be dead weight or used transitively by a missing feature.
- Impact: Minor — dev-only.
- Migration plan: Remove if unused; check if it was intended for future use.

**`cytoscape` v3.33.1 in browser:**
- Risk: Heavy graph library (~500 KB). Imported in client code for map rendering.
- Impact: Startup time — user has complained about slow client start (`docs/client-refactor-plan.md`).
- Migration plan: Lazy-load cytoscape only when the global-map modal opens. Consider a lighter alternative (e.g., d3-force) for the zone graph.

**`postgres` v3.4.7:**
- Risk: Well-maintained but major version changes between releases.
- Impact: DB client changes.
- Migration plan: Pin to minor range in `package.json`; test upgrades in CI before deploy.

**`gitnexus` devDependency drives CLAUDE.md workflow:**
- Risk: If `gitnexus` changes its CLI or MCP interface, the entire Claude-Code automation workflow described in `CLAUDE.md` breaks silently.
- Impact: Developer velocity.
- Migration plan: Pin version; add a smoke test that runs `npx gitnexus status` in CI.

## Missing Critical Features

**No migration framework:**
- Problem: Schema changes live inline in `mapStore.initialize()` as `IF NOT EXISTS` guards.
- Blocks: Rollbacks; tracking which migrations ran; multi-instance deployments.

**No linter/formatter:**
- Problem: `AGENTS.md:62` explicitly states "No linter or formatter is configured."
- Blocks: Consistent style enforcement. Relies on reviewer vigilance — works for a one-developer project, fragile if contributors grow.

**No CI pipeline:**
- Problem: No `.github/workflows/`, no CI config detected.
- Blocks: Automated testing on PRs; catching `bun test` failures before merge. `gitnexus analyze` freshness also relies on a local hook rather than a CI job.

**No monitoring / alerting on bot liveness:**
- Problem: `pm2` auto-restarts on crash, but there is no external healthcheck beyond `pm2 show bylins-bot`. No alerts when the MUD disconnects and cannot reconnect.
- Blocks: Early detection of outages. A farm loop stuck in `recalling` phase for 10 minutes won't notify anyone.

**No structured logging / log rotation within app:**
- Problem: Log rotation is handled by external `logrotate`. Log format is line-based text, hard to query.
- Blocks: Querying for specific sessions / error rates without grep.

## Test Coverage Gaps

**`src/server.ts` (1867 lines) — 0 tests:**
- What's not tested: Everything. MUD text parsing pipeline, chat extraction, market sale parsing, stats parsing, inventory auto-sort, navigation state machine, loot sort, WebSocket event routing.
- Files: `src/server.ts`
- Risk: Any regression in chat filters, stats regex, or auto-sort could silently break production without a test failure.
- Priority: High — critical production path.

**`src/map/store.ts` (785 lines) — 0 tests:**
- What's not tested: All DB interactions, edge conflict resolution, snapshot queries.
- Files: `src/map/store.ts`
- Risk: The `upsertEdge` conflict race (Known Bugs) could reach production without detection.
- Priority: High — data integrity.

**`src/triggers.ts` (477 lines) — 0 tests:**
- What's not tested: Dodge, stand-up, rearm, curse, light-management, follow-leader, auto-assist triggers — each with Russian regex against real MUD text.
- Files: `src/triggers.ts`
- Risk: Silent trigger failure during combat = character death.
- Priority: High — safety-critical.

**`src/farm2/` (all files) — 0 tests:**
- What's not tested: Controller state machine, tick scheduling, session closed handling, combat flee logic.
- Files: `src/farm2/controller.ts`, `src/farm2/tick.ts`, `src/farm2/mud-handler.ts`, etc.
- Risk: Farm script hangs / loops forever / doesn't flee in danger.
- Priority: Critical — this is the reason the bot exists.

**`src/zone-scripts/farm-zone-executor2.ts` (569 lines) — 0 tests:**
- What's not tested: Route advancement, combat detection in zones, low-HP recall, miss-skip logic, loot subscription.
- Files: `src/zone-scripts/farm-zone-executor2.ts`
- Risk: Character stuck in a zone; fails to recall on low HP; wrong mob targeted.
- Priority: Critical.

**`src/mud-connection.ts` (492 lines) — 0 tests:**
- What's not tested: Telnet state machine, session teardown, reconnect backoff, keepalive timer.
- Files: `src/mud-connection.ts`
- Risk: Bot fails to reconnect after outage; telnet negotiation corruption crashes parsing.
- Priority: High — uptime-critical.

**`src/survival-script.ts` (184 lines) — 0 tests:**
- What's not tested: Hunger/thirst state transitions, cooldown logic, `parseInspectItems`, `parseInventoryItems`.
- Files: `src/survival-script.ts`
- Risk: Character starves or dehydrates during farming.
- Priority: Medium — visible failure mode.

**`src/wiki.ts` (955 lines) — 0 tests:**
- What's not tested: HTML parsing, gear item extraction, search results.
- Files: `src/wiki.ts`
- Risk: Wiki format drift silently breaks gear advisor.
- Priority: Medium.

**`src/container-tracker.ts` (166 lines) — 0 tests:**
- What's not tested: All pending-result races.
- Files: `src/container-tracker.ts`
- Risk: Auto-sort, equipment scan, or inventory display silently fails.
- Priority: Medium.

**Only `src/map/parser.ts` and `src/map/tracker.ts` have tests:**
- What IS tested: Parser events, tracker movement inference (two test files, ~428 lines of tests).
- Files: `src/map/parser.test.ts`, `src/map/tracker.test.ts`
- Assessment: Good coverage on these modules; serves as a template for expanding test suite.

---

*Concerns audit: 2026-04-18*
