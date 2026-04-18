# Pitfalls Research

**Domain:** Brownfield Bun/TypeScript refactor — monolithic server with zero tests, autonomous MUD bot where silent regressions cause in-game character death
**Researched:** 2026-04-18
**Confidence:** HIGH (grounded in actual `src/server.ts` / `src/mud-connection.ts` / `src/map/store.ts` code, CONCERNS.md findings, and well-established refactor patterns)

## Critical Pitfalls

### Pitfall 1: Losing `Set<Handler>` subscription semantics when replacing callback chain with an event bus

**What goes wrong:**
The current `server.ts:419 mudTextHandlers = new Set<(text) => void>()` pattern has exact-once delivery, synchronous iteration order (insertion order), and immediate `.delete(handler)` removal that guarantees the very next `text` chunk does NOT reach the removed handler. Naively introducing a bus (`bus.on("mud:text", fn)`) easily changes one of those four semantics: async delivery (microtask-deferred), out-of-order listeners after re-subscribe, double-fire during a cut-over window where both the old `Set` path AND the new bus are wired up, or the reverse — lost first event between bus construction and first `.on()` call.

The farm loop at `farm2/` and triggers at `triggers.ts` depend on the FIRST regex match of a given prompt line. If the new bus fans out in a different order, a dodge-trigger may fire AFTER `autoSortInventory` consumes the same chunk — the character gets hit, the bot sorts loot, then dodges. Silent. No error. No test will catch it because there are no tests.

Additionally: the existing `Set` pattern has self-removing handlers (`server.ts:428, 436, 574, 584` remove themselves inside the callback). A bus that uses an internal iteration over an Array/Set mid-dispatch may skip or re-deliver to a handler that removed itself.

**Why it happens:**
Event-bus patterns are presented as pure decoupling wins. In a synchronous, ordered, regex-racing codebase, subscription *order* and *synchronicity* ARE the contract — not the delivery mechanism.

**How to avoid:**
1. **Pin the contract before implementation**: write a one-page spec `docs/event-bus-contract.md` that enumerates: sync-or-async delivery, listener order, self-removal-during-dispatch semantics, re-entrancy (handler emits another event), error isolation (one handler throws — do others still fire?).
2. **Snapshot listeners at dispatch time**: `for (const h of [...listeners]) { try { h(text) } catch(e) { logEvent(...) } }` — copy-then-iterate so self-removal is safe; try/catch so one bad handler does not break the farm loop.
3. **Keep synchronous delivery**. Do NOT introduce `queueMicrotask` / `setImmediate` "for ergonomics". The MUD text pipeline is ordered and the current mental model is "each chunk is processed top-to-bottom by every listener before the next chunk arrives".
4. **Cut-over with a shim, not a fork**: keep `mudTextHandlers` as-is; make `bus.on("mud:text", fn)` a thin wrapper that calls `mudTextHandlers.add(fn)`. Do NOT wire both the old and new paths simultaneously — that is the classic double-fire bug (triggers fire twice, bot spams `dodge`, gets insta-banned for input flood).
5. **Golden-log regression test**: before bus, capture `/var/log/bylins-bot/mud-traffic.log.1` for 30 minutes of farming, record every `sendCommand` the bot emits. After bus, replay the same MUD-text chunks through the new bus-wired `handleMudText`, diff the emitted command sequence. Zero diff = behavior preserved.

**Warning signs:**
- During refactor: any commit that adds the new bus WITHOUT removing the old `mudTextHandlers.add()` in the same commit → double-fire risk.
- Post-refactor: bot sends `dodge` twice in a row for a single attack; bazaar notifications arrive in duplicate; `combatState` flips `inCombat → notInCombat` mid-fight.
- In tests: a handler that calls `unregister()` inside itself causes "cannot iterate modified Set" errors.

**Phase to address:**
PRE-extract — contract spec + golden-log capture must exist BEFORE any bus is introduced. The bus itself lands in a dedicated phase AFTER the first controller extraction proves the log-replay test works.

---

### Pitfall 2: Silent closure-captured state leak when extracting module-level `let` variables into a factory

**What goes wrong:**
`server.ts` has ~15 module-level `let`s (`statsHp`, `activeProfileId`, `currentRoomCorpseCount`, `lootSortTimer`, `mapRecordingEnabled`, etc. — CONCERNS.md line 50). A closure somewhere else in the 1867-line file may *read* one of these via lexical scope without naming it in its parameter list — moving the `let` into `createStatsTracker({...})` breaks that read silently.

TypeScript strict mode catches **undefined identifier** errors at compile time (the extracted file has no `statsHp` in scope and `bun run build` fails). But TypeScript does NOT catch the symmetric bug: when you extract a function that still references the module-level `let`, and you forget to also move the consumer that sets it. Now the extracted function sees a *stale snapshot* of the value from the last module-load time, while the setter is writing into a new location — the old module binding is still live because other consumers still import it.

A subtler case: `server.ts:347 setTimeout(() => rashodExemptKeywords.delete(keyword), 10_000)` — if the Set moves into a factory but the `setTimeout` callback still closes over the module-scope `rashodExemptKeywords` symbol (because the arrow function was not moved), you get a dangling timer writing to a dead reference. No error. The loot sorter just stops exempting gather items and sorts them to `hlam`. Discovered in-game when the farming character's herb pouch is suddenly in the trash container.

**Why it happens:**
`gitnexus_impact` reports direct callers, not lexical-scope readers. The graph encodes explicit references but not "this identifier is resolved via module scope in a closure two files away".

**How to avoid:**
1. **Extract in a specific order**: state → getters/setters → consumers. Never extract a consumer before its state.
2. **Use `grep -n 'statsHp\b'`** (word-boundary) in `src/server.ts` before extracting `statsHp` — enumerate ALL references, not just the obvious function bodies. Check arrow-function callbacks inside `setTimeout`/`setInterval`/`Promise.then`.
3. **Temporary re-export bridge**: when extracting `statsHp` to `stats-parser.ts`, have `server.ts` re-export `export const getStatsHp = () => statsTracker.getHp()` so any missed closure that reads `statsHp` becomes a compile error pointing at the exact line. Remove the bridge in a follow-up commit once the file compiles clean.
4. **`gitnexus_context({name: "statsHp"})`** before moving to see ALL participating processes, not just direct callers. If the symbol appears in 3 processes, all 3 must be exercised end-to-end after the move.
5. **"Move then inline" two-step**: first move the `let` to the new file as a `let` (not inside a factory), verify server still compiles and runs. Then wrap it in `createStatsTracker()`. This avoids doing two scary things at once.

**Warning signs:**
- `bun run build` passes but `bun test` passes fewer tests than before (stateful tests depend on the stale module binding).
- Farm loop runs normally for 5 minutes then silently stops reacting to low-HP (the `statsHp` value the low-HP check reads is frozen at the last pre-extract value).
- Chat command `дсу` prints the wrong number — the command reads the old module binding while parser writes the new one.
- `grep -rn 'statsHp' src/` finds references in files you didn't expect (e.g. `client/` — shouldn't be there — suggests a leaky abstraction you need to fix first).

**Phase to address:**
PRE-extract safety harness phase. Catalog every `let` in `server.ts` with its read sites *before* extracting any of them.

---

### Pitfall 3: Timing-dependent `setTimeout` handles becoming orphaned during controller extraction

**What goes wrong:**
The code has several `setTimeout` + explicit handle idioms: `lootSortTimer`, `survivalTickTimer`, `survivalTickRunning` bool, `setTimeout(() => rashodExemptKeywords.delete(...), 10_000)`. When the owning state moves to a factory, the timer handle might be left behind in the old module — or created in the new factory but *cleared* by code still in the old module. Cleanup on `sessionTeardownHooks` or `onSessionClosed` then does not actually clear the timer → zombie callback fires 10 seconds after logout, attempts to call `deletedLootSorter.dispatch(...)`, crashes silently (or worse, re-connects and sends a stale command to the NEW session).

Worse: during a zone script where `survivalTickRunning = true` gates re-entry, a partial extraction where `survivalTickRunning` is set in the new factory but read in the old module leads to **concurrent** tick execution → survival script sends `есть хлеб` twice in a row → "Вы не голодны" response confuses the state machine → farm halts.

**Why it happens:**
Timers are invisible to the static call graph. `gitnexus_impact` sees `clearTimeout(survivalTickTimer)` as a reference, but the `setTimeout(() => ..., delay)` scheduled callback is an anonymous closure invisible to most graph tools.

**How to avoid:**
1. **Inventory every timer in `server.ts`** before extraction: `grep -n 'setTimeout\|setInterval\|clearTimeout\|clearInterval' src/server.ts`. For each one, annotate: who schedules, who clears, what state the callback reads.
2. **Single-owner invariant**: the factory that owns a state variable must also own its timer. If `createSurvivalController` owns `survivalTickRunning`, it must also `setTimeout` and `clearTimeout`. Never split.
3. **Use the project's `createTickTimer()`** (`src/utils/timer.ts`, referenced in TESTING.md line 236) — it already dependency-injects the timer, which makes cleanup explicit in the factory API.
4. **Lifecycle teardown contract**: every factory that schedules a timer MUST expose `shutdown()` and be added to `sessionTeardownHooks`. Grep after extraction: `grep -n 'sessionTeardownHooks.add' src/server.ts` — count must equal the number of factories with timers.
5. **Test with rapid profile switching**: after extraction, switch profiles 5x in 10 seconds. If ANY timer fires after the switch and logs to the old profile's log file, the cleanup is broken.

**Warning signs:**
- Log file contains events after the "session closed" line.
- `rashodExemptKeywords` set grows across profile switches (not cleared).
- `survivalTickRunning` latches `true` and survival stops working until restart.
- Hot-reload (`bun --watch`) leaks memory — each reload adds orphan timers.

**Phase to address:**
During controller extraction — each extraction PR includes a teardown test. Also audit phase immediately after all extractions complete.

---

### Pitfall 4: Subtle regex behavior changes when relocating stateful parsers (Russian MUD text)

**What goes wrong:**
`src/map/parser.ts`, `src/triggers.ts`, `src/survival-script.ts`, `src/server.ts:644-648`, and `src/bazaar-notifier.ts` contain 30+ regexes matching Russian MUD text wrapped in ANSI color codes. When you move a regex from `server.ts` to `stats-parser.ts`, trivial-looking changes introduce bugs:

1. **Regex literal flags drift**: the source had `/.../gm` (global+multiline). When you re-type the regex in the new file (instead of cut-paste), you write `/.../g` — `^`/`$` now match full-string, not per-line. The stats parser silently misses 2-line prompts.
2. **RegExp state in global regexes**: `const MOB_ANSI_BLOCK_REGEXP = /.../g` + `.exec(text)` in a loop relies on `regex.lastIndex` persisting across calls. If the extracted module instantiates a fresh regex per call (because you wrapped it in `createParser()` without thinking), the state resets and `extractMobsFromRaw` returns different results on the second call than before.
3. **Cyrillic character class corruption**: copy-pasting across editors with different encodings can silently substitute `е` (Cyrillic U+0435) with `e` (Latin U+0065). The regex `/Вы устали/` now matches nothing because the MUD actually sends Cyrillic `е`. Invisible in a diff.
4. **ANSI prefix stripping moves with parser but color codes change**: `parser.ts:11-13` uses `\u001b[1;31m...\u001b[0m` for mob detection (CONCERNS.md line 166). Moving ANSI handling into a utility changes normalization order — parser now receives pre-stripped text and its mob regex fails because the color code is gone.
5. **Non-greedy `.*?` vs greedy `.*`**: auto-reformatting on paste sometimes deletes the `?`. Mob-block regex becomes greedy and consumes to end-of-text.

**Why it happens:**
Regexes are strings; static-analysis tools don't understand them; there are no tests for most of them (CONCERNS.md line 175: "Zero tests for regex phrases").

**How to avoid:**
1. **Capture a behavioral snapshot before extraction**: write `scripts/parser-snapshot.ts` that feeds 10 MB of `/var/log/bylins-bot/mud-traffic.log.1` through every parser module and dumps the emitted events as JSON lines to `snapshots/before.jsonl`. After extraction, run again → `snapshots/after.jsonl`. `diff` must be empty.
2. **NEVER re-type a regex**. Always cut-paste exactly. If you type it, you changed it.
3. **Never change the `g`/`m`/`i`/`s`/`u`/`y` flag set during a refactor**. If you think the flag set is wrong, that is a **behavior change** and belongs in a separate PR with its own snapshot diff.
4. **Preserve regex singletons**: a `const PATTERN = /.../g` is module-scope-stateful. If the factory-wrap puts it inside `createXxx()`, it becomes per-instance. KEEP it module-scope-stateful by exporting it from the file and constructing it once.
5. **Encoding check**: run `file -I src/**/*.ts | grep -v utf-8` after extraction. Everything must be UTF-8.
6. **Fix before touching**: per CONCERNS.md line 176, create `docs/mud-phrases.md` FIRST listing every regex, then extract with a checklist of "this regex preserved exactly".

**Warning signs:**
- `bun test src/map/parser.test.ts` passes but the bot behaves differently in production.
- Some mobs become "invisible" (regex no longer matches their ANSI block).
- Snapshot diff shows event order change even though no logic changed — indicates regex state or ordering change.
- Trigger regex for `"Вы потеряли сознание"` silently stops matching — Cyrillic substitution.

**Phase to address:**
PRE-extract snapshot harness phase (same phase as event-bus golden-log capture). Must be in place before `src/map/parser.ts` or `src/triggers.ts` are touched.

---

### Pitfall 5: `schema_migrations` bootstrap on a live DB — assuming "fresh install" when production is "half-migrated"

**What goes wrong:**
Production Postgres has been running with `ALTER TABLE IF NOT EXISTS` since day one. When you introduce a proper `schema_migrations` table and number existing migrations 0001..000N, you hit this decision: does the bootstrap run the numbered migrations on the production DB, or does it "seed" `schema_migrations` with rows `(0001, applied), (0002, applied), ..., (000N, applied)` and only run NEW migrations?

Wrong answers, all of them dangerous:

1. **Run 0001 on production**: `CREATE TABLE IF NOT EXISTS map_rooms (...)` — fine. But `DROP TABLE farm_zone_settings` (store.ts:196, already in prod) — now the existing prod `farm_zone_settings` gets dropped because the guard condition re-triggers. Actual data loss.
2. **Seed all migrations as applied**: safe if the on-disk schema matches the current prod schema. But production has `has_wiki_data` / `has_game_data` columns added by the inline `ALTER TABLE` (`store.ts:241, 245`). If a developer forgets those in the numbered migrations, new prod rows get default `FALSE` and re-scan triggers for items that already have wiki data.
3. **Hybrid**: "apply only migrations newer than X" — but there is no `X` on production because nothing ever recorded which inline `ALTER`s ran.
4. **Migration ID conflicts when two branches in flight**: dev A creates `0007_add_column_x.sql`, dev B creates `0007_add_column_y.sql`, both merge — on deploy, one of them silently doesn't run (whichever the migration runner encounters second and sees `0007` in `schema_migrations`).
5. **Failed migration leaves DB half-applied**: framework runs `0008`, it errors mid-way, `schema_migrations` isn't updated → next deploy re-runs `0008`, but some changes already applied → `CREATE INDEX` fails because index exists.

**Why it happens:**
Migration frameworks are designed for greenfield projects. Brownfield adoption requires explicit "baseline" reconciliation that most tutorials skip.

**How to avoid:**
1. **Baseline migration ONLY**: migration `0001_baseline.sql` is the **exact current production schema** (dumped via `pg_dump --schema-only --no-owner --no-privileges bylins_bot > 0001_baseline.sql`, then manually reviewed). All future migrations are `0002+`.
2. **On first deploy**: detect `schema_migrations` absent → assume baseline already applied → create `schema_migrations`, insert `(0001, applied)` manually → DO NOT run `0001`. Gate with env var `INIT_BASELINE=skip` to prevent accidental re-run.
3. **Idempotent migrations**: every `.sql` file must be re-runnable. `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`. No bare `DROP TABLE`. If a destructive change is needed, it goes in a transaction with an explicit pre-condition check.
4. **Transactional migrations**: wrap each `.sql` in `BEGIN; ... COMMIT;` so failure rolls back and `schema_migrations` isn't updated → next deploy re-runs clean.
5. **Migration ID uniqueness enforced at build time**: a pre-commit hook (or a test in `src/map/migrations/migrations.test.ts`) reads `src/map/migrations/*.sql`, asserts no duplicate numeric prefix, asserts strictly monotonic.
6. **Lock during migration**: use Postgres advisory lock `SELECT pg_try_advisory_lock(12345)` before running migrations. Prevents two `pm2` instances racing on restart (unlikely with single-host pm2, but cheap insurance).
7. **Dry-run mode**: `DATABASE_MIGRATE_DRY_RUN=1 bun run start` prints what would run without executing. Mandatory before every prod deploy.
8. **Rollback is manual, not framework-provided**: do NOT add `down.sql` files. They rot and give false confidence. Recovery plan = restore from `pg_dump` backup taken pre-deploy.

**Warning signs:**
- After migration framework adoption, `game_items.has_wiki_data` column doesn't exist on production → baseline dump was stale.
- Two developers' branches both have migration `0007_*.sql` → no build-time uniqueness check.
- `schema_migrations` has a row but the migration ran partially → missing transactional wrapper.
- `initialize()` still contains `ALTER TABLE` after framework adoption → incomplete migration (the whole point is to move all schema evolution OUT of `initialize()`).

**Phase to address:**
Migration framework is its own phase. Must precede any new schema change. Checklist item: `mapStore.initialize()` reduced to `ensureMigrationsTable() && runPendingMigrations()` — zero `ALTER`/`CREATE TABLE` statements remain.

---

### Pitfall 6: Diagnosing the 15-second frontend freeze via correlation ("WebSocket reconnect is visible so it must be the cause")

**What goes wrong:**
CONCERNS.md already lists three *hypotheses*: full map snapshot broadcast (line 134), cytoscape 500 KB eager load (line 230), `autoSortInventory` round-trip (line 146). The user sees WebSocket reconnect at T=0, map redraws at T=14, UI responsive at T=15. It is **extremely tempting** to conclude "WebSocket reconnect handler blocks the main thread" and patch that. But reconnect is the *entry point* — the freeze happens in whatever the reconnect handler triggers. Fixing the wrong layer means the freeze moves, not disappears.

Common red herrings in this stack:

1. **"WebSocket reconnect is slow"** — TCP SYN is ~ms, not 15s. The reconnect handler's onmessage burst is the suspect, not the connection.
2. **"Large DOM, terminal buffer overflow"** — plausible but usually causes progressive slowdown, not a 15-second frozen-then-ok pattern.
3. **"Server is slow to respond after reload"** — easy to verify: check `pm2 logs`, if server emits `broadcastMapSnapshot` at T=0 then silence till T=14, it's client-side.
4. **"React/framework devtools"** — not applicable (vanilla TS client).
5. **"Cytoscape init time"** — 500 KB eager load costs ~200-500 ms to parse on modern hardware, not 15 seconds. Real culprit more likely is cytoscape's **layout algorithm** running on a large graph after init.
6. **"Network latency"** — 15 seconds is script execution, not network. A `performance.mark()`/`performance.measure()` around each top-level op settles this in 5 minutes.

The meta-pitfall: fixing the *first hypothesis that seems to fit* without profiling. Developer patches `broadcastMapSnapshot` (added debounce), notices "it feels faster", declares victory. Actual root cause was cytoscape layout → freeze is still 8 seconds → user reports again in 2 weeks → by then the debounce is shipped and can't be easily rolled back.

**Why it happens:**
Freezes are "obvious" in the wrong way — developer sees symptom (frozen UI), guesses cause (recent change in mental model), patches, moves on. Chrome DevTools Performance tab is the single best debugging tool and nearly nobody uses it before hypothesizing.

**How to avoid:**
1. **Profile before theorizing**: Chrome DevTools → Performance → record → reload → stop. Look at the flamegraph for the tallest bar. That is the culprit, not whatever you thought.
2. **`performance.mark()` / `performance.measure()`** at every top-level client bootstrap step: `main.ts` entry, WS open, first `map_update` receipt, first `renderGridMap`, cytoscape init, first user-interactive frame. Log measures to console with labels.
3. **Bisect with feature flags**: disable cytoscape init (`?nomap=1` query param) → does the freeze go away? Disable map-grid render → same question. Disable snapshot processing → same. The first `N` that removes the freeze identifies the module.
4. **Server-side timing**: add timestamped `logEvent` around `broadcastMapSnapshot` — correlate with client's `performance.now()`. If server broadcasts at 12ms and client renders at 14000ms, the culprit is client-side processing.
5. **Network tab**: is the 500 KB cytoscape bundle served fresh (304 Not Modified is fine, 200 with 500 KB body is not — cache-bust scenario).
6. **Check main thread Long Tasks**: Chrome's "Long tasks" marker shows any task over 50ms. In a healthy reload there should be maybe 3 or 4. If you see a single 12-second Long Task — that's the function to extract.
7. **Rule of two independent measurements**: before fixing, you must have profiler flamegraph + at least one of {feature flag bisect, performance.measure logs, server-side timing}. Two sources agreeing = reliable root cause.

**Warning signs:**
- Any sentence starting with "I think the freeze is probably ___" without a screenshot of DevTools profiler.
- PR description says "fixed 15-second freeze by adding debounce" — with no before/after trace.
- User-visible freeze duration changed from 15s to 8s after "fix" → incomplete, likely wrong layer.
- Fix that was "obvious" and ships in 1 hour — usually means not investigated.

**Phase to address:**
Dedicated diagnosis phase — explicitly "measure, do not fix". Output is a report naming the actual bottleneck with profiler traces. Fix is in a subsequent phase.

---

### Pitfall 7: `gitnexus_rename` silent failure modes — dynamic property access and string-constructed symbol names

**What goes wrong:**
`gitnexus_rename` understands the call graph — explicit references, imports, direct calls. It does NOT understand:

1. **Dynamic property access**: `const handler = textHandlers[commandName]` where `commandName` is a runtime string. Rename `textHandlers.lootSort` to `textHandlers.sortLoot` — the graph does not see `lootSort` as a symbol here because the key is a bracketed string. Text-search part of rename may or may not catch it depending on how the key appears in source.
2. **String-concatenated symbol names**: `require(\`./zones/\${zoneId}\`).default` — zone scripts in `zone-scripts/zones/104.ts` are loaded by constructed path. Rename `104.ts` to `zone-104.ts` and the dynamic import still looks for `104.ts`.
3. **Reflection / Object.keys**: `for (const key of Object.keys(triggers)) dispatch(key, text)` — a renamed `trigger.dodgeHandler` → `trigger.handleDodge` changes the output of `Object.keys()`. Any consumer that hardcoded the string "dodgeHandler" somewhere breaks. String constants in JSON config files, DB rows, persisted state — invisible to gitnexus.
4. **Regex-matched symbol names**: if a log line is written as `logEvent(null, "lootSort", ...)` and a log-reader script in `scripts/` greps for `"lootSort"`, renaming the log label (even if the *function* is renamed correctly) breaks the reader.
5. **Persisted state keys**: `saveZoneScriptSettings({ settings: { ...fieldName... }})` — a field in JSONB named after a symbol. Rename symbol → JSONB still has old key → app reads `undefined`.
6. **`profiles.ts` startup command strings**: `startupCommands: ["имя", "voinmir", "respect1"]` — strings, not symbols. Rename of related identifier won't touch these.
7. **Cross-file string literals in Russian**: trigger regex source strings often duplicate across files (copy-paste). Rename a constant name in one file; the other file's string literal stays.

Per the CLAUDE.md warning: `gitnexus_rename` text_search edits need **manual review** — the trap is skimming the preview and approving it without reading the text_search section carefully.

**Why it happens:**
Static analysis is a *lower bound* on references. Dynamic language features (JS especially) evade it. The tool is correct on what it sees; the developer is wrong to assume what it sees is exhaustive.

**How to avoid:**
1. **Always `dry_run: true` first** (CLAUDE.md rule — enforce). Read the preview top to bottom. Both `graph` and `text_search` sections.
2. **Pre-rename audit**: `grep -rn 'oldSymbolName' src/` — compare count to gitnexus preview. If grep finds 12 hits and gitnexus preview shows 8 edits, 4 are missing. Investigate each.
3. **Pre-rename search of string literals**: `grep -rn "\"oldSymbolName\"" src/` (note the quotes) — catches `logEvent("oldSymbolName", ...)` and `JSON.stringify({oldSymbolName: ...})`.
4. **Search the DB**: before renaming anything touching persisted state, query `SELECT DISTINCT jsonb_object_keys(settings) FROM zone_script_settings` and `SELECT DISTINCT jsonb_object_keys(settings) FROM farm_zone_settings`. If a key matches the symbol, add a migration to rename the JSONB key at the same time.
5. **Log file audit**: `grep -c 'oldSymbolName' /var/log/bylins-bot/*.log` — if non-zero, external tooling may depend on the string.
6. **Prefer renames that don't touch public surface**: rename an internal helper (zero external string refs) before renaming `createFarm2Controller` (referenced in config, logs, docs).
7. **Post-rename smoke**: `bun run build` (catches most), then start the bot with a test profile, let it run a farm cycle, compare log output to a pre-rename golden log. Silent drift in log labels = missed rename.
8. **Commit rename alone**: one commit = one rename, no other changes. If something breaks, `git revert` is clean.
9. **For config keys / persisted state**: NEVER use `gitnexus_rename`. Write a migration + code change together.

**Warning signs:**
- `dry_run` preview has a "text_search" section with edits in files outside `src/` (e.g., `.planning/`, `docs/`, `README.md`) — the rename is changing documentation strings, review carefully.
- `bun run build` passes, app starts, but `logEvent(...)` calls emit events with a category name no log-reader expects → log dashboards silently break.
- Browser client expects a `{type: "old_event"}` WebSocket message but server now sends `{type: "new_event"}` → silent UI breakage.
- `zone-script` fails to load because `require()` uses an old path string.

**Phase to address:**
Every phase that renames symbols. This is an ongoing discipline, not a one-time phase. Add to the Phase 0 safety harness as a mandatory pre-rename checklist.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Inline `ALTER TABLE IF NOT EXISTS` in `initialize()` | No migration framework needed, works | Losing track of what ran where; impossible to roll back; drop-guards become booby-traps | Never — replace in migration framework phase |
| `let` at module scope for "just one more state variable" | Fast to add | Accumulates to 15+ vars; untestable; racy; cognitive load | Never in new code; gradually extract existing |
| `setTimeout(() => map.delete(k), 10_000)` for TTL | 3 lines of code | Timer handles leak on teardown; key lifetime is implicit | Acceptable only for values that tolerate over-exemption; otherwise use a timestamped-map with explicit "exempt until" check |
| Wire both old callback chain AND new event bus during cutover | No big-bang migration | Double-fire bugs, duplicate commands, character input flood | Never — shim the bus behind the Set, or cut over atomically per-listener |
| Re-type regex instead of cut-paste during extraction | "I understand the regex better now" | Silent flag drift, encoding corruption, cyrillic substitution | Never during refactor — always cut-paste |
| Guess at freeze root cause before profiling | 1 hour PR vs 1 day investigation | Wrong fix ships; freeze moves instead of disappears; re-reported in 2 weeks | Never — profile first, then fix |
| "Fix it while I'm in there" during refactor | Fewer PRs | Mixes refactor with behavior change; impossible to bisect regressions | Never — one PR = one concern |
| Commented-out route rooms with `// ВРЕМЕННО` | Unblock a script today | TODO persists indefinitely; no tracking; loot missed | Only with a linked issue; no TODO without a due date |
| Skipping `gitnexus_impact` before editing | Save 30 seconds | Miss d=1 callers; ship broken code | Never — CLAUDE.md mandates |
| `console.log` in server code for debugging | Faster than `logEvent` | AGENTS.md rule violation; unstructured logs; no rotation | Never in committed code; dev-only, strip before commit |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Postgres (`postgres` porsager v3.4.7) | Assuming `ALTER TABLE IF NOT EXISTS ... ADD COLUMN` is atomic with existing data (it is — but developer assumes the default `NOT NULL DEFAULT FALSE` applies historically; on a 10M-row table this ACQUIRES ACCESS EXCLUSIVE LOCK and stalls) | For large tables: split into `ADD COLUMN` (nullable, no default), backfill in batches, then `SET NOT NULL`. For this project's small tables, fine as-is but validate table sizes before writing migrations |
| Postgres advisory locks for migration coordination | Forgetting to release → next deploy hangs silently | Use session-scoped `pg_try_advisory_lock(N)`; if `false`, fail fast with a clear error; release happens automatically on session end |
| MUD TCP session (`net.Socket`) | Assuming `chunk` events deliver complete lines (they don't — TCP is a byte stream); relying on `setEncoding('utf8')` to handle multibyte boundary (it doesn't always for Cyrillic) | `mud-connection.ts` already line-buffers; preserve this during any refactor; never feed partial lines to regex parsers |
| WebSocket (Bun's ws) | Assuming client receives messages in send order when running under network instability | Always include a sequence number or timestamp; client reorders as needed; do NOT make the server enforce ordering with `await` chains — that's what produces the 15s freeze |
| Telegram Bot API | Logging fetch error including full URL leaks the bot token | Wrap fetch in try/catch that strips URL (`src/bazaar-notifier.ts:72-80` — CONCERNS.md security section) |
| `postgres` template-tag SQL | Writing `database\`SELECT * FROM \${tableName}\`` — template tag doesn't parameterize identifiers | Use `database\`SELECT * FROM \${database(tableName)}\`` (identifier sigil) or a whitelist |
| GitNexus index freshness | Running `gitnexus_impact` against a stale index and trusting the result | `gitnexus_context` reports freshness; if stale, run `npx gitnexus analyze --embeddings` first |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full map snapshot broadcast on every room change | Client CPU spike every 2s during farming; WS buffer growth | Cache snapshot, invalidate on `upsertRoom`/`upsertEdge`; introduce `map_delta` event; debounce 200ms | Already broken — 30 broadcasts/min; worsens as zone size grows past 100 rooms |
| Eager cytoscape import (500 KB) | 200-500ms parse on every reload; larger main bundle; slow first paint | Lazy-load only when global-map modal opens; gate behind a dynamic `import()` | Noticeable now; worse on slow devices and first load |
| Sequential `await upsertRoom` then `await upsertEdge` in a for-loop | MUD text handler blocks 1-5ms per edge × 4 exits/room | `Promise.all` parallelize — BUT fix the `upsertEdge` conflict race first (CONCERNS.md Known Bugs) | Noticeable on busy rooms; scales linearly with exits |
| `autoSortInventory` waits 3s for `"Вы несете"` round-trip after every kill | Character idle in hostile zone while sorting; mobs re-aggress | Maintain live inventory via `containerTracker`; dispatch `пол` commands immediately from cache | Already unsafe — character can die mid-sort |
| `extractMobsFromRaw` runs global regex on every received chunk | CPU on every MUD packet, even ones without mobs | Early-return if chunk contains no `\u001b[1;31m` or `\u001b[1;33m` escape | Scales with MUD verbosity |
| `MAX_STATS_REGEXP` + `PROMPT_STATS_REGEXP` with backtracking on adversarial input | Bot hangs if MUD sends pathological input; denial-of-service vector | Anchor regexes, cap input length to 64 KB, avoid nested quantifiers (CONCERNS.md security) | Only triggers on hostile/buggy MUD |
| `appendFileSync` for every log event | Sync fs blocks event loop during combat bursts | Batch writes via `createWriteStream`; flush on interval | Breaks at ~50 events/sec |
| Event bus broadcast to 30+ listeners synchronously | Each chunk blocks for sum of all handler times | Accept sync model; optimize individual handlers; profile with per-handler timing in dev mode | Breaks when handler count grows past ~50 or a single handler is slow |
| Chat messages table growing unbounded | Disk fill in 6-12 months of 24/7 operation | Cron delete older than N days; partition by month | Already happening — CONCERNS.md flagged |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Hardcoded MUD password `respect1` in `profiles.ts`, `startup-script.ts`, `ecosystem.config.cjs`, `.env.example` | Account takeover, character theft, ban; public repo | Rotate password now; `.env` only; `startupCommands` accepts `"${MUD_PASSWORD_VOINMIR}"` placeholder resolved at runtime (OUT OF SCOPE for refactor milestone per PROJECT.md but MUST be tracked) |
| Refactor expands password surface area | More files to scrub later | NEVER touch password handling during refactor; leave strings exactly where they are; do not "helpfully" centralize them into a config module |
| WS handler forwards `type: "send"` without server-side validation | Anyone on LAN can send raw commands to MUD | Bind `HOST=127.0.0.1`; require Caddy Basic Auth; add WS upgrade token check; never publish port 3211 |
| Regex ReDoS on adversarial MUD input | Bot stuck in regex backtracking, misses combat events, character dies | Truncate chunks to 64KB; audit all regexes for nested quantifiers with overlapping alternation |
| Logging to stdout leaks passwords during error traces | Error path stringifies config object containing secrets | `logEvent` must accept an allowlist of fields; never `JSON.stringify(entireConfig)` |
| Migration framework with `down.sql` rollback scripts | Developer runs `rollback` on production, loses data | Do not provide rollback scripts; recovery = `pg_dump` backup restore |
| Committing a placeholder Basic Auth hash | Developer deploys with placeholder; Caddy rejects all auth (no entry) — OR develops habit of editing the file and accidentally commits real hash | `ecosystem.config.cjs` reads from `.env` only; hash is never in tracked source |
| Telegram bot error message includes full `/bot<TOKEN>/sendMessage` URL | Token leak in logs | Strip URL before logging; format as `"Telegram API error: status=<code>"` |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| 15-second UI freeze on reload | User can't interact, forced to wait, may force-reload and make it worse | Fix root cause (see Pitfall 6) + show loading state during init so freeze is visible-progress not black-box |
| Full map re-render on each snapshot | UI janks during farming; can't click buttons reliably | DOM diff / Cytoscape JSON patch API |
| Hotkey system breaks silently after extraction | User's muscle memory fails; typed keystrokes reach wrong handler or MUD | Hotkey extraction must have manual test checklist: every documented hotkey verified working post-extract |
| Loot-sort container name hardcoded silently changes | User loses items to unexpected container | Enumerate container names in a constant; warn in logs when target container is unknown; survive unknown container gracefully |
| Error path shows nothing in UI | User thinks bot is working when it isn't | Every catch block logs via `logEvent(null, "error", ...)`; UI surfaces last error visibly |
| Reconnect backoff climbs forever with no user signal | User doesn't know bot gave up | Cap backoff; surface reconnect state in UI; alert on prolonged failure |

## "Looks Done But Isn't" Checklist

- [ ] **Controller extraction:** Often missing teardown hook registration — verify `grep -c 'sessionTeardownHooks.add' src/server.ts` matches the number of extracted controllers with timers/state.
- [ ] **Event bus introduction:** Often missing try/catch around listener dispatch — verify one throwing listener does not stop subsequent listeners from firing (unit test).
- [ ] **Event bus introduction:** Often missing self-removal-during-dispatch semantics — verify `listeners = [...listeners]` snapshot before iterating.
- [ ] **Migration framework:** Often missing baseline seed on prod DB — verify `SELECT count(*) FROM schema_migrations` is non-zero on production before merging.
- [ ] **Migration framework:** Often missing advisory lock — verify simulated concurrent startups don't both run the same migration.
- [ ] **Migration framework:** Often missing removal of inline `ALTER TABLE` from `mapStore.initialize()` — verify `grep -c 'ALTER TABLE' src/map/store.ts` == 0.
- [ ] **Regex extraction:** Often missing snapshot diff — verify `snapshots/before.jsonl` and `snapshots/after.jsonl` are byte-identical.
- [ ] **Regex extraction:** Often missing UTF-8 encoding check — verify `file -I src/**/*.ts` shows utf-8 everywhere.
- [ ] **Frontend freeze fix:** Often missing before/after flamegraph — PR description must include DevTools trace URLs or screenshots.
- [ ] **Frontend freeze fix:** Often missing independent confirmation — root cause confirmed by 2 of: profiler, feature-flag bisect, server-side timing.
- [ ] **Rename:** Often missing grep of string literals — verify `grep -rn "\"$OLD\""` count = 0 post-rename.
- [ ] **Rename:** Often missing persisted-state audit — verify JSONB keys in `zone_script_settings` / `farm_zone_settings` don't reference old symbol name.
- [ ] **Timer cleanup:** Often missing profile-switch stress test — verify no stale timer fires after 5x rapid profile switch.
- [ ] **Behavior preservation:** Often missing golden-log replay — verify 30min of recorded MUD text produces identical sendCommand sequence pre/post refactor.
- [ ] **Behavior preservation:** Often missing farm dry-run — verify one full farm cycle in a safe zone post-refactor with no behavior delta observed in logs.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Event bus double-fire | LOW | `git revert` the bus PR; bot immediately stable; re-approach with shim pattern |
| Closure-captured state leak after extraction | MEDIUM | Identify stale binding via `grep` of the moved symbol; add temporary re-export bridge; fix missed closure; remove bridge |
| Orphan `setTimeout` writing to dead reference | MEDIUM | Identify via memory-leak inspector; add `shutdown()` to factory; wire to `sessionTeardownHooks`; restart cleans active leak |
| Regex behavior drift post-extraction | HIGH if undetected, LOW if snapshot harness in place | `diff snapshots/before.jsonl snapshots/after.jsonl`; first diff line identifies the broken regex; cut-paste the original literal back |
| Baseline migration mismatch (missing column on prod) | HIGH | Manually write a `0002_fixup.sql` adding the missing column with `IF NOT EXISTS`; verify schema with `pg_dump --schema-only` matches expected |
| Destructive migration ran on wrong DB | CRITICAL | Restore from pre-deploy `pg_dump` backup. Prevention is the only real answer — always backup before prod migration |
| Fixed wrong layer of frontend freeze | LOW | Revert the fix; actual root cause still unknown; restart the profile-first investigation |
| `gitnexus_rename` missed string-literal reference | LOW-MEDIUM | `grep -rn "oldName"` to find remaining refs; manual edit; if persisted state affected, write a migration |
| Timer handle moved but not clear path | MEDIUM | Start fresh session; zombie callback error surfaces in logs; trace back to owning factory; move `clearTimeout` into factory's `shutdown()` |
| Inline `ALTER TABLE` still present after "migration framework complete" | LOW | `grep -c 'ALTER TABLE\|CREATE TABLE' src/map/store.ts` must be 0; move remaining statements into numbered migrations |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Losing `Set<Handler>` semantics in event bus | **Phase 0: Safety Harness** (contract spec + golden-log capture) + **Phase N: Bus Introduction** (shim pattern) | Replay 30-min MUD log pre/post bus; zero diff in emitted command sequence |
| Closure-captured state leak | **Phase 0: Safety Harness** (catalog every `let` + grep each reference) + **During Extraction** (one `let` at a time, move-then-wrap two-step) | `bun run build` clean + per-extraction smoke run of zone-script + 30-min farm dry-run |
| Orphan `setTimeout` | **During Extraction** (single-owner invariant) + **Post-Extraction Audit** (teardown-hook count check) | Rapid profile-switch test (5x in 10s); zero post-teardown log entries |
| Regex behavior drift | **Phase 0: Safety Harness** (snapshot harness + `docs/mud-phrases.md` inventory) | `diff snapshots/before.jsonl snapshots/after.jsonl` = empty after every parser-touching PR |
| Baseline migration mismatch | **Migration Framework Phase** (baseline seed-not-run, idempotent migrations, advisory lock, build-time ID uniqueness check) | `pg_dump --schema-only` on prod matches baseline SQL + `SELECT count(*) FROM schema_migrations` ≥ 1 |
| Frontend freeze fixed at wrong layer | **Dedicated Diagnosis Phase** (measure-don't-fix) before **Fix Phase** | PR description includes flamegraph + 2 independent confirmations; post-fix reload freeze < 500ms verified in DevTools |
| `gitnexus_rename` missing dynamic refs | **Every Phase that Renames** — ongoing discipline from Phase 0 onward | `grep -rn "oldName"` returns 0; JSONB keys audited; log file scanned; one-rename-per-commit rule enforced |

## Sources

- `.planning/PROJECT.md` — project scope, constraints, behavior-preservation requirement
- `.planning/codebase/CONCERNS.md` — concrete list of tech debt, known bugs, fragile areas, test coverage gaps (primary evidence)
- `.planning/codebase/TESTING.md` — bun:test conventions, existing test patterns, testable factory pattern
- `src/server.ts:54-64, 189, 328-329, 347-348, 416-464, 522-523, 574-588` — actual `Set<Handler>` subscription pattern grounding Pitfall 1
- `src/server.ts:252-258, 655-661` — actual `let` inventory grounding Pitfall 2
- `src/mud-connection.ts:68, 421` — `onMudText` callback contract grounding event-bus work
- `src/map/store.ts:162-258` — actual `initialize()` with inline DDL + destructive `DROP TABLE` guard grounding Pitfall 5
- `src/map/parser.ts:11-13, 146-165` — ANSI-dependent regex parsing grounding Pitfall 4
- `CLAUDE.md` — GitNexus `rename` / `impact` / `detect_changes` workflow mandates
- `AGENTS.md:313, 317, 354` — project invariants (no empty-catch, no `console.log` in server, no `await` in loop)
- `docs/client-refactor-plan.md` — referenced in CONCERNS.md; first-round client refactor history (5525 → 1029) informs expectation that large refactors ship incrementally
- General brownfield refactor literature (Feathers, "Working Effectively with Legacy Code"); Strangler Fig pattern — training-data based, informed the "shim-not-fork" recommendation in Pitfall 1

---
*Pitfalls research for: brownfield Bun/TypeScript monolith refactor (bylins-bot)*
*Researched: 2026-04-18*
