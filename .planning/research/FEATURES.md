# Feature Research

**Domain:** Brownfield TypeScript/Bun monolith refactor — break-up + event-bus migration + schema-migration framework + frontend freeze diagnosis. Behaviour-preserving refactor of a single-user, production-serving MUD bot.
**Researched:** 2026-04-18
**Confidence:** HIGH (concerns + architecture extensively documented; activities map 1:1 to Feathers "Working Effectively with Legacy Code" playbook + strangler fig + standard browser performance diagnostics)

## Scope Note

"Features" here means **refactor activities/deliverables**, not product features. The product is feature-complete; the initiative's deliverables are structural changes, safety nets, and a diagnosis. Categorisation follows the downstream-consumer brief:

- **Table stakes** = must-do-or-refactor-is-unsafe/incomplete
- **Differentiators** = quality multipliers separating a confident refactor from a risky one
- **Anti-features** = scope creep to explicitly reject

Everything is indexed to `.planning/codebase/CONCERNS.md` and `.planning/codebase/ARCHITECTURE.md` so the roadmap author can trace each item to an existing pain point.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Activities that **must** happen or the refactor is either unsafe or incomplete. Skipping any of these means the effort fails to deliver its stated Core Value ("Сделать кодобазу проще в работе… не меняя поведение бота").

| # | Activity | Why Required | Complexity | Notes |
|---|----------|--------------|------------|-------|
| T1 | **Establish a behavioural-parity baseline before extracting anything** | Core Value says "не меняя поведение бота" — without a baseline there is no way to prove preservation. Canonical Feathers Step 1: "get legacy code under test." | MEDIUM | Replay a captured `mud-traffic.log.1` through the parser/controller stack into a fixture harness and record chat/event/stats output. This IS the regression oracle. |
| T2 | **Seam-first extraction of `server.ts` into factory modules** (`stats-parser`, `chat-parser`, `loot-sort`, `navigation-controller`, `browser-ws`) | Already mandated in PROJECT.md `Active` and CONCERNS.md "Tech Debt". Monolith is the root cause of "сложно работать". | HIGH | Use `gitnexus_impact` upstream before every symbol move. Target: `server.ts` ≤ 400 lines, pure composition root. Follow existing `createXxx({deps})` factory pattern — no classes, no framework switch. |
| T3 | **Break up the three other monoliths** (`client/main.ts` 1029, `client/map-grid.ts` 1046, `wiki.ts` 955) | Same rationale as T2. They hit the same cognitive-load wall. `map-grid.ts` is already implicated as a freeze suspect (T7). | MEDIUM-HIGH | `main.ts` → bootstrap + `hotkeys.ts` + `zone-script-panel.ts`. `map-grid.ts` → `map-layout.ts` (pure) + `map-render.ts` (DOM) + `map-interactions.ts` (pointer). `wiki.ts` → `wiki/client.ts` + `wiki/parser.ts` + `wiki/slots.ts`. The layout/render split is a prerequisite for diffing-renderer work in T7. |
| T4 | **Introduce event bus for MUD text fan-out** (replaces `onMudText` callback + `mudTextHandlers: Set<Handler>`) | Called out in PROJECT.md `Active` and architecture doc. Current chain forces every controller to be wired through `server.ts`; bus inverts the dependency so extractions in T2 don't reintroduce tight coupling. | MEDIUM | Keep the bus **typed** (discriminated union of event kinds, matching the existing `ParsedEvent` style). Publish order must match current sequential dispatch — controllers may rely on side-effect ordering (e.g., `containerTracker.feedText` before `persistParsedMapData`). Emit **after** existing side-effects for the first iteration so ordering regressions are impossible; migrate subscribers one at a time. |
| T5 | **Migration framework: `schema_migrations` table + numbered SQL scripts** (`src/map/migrations/NNN_description.sql`) | CONCERNS.md flags this as a "Missing Critical Feature". `ALTER TABLE IF NOT EXISTS` inline in `mapStore.initialize()` (lines 184–199, 241, 245) is a correctness bomb on multi-deploy/reinstall; the pre-migration `DROP TABLE farm_zone_settings` is particularly dangerous. | LOW-MEDIUM | Lightweight design: single table `schema_migrations(id int PRIMARY KEY, applied_at timestamptz)`; apply in a transaction per file; no rollback (forward-only is fine for a single-user deployment). Backfill a migration `001_baseline.sql` representing the current live schema so production stays idempotent. |
| T6 | **Port existing inline ALTERs into numbered migrations** | T5 without this is just scaffolding. The `has_wiki_data` column and the `farm_zone_settings` drop must live as versioned scripts, not as imperative code inside `initialize()`. | LOW | Drop the inline `ALTER TABLE` / `DROP TABLE` blocks from `mapStore.initialize()` once migrations own them. Keep `initialize()` as a dispatcher that runs pending migrations and nothing else. |
| T7 | **Diagnose the >15s post-reload UI freeze with a profile-driven playbook** | PROJECT.md `Active` names this as a user-visible pain. "Решать через профайлинг" is explicit — no speculative fixes. | MEDIUM (diagnosis) + unknown (fix) | See **Frontend Freeze Playbook** section below. Two named suspects exist (eager Cytoscape, full-snapshot broadcast), but the brief is explicit: measure before fixing. |
| T8 | **Behaviour-preservation verification at every extraction boundary** | Without this, each commit is a coin flip. The no-tests problem (only `parser.test.ts` + `tracker.test.ts` exist) means the replay fixture (T1) is the only safety net. | LOW per-step, MEDIUM cumulative | After each extract: (a) run `bun test` green, (b) replay T1 fixture and diff output, (c) manual smoke against staging MUD session if log replay is ambiguous, (d) `gitnexus_detect_changes` ≤ expected scope. |
| T9 | **Post-extraction targeted tests for newly-minted modules** | Listed in PROJECT.md `Active`: "После структурного разбора — написать тесты для критичных модулей". A module that is easy to test now (because it's extracted) but has no tests is a regression waiting to happen. | MEDIUM | Target hot-path only per PROJECT.md scope: `stats-parser`, `chat-parser`, `navigation-controller`, `triggers`, `farm2` controller, `mud-connection` telnet/reconnect, `map/store` upsert conflict path. Skip `wiki`, `container-tracker`, `compare-scan` per stated out-of-scope. |
| T10 | **Rollout plan per phase with rollback** | Bot serves production; a broken extraction costs the user real farming time. Every phase needs a "how do I un-do this if the replay harness catches a diff" answer. | LOW | Each extraction = one merge commit on a branch; revert is `git revert <merge>` + `pm2 restart`. Enforce: no PR touches more than one extraction boundary. |

### Differentiators (Competitive Advantage)

Practices that elevate a merely-working refactor to a confidence-building one. None are required; each materially reduces risk or improves the post-refactor state. Ordered by expected payoff.

| # | Activity | Value Proposition | Complexity | Notes |
|---|----------|-------------------|------------|-------|
| D1 | **Log-replay characterization harness** (built on top of T1 baseline) | Turns the existing `/var/log/bylins-bot/mud-traffic.log.1` into a deterministic golden-master test bed. Replays raw MUD bytes into `mudConnection.decodeMudData` → full pipeline with DB+WS mocked; asserts parsed events + emitted `ServerEvent`s + `sendCommand` outputs match a recorded snapshot. | MEDIUM-HIGH | This is THE force multiplier for this refactor. It turns every extraction into "did the snapshot change?" which is mechanical. Requires: (a) deterministic clock injection (replace `Date.now()`/`setTimeout` via a `deps.clock`), (b) DB test double (in-memory `MapStore` already exists), (c) WS broadcast capture list. Worth building even if only 2–3 fixtures exist. |
| D2 | **Behaviour-preserving commit discipline — one extraction per commit, no behavioural changes allowed in the same commit** | Makes `git bisect` work. Makes review a 10-minute task instead of a 2-hour task. Makes rollback of any single step surgical. | LOW | Convention + PR template, not tooling. Commit message format: `refactor(extract): <symbol> from <source> to <dest>`. Any `fix:`/`feat:` during refactor phase = separate commit, never mixed. |
| D3 | **Feature-flag the event bus migration** (env var `USE_EVENT_BUS=1`) | Lets the old `onMudText` path and the new bus path coexist for 1–2 weeks of real-session use. If a subtle ordering issue bites, flip the flag and keep playing; fix in daylight. | LOW | Dual-publish pattern: new bus is authoritative when flag is on; old path is authoritative when flag is off; **both produce identical side-effects** so toggling mid-session is safe. Delete the flag + old path once confidence is high. |
| D4 | **Deterministic clock/timer injection as a single cross-cutting deps primitive** | Unlocks D1 (replay), unlocks future tests for `farm2` tick loop, `survival` cooldowns, `reconnect backoff`, `rashodExemptKeywords` timer (CONCERNS.md race). Currently every controller reaches for `Date.now()` / `setTimeout` directly — replay is impossible without this. | MEDIUM | Extend `createTickTimer` pattern (already in `src/utils/timer.ts`) to cover `now()` and `setTimeout`. Thread a `Clock` through the DI `Deps` interfaces. Default factory wires real clock; test factory wires virtual. |
| D5 | **Typed event bus with exhaustiveness checks** | Stops subscribers drifting. If a new MUD event kind is added, TS forces every subscriber to handle or explicitly ignore it. Protects T4 over time. | LOW once bus exists | Use discriminated union + `assertNever` in switch defaults, mirroring the existing `ParsedEvent` / `ClientEvent` / `ServerEvent` style. No external dep; hand-rolled < 80 lines. |
| D6 | **Migration integrity check at startup** (part of T5 polish) | Detects the "was the migration ever applied?" question before the bot starts handling MUD traffic. If a `schema_migrations` row is missing but the column exists, fail fast with a clear message. | LOW | Query `information_schema.columns` vs migration ledger on boot. One-off script `scripts/verify-schema.ts`. Protects against the "half-migrated state" risk CONCERNS.md calls out. |
| D7 | **Incremental map-update protocol** (`map_delta` event carrying only changed rooms/edges) | Addresses CONCERNS.md "Full map snapshot broadcast on every room change" — a named suspect for the freeze. Converts a 30-per-minute full-zone broadcast into a 30-per-minute delta. | MEDIUM | Only pursue if T7 profile implicates it. Implementation: cache zone snapshot keyed by `currentVnum`; invalidate on `upsertRoom`/`upsertEdge`; emit diff of `{added, updated, removed}`. Client applies patch. Gate behind a server-side feature flag until validated against a cold-reload replay. |
| D8 | **Lazy-load Cytoscape behind the global-map modal** | Addresses CONCERNS.md "cytoscape ~500 KB eager" — the other named freeze suspect. Already the documented fix direction. | LOW | Vite/bun bundler already does code-splitting; move Cytoscape import into the dynamic modal import already used by `modals/global-map.ts`. Check the post-build HTML to confirm it is not in the `<link rel=modulepreload>` eager set. Again, gate on T7 profile confirming it is implicated. |
| D9 | **Structured logging schema for the refactor window** | During extraction, the ability to grep logs by `session=`, `module=`, `event=` and see that `navigation-controller` is firing in the same order it did pre-refactor is worth the 2 hours of setup. | LOW | Existing `appendLogLine` already writes pseudo-JSON. Add a `module` field everywhere, write a one-shot `scripts/diff-logs.ts` that groups by session and diffs event sequences between pre/post branches. |
| D10 | **"No new behaviour without an issue" PR gate** | Cultural protection against anti-features. Any PR that changes an observable output of the bot (chat format, auto-sort decision, trigger reaction) during the refactor window must link an issue and get explicit sign-off. | LOW | PR template checkbox. Pairs with D2. |
| D11 | **Dependency inversion of `mapStore` concurrency assumption** | CONCERNS.md "Non-atomic edge conflict resolution in `upsertEdge`" — parallelising writes is tempting during refactor. Document the single-writer invariant at the bus level so a well-meaning "why is this `await`-in-loop, AGENTS.md says no" rewrite doesn't data-corrupt the map. | LOW | Comment + test (`store.test.ts` with two concurrent upsert races against in-memory store). Do NOT fix the race itself this milestone — that's a behaviour change. |
| D12 | **Extraction checklist in PR template** | Forces each refactor PR through the same rubric: impact run? seam identified? deps list minimal? replay passed? gitnexus scope verified? | LOW | One markdown file, zero tooling. |

### Anti-Features (Commonly Requested, Often Problematic)

"While we're here, let's also…" — each of these is a real temptation for a refactor of this scope, each is explicitly out of scope per PROJECT.md or would destroy the behaviour-preservation guarantee. Rejection must be documented in the roadmap so future reviewers don't resurrect them.

| # | Anti-Feature | Why Requested | Why Problematic | Alternative |
|---|--------------|---------------|-----------------|-------------|
| A1 | **Fix bugs while refactoring** (`rashodExemptKeywords` race, `statsRazb` stub, reconnect counter overflow, chat/stats edge cases, sequential DB writes in parser pipeline) | The concerns audit surfaces them; feels efficient to fix in the same PR as the extraction. | Destroys behavioural parity. Your replay harness (D1) now can't tell "this diff is intended" from "this diff is a regression". Also pollutes `git bisect`. | Capture each in a follow-up issue; fix in a separate post-refactor phase with `fix:` commits that explicitly change snapshots. |
| A2 | **Switch from factory pattern to OOP / DI container** (NestJS, Inversify, class-based controllers) | "We're restructuring anyway, let's go modern." PROJECT.md explicitly forbids this. | Doubles the work (every module needs reshape, not just relocation), breaks the mental model for every other file that stays factory-style, and delivers zero on Core Value. | Keep `createXxx({deps})`. It already IS DI; the event bus makes it feel like a framework without being one. |
| A3 | **Swap runtime (Bun → Node) or DB (Postgres → SQLite/DuckDB)** | "Cleaner fresh start." PROJECT.md `Out of Scope`. | Infinite scope, infinite test surface. The stack works. | Defer to a separate initiative if ever needed. |
| A4 | **Introduce a frontend framework** (React/Svelte/Solid) for the client | `client/main.ts` is 1029 lines of imperative DOM — "a framework would tidy this." | Massive rewrite for every subtree (map-grid, terminal, inventory, modals), breaks the lazy-import modal pattern, introduces build complexity. Zero value on Core Value. | Module extraction (T3) + possibly a tiny reactive-store primitive if state-sharing pain emerges post-extraction. |
| A5 | **CI pipeline / lint / formatter during the same milestone** | "We should have had CI years ago." PROJECT.md `Out of Scope`. | Each is its own rabbit hole (rule choice, fixing all existing violations, pipeline plumbing). Delays Core Value. | Next iteration. Queue as a separate milestone. |
| A6 | **Multi-character concurrent sessions** | Architecture doc names it as a scaling path. Feels like a natural outcome of "proper modularity". | Forces every closure-captured "current session" assumption to become keyed. Huge change surface. Not a current pain (single user). | Keep `sharedSession` singleton. Extract as if single-session is eternal. If a future initiative needs it, revisit. |
| A7 | **Rotate the MUD password / fix the `respect1` leak in this milestone** | CONCERNS.md Security `CRITICAL`. Feels urgent and cheap. PROJECT.md `Out of Scope` with explicit reasoning ("требует доступа к MUD-аккаунтам"). | Requires human-in-loop for MUD accounts; doesn't block the refactor; failing halfway leaves passwords in inconsistent state. | Separate security-only milestone with account-owner coordinated change. Document in a SECURITY issue now. |
| A8 | **Rebuild the MUD text parser to be palette-agnostic** | CONCERNS.md Fragile Areas names ANSI-color dependency. Tempting target during "we're extracting anyway." | Behavioural change by definition (different parse outputs on edge cases). Not what users are paying for with this milestone. | Keep regex-first as-is. If palette drift happens, one-off fix in its own PR. |
| A9 | **Introduce runtime schema validation** (Zod across all WS events) | `zod` is already a dependency, feels wasteful not to use it. Validation is called out as "manual" in architecture. | Every WS event-type addition becomes a two-file change; transition is churn with no Core Value payoff. The existing TS discriminated unions catch 95% of what Zod would. | Defer. Adopt selectively if a specific event sees repeated shape drift. |
| A10 | **Rewrite `map-grid` with a virtualising DOM diff** during freeze-fix | `map-grid.ts` is implicated as freeze suspect; "rewrite" feels like a single-stone-two-birds move. | Un-bounded scope, perfect storm for behaviour regressions in a visible subsystem. And the freeze might not even be `map-grid`. | Let T7 profile data decide. If `map-grid` is the culprit, minimum viable fix (e.g., skip re-render when snapshot is deep-equal, or Cytoscape `json()` patch API which is already imported). |
| A11 | **Introduce an ORM / query builder** (Prisma, Drizzle, Kysely) to "modernise `store.ts`" | 785-line SQL file feels replaceable. | Huge behaviour risk (SQL nuances, especially the conflict-resolution path), pulls in code-gen / migration story that conflicts with T5's minimal framework, breaks the `postgres` (porsager) style that the rest of the code assumes. | Keep raw SQL in `postgres` template strings. T5's numbered-migrations framework is what's needed. |
| A12 | **Add observability/metrics (Prometheus, OpenTelemetry)** | Single-user bot "should have metrics." CONCERNS.md names "no monitoring" as a missing feature. | Orthogonal to Core Value; infinite design surface; not in PROJECT.md scope. | Queue as a separate future milestone (or skip — this is a single-user tool). |
| A13 | **Parallelise DB writes in parser pipeline** (`Promise.all` for upserts — per AGENTS.md guideline) | AGENTS.md guideline is real: "never await in loop when parallel possible." | CONCERNS.md flags `upsertEdge` race; parallelising WILL corrupt the map graph. This is exactly the kind of "obvious cleanup" that the behaviour-preservation rule exists to block. | Document single-writer invariant (D11). Do NOT parallelise this milestone. Fix race + parallelise as a separate post-refactor phase. |
| A14 | **Delete unused `@ladybugdb/core` / dependency audit** | Feels like tidy-up. | Pure scope creep; belongs in a dependency-hygiene task. | Log as a separate ticket. |
| A15 | **Re-plan `zone-scripts/zones/286.ts` / `104.ts` TODO(temp) exclusions** | They are visible, annoying, and "while you're in the area". | Behavioural change (farming routes differ); requires map-data investigation orthogonal to structure. | Separate ticket post-milestone. |

---

## Feature Dependencies

```
T1 (baseline fixture)
    └── enables ──> D1 (log-replay harness)
                        └── enables ──> T8 (per-extraction verification)
                                            └── enables ──> T2, T3 (safe extraction)

D4 (clock injection) ──required-for──> D1 (replay determinism)
                     ──enables──────> T9 (testing timer-driven modules)

T2 (server.ts breakup) ──unblocks──> T4 (event bus has clean seams to subscribe to)
T4 (event bus) ─────────enhances────> T2 (extractions stop re-coupling via new wires)
T4 ─────────────────────requires────> D5 (typed bus with exhaustiveness)
T4 ─────────────────────benefits────> D3 (flag for dual-path coexistence)

T5 (migration framework) ──required-before──> T6 (porting ALTERs)
T6 ──────────────────────required-before──> any further schema change post-milestone

T7 (freeze diagnosis) ──informs──> D7 (map delta) and/or D8 (lazy cytoscape)
                      ──must-precede──> any freeze fix (no speculative fixes)

T2, T3 ──must-precede──> T9 (test newly-extracted modules)
T8 (per-extraction verification) ──guards──> T2, T3, T4, T6 (all behaviour-changing steps)

D11 (document single-writer) ──blocks──> A13 (parallel DB writes anti-feature)
D10 (PR gate) ──blocks──────> A1 (fix-while-refactoring anti-feature)
```

### Dependency Notes

- **T1 before T2**: You cannot safely extract `server.ts` without a regression oracle. The fixture harness + `bun test` green + `gitnexus_detect_changes` form the three-legged stool.
- **D4 before D1**: Log replay is non-deterministic without injected clock/timers — `setTimeout`-driven behaviour (`rashodExemptKeywords`, `scheduleLootSort`, survival ticks, reconnect backoff) will diverge between runs.
- **T2 before T4**: Introducing an event bus into an undifferentiated 1867-line file forces the bus API to absorb every coupling currently implicit in shared closure state. Extract seams first so the bus has clean subscribers.
- **T5 before T6**: Obvious; you can't port migrations into a framework that doesn't exist yet.
- **T7 before D7/D8**: The freeze's root cause is *unknown* per PROJECT.md. Fixing a suspect without a profile is guessing — and both named suspects have non-trivial fixes that risk behaviour regressions.
- **D10 before T2 starts**: The PR gate must be in place on commit #1 of the refactor; retrofitting discipline mid-stream is how anti-features land.

---

## Refactor Sequencing Best Practices

This section is specific to this codebase's shape. Ordering is driven by **risk** (extract lowest-risk first to build confidence in the harness) and **dependency** (extractions that unblock later extractions come first).

### Extraction Order — Recommended

**Phase 0 — Scaffolding (no behaviour change, no symbol moves):**
1. Build T1 baseline fixture from `mud-traffic.log.1`.
2. Introduce D4 `Clock` deps primitive; thread through top-level `createXxx` calls without changing call sites inside controllers yet.
3. Build D1 replay harness; make it pass against `main`. This is the refactor's "lock the door before painting" step.
4. Set up D10 PR template + D2 commit discipline docs. Land these first so the very first refactor PR follows them.

**Phase 1 — Lowest-risk extractions from `server.ts` (leaf concerns, few inbound refs):**
5. `stats-parser.ts` — tightly-scoped regex block + `statsHp*`/`statsEnergy*` state; isolated consumers (broadcast + chat command `"дсу"`). Small surface, easy snapshot-diff.
6. `chat-parser.ts` — `CHAT_FILTER_NAMES`, `isChatLine`, `extractChatLines`, `extractMarketSales`. Pure functions over strings; no DB; trivial to replay.
7. `loot-sort.ts` — `scheduleLootSort`, `sortLootedItems`, `autoSortInventory`, `pendingLootItems`, `rashodExemptKeywords`. Medium — has a `setTimeout`, but D4 neutralises that.

**Phase 2 — Higher-risk extractions (stateful, many inbound/outbound refs):**
8. `navigation-controller.ts` — `NavigationState`, `startNavigation`, `startNavigationToNearest`, `onceRoomChanged` (~760 lines, largest block). Extract last from `server.ts` because it depends on stats/chat/loot-sort being out of the way and on clean seams. Use `gitnexus_rename` for any renames during the move.
9. `browser-ws.ts` — WebSocket message handler (~line 1600). Extract after navigation because several `ClientEvent` branches delegate into navigation.

**Phase 3 — Client-side monolith breakup (parallelisable with Phase 2 if separate committer):**
10. `client/main.ts` → split `hotkeys.ts` (lowest risk — pure keydown wiring) first, then `zone-script-panel.ts`, leave `main.ts` as bootstrap.
11. `client/map-grid.ts` → `map-layout.ts` (pure, testable) first; then `map-render.ts`; then `map-interactions.ts`. The layout/render split is a prerequisite for any freeze fix that targets rendering (D7).
12. `wiki.ts` → `wiki/slots.ts` (pure constants) first; then `wiki/client.ts`; then `wiki/parser.ts`. Lowest stakes of the monoliths since wiki is not in the hot path.

**Phase 4 — Event bus migration (after Phase 1–3 produce clean seams):**
13. Introduce typed event bus + D5 exhaustiveness. Subscribers start as **duplicate** consumers behind D3 flag.
14. Migrate one controller at a time from `onMudText` / `mudTextHandlers` to bus subscription. Flip flag per-controller; verify replay harness still green.
15. Delete old path + flag once every controller is on the bus for ≥1 week of real use.

**Phase 5 — Migration framework:**
16. T5: ship `schema_migrations` table + runner + baseline migration `001_baseline.sql`. Deploy to production; verify it's idempotent (second startup is a no-op).
17. T6: port inline `ALTER TABLE` blocks into `002_add_wiki_data_cols.sql`, `003_drop_farm_zone_settings.sql`, etc. Each migration ported = one PR.

**Phase 6 — Freeze diagnosis + fix:**
18. Execute the Frontend Freeze Playbook (below). Record findings.
19. Implement whichever of D7/D8/other-surprises the profile indicates. One PR per fix; gated behind feature flag where possible.

**Phase 7 — Post-extraction tests (T9):**
20. Write targeted tests for newly-extracted modules against their `Clock` + in-memory `MapStore` fakes. Hot path only per PROJECT.md.

### How to Validate Each Extraction

Checklist, applied to every single extraction PR:

1. `gitnexus_impact({target: "<symbol>", direction: "upstream"})` run BEFORE editing — blast radius noted in PR description.
2. Symbol move uses `gitnexus_rename({dry_run: true})` first; diff reviewed; then `dry_run: false`.
3. `bun test` green (including the existing parser/tracker tests).
4. **D1 replay harness green** against the canonical fixture — zero diffs in emitted events, `sendCommand` calls, broadcast `ServerEvent`s, or DB writes. A non-zero diff means stop and investigate before merging.
5. `gitnexus_detect_changes({scope: "staged"})` shows only expected files/symbols.
6. Manual smoke against staging MUD session for 5–10 minutes when extraction touches combat/navigation/farm paths.
7. PR is **one extraction only** (D2) and links back to the concern in `CONCERNS.md` it resolves.
8. Post-merge: `npx gitnexus analyze` runs (PostToolUse hook or manual). Index stays fresh for the next PR.

### Extraction Smells (stop and reconsider)

- Extraction PR touches >1 concern → split.
- `gitnexus_impact` shows HIGH/CRITICAL risk and you don't fully understand every caller → add tests for the riskiest caller first, then extract.
- Replay harness shows a diff in `ServerEvent` ordering → the bus or side-effect ordering is wrong. Do not merge; investigate.
- You want to rename a field "while moving it" → do the move first, rename in a separate PR.
- You want to "just clean up" an inline condition in the moved code → stop; that's A1.

---

## Frontend Freeze Playbook (>15s post-reload hang)

Executing T7. **Measure first, fix second.** The hang is 15 seconds on every reload, UI fully frozen → this is main-thread work, not network, not layout thrashing.

### Step 1 — Setup a clean profile environment

- Load page in Chrome with **Incognito** + DevTools open. Disable extensions (one is enough to muddy a profile).
- Chrome DevTools → Performance tab → Settings:
  - CPU throttling: **None** (we're characterising the real hang, not a worst case).
  - Network throttling: **No throttling**.
  - **Enable Advanced Paint Instrumentation** (off by default).
  - Record **over a full reload cycle**: click Record → hit reload → wait for UI to respond → stop recording.
- Also open Memory tab → Heap snapshot right before reload (baseline) and right after UI becomes responsive (post-freeze).

### Step 2 — Classify the freeze by shape

In the recorded Performance timeline, look at the **Main thread** track between `DOMContentLoaded` and the point where the UI responds. The shape tells you where the freeze is:

| Shape | Likely cause | Confirm with |
|-------|--------------|--------------|
| **One continuous long task (5–15s solid yellow block)** | Synchronous work on first paint — most likely Cytoscape init parsing a large graph, or a single `for`-loop building DOM. | Zoom into the task; bottom-up view shows the hottest function. Check if it's in `cytoscape.min.js` or in `client.js::renderGridMap`/`renderZoneMap`. |
| **Many medium tasks back-to-back (5s of stacked 100–500ms tasks)** | Storm of per-event work — e.g., the server replays accumulated `map_update` / `stats_update` / `output` events on reconnect, each triggering a full snapshot render. | Filter Main track by "WebSocket" marks; count `ServerEvent` dispatches in first 5s. CONCERNS.md "Full map snapshot broadcast on every room change" is a direct match for this shape. |
| **Long task + tall flame** | JS parse+compile of a large bundle. | Performance → Bottom-Up grouped by URL. Large time in `(anonymous)` inside `client.js` or `cytoscape` = parse/compile. Check bundle size in Network tab. |
| **Main thread idle, freezes at Layout/Recalc** | Style/layout storm — thousands of DOM nodes inserted before first paint. | Performance → "Experience" track shows long layout shifts. |
| **Main thread idle, long "Evaluate Script" on one file** | Synchronous top-level work at module load (e.g., a module that runs expensive code at import time). | Coverage tab (Cmd+Shift+P → "Show Coverage") — run and reload; modules with 100% used + large size are top-level-heavy. |

### Step 3 — Named-suspect checks (tied to CONCERNS.md)

Two suspects are pre-identified. Test each before searching wider.

**Suspect A — Eager Cytoscape (~500 KB):**
- Network tab → filter to `cytoscape*`. Is it requested in the initial HTML critical path (eager modulepreload)?
- If yes → Performance: is there a ≥500ms "Evaluate Script" task for it? → confirmed parse/init cost.
- Coverage tab → is most of Cytoscape's bytes **unused** on a reload where the global-map modal isn't opened? → confirmed dead-code-on-boot.
- Fix path: D8 (lazy-load behind modal open).

**Suspect B — Full map snapshot broadcast replay:**
- Server-side: grep the `debug.log` emitted during a freeze session for `map_update` events in the first 15s. Count them.
- Client-side: in Performance, scripting time attributed to `map-grid.ts`/`renderGridMap`. If it dominates, and `map_update` count is high → confirmed.
- Secondary signal: Network tab → WebSocket frames tab. Inspect size + count of `map_update` frames on reload. If the client gets 50+ full-zone snapshots in 15s, the cause is server replaying queued state.
- Fix path: D7 (incremental `map_delta` + debounce) or simpler: dedup/debounce on the client side first.

### Step 4 — If neither named suspect accounts for the freeze

Expand investigation:

- **Bundle audit:** `scripts/build-client.ts` produces `public/client.js`. Record its size and the sizes of lazy chunks. Large initial chunks are candidates. Use `--analyze` or a manual stat.
- **Top-level side-effect audit:** grep `src/client/**/*.ts` for module-level calls (not inside a function). Things like `fetch()` at import, large array construction, or heavy regex compilation happen at script evaluation.
- **`modulepreload` audit:** recent commit `0c29f16` mentions "eager chunks via build-time HTML rewrite". Verify the eager set contains only what truly must paint first. Anything there is paid at load.
- **WebSocket reconnect behaviour:** on reload, the client re-opens WS and the server dumps current state. Check `src/client/net.ts::createNet` pending queue — how big is it after reconnect? Check server: does it replay `recentOutputChunks` (200 chunks)? That's 200 `output` events delivered synchronously before the terminal is responsive.
- **Terminal back-buffer rendering:** `src/client/terminal.ts` — on a flood of `output` events post-reconnect, is each appended synchronously with layout? An ANSI parser + DOM append over 200 chunks could easily blow 15s.

### Step 5 — Reproduce-minimise-fix

Once the profile identifies the culprit:
- Reduce the repro to the smallest trigger (e.g., "reload with WS reconnect to server that has `recentOutputChunks` full" vs "reload with empty backlog").
- Fix behind a feature flag if the fix is non-trivial. Re-profile. Confirm freeze < 1s (target).
- Document the finding in `.planning/codebase/CONCERNS.md` Performance Bottlenecks for future reference.

### Common hiding spots for 15s freezes (checklist)

Ordered by prior probability in a codebase shaped like this one:

1. Synchronous replay of buffered server events on WS reconnect (output backlog, map snapshot queue).
2. Large graph library initialisation on first paint (Cytoscape).
3. Per-event full re-render in an imperative DOM (map-grid redrawing all nodes on every snapshot).
4. Top-level module work in a module imported from the entry bundle (hot-path regex compile, static data parse).
5. `JSON.parse` of a large persisted blob (e.g. a cached map snapshot from localStorage, if any).
6. Layout thrash from synchronous style reads interleaved with writes in a hot render loop.
7. Font loading blocking paint (unlikely here; app is monospace terminal-style).
8. A bug where a once-only init actually runs N times (e.g., listener leak attaching on every reconnect).

---

## MVP Definition

### Launch With (v1 of refactor — the milestone's completion bar)

The refactor is "done" when these are true:

- [ ] **T1 + D1 in place** — log-replay harness exists and is the regression oracle for every extraction PR.
- [ ] **T2 complete** — `server.ts` ≤ 400 lines, composition-only, all five named concerns extracted.
- [ ] **T3 complete** — `client/main.ts`, `client/map-grid.ts`, `wiki.ts` all split per PROJECT.md plan.
- [ ] **T4 complete** — event bus is the sole MUD-text fan-out mechanism; `onMudText` callback + `mudTextHandlers` set deleted; D3 flag removed.
- [ ] **T5 + T6 complete** — migration framework live; all inline schema evolution ported to numbered migrations; `mapStore.initialize()` contains no `ALTER`/`DROP`.
- [ ] **T7 complete** — freeze diagnosed, root cause documented, fix shipped OR explicit decision-doc explaining why the fix is deferred and to when.
- [ ] **T8 has been applied to every refactor PR** — evidence in commit history (D2 discipline + D10 checklist).
- [ ] **T9 covers the hot path** — tests exist for `navigation-controller`, `stats-parser`, `chat-parser`, `triggers`, `farm2` controller, `mud-connection`, `map/store`. Not wiki, not container-tracker, not compare-scan.
- [ ] **Behavioural parity proven** — replay harness emits byte-identical (or documented-diff-with-reason) outputs before/after milestone. A comparable delta against a fresh MUD session is similarly clean.
- [ ] **CLAUDE.md workflow still works** — `gitnexus analyze` runs green on the final branch; no tool references now dangle.

### Add After Validation (v1.x of refactor — follow-up milestones)

- [ ] Security milestone — rotate `respect1`, move credentials to env, audit git history (A7).
- [ ] Bug-fix sweep milestone — race fixes (`rashodExemptKeywords`, `upsertEdge`), `statsRazb` parsing, reconnect counter, parallel DB writes + race fix (A1, A13).
- [ ] Tooling milestone — CI, linter, formatter, `gitnexus analyze` in CI (A5).
- [ ] Dependency hygiene — `@ladybugdb/core` audit + Cytoscape alternative evaluation (A14).
- [ ] `zone-scripts` TODO(temp) repairs — investigate skipped rooms (A15).

### Future Consideration (v2+ / if needs emerge)

- [ ] Multi-character concurrent sessions (A6) — only if user requirements change.
- [ ] Observability/metrics (A12) — only if ops pain becomes real.
- [ ] Runtime schema validation with Zod (A9) — only if WS payload drift becomes a recurring bug source.
- [ ] ORM/query-builder migration (A11) — only if raw SQL becomes a maintenance problem.

---

## Feature Prioritization Matrix

Value = impact on Core Value ("сделать кодобазу проще в работе + устранить зависание"). Cost = engineering time + risk.

| # | Activity | User Value | Implementation Cost | Priority |
|---|----------|------------|---------------------|----------|
| T1 | Baseline fixture | HIGH (enables everything) | LOW | P1 |
| T2 | `server.ts` breakup | HIGH | HIGH | P1 |
| T3 | Client + wiki monolith breakup | HIGH | MEDIUM | P1 |
| T4 | Event bus | MEDIUM (structural payoff, not user-visible) | MEDIUM | P1 |
| T5 | Migration framework | MEDIUM (correctness, not user-visible) | LOW | P1 |
| T6 | Port inline ALTERs | MEDIUM | LOW | P1 |
| T7 | Freeze diagnosis | HIGH (user-visible pain) | MEDIUM | P1 |
| T8 | Per-extraction verification | HIGH (safety net) | LOW per step | P1 |
| T9 | Hot-path tests | MEDIUM (long-term) | MEDIUM | P1 |
| T10 | Rollout plan | HIGH (safety) | LOW | P1 |
| D1 | Replay harness | HIGH (force multiplier) | MEDIUM | P1 |
| D2 | Commit discipline | HIGH (review + bisect) | LOW | P1 |
| D3 | Event-bus feature flag | MEDIUM | LOW | P2 |
| D4 | Clock/timer injection | HIGH (enables D1, T9) | MEDIUM | P1 |
| D5 | Typed bus + exhaustiveness | MEDIUM | LOW | P2 |
| D6 | Migration integrity check | LOW | LOW | P3 |
| D7 | Incremental map protocol | HIGH if freeze cause | MEDIUM | P2 (gated on T7) |
| D8 | Lazy Cytoscape | HIGH if freeze cause | LOW | P2 (gated on T7) |
| D9 | Structured logs for refactor window | MEDIUM | LOW | P2 |
| D10 | PR gate template | HIGH (anti-feature shield) | LOW | P1 |
| D11 | Document single-writer invariant | MEDIUM (prevents A13) | LOW | P2 |
| D12 | Extraction checklist | MEDIUM | LOW | P2 |

**Priority key:**
- **P1** = in-scope for this milestone; completion bar depends on it.
- **P2** = in-scope if time allows; defer to follow-up if schedule slips. D7/D8 are gated on T7 findings regardless.
- **P3** = nice-to-have; deferrable without impacting Core Value.

---

## Competitor / Reference Analysis

No direct competitors (single-user tool). References are established industry practices:

| Topic | Reference Practice | Notable Variant | Our Approach |
|-------|-------------------|-----------------|--------------|
| Legacy refactor safety net | Feathers, *Working Effectively with Legacy Code* — "characterization tests" before edit | Approval/golden-master tests, snapshot testing | T1 + D1 log-replay harness (characterization test on real traffic capture) |
| Monolith break-up | Fowler, *Refactoring* — Extract Class, Extract Function | Strangler Fig (Fowler) for phased migration | Seam-first extraction inside a single process + D3 flag for the event-bus leg as a strangler |
| Event bus in functional TS | In-process pub/sub (Node `EventEmitter`, `mitt`, hand-rolled) | CQRS-style with typed event schema | Hand-rolled typed bus with discriminated unions (matches existing `ParsedEvent` style; no new dep) |
| DB migrations | `node-pg-migrate`, `umzug`, `graphile-migrate`, `db-migrate` | Roll-your-own numbered SQL + ledger table | Roll-your-own (T5) — matches the "minimal deps" philosophy, dev is solo, no team size justifies a framework |
| Browser freeze diagnosis | Chrome DevTools Performance profile → Long Tasks API | Google "Measure what users experience" — LCP/TTI/INP | Profile-driven playbook above; LCP/TTI are less relevant here since user is authenticated internal UI, but Long Task identification is core |
| Refactor commit discipline | "One refactor per commit" (Kent Beck) | "Tidy first" (Beck, 2024) — separate tidy commits from behaviour commits | D2 + D10 apply Beck's discipline strictly during the refactor window |

---

## Sources

- `.planning/PROJECT.md` (this project's active scope + out-of-scope decisions — authoritative for anti-feature list)
- `.planning/codebase/CONCERNS.md` (concern numbering cross-references throughout — primary source for what each activity fixes)
- `.planning/codebase/ARCHITECTURE.md` (pattern + layer definitions — authoritative for "keep factory pattern" and data-flow descriptions)
- `AGENTS.md` (project invariants: no-`any`, no-empty-catch, no-`console.log` in server — constraints on every refactor PR)
- `CLAUDE.md` (GitNexus workflow — mandates `gitnexus_impact` / `gitnexus_rename` / `gitnexus_detect_changes` in every extraction)
- Michael Feathers, *Working Effectively with Legacy Code* (seam-identification and characterization-testing foundations) — canonical reference
- Martin Fowler, *Refactoring: Improving the Design of Existing Code* (Extract Function, Extract Class catalogue) — canonical reference
- Martin Fowler, "Strangler Fig Application" pattern — canonical reference for D3 gradual migration approach
- Kent Beck, *Tidy First?* (2024) — commit discipline (D2) separating tidying from behaviour change
- Chrome DevTools Performance documentation — standard methodology for the T7 playbook; named tracks (Main, Experience, Coverage) and flame-graph shapes are standard tooling, not novel findings

---

*Feature research for: Brownfield Bun/TypeScript MUD-bot monolith refactor + event-bus migration + schema migrations + frontend freeze diagnosis*
*Researched: 2026-04-18*
