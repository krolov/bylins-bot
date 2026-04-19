---
phase: 01-safety-harness-scaffolding-infrastructure
verified: 2026-04-19T12:00:00Z
status: gaps_found
score: 5/6 must-haves verified
overrides_applied: 0
gaps:
  - truth: "bun run scripts/replay-harness.ts reproduces 30 minutes of real MUD traffic and emit-sequence + DB writes + broadcast ServerEvents coincide with recorded snapshot (zero diff)"
    status: partial
    reason: "Harness tooling exists and is correctly wired, but snapshots/replay-before.jsonl has never been seeded — the developer ritual (bun run replay:check --write-initial) documented in the playbook has not been run. SC-1 requires the diff to be zero; without a committed baseline snapshot the harness exits 0 on every run because it finds no fixture and returns early rather than diffing. The oracle is built but not armed."
    artifacts:
      - path: "snapshots/replay-before.jsonl"
        issue: "File does not exist. Only snapshots/.gitkeep is committed. The playbook documents the seed ritual but it has not been executed."
      - path: "snapshots/parser-before.jsonl"
        issue: "File does not exist. Same issue as replay-before.jsonl."
    missing:
      - "Run: bun run scripts/extract-baseline.ts --start <ISO> to generate .fixtures/mud-traffic-baseline.log locally"
      - "Run: bun run parser:snapshot --write-initial to seed snapshots/parser-before.jsonl"
      - "Run: bun run replay:check --write-initial to seed snapshots/replay-before.jsonl"
      - "git add snapshots/parser-before.jsonl snapshots/replay-before.jsonl && git commit -m 'feat(01): seed initial regression snapshots'"
  - truth: "Migration framework works: bun run scripts/verify-schema.ts confirms live prod schema matches baseline dump"
    status: failed
    reason: "scripts/verify-schema.ts does not exist. Roadmap SC-5 explicitly names this script as part of the migration framework success criterion. None of the seven plans included it in must_haves or tasks — it was in ROADMAP.md and research/FEATURES.md (D6, LOW priority) but was silently dropped during planning. The migration runner, advisory lock, baseline-pump, and INFRA-04 inline-DDL removal are all correctly implemented; only the schema-verification utility is missing."
    artifacts:
      - path: "scripts/verify-schema.ts"
        issue: "File does not exist. Referenced in ROADMAP.md SC-5 as the mechanism confirming prod schema matches baseline dump."
    missing:
      - "Create scripts/verify-schema.ts that queries information_schema.columns and compares against the expected columns from 20260418180000-baseline.sql; exits 0 if match, 1 with diff on mismatch"
      - "Add 'verify:schema' script entry to package.json"
---

# Phase 1: Safety Harness + Scaffolding Infrastructure — Verification Report

**Phase Goal:** Установлен regression oracle (baseline replay + parser snapshot) и структурные примитивы (ports, typed event bus, migration framework + baseline seed) — всё готово для безопасного извлечения символов без единого касания server.ts domain logic.
**Verified:** 2026-04-19T12:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| SC-1 | `bun run scripts/replay-harness.ts` reproduces 30 min MUD traffic from `.fixtures/mud-traffic-baseline.log`; emit-sequence + DB writes + broadcasts match snapshot (zero diff) | ⚠️ PARTIAL | Harness wired correctly; exits 0 but only because fixture is absent — returns early, never diffs. `snapshots/replay-before.jsonl` not committed. |
| SC-2 | `bun run scripts/parser-snapshot.ts` runs parser.ts over baseline; `snapshots/after.jsonl` byte-identical to `snapshots/before.jsonl` | ⚠️ PARTIAL | Script correct and wired to parser.ts; exits 0 because fixture absent. `snapshots/parser-before.jsonl` not committed. Both failures share one root cause: seed ritual not run. |
| SC-3 | `src/bus/mud-event-bus.ts` exists with typed discriminated union, sync delivery, listener-snapshot-before-iterate, try/catch per handler; all D-25 tests pass | ✓ VERIFIED | 7/7 bun:test cases pass. `[...bucket]` and `[...anyHandlers]` snapshots confirmed. `[bus] handler error for` error prefix confirmed. `bun test src/bus/mud-event-bus.test.ts` exits 0. |
| SC-4 | `src/ports/` contains clean interfaces `MudCommandSink`, `Broadcaster`, `MapStore`, `NowProvider`, `TimerProvider`, `SessionTeardownRegistry`; no controller imports them yet | ✓ VERIFIED (with documented deviation) | Five of six interfaces shipped. `MapStore` intentionally absent per D-28 (REQUIREMENTS.md INFRA-02 already records this deviation with rationale). Zero imports from `src/ports/` outside `src/ports/` itself confirmed. |
| SC-5 | Migration framework works: `schema_migrations` table created via baseline-seed (not re-run), advisory lock held, `bun run scripts/verify-schema.ts` confirms live prod schema matches baseline dump; `mapStore.initialize()` reduced to migration runner call | ✗ FAILED | `scripts/verify-schema.ts` does not exist. Runner, advisory lock, baseline-pump logic, and INFRA-04 inline-DDL removal all confirmed correct. Only the schema-verification utility is missing. |
| SC-6 | `docs/mud-phrases.md` contains inventory of all hardcoded Russian MUD phrases/regexes; `docs/refactor-playbook.md` describes commit convention | ✓ VERIFIED | All eight required `##` sections present in mud-phrases.md. All ten required `##` sections in refactor-playbook.md. All required exact strings confirmed including `gitnexus_impact`, `bun run replay:check`, `git config core.hooksPath .githooks`, destructive migration reference, ports references. |

**Score: 4/6 truths verified** (SC-1 and SC-2 share one root cause: snapshots not seeded; SC-5 is a separate missing artifact)

---

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `scripts/extract-baseline.ts` | ✓ VERIFIED | Streaming I/O (createReadStream + createInterface), no readFileSync, exits 1 on missing --start, correct LOG_LINE_REGEXP, no console.log, no Cyrillic |
| `src/bus/types.ts` | ✓ VERIFIED | 5 exports: MudEvent, MudEventHandler, Unsubscribe, MudEventBus, MudEventBusDependencies. No runtime code. |
| `src/bus/mud-event-bus.ts` | ✓ VERIFIED | `createMudBus` factory, `[...bucket]` and `[...anyHandlers]` snapshot-before-iterate, error prefix `[bus] handler error for`, no `any`, no `console`, no async delivery |
| `src/bus/mud-event-bus.test.ts` | ✓ VERIFIED | 7 tests, all pass. Covers: no-handler emit, many handlers, self-remove mid-dispatch, once, onAny, error isolation, typed payload narrowing |
| `src/ports/mud-command-sink.ts` | ✓ VERIFIED | Interface-only, `send(command: string, source: string): void` |
| `src/ports/broadcaster.ts` | ✓ VERIFIED | Interface-only, imports `ServerEvent` from `../events.type.ts` |
| `src/ports/now-provider.ts` | ✓ VERIFIED | Interface-only, `now(): number` |
| `src/ports/timer-provider.ts` | ✓ VERIFIED | Interface-only, exports `TimerHandle`, `IntervalHandle` type aliases |
| `src/ports/session-teardown-registry.ts` | ✓ VERIFIED | Interface-only, `register(hook: () => void): () => void`, `invokeAll(): void` |
| `src/ports/defaults/now.ts` | ✓ VERIFIED | `createDefaultNowProvider()`, wraps `Date.now()` |
| `src/ports/defaults/timer.ts` | ✓ VERIFIED | `createDefaultTimerProvider()`, all four globalThis delegates present |
| `src/ports/defaults/session-teardown.ts` | ✓ VERIFIED | `createDefaultSessionTeardownRegistry()`, `new Set<() => void>()`, `[...hooks]` snapshot-before-iterate |
| `src/map/migrations/runner.ts` | ✓ VERIFIED | `export async function runMigrations`, `pg_advisory_xact_lock(727465)`, `schema_migrations`, `CREATE TABLE IF NOT EXISTS schema_migrations`, `database.begin` |
| `src/map/migrations/20260418180000-baseline.sql` | ✓ VERIFIED | 18 `CREATE TABLE` statements, zero SET OWNER/GRANT/CREATE USER/ROLE |
| `src/map/migrations/20260418180100-add-has-wiki-data.sql` | ✓ VERIFIED | `ALTER TABLE game_items ADD COLUMN IF NOT EXISTS has_wiki_data` present |
| `src/map/migrations/20260418180200-drop-farm-zone-settings.sql` | ✓ VERIFIED | `DROP TABLE farm_zone_settings`, `DO $$ BEGIN`, `farm_zone_settings_pkey` present |
| `src/map/migrations/runner.test.ts` | ✓ VERIFIED | 4 tests pass. Covers baseline-pump detection, schema_migrations, runMigrations |
| `src/map/store.ts` | ✓ VERIFIED | `initialize()` reduced to `await runMigrations(database)`. Zero inline DDL remaining. |
| `scripts/parser-snapshot.ts` | ✓ VERIFIED | Imports from `../src/map/parser.ts`, filters `direction=mud-in`, references both snapshot paths, `chunkIndex` present |
| `snapshots/.gitkeep` | ✓ VERIFIED | Tracked in git (`git ls-files snapshots/` returns `snapshots/.gitkeep`) |
| `snapshots/parser-before.jsonl` | ✗ MISSING | Seed ritual not run. Developer must run extract-baseline + parser:snapshot --write-initial. |
| `snapshots/replay-before.jsonl` | ✗ MISSING | Seed ritual not run. Developer must run extract-baseline + replay:check --write-initial. |
| `scripts/replay-harness.ts` | ✓ VERIFIED | Imports createMudBus, createParserState, feedText, createMockMapStore, createFakeClock; references both snapshot paths, `direction=mud-in`, `mud_text_raw` |
| `scripts/lib/mock-map-store.ts` | ✓ VERIFIED | `import type { MapStore }` from store.ts, `export function createMockMapStore` |
| `scripts/lib/fake-clock.ts` | ✓ VERIFIED | Exports `createFakeClock`, `createFakeNowProvider`, `createFakeTimerProvider`. Implements both `NowProvider` and `TimerProvider` interfaces. |
| `scripts/verify-schema.ts` | ✗ MISSING | Referenced in Roadmap SC-5. Not planned in any of the 7 plans. |
| `docs/refactor-playbook.md` | ✓ VERIFIED | All 8 required `##` sections present. All required exact strings confirmed. |
| `docs/mud-phrases.md` | ✓ VERIFIED | All 8 required `##` source-file sections present. |
| `.githooks/pre-commit` | ✓ VERIFIED | Executable (`-rwxr-xr-x`), contains `#!/usr/bin/env bash`, `bun run replay:check`, `refactor/`, `refactor(` |
| `package.json` scripts | ✓ VERIFIED | `parser:snapshot`, `replay:check`, `migrate`, `migrate:status` all present. No new runtime dependencies added (dependencies block identical to pre-Phase-1). |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scripts/extract-baseline.ts` | `/var/log/bylins-bot/mud-traffic.log` | `createReadStream` on absolute path | ✓ WIRED | `DEFAULT_SOURCE_LOG = "/var/log/bylins-bot/mud-traffic.log"` confirmed |
| `scripts/extract-baseline.ts` | `.fixtures/mud-traffic-baseline.log` | `createWriteStream` on relative path | ✓ WIRED | `DEFAULT_OUTPUT_PATH = ".fixtures/mud-traffic-baseline.log"` confirmed |
| `src/bus/mud-event-bus.ts` | `src/bus/types.ts` | `import type { MudEvent, MudEventBus, MudEventBusDependencies, MudEventHandler, Unsubscribe }` | ✓ WIRED | Confirmed |
| `src/bus/mud-event-bus.test.ts` | `src/bus/mud-event-bus.ts` | `import { createMudBus }` | ✓ WIRED | Confirmed |
| `src/ports/broadcaster.ts` | `src/events.type.ts` | `import type { ServerEvent } from "../events.type.ts"` | ✓ WIRED | Confirmed |
| `src/ports/defaults/now.ts` | `src/ports/now-provider.ts` | `import type { NowProvider }` | ✓ WIRED | Confirmed |
| `src/ports/defaults/timer.ts` | `src/ports/timer-provider.ts` | `import type { TimerProvider, TimerHandle, IntervalHandle }` | ✓ WIRED | Confirmed |
| `src/ports/defaults/session-teardown.ts` | `src/ports/session-teardown-registry.ts` | `import type { SessionTeardownRegistry }` | ✓ WIRED | Confirmed |
| `src/map/store.ts` | `src/map/migrations/runner.ts` | `import { runMigrations } from "./migrations/runner.ts"` | ✓ WIRED | Confirmed. initialize() body is single await. |
| `scripts/replay-harness.ts` | `src/bus/mud-event-bus.ts` | `import { createMudBus }` | ✓ WIRED | Confirmed |
| `scripts/replay-harness.ts` | `src/map/parser.ts` | `import { createParserState, feedText }` | ✓ WIRED | Confirmed |
| `scripts/replay-harness.ts` | `scripts/lib/mock-map-store.ts` | `import { createMockMapStore }` | ✓ WIRED | Confirmed |
| `scripts/replay-harness.ts` | `scripts/lib/fake-clock.ts` | `import { createFakeClock }` | ✓ WIRED | Confirmed. Note: plan frontmatter named `createFakeNowProvider`/`createFakeTimerProvider` as expected strings; implementation uses `createFakeClock` composite factory. Both `createFakeNowProvider` and `createFakeTimerProvider` are exported from fake-clock.ts and satisfy the NowProvider/TimerProvider interfaces. Goal achieved; name deviation is cosmetic. |
| `scripts/lib/mock-map-store.ts` | `src/map/store.ts::MapStore` | `import type { MapStore }` | ✓ WIRED | Confirmed |
| `scripts/lib/fake-clock.ts` | `src/ports/now-provider.ts` + `src/ports/timer-provider.ts` | `import type { NowProvider }`, `import type { TimerProvider }` | ✓ WIRED | Confirmed |
| `docs/refactor-playbook.md` | `.githooks/pre-commit` | `git config core.hooksPath .githooks` instruction | ✓ WIRED | Confirmed |

---

### Invariant Verification (D-28, D-29, D-30, D-13, Phase Scope)

| Invariant | Status | Evidence |
|-----------|--------|---------|
| D-28: No `src/ports/map-store.ts` | ✓ PASS | File does not exist. `MapStore` stays in `src/map/store.ts`. |
| D-29: No src/ controller imports from `src/ports/` | ✓ PASS | `grep -rn "from.*ports/" src/ --include="*.ts"` excluding `src/ports/` itself returns zero matches. |
| D-30: No new runtime dependencies | ✓ PASS | `dependencies` block in package.json identical to pre-Phase-1 commit `51a2fc4`. New scripts added to devDependencies section only. |
| D-13: `snapshots/` tracked, `.fixtures/` gitignored | ✓ PASS | `git ls-files snapshots/` returns `snapshots/.gitkeep`. `.gitignore` has `.fixtures/` entry. `snapshots/` absent from `.gitignore`. |
| Phase scope: server.ts not modified by Phase 1 commits | ✓ PASS | `git log 51a2fc4..ba7faed -- src/server.ts` returns empty. Phase 1 commits (29 total) touched zero files in existing domain controllers. Working-tree modifications to `src/server.ts` (quest feature) and other files are uncommitted feature work predating or postdating Phase 1 — not introduced by any Phase 1 commit. |
| Test suite passes with zero regressions | ✓ PASS | `bun test` exits 0: 35 pass, 0 fail across 4 test files (mud-event-bus.test.ts, runner.test.ts, parser.test.ts, tracker.test.ts). |

---

### Requirements Coverage

| Requirement | Plan | Status | Evidence |
|-------------|------|--------|---------|
| SAFE-01 | 01-01, 01-06 | ✓ PARTIAL — BLOCKED on seed ritual | `scripts/extract-baseline.ts` correct. `scripts/replay-harness.ts` correct. Snapshot baseline not seeded → oracle not armed. |
| SAFE-02 | 01-05 | ✓ PARTIAL — BLOCKED on seed ritual | `scripts/parser-snapshot.ts` correct. `snapshots/parser-before.jsonl` not committed. |
| SAFE-03 | 01-03, 01-07 | ✓ SATISFIED | Ports NowProvider + TimerProvider shipped in Plan 03. Injection pattern documented in Plan 07 refactor-playbook.md "Clock and Timer Injection" section. Per-controller injection deferred to Phase 2 per D-15. |
| SAFE-04 | 01-07 | ✓ SATISFIED | `docs/mud-phrases.md` has all 8 required `##` source-file sections with regex literals + purposes. |
| SAFE-05 | 01-07 | ✓ SATISFIED | `docs/refactor-playbook.md` complete. `.githooks/pre-commit` executable and wired to `bun run replay:check`. |
| INFRA-01 | 01-02 | ✓ SATISFIED | Bus with discriminated union, sync delivery, 7 unit tests all green. |
| INFRA-02 | 01-03 | ✓ SATISFIED | 5 port interfaces + 3 default impls. MapStore deferral per D-28 recorded in REQUIREMENTS.md. |
| INFRA-03 | 01-04 | ✓ PARTIAL — missing verify-schema.ts | Runner + advisory lock + baseline-pump + 3 SQL migrations correct. `scripts/verify-schema.ts` from SC-5 not created. |
| INFRA-04 | 01-04 | ✓ SATISFIED | `mapStore.initialize()` body is exactly `await runMigrations(database)`. Zero inline DDL remaining in store.ts. |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `.githooks/pre-commit` | Reads `.git/COMMIT_EDITMSG` before git writes it — commit-message branch detection always reads stale data | ⚠️ Warning (WR-01 from REVIEW.md) | Branch-name detection (`refactor/*`) works correctly and is the primary gate. Commit-msg fallback is broken but not a blocker. |
| `src/ports/defaults/session-teardown.ts` | `invokeAll()` lacks try/catch per hook — one throwing hook stops teardown of subsequent hooks | ⚠️ Warning (WR-02 from REVIEW.md) | Risk materialises in Phase 2 when real teardown hooks are registered. Not a Phase 1 blocker (no hooks registered yet). |
| `scripts/replay-harness.ts` | `extractFirstTimestamp()` calls `rl.close()` without `readStream.destroy()` — potential fd leak | ⚠️ Warning (WR-03 from REVIEW.md) | Script is short-lived (CLI); no production runtime impact. Non-blocking. |
| `scripts/lib/fake-clock.ts` | `createFakeTimerProvider()` is exported but throws immediately — tombstone function | ℹ️ Info (IN-02 from REVIEW.md) | Cosmetic. Functions are exported and satisfy NowProvider/TimerProvider interfaces when called correctly via createFakeClock. |
| `scripts/parser-snapshot.ts` + `scripts/replay-harness.ts` | `extractMessageLiteral` duplicated byte-for-byte across both files | ℹ️ Info (IN-01 from REVIEW.md) | Drift risk if either copy is modified without updating the other. Non-blocking in Phase 1. |

No blockers found. The warnings are carryovers documented in 01-REVIEW.md and do not prevent Phase 1 goal achievement — they are Phase 2 reliability concerns.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| extract-baseline exits 1 on missing --start | `bun run scripts/extract-baseline.ts` | `extract-baseline: --start is required` + exit 1 | ✓ PASS |
| replay-harness exits gracefully when fixture absent | `bun run scripts/replay-harness.ts` | `replay-harness: fixture not found...` + exit 0 | ✓ PASS |
| parser-snapshot exits gracefully when fixture absent | `bun run scripts/parser-snapshot.ts` | `parser-snapshot: fixture not found...` + exit 0 | ✓ PASS |
| Bus unit tests all green | `bun test src/bus/mud-event-bus.test.ts` | 7 pass, 0 fail | ✓ PASS |
| Migration runner unit tests all green | `bun test src/map/migrations/runner.test.ts` | 4 pass, 0 fail | ✓ PASS |
| Full test suite zero regression | `bun test` | 35 pass, 0 fail across 4 files | ✓ PASS |

---

### Gaps Summary

Two gaps block SC-1/SC-2/SC-5 from being fully satisfied:

**Gap 1 — Snapshot baselines not seeded (SC-1, SC-2, SAFE-01, SAFE-02)**

Both `snapshots/parser-before.jsonl` and `snapshots/replay-before.jsonl` are absent from the repository. The harness tooling is correctly implemented and wired, but without the committed baseline snapshots the regression oracle cannot produce a diff — it exits 0 on "fixture not found" instead of actually comparing behaviour. This is a developer ritual documented in `docs/refactor-playbook.md:127-130` that was never executed. The fix requires access to the live MUD traffic log (`/var/log/bylins-bot/mud-traffic.log`) to extract the 30-minute baseline, then running `--write-initial` on both scripts and committing the outputs. This is a one-time setup action, not a code fix.

**Gap 2 — scripts/verify-schema.ts missing (SC-5, INFRA-03 partial)**

Roadmap SC-5 names `bun run scripts/verify-schema.ts` as the mechanism that "confirms live prod schema matches baseline dump." This script was noted in `research/FEATURES.md` as D6 (LOW priority) but was not included in any of Plan 01–07's must_haves or task lists — it was silently dropped during planning decomposition. The migration runner itself is correct and complete. The gap is a ~30 LOC schema-verification utility. Phase 2 planning should either create this script as a pre-merge task or explicitly descope it with a roadmap override if the migration runner tests are deemed sufficient.

---

_Verified: 2026-04-19T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
