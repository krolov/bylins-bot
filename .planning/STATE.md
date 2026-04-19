---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 01-05-PLAN.md
last_updated: "2026-04-19T09:12:43.000Z"
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 7
  completed_plans: 5
  percent: 71
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

Phase: 01 (safety-harness-scaffolding-infrastructure) — EXECUTING
Plan: 6 of 7 (next)
**Phase:** 1 of 4 — Safety Harness + Scaffolding Infrastructure
**Plan:** Plans 01 + 02 + 03 + 04 + 05 complete; Wave-3 Plan 06 (replay-harness) next in sequential execution
**Status:** Executing Phase 01
**Progress:**

```
Overall:  [██████████████░░░░░░]  71% (5/7 plans in Phase 01)
Phase 1:  [█████████████░░░░░░░]  66% (6/9 requirements — SAFE-01, SAFE-02, INFRA-01, INFRA-02, INFRA-03, INFRA-04 done; SAFE-03 partially done via ports — default impls shipped, per-controller injection deferred to Phase 2 per D-15)
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

**Last action:** Plan 05 (SAFE-02 parser snapshot) executed — 2 commits (`8905c0d` feat scripts/parser-snapshot.ts, `14e8a2a` chore snapshots/.gitkeep + package.json parser:snapshot entry), SUMMARY at `.planning/phases/01-safety-harness-scaffolding-infrastructure/01-05-SUMMARY.md`. Typecheck clean; full suite 35/35 pass (zero regressions from Plan 04 baseline). Script: 248 LOC, streaming I/O, LOG_LINE_REGEXP verbatim from Plan 01 (byte-identical via `diff <(grep ...) <(grep ...)` gate), `{chunkIndex, events}` JSONL per D-11, exit codes 0/1/2 per Plan 07 playbook. 2 deviations auto-resolved (Rule 3): plan's action-section regex contradicted its acceptance criterion → used Plan 01's shorter regex + extractMessageLiteral helper; comment-word "any" triggered grep gate → rephrased. No pre-existing symbols edited; GitNexus impact analysis not applicable.
**Last session:** 2026-04-19T09:12:43Z
**Stopped at:** Completed 01-05-PLAN.md
**Next command:** `/gsd-execute-plan 01 06` (or `/gsd-execute-phase 1` continuation) — Wave 3 Plan 06 (SAFE-01 replay-harness); Plan 07 (SAFE-04/05 docs + pre-commit hook) closes the phase.
**Last file edited:** `scripts/parser-snapshot.ts`, `snapshots/.gitkeep`, `package.json`, `.planning/phases/01-safety-harness-scaffolding-infrastructure/01-05-SUMMARY.md`
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
