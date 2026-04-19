# Refactor Playbook

This document is the single source of truth for how refactor PRs flow through this
repo. Every structural change to `src/server.ts`, `src/client/**`, `src/map/**`,
`src/*/controller.ts`, or any module under refactor must follow it.

The playbook consumes tooling built in Phase 1 Plans 01-06 (baseline extractor, typed
event bus, ports layer, migration framework, parser-snapshot harness, replay harness).
It does not add new `package.json` scripts — it documents how to use the commands those
plans already shipped.

## Pre-flight Checklist

Before editing any code, run this sequence. Skipping a step has caused real production
regressions in this codebase; the checklist exists to make that not happen again.

1. **Index freshness.** Run `npx gitnexus analyze` if any commit landed since your last
   local analyze. If `.gitnexus/meta.json` reports `stats.embeddings > 0`, preserve them
   with `npx gitnexus analyze --embeddings`.
2. **Impact analysis.** Run `gitnexus_impact({target: "<symbol-you-are-moving>",
   direction: "upstream"})`. Read the d=1 list carefully. If ANY result is labeled HIGH
   or CRITICAL, stop and reassess before proceeding. d=1 results WILL BREAK; d=2 LIKELY
   BREAK; d=3 MAY NEED TESTING.
3. **Codebase state clean.** `git status` shows no unrelated work in flight; branch is
   off the latest `main`.
4. **Harness baseline present.**
   - `.fixtures/mud-traffic-baseline.log` exists locally (regenerate if older than about
     a week — see "Baseline Fixture Restoration"). The fixture is gitignored per D-04,
     so each developer maintains a local copy.
   - `snapshots/parser-before.jsonl` and `snapshots/replay-before.jsonl` are checked in
     at HEAD. If they are absent, you are the first developer to seed them — follow
     "Running Harnesses Locally" to create and commit them before starting the refactor.
5. **Green before changes.**
   - `bun run typecheck` passes
   - `bun test` passes
   - `bun run parser:snapshot` exits 0 ("zero diff")
   - `bun run replay:check` exits 0 ("zero diff")

   If any of these fail BEFORE your changes, the main branch is broken — do not start
   the refactor until it is fixed.

6. **Pre-commit scope check.** Right before each commit, run
   `gitnexus_detect_changes({scope: "staged"})` and verify ONLY the expected files
   changed. Unrelated drift (formatting-only edits to neighbouring files, stale build
   artefacts) belongs in a separate PR.

## Commit Convention

- PR title format: `refactor(N): <what>` where N is the phase number and `<what>` is a
  short imperative description.
- Examples:
  - `refactor(2): extract stats-parser controller`
  - `refactor(2): subscribe loot-sort to bus via shim`
  - `refactor(3): split map-grid into layout + render + interactions`
- One PR = one structural extraction plus the minimum wiring needed to keep the
  behaviour-preserving invariant.
- NO mixed-purpose PRs. If you notice a bug during extraction, file it as a separate
  issue and leave the bug intact — do not "fix it while I'm in there" (see
  PITFALLS.md Pitfall 5, antipattern A1). The rationale: mixing a bug fix into a
  behaviour-preserving PR means the replay-harness diff is no longer strict-byte-
  equality, which destroys the only automated regression signal.
- Every commit in a refactor PR ends with the regression gate passing — do not push
  commits where `bun run replay:check` is red.

## Regression Definition

Behaviour-preserving means **strict byte-equality**:

- `bun run parser:snapshot` — `snapshots/parser-after.jsonl` is byte-identical to
  `snapshots/parser-before.jsonl`.
- `bun run replay:check` — `snapshots/replay-after.jsonl` is byte-identical to
  `snapshots/replay-before.jsonl`.

There is no tolerance margin. A single whitespace change in a rendered event payload
is a regression.

**Exception — intentional surface growth.** Phase 2 extractions that wire new bus
subscribers WILL change the replay transcript (new `mapStore.*`, `timer.*`, or
`mudCommandSink.*` entries appear). When this is the intent:

1. Review the diff manually line-by-line.
2. Confirm every new entry represents a side-effect that ALSO existed in the
   pre-extraction code path (same DB writes, same outgoing commands, same broadcasts).
3. Re-run `bun run replay:check --write-initial` to re-seed
   `snapshots/replay-before.jsonl`.
4. Commit the re-seeded file IN THE SAME PR as the extraction, with a commit body
   documenting each new `kind` added.

Phase 4 TEST-* PRs may similarly re-seed snapshots if they wire new test-side
observers. In every other PR, a non-empty diff blocks merge.

## Baseline Fixture Restoration

`.fixtures/mud-traffic-baseline.log` is gitignored (CONTEXT D-04). Regenerate locally:

```bash
bun run scripts/extract-baseline.ts --start <ISO-8601 timestamp from the live log>
```

How to pick a good start timestamp:

- Inspect `/var/log/bylins-bot/mud-traffic.log` for a 30-minute window with diverse
  activity (farm + chat + bazaar + repair + survival — CONTEXT D-02).
- Good heuristic: grab a window where the bot was actively farming. Run
  `grep 'direction=mud-out' /var/log/bylins-bot/mud-traffic.log | head -100` to find
  recent farming sessions; pick the ISO timestamp of a command within that range.
- Default window is 30 minutes (`--minutes 30`); maximum is 240 minutes.

Exit codes (documented by Plan 01):

- `0` — success, fixture written
- `1` — usage error or filesystem error
- `2` — empty window (no log lines matched the time range; `--start` is probably wrong)

The fixture is NEVER committed. Only the scripts that read it (`parser-snapshot`,
`replay-harness`) and the committed snapshots (`snapshots/parser-before.jsonl`,
`snapshots/replay-before.jsonl`) are in git.

If you are onboarding and need the exact baseline another developer used, coordinate
out-of-band with your pair partner or the prior commit author — the fixture itself is
not shareable through git.

## Running Harnesses Locally

```bash
# First time after extract-baseline.ts has produced the fixture:
bun run parser:snapshot --write-initial    # seeds snapshots/parser-before.jsonl (one-off)
bun run replay:check --write-initial       # seeds snapshots/replay-before.jsonl (one-off)
git add snapshots/parser-before.jsonl snapshots/replay-before.jsonl
git commit -m "feat(1): seed initial snapshots"

# Routine verification during a refactor:
bun run parser:snapshot                    # expect: "zero diff"; exit 0
bun run replay:check                       # expect: "zero diff"; exit 0
```

Exit-code contract (identical across both harnesses):

- `0` — zero diff (or `--write-initial` succeeded)
- `1` — diff detected, or runtime error
- `2` — fixture missing (`.fixtures/mud-traffic-baseline.log` not present)

Expected runtime on a 30-minute baseline:

- `parser:snapshot`: ~5-20 seconds (parser CPU-bound over ~10k chunks).
- `replay:check`: ~10-45 seconds (same work plus bus plus mock store plus fake-clock
  scheduling).

These runtimes are intentional — do not optimize the harness by sampling or skipping
chunks. Full coverage is the point.

If either harness reports REGRESSION, read the first-diff line and trace back to the
offending symbol. Do NOT silence the harness or regenerate `before.jsonl` on a whim —
that is the exact failure mode the harness exists to catch (PITFALLS.md Pitfall 4).

## Destructive Migrations

One destructive migration shipped in Phase 1 and is on the permanent watchlist:

- `src/map/migrations/20260418180200-drop-farm-zone-settings.sql` — drops the legacy
  `farm_zone_settings` table if its primary key matches the old pre-`profile_id`
  shape. Modern production has `profile_id` in the PK so the guard is a no-op there;
  the migration exists to clean up older installs.

Before deploying ANY destructive migration to production:

1. Take a schema-level dump:
   `pg_dump --schema-only "$DATABASE_URL" > /tmp/pre-deploy-schema.sql`.
2. Take a data dump if the affected table is not empty:
   `pg_dump --data-only --table=<table_name> "$DATABASE_URL" > /tmp/pre-deploy-data.sql`.
3. Dry-run locally first: restore the dumps into a test DB, run
   `DATABASE_URL=<test> bun run migrate`, verify the expected outcome.
4. Only then apply to production.
5. Keep the dumps for at least 30 days.

New destructive migrations require a new list entry here — do NOT ship destructive
migrations without updating this section. The pre-commit hook does not catch this;
it is a human-review gate.

Observability while migrating:

- `bun run migrate` — applies any unregistered migrations under
  `src/map/migrations/*.sql`. Uses `pg_advisory_xact_lock(727465)` to serialize
  concurrent runners. Fail-fast: any error aborts the transaction and the process.
- `bun run migrate:status` — lists applied migrations. Fails with a friendly error if
  `schema_migrations` does not yet exist (run `migrate` first).

## Clock and Timer Injection

Phase 1 shipped the ports but did NOT inject them into existing controllers
(CONTEXT D-15: injection happens per-extraction in Phase 2). This section documents
the wiring pattern so Phase 2 authors know where to plug in.

Port files:

- `src/ports/now-provider.ts` — `interface NowProvider { now(): number }`
- `src/ports/timer-provider.ts` — `interface TimerProvider { setTimeout, clearTimeout, setInterval, clearInterval }`

Default production impls (thin wrappers over globalThis):

- `src/ports/defaults/now.ts` — `createDefaultNowProvider()`
- `src/ports/defaults/timer.ts` — `createDefaultTimerProvider()`

Test + replay fakes (deterministic virtual clock):

- `scripts/lib/fake-clock.ts` — `createFakeClock(seedMs, sink)` returning
  `{now, timer, advanceTo, drain, nowMs}`. Used by the replay harness.

Phase 2 extraction pattern — when extracting `createFarm2Controller` (or any
timer-driven controller):

1. Add `nowProvider: NowProvider` and `timerProvider: TimerProvider` to the
   `*Dependencies` interface.
2. In the factory body, replace every `Date.now()` with `deps.nowProvider.now()`.
3. Replace every `setTimeout(...)`, `clearTimeout(...)`, `setInterval(...)`, and
   `clearInterval(...)` with the corresponding `deps.timerProvider.*` method.
4. In `src/server.ts` composition root, pass `createDefaultNowProvider()` and
   `createDefaultTimerProvider()` into the factory call.
5. In unit tests (Phase 4), pass fake variants — either `createFakeClock` for
   time-integrated tests or `createFakeNowProvider` for tests that need only a clock.

Do NOT inject big-bang across all controllers in a single PR. Per D-15, injection is
PER-EXTRACTION; when wired correctly it introduces no behavioural diff and the
replay-harness stays zero-delta.

## Installing the Pre-commit Hook

The hook lives at `.githooks/pre-commit`. Git does not use `.githooks/` by default —
you opt in on each local clone:

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit   # only if the file is not already executable
```

What the hook does:

- If your current branch matches `refactor/*` OR the commit message you are typing
  contains `refactor(`, the hook runs `bun run replay:check`.
- If the harness reports REGRESSION (exit 1), the commit is blocked with the first-diff
  line printed.
- If the harness exits 2 (fixture missing), the hook surfaces the error — re-run
  `bun run scripts/extract-baseline.ts --start <ISO>` to regenerate the fixture, then
  retry the commit.
- On non-refactor branches and non-refactor commit messages, the hook is a no-op and
  exits fast.

CI note: there is no CI pipeline in this milestone (v2 TOOL-01 defers the CI buildout).
The pre-commit hook is the only automated regression gate; discipline is the other
half. CI will eventually invoke `bun run replay:check` directly via its own script path
— the hook remains the developer-machine gate.

If you need to bypass the hook in an emergency: `git commit --no-verify`. Use this
only if the harness itself is broken (infrastructure issue), never to skip a genuine
regression. If you `--no-verify` a real regression into main, you own the rollback.

## Tooling Reference

| Command | Purpose | Exit codes |
|---------|---------|------------|
| `bun run scripts/extract-baseline.ts --start <ISO>` | Regenerate the gitignored baseline fixture from `/var/log/bylins-bot/mud-traffic.log` | 0 success / 1 CLI-or-fs error / 2 empty window |
| `bun run parser:snapshot` | SAFE-02 — byte-diff parser output vs committed `snapshots/parser-before.jsonl` | 0 zero-diff / 1 regression or error / 2 fixture missing |
| `bun run parser:snapshot --write-initial` | Seed `snapshots/parser-before.jsonl` (run once per phase-level snapshot refresh) | 0 success |
| `bun run replay:check` | SAFE-01 runtime — byte-diff replay transcript vs `snapshots/replay-before.jsonl` | 0 / 1 / 2 (same meaning) |
| `bun run replay:check --write-initial` | Seed `snapshots/replay-before.jsonl` | 0 success |
| `bun run migrate` | Apply pending migrations (baseline-pump safe) | 0 success / non-zero on failure |
| `bun run migrate:status` | List applied migrations | 0 success (or non-zero if `schema_migrations` absent — run `migrate` first) |
| `bun run typecheck` | `tsc --noEmit` | 0 / non-zero |
| `bun test` | Run the bun:test suite | 0 / non-zero |

## Glossary

- **SAFE-01** — baseline plus replay oracle (Plans 01, 06).
- **SAFE-02** — parser snapshot oracle (Plan 05).
- **SAFE-03** — clock and timer injection (Plan 03 ports, this playbook, Phase 2
  injection).
- **SAFE-04** — `docs/mud-phrases.md` regex inventory.
- **SAFE-05** — this playbook plus commit convention plus pre-commit hook.
- **INFRA-01** — typed event bus (Plan 02).
- **INFRA-02** — ports layer (Plan 03).
- **INFRA-03** — migration framework (Plan 04).
- **INFRA-04** — inline-DDL removal from `mapStore.initialize()` (Plan 04).

For the regex-drift prevention companion doc, see `docs/mud-phrases.md` — update it in
the same PR whenever a regex moves, is added, or changes.
