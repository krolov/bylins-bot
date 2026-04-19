---
phase: 01-safety-harness-scaffolding-infrastructure
plan: 04
subsystem: map/migrations
tags: [infra, migrations, postgres, refactor]
requirements: [INFRA-03, INFRA-04]
dependency_graph:
  requires:
    - src/db.ts::DatabaseClient                   # postgres client type alias (pre-existing)
    - src/map/store.ts::createMapStore             # host of the initialize() being collapsed
  provides:
    - src/map/migrations/runner.ts::runMigrations  # advisory-locked tx runner w/ baseline-pump
    - src/map/migrations/20260418180000-baseline.sql           # seed-only on prod
    - src/map/migrations/20260418180100-add-has-wiki-data.sql  # seed-only on prod
    - src/map/migrations/20260418180200-drop-farm-zone-settings.sql
    - schema_migrations (runtime table)            # created on first run
    - package.json::scripts.migrate                # one-liner CLI
    - package.json::scripts.migrate:status         # applied-ids lister
  affects:
    - src/map/store.ts::initialize                 # body collapsed from 115 LOC -> 1 LOC
    - src/server.ts (indirect)                     # still the only d=1 caller of mapStore.initialize(); signature preserved
tech_stack:
  added: []
  patterns:
    - "factory createXxx({deps}) with noop default"
    - "single boundary cast (as unknown as DatabaseClient) for postgres.js v3 TransactionSql callable-signature gap"
    - "tagged templates for parameterized queries; sql.unsafe() only for committed migration files"
    - "advisory xact lock (not session lock) to avoid leak on process crash"
key_files:
  created:
    - src/map/migrations/runner.ts
    - src/map/migrations/runner.test.ts
    - src/map/migrations/20260418180000-baseline.sql
    - src/map/migrations/20260418180100-add-has-wiki-data.sql
    - src/map/migrations/20260418180200-drop-farm-zone-settings.sql
    - .planning/phases/01-safety-harness-scaffolding-infrastructure/01-04-preflight.md
  modified:
    - src/map/store.ts
    - package.json
decisions:
  - "ADVISORY_LOCK_ID=727465 locked as runtime contract; never change — would orphan migrations mid-flight against any running pre-change process"
  - "Fixed timestamp prefixes (20260418180000/180100/180200) are load-bearing: runner baseline-pump seeds schema_migrations using these exact ids. Renaming a file breaks seed-reconciliation on already-migrated prod DBs"
  - "Migration naming convention YYYYMMDDHHMMSS-short-kebab-description.sql (D-32). Phase 2+ migrations follow this; timestamp collisions avoided even on parallel branches"
  - "Runner uses postgres.js .begin() transaction callback; single 'as unknown as DatabaseClient' cast restores callable tagged-template shape that Omit<Sql, ...> strips from TransactionSql. No 'any' used. Alternative (intersection type trickery) adds more noise than the cast"
  - "Baseline SQL captured via pg_dump --schema-only --no-owner --no-privileges; idempotency retrofitted (IF NOT EXISTS on CREATE TABLE/SEQUENCE/INDEX, DO blocks with pg_constraint lookup for ADD CONSTRAINT). File runs cleanly on fresh install AND is safe to rerun"
  - "Fail-fast semantics per D-35: any migration error aborts tx (postgres.js rolls back on throw), enriched Error('[migrations] failed applying <id>: <cause>') re-thrown, runMigrations does not catch, mapStore.initialize() does not catch, startup crashes. Matches existing DATABASE_URL-missing throw-to-refuse-start semantic at src/config.ts:110"
  - "Mock-only unit tests; no real Postgres in runner.test.ts. Real-DB verification deferred to Phase 4 TEST-05 per D-07"
metrics:
  duration_minutes: 45
  tasks_completed: 5
  files_created: 6
  files_modified: 2
  tests_added: 4
  test_suite: 35/35 pass
  loc_store_ts_before: 838
  loc_store_ts_after: 726
  loc_store_ts_delta: -112
  loc_runner_ts: 106
  loc_runner_test_ts: 195
  inline_ddl_count_before: 13
  inline_ddl_count_after: 0
completed: 2026-04-19
---

# Phase 01 Plan 04: Migration Framework Adoption Summary

**One-liner:** Introduced an advisory-locked, transactional, baseline-pump-aware Postgres migration runner — replaces 115 lines of inline DDL in `mapStore.initialize()` with a single `await runMigrations(database)` call, extracts three numbered SQL migrations from the current production schema, and ships a unit test that proves the baseline-pump path never executes SQL against an already-migrated database.

## Deliverables

### Artifacts

1. **`src/map/migrations/runner.ts`** (106 LOC)
   - `runMigrations(database: DatabaseClient, deps?: MigrationRunnerDependencies): Promise<void>`
   - Optional `deps` parameter with `onLog` callback; no-op default when invoked from `mapStore.initialize()` (no composition-root context yet). Phase 2 composition root may inject a real logger.
   - Constants: `ADVISORY_LOCK_ID = 727465`, `MIGRATION_FILENAME_REGEXP = /^\d{14}-[a-z0-9-]+\.sql$/`, `MIGRATIONS_DIR = dirname(fileURLToPath(import.meta.url))`.
   - Three-state machine described below.

2. **Three migration SQL files** under `src/map/migrations/`:
   - `20260418180000-baseline.sql` — full production schema (17 tables, 3 sequences, 3 indexes, 4 FKs, 17 PK/UNIQUE constraints) captured via `pg_dump --schema-only --no-owner --no-privileges` then made idempotent (`IF NOT EXISTS` on CREATE, `DO $$ ... pg_constraint` guards on ADD CONSTRAINT since PG ≤17 has no `ADD CONSTRAINT IF NOT EXISTS`).
   - `20260418180100-add-has-wiki-data.sql` — extracts the two `ALTER TABLE game_items ADD COLUMN IF NOT EXISTS has_wiki_data/has_game_data` statements verbatim from the pre-Phase-1 inline DDL at `store.ts:255-260`.
   - `20260418180200-drop-farm-zone-settings.sql` — extracts the `DO $$ ... DROP TABLE farm_zone_settings` guard from `store.ts:198-213` verbatim. **This is the sole destructive migration in Phase 1 and is listed below under "Destructive Migrations".**

3. **`src/map/migrations/runner.test.ts`** (195 LOC)
   - Four `bun:test` cases in `describe("runMigrations", ...)`:
     - Fresh install (map_rooms absent + schema_migrations absent → apply every migration).
     - Baseline-pump (map_rooms present + schema_migrations absent → seed every id WITHOUT executing SQL).
     - Normal re-run no-op (all ids already in schema_migrations → zero side-effects).
     - Mid-migration error (runMigrations rejects with `[migrations] failed applying <id>: <cause>` enriched message).
   - Hand-rolled mock of the postgres.js tagged-template + `.begin` + `.unsafe` surface; one `as unknown as DatabaseClient` boundary cast; no `any`, no real Postgres.

4. **`src/map/store.ts`** — `initialize()` body collapsed from lines 178-293 (115 inline DDL lines) to a single-line `await runMigrations(database)` call + one new import. File LOC: 838 → 726 (−112).

5. **`package.json`** — two new scripts:
   - `migrate` — `bun -e` one-liner: `import { runMigrations, sql } … await runMigrations(sql, { onLog: stdout });`
   - `migrate:status` — `bun -e` one-liner listing applied ids + timestamps from `schema_migrations`.

6. **`.planning/phases/01-safety-harness-scaffolding-infrastructure/01-04-preflight.md`** — GitNexus impact pre-flight + post-flight audit trail. Contains APPROVED gate decision and Post-flight PASS verdict.

## GitNexus Findings

### Pre-flight (before any edits)

**Command:** `npx gitnexus impact initialize --repo bylins-bot --direction upstream` (and the same for `createMapStore`).

| Target | d=1 callers | d=2 | Risk |
|--------|-------------|-----|------|
| `initialize` (Method at src/map/store.ts) | 1 — `src/server.ts` (CALLS, confidence 0.9) | 0 | LOW |
| `createMapStore` (Function at src/map/store.ts) | 1 — `src/server.ts` (CALLS, confidence 0.9) | 0 | LOW |

- HIGH/CRITICAL risk gate: **not tripped**.
- Pre-flight gate decision: **APPROVED to proceed**.
- Exact initialize body range on disk: **lines 178-293** (116 lines; closed brace on 293).

### Post-flight (after Tasks 2-5 edits)

- `gitnexus_detect_changes` MCP tool not exposed via CLI (confirmed via `npx gitnexus --help`). Substituted post-flight strategy: `git log --name-only 8c2cad6^..HEAD` + `git diff --stat` for uncommitted files + impact re-check.
- **Scope verdict:** **PASS**. Plan-scope edits contained to `src/map/` + `package.json` + preflight note. Pre-existing working-tree modifications from before this session (AGENTS.md, CLAUDE.md, client files, etc.) are out of scope and were not touched.
- Impact re-check on `initialize` (post-collapse): same caller set (`src/server.ts` at d=1), same LOW risk. **Interface preserved; no downstream breakage introduced.**

## State Machine (D-31 Contract)

The runner implements a three-state detection-and-action machine on every invocation, inside a single transaction holding `pg_advisory_xact_lock(727465)`:

### State 1 — NORMAL (schema_migrations present)

```
applied_ids := SELECT id FROM schema_migrations
for file in files (lexicographic):
  if file.id in applied_ids: skip
  else:
    tx.unsafe(file.sql)
    INSERT INTO schema_migrations (id) VALUES (file.id)
    onLog("[migrations] applied <id>")
```

### State 2 — PRODUCTION-UNMIGRATED (schema_migrations absent + map_rooms present) — **baseline-pump**

This is the pitfall-avoidance path (PITFALLS.md Pitfall 5). Production DBs have been running for months with inline DDL; re-running migrations against them would **double-apply destructive guards** (particularly the `DROP TABLE farm_zone_settings` guard). Instead:

```
CREATE TABLE IF NOT EXISTS schema_migrations (...)
(applied_ids is empty)
if map_rooms exists:
  for file in files (lexicographic):
    INSERT INTO schema_migrations (id) VALUES (file.id)   -- seed, no tx.unsafe
    onLog("[migrations] baseline-pump seeded <id> (not executed)")
  return
```

**Invariant:** zero calls to `tx.unsafe()` in this branch. Enforced by Task 4 case 2.

### State 3 — FRESH-INSTALL (schema_migrations absent + map_rooms absent)

Falls through to State 1's apply loop after the initial `CREATE TABLE IF NOT EXISTS schema_migrations` — no special casing needed.

## Advisory Lock Rationale (D-33)

- Constant: `ADVISORY_LOCK_ID = 727465` (decimal hash "bylins", arbitrary but stable — never change).
- Function: `pg_advisory_xact_lock(...)` (**transaction-scoped**, auto-released on commit/rollback).
- Rejected alternative: `pg_advisory_lock(...)` (session-scoped) — leaks on process crash and forces manual `pg_advisory_unlock` recovery.
- Current deployment (PM2 single-instance) makes contention impossible, but cheap insurance for future multi-instance deploys. A second runner entering `database.begin()` blocks on the lock until the first commits; at that point `schema_migrations` reflects all applied ids and the second runner finds nothing to apply.

## Fail-Fast Semantics (D-35)

- `try { await tx.unsafe(sqlText); } catch (error: unknown) { throw new Error(\`[migrations] failed applying ${id}: ${error instanceof Error ? error.message : "unknown"}\`); }`
- Rethrown error propagates out of `database.begin()` → postgres.js rolls back the transaction → no `schema_migrations` row for the failed id → next deploy retries cleanly from the same point.
- `runMigrations()` does not catch; `mapStore.initialize()` does not catch; process exits non-zero. Matches existing `DATABASE_URL missing` throw-to-refuse-start semantic at `src/config.ts:110`.
- Asserted by Task 4 case 4.

## Migration Naming Convention (D-32)

`YYYYMMDDHHMMSS-short-kebab-description.sql`

- Lexicographic sort = chronological order.
- No collisions across parallel branches.
- Filename regex gate: `/^\d{14}-[a-z0-9-]+\.sql$/`. Any file not matching the regex is silently ignored by `listMigrationFiles()`, which prevents stray dev scratch files from accidentally executing. This is the T-01-04-02 (SQL injection via migration path) mitigation.
- Phase 2+ migrations MUST follow this convention. Do NOT invent alternative schemes; breaks the lexicographic-ordering contract.

## Destructive Migrations

Per PITFALLS.md §5 and CONTEXT D-19 (refactor playbook), destructive migrations must be explicitly catalogued so operators know which migrations require pre-run backups.

Phase 1 destructive migrations:

| Migration | Action | Guard |
|-----------|--------|-------|
| `20260418180200-drop-farm-zone-settings.sql` | `DROP TABLE farm_zone_settings` | Runs only if the table's current PK constraint name is `farm_zone_settings_pkey` AND the `profile_id` column is absent — i.e., only the old-shape PK triggers the drop. Modern prod has `profile_id` in PK so the guard is a no-op. |

Plan 07 (`docs/refactor-playbook.md`) must quote this list verbatim under its "destructive migrations" card.

## Security Posture (from threat register)

| Threat | Status | Evidence |
|--------|--------|----------|
| T-01-04-02 (SQL injection via migration path) | **mitigated** | Filename gated by regex; `grep -c 'process.env\|Bun.env' src/map/migrations/runner.ts` = 0; no user input flows into SQL. |
| T-01-04-03 (Repudiation — no audit trail) | **mitigated** | Dual audit: `[migrations] applied <id>` log lines via `deps.onLog` + `schema_migrations (id, applied_at)` DB row per applied migration. |
| T-01-04-04 (baseline.sql leaks secrets) | **mitigated** | `grep -cEi 'password\|secret\|\btoken\b\|respect1\|api[_-]?key\|SET OWNER\|ALTER OWNER\|CREATE ROLE\|CREATE USER\|^GRANT ' src/map/migrations/*.sql` = 0. pg_dump invoked with `--no-owner --no-privileges`; no data dumped (`--schema-only`). |
| T-01-04-05 (concurrent runner DoS) | **mitigated** | `pg_advisory_xact_lock(727465)` serializes; second runner blocks until first commits. |
| T-01-04-06 (baseline-pump misfires, re-runs destructive guard) | **mitigated** | State-machine check `(schema_migrations absent) AND (map_rooms present)` runs BEFORE any `tx.unsafe()`; Task 4 case 2 asserts zero unsafe calls in that branch. |
| T-01-04-09 (failed migration half-applied) | **mitigated** | `database.begin()` rolls back entire transaction on throw; no partial schema_migrations INSERT for failed id. Task 4 case 4 asserts rejection + message format. |

## Developer Operations

### Running migrations against a local prod-copy DB

Recommended verification workflow (not an automated gate — this is documentation for Plan 07 playbook):

```bash
# On a local restored copy of prod dump (never the real prod DB directly):
dropdb bylins_test 2>/dev/null || true
createdb bylins_test
pg_restore --schema-only --no-owner --dbname=bylins_test prod.dump
DATABASE_URL=postgres://localhost/bylins_test bun run migrate
# Expected: baseline-pump path taken (map_rooms present + schema_migrations absent).
# schema_migrations seeded with 3 rows; DDL for those 3 migrations NOT re-run.
psql bylins_test -c "SELECT id FROM schema_migrations ORDER BY id"
# Expected output:
#  20260418180000-baseline
#  20260418180100-add-has-wiki-data
#  20260418180200-drop-farm-zone-settings
```

### Running against a fresh database

```bash
createdb bylins_fresh
DATABASE_URL=postgres://localhost/bylins_fresh bun run migrate
# Expected: fresh-install path. Every migration applied; 17 tables created.
bun run migrate:status
# Expected: three rows with applied_at timestamps.
```

## Phase 1 Port Note

**MapStore port NOT created in Phase 1 (D-28).** The `MapStore` interface stays in `src/map/store.ts` for Phase 1. Phase 2 may move it to `src/ports/` if extractions require it; leaving it here avoids unnecessary churn in the plan-04 diff.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] postgres.js v3 `TransactionSql` drops call signatures via `Omit<Sql, ...>`**
- **Found during:** Task 3 (first typecheck after initial runner.ts).
- **Issue:** `TransactionSql<TTypes>` is declared `extends Omit<Sql<TTypes>, 'parameters' | 'largeObject' | ... | 'begin' | ...>`. TypeScript's `Omit` drops the tagged-template callable signatures that `Sql` declares via `<T, K extends Rest<T>>(first, ...rest): Return<T, K>` and `<T extends readonly (object | undefined)[]>(template, ...parameters): PendingQuery<T>`. Code like `await tx\`SELECT ...\`` on the tx callback parameter fails with "This expression is not callable. Type 'TransactionSql<{}>' has no call signatures."
- **Fix:** Single boundary cast `const tx = rawTx as unknown as DatabaseClient;` inside the `.begin()` callback. Runtime shape is identical — postgres.js returns the same callable. No `any` used; constant is documented inline with reference to the postgres.js typing gap.
- **Files modified:** `src/map/migrations/runner.ts` (added 5 lines of comment + one `as unknown as DatabaseClient` cast).
- **Commit:** `14b48d0` (Task 3 commit).

**2. [Rule 3 — Blocking issue] Test mock method assignment typing conflict**
- **Found during:** Task 4 (first typecheck after initial runner.test.ts).
- **Issue:** Attaching `.unsafe` and `.begin` to a callable-cast-to-`DatabaseClient` failed because the target types are intersections including the full postgres.js signatures; simple `(text: string) => Promise<unknown>` assignments are not assignable to `unsafe<T extends any[]>(query: string, parameters?: ..., queryOptions?: ...): PendingQuery<T>`.
- **Fix:** Introduced a narrow `MockShape` interface (local to `createMockDatabase`) that extends callable + `.unsafe(text): Promise<unknown>` + `.begin(cb: (tx: MockShape) => ...)`; assigned methods on that typed alias, then boundary-cast to `DatabaseClient` once at the return site.
- **Files modified:** `src/map/migrations/runner.test.ts`.
- **Commit:** `47b63db` (Task 4 commit).

### Notes

- **Baseline SQL sourcing:** the plan's primary strategy (pg_dump) was available in the execution environment (Postgres 16 + `.env` with DATABASE_URL pointing at localhost). pg_dump ran cleanly. The plan's fallback path (reconstruct from store.ts inline DDL) was NOT needed, but the captured baseline actually includes all 17 prod tables — which is MORE than the 8 tables that store.ts's inline DDL covers. The other 9 tables (`auto_spells_settings`, `map_aliases`, `map_edges`, `mob_names`, `room_auto_commands`, `room_colors`, `sneak_settings`, `survival_settings`, `trigger_settings`) exist in prod (created either by earlier code versions or ad-hoc). Baseline reflects full prod reality; this is preferred over the narrower inline-DDL set because fresh-install then creates a complete schema.
- **Post-flight via CLI:** `gitnexus_detect_changes` is MCP-only; substituted with `git log --name-only` + `git diff --stat` + impact re-check to achieve the same scope-containment verdict. Documented in preflight.md Post-flight section.

## Authentication Gates

None.

## Known Stubs

None.

## Self-Check: PASSED

**Files asserted in frontmatter `key_files.created`:**
- `src/map/migrations/runner.ts` — FOUND
- `src/map/migrations/runner.test.ts` — FOUND
- `src/map/migrations/20260418180000-baseline.sql` — FOUND
- `src/map/migrations/20260418180100-add-has-wiki-data.sql` — FOUND
- `src/map/migrations/20260418180200-drop-farm-zone-settings.sql` — FOUND
- `.planning/phases/01-safety-harness-scaffolding-infrastructure/01-04-preflight.md` — FOUND

**Files asserted in `key_files.modified`:**
- `src/map/store.ts` — MODIFIED (initialize body collapsed; import added)
- `package.json` — MODIFIED (two script entries added)

**Commits asserted in execution flow:**
- `8c2cad6` docs(01-04): gitnexus pre-flight — FOUND
- `1f11614` feat(01-04): add three migration SQL files — FOUND
- `14b48d0` feat(01-04): add migration runner with baseline-pump state machine — FOUND
- `47b63db` test(01-04): add runner.test.ts covering baseline-pump state machine — FOUND
- `cd01630` refactor(01-04): collapse mapStore.initialize to runMigrations call — FOUND

Build status: `bun run typecheck` clean. `bun test` 35/35 pass (31 pre-existing + 4 new from this plan). No regressions.
