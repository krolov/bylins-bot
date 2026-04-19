---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: phase-complete
stopped_at: Completed 01-07-PLAN.md (Phase 1 complete)
last_updated: "2026-04-19T09:40:24.000Z"
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 7
  completed_plans: 7
  percent: 100
---

# STATE: bylins-bot — Monolith Refactor

**Initialized:** 2026-04-18
**Milestone:** monolith refactor (behaviour-preserving)

## Project Reference

**Core Value:** Сделать кодобазу проще в работе — разобрать монолиты и устранить >15-секундное зависание UI после reload — не меняя поведение бота.

**Current Focus:** Phase 01 — safety-harness-scaffolding-infrastructure

**Primary Constraints:**

- Behaviour-preserving: bit-for-bit identical bot behaviour (farm/combat/zone-scripts/triggers)
- Factory pattern `createXxx({deps})`; no classes in domain code
- Single-user, single-session assumption holds
- Bun + TypeScript strict + Postgres (porsager) — locked
- GitNexus workflow (`impact` before edit, `detect_changes` before commit, `rename` not find-and-replace)

## Current Position

Phase: 01 (safety-harness-scaffolding-infrastructure) — COMPLETE
Plan: 7 of 7 (done)
**Phase:** 1 of 4 — Safety Harness + Scaffolding Infrastructure (COMPLETE)
**Plan:** Plans 01 + 02 + 03 + 04 + 05 + 06 + 07 all complete; Phase 1 closed with SAFE-03/04/05 delivery
**Status:** Phase 01 Complete — ready for `/gsd-plan-phase 2`
**Progress:**

```
Overall:  [█████████████████████]  100% (7/7 plans in Phase 01; 1/4 phases complete)
Phase 1:  [█████████████████████]  100% (9/9 requirements — SAFE-01..05 + INFRA-01..04 all shipped; SAFE-03 documented + ports shipped, per-controller injection deferred to Phase 2 per D-15)
```

## Performance Metrics

Tracked at phase-completion boundaries.

| Metric | Baseline | Current | Target | Notes |
|--------|----------|---------|--------|-------|
| `wc -l src/server.ts` | 1867 | 1867 | ≤400 (after Phase 2) | Composition root only |
| `wc -l src/client/main.ts` | 1029 | 1029 | ≤300 (after Phase 3) | Pure bootstrap |
| `wc -l src/client/map-grid.ts` | 1046 | 1046 | split into 3 files (after Phase 3) | layout/render/interactions |
| `wc -l src/wiki.ts` | 955 | 955 | split into 3 files (after Phase 3) | client/parser/slots |
| UI first-interactive after F5 | >15s | >15s | <2s (after Phase 3) | 30-room typical zone |
| Hot-path test coverage | ~2 files (parser, tracker) | ~2 files | parser/triggers/farm2/mud-connection/map-store + extracted controllers + layout (after Phase 4) | per PROJECT.md scope |
| Replay harness diff | N/A | N/A | empty byte-for-byte (from Phase 1 through Phase 4) | Per-PR gate |
| Parser snapshot diff | N/A | N/A | empty byte-for-byte (from Phase 1 through Phase 4) | Per-PR gate |

## Accumulated Context

### Decisions

- **2026-04-18** — Roadmap granularity = coarse (4 phases) per user config; research suggested 8 phases consolidated into Safety+Scaffolding / Server+Bus-shim / Client+Freeze+Bus-final / Tests
- **2026-04-18** — Strangler-fig bus cutover splits across Phase 2 (BUS-01 shim + BUS-02 per-controller migration) and Phase 3 (BUS-03 delete) — preserves "both paths alive until last consumer migrates" invariant
- **2026-04-18** — Tests deferred to Phase 4 per PROJECT.md Key Decision ("Структура ПРЕЖДЕ тестов — писать против монолита дороже чем против разобранного модуля")
- **2026-04-18** — Extraction order within Phase 2: leaf-first (stats → chat → loot-sort → navigation → browser-gateway) recommended by research; PROJECT.md says user wants navigation first; roadmap flags this as planning-time decision to surface at `/gsd-plan-phase 2`
- **2026-04-19** — Plan 01 (SAFE-01 baseline extraction): locked `LOG_LINE_REGEXP` contract `/^\[(?<ts>[^\]]+)\] session=(?<session>\S+) direction=(?<direction>\S+) message=/`; Plans 05 (parser-snapshot) and 06 (replay-harness) MUST reuse this regex verbatim to prevent drift
- **2026-04-19** — Plan 01: exit-code contract published — 0=success, 1=usage/fs error, 2=empty-window warning; Plan 07 playbook must quote verbatim
- **2026-04-19** — Plan 01: half-open windowing `[start, endExclusive)` chosen over closed interval — matches idiomatic time-range semantics, avoids boundary double-count
- **2026-04-19** — Plan 02 (INFRA-01): roll-your-own `createMudBus` chosen over `mitt` (the research STACK.md open question resolved); MudEvent union has exactly one variant `mud_text_raw` in Phase 1; Phase 2 extends inline. `[bus] handler error for <kind>: <message>` error-message prefix convention locked; Phase 2 consumers will see this prefix in logEvent output
- **2026-04-19** — Plan 02: `once()` implemented as an `on()` wrapper that unsubscribes itself before invoking user handler — keeps the returned unsubscribe closure in sync with internal registration, prevents double-unsub bugs
- **2026-04-19** — Plan 02: test-helper pattern `makeDeps() → {deps, errors}` with closure-over-array established for future bus-consumer tests (Phase 2 will reuse this)
- **2026-04-19** — Plan 03 (INFRA-02 + partial SAFE-03): 5 port interfaces + 3 default factory impls committed pre-wired (D-29) in `src/ports/` + `src/ports/defaults/`. MapStore port intentionally excluded (D-28) — stays in `src/map/store.ts`. Port signatures locked: `MudCommandSink.send(command, source)`, `Broadcaster.broadcast(ServerEvent)`, `NowProvider.now(): number`, `TimerProvider.{setTimeout,clearTimeout,setInterval,clearInterval}` + `TimerHandle`/`IntervalHandle` aliases, `SessionTeardownRegistry.{register,invokeAll}`. Phase 2 extractions import these identifiers by name — rename = break.
- **2026-04-19** — Plan 03: `MudCommandSink.send(source: string)` vocabulary fixed at 18 values (enumerated in 01-03-SUMMARY.md "Source-String Vocabulary" table) — Phase 2 controllers reuse verbatim, do NOT invent new sources without a logged deviation; protects mud-out log-audit grep patterns.
- **2026-04-19** — Plan 03: `createDefaultSessionTeardownRegistry.invokeAll()` does NOT wrap hooks in try/catch by design — mirrors existing `server.ts:158` no-catch semantic. Phase 2 composition root decides error-isolation policy (wrap at registration if needed); port default stays minimal.
- **2026-04-19** — Plan 03: `[...hooks]` snapshot-before-iterate inside `invokeAll()` is a CONTRACT requirement mirroring Plan 02 bus emit defense; any future re-implementation must preserve this (do NOT switch to `hooks.forEach` or direct `for..of hooks`).
- **2026-04-19** — Plan 04 (INFRA-03 + INFRA-04): `ADVISORY_LOCK_ID = 727465` locked runtime contract; never change — would orphan migrations mid-flight against any running pre-change process. Transaction-scoped `pg_advisory_xact_lock` (not session-scoped `pg_advisory_lock`) chosen — auto-releases on commit/rollback, no leak on process crash.
- **2026-04-19** — Plan 04: three-state baseline-pump machine locked (D-31). Branches: (1) schema_migrations absent + map_rooms present → seed all ids WITHOUT executing SQL (production-unmigrated); (2) schema_migrations absent + map_rooms absent → apply every migration (fresh-install); (3) schema_migrations present → apply only unregistered. Branch 1 is the pitfall-5 mitigation; unit test case 2 asserts zero `tx.unsafe` calls in that branch.
- **2026-04-19** — Plan 04: migration filename regex `/^\d{14}-[a-z0-9-]+\.sql$/` is a T-01-04-02 SQL-injection mitigation (rejects stray dev scratch files). Timestamp prefixes `20260418180000/180100/180200` are load-bearing — runner seeds schema_migrations using these exact ids; renaming a file breaks seed-reconciliation on already-migrated prod DBs.
- **2026-04-19** — Plan 04: fail-fast semantic locked (D-35). `runMigrations()` does not catch; `mapStore.initialize()` does not catch; process exits non-zero on any migration error. Matches existing `DATABASE_URL missing` refuse-to-start semantic at `src/config.ts:110`. Phase 2 composition root may inject a real `onLog` dep but must preserve no-catch policy.
- **2026-04-19** — Plan 04: postgres.js v3 typing gap — `TransactionSql<TTypes>` extends `Omit<Sql<TTypes>, ...>` which drops the callable tagged-template signatures. Runner works around via single `as unknown as DatabaseClient` cast inside the `.begin()` callback; documented inline. Phase 2+ migrations MUST reuse this exact pattern — do NOT attempt alternative typing (intersection tricks) that add noise.
- **2026-04-19** — Plan 04: destructive migrations list bootstrapped with `20260418180200-drop-farm-zone-settings.sql`. Plan 07 (`docs/refactor-playbook.md`) must enumerate this list verbatim so operators know which migrations require pre-run backups.
- **2026-04-19** — Plan 04: baseline.sql captures full production reality (17 tables, not just the 8 in store.ts inline DDL). `pg_dump --schema-only --no-owner --no-privileges` + idempotency retrofit (`IF NOT EXISTS` + `DO $$ ... pg_constraint` guards). Fresh-install creates the complete schema; prod seed-only path preserves existing data.
- **2026-04-19** — Plan 05 (SAFE-02 parser snapshot): `LOG_LINE_REGEXP` reused verbatim from Plan 01's `scripts/extract-baseline.ts` (stops at `message=` prefix; does NOT capture message body). Plan 05's own action section contained a longer regex but its acceptance criterion demanded byte-equality with Plan 01 — resolved in favor of Plan 01's invariant. Message body extraction handled via new `extractMessageLiteral(line, matchLength)` helper that walks the quoted-string tail honouring backslash escapes; returns the JSON-string literal ready for `JSON.parse`. Plan 06 (replay-harness) MUST reuse both the same LOG_LINE_REGEXP AND the extractMessageLiteral pattern.
- **2026-04-19** — Plan 05: JSONL contract locked — one line per CHUNK (not per event), shape `{chunkIndex: number, events: ParsedEvent[]}`. Zero-event chunks still emit `{"chunkIndex":N,"events":[]}` so line numbering stays in sync with chunk numbering. Single shared `ParserState` across the entire stream (one `createParserState()` at script start, fed iteratively) — resetting per-chunk would corrupt output because lineBuffer/rawLineBuffer/pendingMobs accumulate across chunks.
- **2026-04-19** — Plan 05: Exit-code contract published — `0` success (including `--write-initial`) / `1` diff-or-error / `2` fixture missing. Plan 07's pre-commit hook MUST distinguish these: `0` allow commit, `1` block commit with first-diff line, `2` warn-but-don't-block (fresh clone without local fixture).
- **2026-04-19** — Plan 05: `snapshots/parser-before.jsonl` deliberately NOT committed by this plan — it is a developer-generated artifact requiring Plan 01's baseline fixture which is gitignored and local-only. Seed ritual (extract-baseline → parser:snapshot --write-initial → commit) documented in Plan 07's playbook. `snapshots/.gitkeep` ensures the directory is tracked in git before the first seed.
- **2026-04-19** — Plan 05: Byte-exact JSONL diff (no jsondiffpatch / deep-diff dep) chosen — implementation ~15 LOC (`diffSnapshots` returns `{equal, firstDiff}`). Per D-19 any textual divergence IS the regression signal we want; tolerance-based or semantic diff would mask real drift. Plan 06 can copy this template for replay-harness side-effect diff.
- **2026-04-19** — Plan 06 (SAFE-01 runtime): replay harness shipped as `scripts/replay-harness.ts` (311 LOC) + `scripts/lib/fake-clock.ts` (155 LOC) + `scripts/lib/mock-map-store.ts` (192 LOC). CLI shape + exit codes (0/1/2) mirror Plan 05 verbatim. LOG_LINE_REGEXP + `extractMessageLiteral` helper reused from Plan 05 (single-source-of-truth invariant now spans THREE scripts: extract-baseline, parser-snapshot, replay-harness). JSONL transcript schema locked: `{seq: number, kind: string, ...payload}` with dot-separated `kind` namespace (`bus.emit` / `bus.error` / `parser.events` / `mapStore.<method>` / `timer.schedule-<kind>` / `timer.clear-<kind>` / `timer.fire`). Phase 2 extractions grow the kind namespace but do not reshape the schema.
- **2026-04-19** — Plan 06: fake clock virtual-time seeded from first baseline timestamp (D-10). `createFakeClock(seedMs, sink)` returns `{now, timer, advanceTo, drain, nowMs}`. `advanceTo(t)` fires eligible timers in fireAt-ascending order emitting `timer.fire` BEFORE callback invocation (transcript reflects real-time dispatch). `drain()` at end-of-stream wakes all pending timers. `createFakeNowProvider(seedMs)` is a real standalone factory for Phase 4 tests; `createFakeTimerProvider()` is a throw-stub naming export (production-replay callers use `createFakeClock`). 4 boundary casts between numeric ids and opaque setTimeout/setInterval handle types — all confined to the factory interior.
- **2026-04-19** — Plan 06: mock MapStore is an object literal satisfying `MapStore` directly — zero boundary casts (contrast Plan 04's runner.test.ts mock which needed `as unknown as DatabaseClient`). tsc guarantees completeness: adding a MapStore method without updating the mock fails typecheck. 44 methods; reads return minimal defaults (`[]` / `null` / `{}` / empty `MapSnapshot`); writes return `Promise<void>`. No `postgres` import; hermetic spy.
- **2026-04-19** — Plan 06: `bus.emit` transcript entry emitted BEFORE `bus.emit()` call — preserves chronological ordering `harness-intent → subscriber-side-effects → parser.events` when Phase 2 subscribers land (D-29: Phase 1 has no subscribers, so the ordering is moot in Phase 1 but locks the invariant for Phase 2+). `void mapStore;` silences unused-variable warning while keeping the full pipeline wired — Phase 2 extractions snap in via composition without reshaping the harness.
- **2026-04-19** — Plan 06: `snapshots/replay-before.jsonl` deliberately NOT committed by this plan — same pattern as Plan 05's `parser-before.jsonl`. Plan 06 ships tooling only; Plan 07's playbook documents the one-time developer seed ritual (extract-baseline → replay:check --write-initial → review → commit). `snapshots/.gitkeep` (shipped by Plan 05) ensures the directory is tracked.
- **2026-04-19** — Plan 06: `package.json` gained `"replay:check": "bun run scripts/replay-harness.ts"` script entry. Zero new dependencies added (D-30 invariant). Plan 07's pre-commit hook will invoke `bun run replay:check` (and `bun run parser:snapshot`) on commits matching `refactor(...)` message or `refactor/*` branch. Exit-code handling: `0` allow commit, `1` block with first-diff line printed, `2` warn-but-don't-block (fresh clone without baseline fixture).
- **2026-04-19** — Plan 07 (SAFE-03 docs + SAFE-04 + SAFE-05): closed Phase 1 with three artifacts — `docs/refactor-playbook.md` (14 KB, 8 required `##` sections + Tooling Reference + Glossary), `docs/mud-phrases.md` (32 KB, 14 source-file sections, 104 regex-feature entries with verbatim literals + purpose + example match), `.githooks/pre-commit` (37-line bash, executable, refactor-context-gated `bun run replay:check`). Zero new `package.json` scripts (D-30 invariant preserved). 1042 lines added in mud-phrases; regex fidelity spot-check verified `ROOM_HEADER_REGEXP` byte-identical between doc and `src/map/parser.ts`.
- **2026-04-19** — Plan 07: pre-commit hook predicate locked as `branch == refactor/* OR commit_msg == *refactor(*`; exit-code propagation from `bun run replay:check` — 0 allow, 1/2 block (both with diagnostic to stderr). Non-refactor path exits 0 fast without invoking the harness (verified via synthetic empty commit-msg on `main`). Plain bash per D-09 — no husky, no node-based hook manager. Activation is voluntary (`git config core.hooksPath .githooks`).
- **2026-04-19** — Plan 07: SAFE-03 scope boundary documented explicitly in playbook's "Clock and Timer Injection" section — Phase 1 shipped ports (Plan 03) + docs (Plan 07); Phase 2 ships the actual controller injection per D-15. Playbook names `src/ports/now-provider.ts` + `src/ports/timer-provider.ts` + `scripts/lib/fake-clock.ts` verbatim so Phase 2 extractors import the right identifiers.
- **2026-04-19** — Plan 07: mud-phrases.md covered 8 EXTRA source files beyond the 6 frontmatter-required (gather-script, combat-state, repair-script, container-tracker, zone-scripts/farm-zone-executor2, mob-resolver, compare-scan, equip-utils). Duplication flags called out inline for 6 shared regex families: short-form ANSI (5 copies), full-form ANSI (7 copies), TARGET_PREFIX (3), DARK_ROOM (2 exact + 1 variant), ROOM_PROMPT (3), TARGET_NOT_VISIBLE (2). Phase 2+ consolidation candidates now visible at a glance.
- **2026-04-19** — Plan 07: destructive migration `20260418180200-drop-farm-zone-settings.sql` (Plan 04) called out by name in playbook's Destructive Migrations section with `pg_dump` backup protocol documented. Future destructive migrations require adding a new entry here — the pre-commit hook does not catch this, it is a human-review gate.
- **2026-04-19** — Plan 07: playbook documents developer seed ritual (extract-baseline → parser:snapshot --write-initial → replay:check --write-initial → commit snapshots/*-before.jsonl). Plan 07 ships PROCESS not artifacts — `snapshots/parser-before.jsonl` and `snapshots/replay-before.jsonl` remain developer-generated, uncommitted at this point. Whoever owns the first Phase 2 refactor PR (or a separate Phase 1 closure operation) seeds them.

### Open Questions (for future plan-phase sessions)

- Phase 2: navigation-first (user preference) vs leaf-first (research recommendation)? — decide at `/gsd-plan-phase 2`
- ~~Phase 1: `mitt` (3.0.1, <200 bytes) vs roll-your-own `createMudBus` (~80 LOC) for INFRA-01?~~ — **RESOLVED 2026-04-19 Plan 02: roll-your-own shipped in `src/bus/mud-event-bus.ts` (72 LOC)**
- ~~Phase 1: `postgres-shift` (0.1.0, Dec 2022, low maintenance) vs roll-your-own (~40 LOC) for INFRA-03? STACK.md says both valid~~ — **RESOLVED 2026-04-19 Plan 04: roll-your-own shipped in `src/map/migrations/runner.ts` (106 LOC) — baseline-pump strategy required custom state machine; postgres-shift couldn't express this cleanly**
- Phase 3: if FREEZE-01 identifies `map_delta` as root cause, PERF-01 from v2 promotes into this milestone; otherwise defer
- Phase 2: loot-sort ↔ gather-script `onPickupForRaskhod` — bus event or direct callback? (single consumer → leaning direct)
- Phase 2: combat-state — queryable singleton (current) or emit `combat_started`/`combat_ended` via bus? (research leans queryable, post-milestone polish if needed)

### Todos (carry across phases)

None yet — populated as phases surface cross-cutting work.

### Blockers

None. Ready to `/gsd-plan-phase 1`.

## Requirements Trace

Full traceability in REQUIREMENTS.md Traceability section (populated during roadmap creation).

| Category | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|----------|---------|---------|---------|---------|
| SAFE-* (5) | SAFE-01..05 | — | — | — |
| INFRA-* (4) | INFRA-01..04 | — | — | — |
| SRV-* (6) | — | SRV-01..06 | — | — |
| BUS-* (3) | — | BUS-01, BUS-02 | BUS-03 | — |
| CLI-* (9) | — | — | CLI-01..09 | — |
| FREEZE-* (2) | — | — | FREEZE-01, FREEZE-02 | — |
| TEST-* (7) | — | — | — | TEST-01..07 |
| **Total** | **9** | **8** | **12** | **7** |

## Session Continuity

**Last action:** Plan 07 (SAFE-03 docs + SAFE-04 + SAFE-05) executed — 3 atomic commits (`f8e0d5f` docs/refactor-playbook.md, `7147ada` docs/mud-phrases.md, `1df2cc1` .githooks/pre-commit), SUMMARY at `.planning/phases/01-safety-harness-scaffolding-infrastructure/01-07-SUMMARY.md`. Typecheck clean; full suite 35/35 pass (zero regressions from Plan 06 baseline). 1364 lines added across three new files. Zero new dependencies + zero new `package.json` scripts (D-30/D-21 invariants preserved). Regex fidelity spot-check verified `ROOM_HEADER_REGEXP` byte-identical between `docs/mud-phrases.md` and `src/map/parser.ts`. Zero deviations; plan executed exactly as written. Phase 1 closes with all 9 requirements (SAFE-01..05 + INFRA-01..04) delivered.
**Last session:** 2026-04-19T09:40:24Z
**Stopped at:** Completed 01-07-PLAN.md (Phase 1 complete)
**Next command:** `/gsd-plan-phase 2` — begin Phase 2 (server.ts Extraction + Bus Cutover Strangler-Fig). Must resolve the navigation-first vs leaf-first ordering question (noted as open question below) at the start of plan-phase.
**Last file edited:** `docs/refactor-playbook.md`, `docs/mud-phrases.md`, `.githooks/pre-commit`, `.planning/phases/01-safety-harness-scaffolding-infrastructure/01-07-SUMMARY.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`
**Working directory:** `/root/bylins-bot`
**Git branch:** `main`
**Git status at creation:** M AGENTS.md, M CLAUDE.md, M src/client/main.ts (pre-existing modifications, not part of this milestone yet)

## Key Files Reference

**Planning artifacts:**

- `.planning/PROJECT.md` — project scope
- `.planning/REQUIREMENTS.md` — v1 requirements + traceability
- `.planning/ROADMAP.md` — phase breakdown (this milestone)
- `.planning/STATE.md` — this file
- `.planning/research/` — stack/features/architecture/pitfalls synthesis
- `.planning/codebase/CONCERNS.md` — grounded tech debt
- `.planning/config.json` — granularity=coarse, mode=yolo, sequential

**Hot-path source files (monoliths to break):**

- `src/server.ts` (1867 LOC) → Phase 2
- `src/client/main.ts` (1029 LOC) → Phase 3
- `src/client/map-grid.ts` (1046 LOC) → Phase 3
- `src/wiki.ts` (955 LOC) → Phase 3

**Hot-path source files (ports target):**

- `src/mud-connection.ts` (492 LOC) — touches in Phase 1 (bus shim) + Phase 3 (remove callback API)
- `src/map/store.ts` (726 LOC — was 838 pre-Plan-04; inline DDL removed in Plan 04) — future touches deferred post-Phase-1

---
*State initialized: 2026-04-18 after roadmap creation*
*Last updated: 2026-04-19 after Plan 07 completion — Phase 1 complete*
