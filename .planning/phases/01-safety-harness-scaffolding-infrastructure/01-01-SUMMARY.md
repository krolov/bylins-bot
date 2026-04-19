---
phase: 01-safety-harness-scaffolding-infrastructure
plan: 01
subsystem: infra
tags: [bun, cli, streaming, readline, regression-oracle, gitignore, baseline-fixture]

# Dependency graph
requires: []
provides:
  - ".fixtures/ gitignore rule (baseline fixture is local-only — D-04 enforced)"
  - "scripts/extract-baseline.ts — reproducible 30-minute window extractor from /var/log/bylins-bot/mud-traffic.log"
  - "LOG_LINE_REGEXP shared contract: /^\\[(?<ts>[^\\]]+)\\] session=(?<session>\\S+) direction=(?<direction>\\S+) message=/"
  - "Window-selection semantics [start, start + minutes) half-open interval"
  - "Exit-code contract: 0 success / 1 usage-or-fs-error / 2 empty-window"
affects: [01-05-PLAN.md, 01-06-PLAN.md, 01-07-PLAN.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bun CLI script style (mirrors scripts/smoke-test.ts): bare comment header, top-level await, process.stdout/stderr.write instead of console.*"
    - "Streaming file ingestion via node:fs createReadStream + node:readline createInterface (avoids OOM on 756MB log)"
    - "Hand-rolled argv parser — no external CLI dep, per CONTEXT D-21/D-30 (no new deps in Phase 1)"

key-files:
  created:
    - "scripts/extract-baseline.ts"
  modified:
    - ".gitignore"

key-decisions:
  - "LOG_LINE_REGEXP stops at `message=` prefix — only timestamp field is required for windowing; message body is passed through byte-for-byte (D-03 no re-encoding)"
  - "Early-break via rl.close() once ts >= endExclusive — MUD log is monotonically time-ordered (logEvent appends), safe to stop early"
  - "Exit 2 on empty-window — distinguishes `bad --start` from `fs error` (exit 1). Aligns with POSIX convention of using >1 codes for non-error warnings"
  - "Max --minutes capped at 240 (4 hours) — guards against accidental multi-hour slice from a massive prod log"
  - "Half-open interval [start, endExclusive) — matches idiomatic time-windowing and avoids double-counting at window boundaries"

patterns-established:
  - "Script header comment style: 3-block structure (purpose / format contract / Run: command) mirroring scripts/smoke-test.ts"
  - "CLI-arg parser pattern: linear for-loop over argv, flag-dispatch switch, explicit --flag requires-value checks, unknown-flag rejection"

requirements-completed: [SAFE-01]

# Metrics
duration: 3min
completed: 2026-04-19
---

# Phase 01 Plan 01: Baseline Extraction Tooling Summary

**Bun CLI + gitignore rule that carves a 30-minute behaviour-diverse window out of /var/log/bylins-bot/mud-traffic.log into .fixtures/mud-traffic-baseline.log via streaming I/O.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-19T08:26:24Z
- **Completed:** 2026-04-19T08:28:55Z
- **Tasks:** 2 completed
- **Files modified:** 2 (1 created, 1 appended)

## Accomplishments

- `.fixtures/` added to `.gitignore` — prevents accidental commit of 30-minute live-log slice (D-04)
- `scripts/extract-baseline.ts` ships with streaming I/O (`createReadStream` + `readline.createInterface`), safely handles the 756MB source log without OOM
- CLI contract locked: `--start <ISO-8601>` (required) + `--minutes` (default 30, max 240) + `--source` + `--out`
- Exit-code contract published for Plan 07 playbook: 0/1/2
- `LOG_LINE_REGEXP` reproduced verbatim from `01-PATTERNS.md` — same regex that Plan 05 (parser-snapshot) and Plan 06 (replay-harness) will rely on; regex-drift prevention

## Task Commits

Each task was committed atomically:

1. **Task 1: Add `.fixtures/` to .gitignore** — `2504de1` (chore)
2. **Task 2: Create scripts/extract-baseline.ts** — `ee50370` (feat)

**Plan metadata:** (to be appended as docs commit with SUMMARY + STATE + ROADMAP)

## Files Created/Modified

- **Created** `scripts/extract-baseline.ts` (171 LOC) — Bun CLI streaming 30-minute log window; parses argv, validates ISO start + integer minutes, opens `createReadStream` on source, iterates lines via `readline`, copies matching lines byte-for-byte to output, breaks early once timestamp crosses `endExclusive`. Emits progress line to stdout on success, WARNING to stderr on empty window.
- **Modified** `.gitignore` — appended single line `.fixtures/` (file grew 13 → 14 lines). `snapshots/` intentionally NOT added (D-11/D-13 keep snapshots committed as "behaviour of record").

## Decisions Made

See `key-decisions` in frontmatter. Summary:

- **Regex stops at `message=`.** Plan 02 of SAFE-02 (parser-snapshot) still needs the trailing `message="..."` JSON body, but this extractor only needs the timestamp for windowing. Stopping the regex early keeps it fast + the message body is never re-encoded (D-03).
- **Early-break on window exit.** MUD log is append-only and time-ordered; once we see a ts beyond `endExclusive`, no later line can match. Confirmed in functional test (synthetic log: 7 input lines, only 5 read before `rl.close()` fires on line 5).
- **Half-open interval `[start, endExclusive)`.** Synthetic test confirmed: line at `start` exactly is included, line at `start + 15min` exactly is excluded.
- **Exit 2 on empty window.** Makes `bun run extract-baseline.ts --start <wrong-date>` distinguishable from genuine fs errors (exit 1) — important for Plan 07 playbook integration.

## Deviations from Plan

None - plan executed exactly as written.

The plan's `action` section referenced adding a second header-comment line that explicitly mentions `direction=mud-in` and `direction=mud-out` to satisfy the frontmatter `contains_exact_strings` gate. I added this documentation line alongside the pre-existing `direction=<mud-in|mud-out|...>` pattern — no behaviour change, strictly doc-level to close the acceptance check.

**Total deviations:** 0
**Impact on plan:** No scope creep; all acceptance criteria pass as specified.

## Issues Encountered

None. All acceptance gates (file exists, usage-error exit, `DEFAULT_SOURCE_LOG` / `DEFAULT_OUTPUT_PATH` constants, streaming primitives, no `readFileSync`, LOG_LINE_REGEXP ≥2 occurrences, tsc clean, zero Cyrillic, zero `console.log`, empty-window exit-2) passed on first run. Functional test with synthetic log confirmed correct `[start, end)` semantics and early-break optimization.

## Self-Check Before Finishing

- `scripts/extract-baseline.ts` exists: confirmed by `test -f`
- `.gitignore` contains `.fixtures/`: grep returns 1 match
- `.gitignore` does NOT contain `snapshots/`: grep returns 0
- `tsc --noEmit` clean
- Commits `2504de1` and `ee50370` present in `git log` (verified below in Self-Check section)
- GitNexus impact analysis: not applicable — plan creates only new files; no pre-existing symbols edited
- GitNexus pre-commit scope: manually verified via `git diff --cached --stat` before each commit (1 file, N lines each — zero unrelated scope bleed)

## Next Phase Readiness

**Ready for Plan 05 (parser-snapshot) and Plan 06 (replay-harness):**
Both consume `.fixtures/mud-traffic-baseline.log`. Developer regenerates the fixture locally via:

```bash
# 1. Pick a timestamp that exists in the live log
grep -E '^\[' /var/log/bylins-bot/mud-traffic.log | head -1   # note ISO prefix

# 2. Carve a 30-minute window (default — or override with --minutes)
bun run scripts/extract-baseline.ts --start <ISO> --minutes 30

# 3. Inspect
wc -l .fixtures/mud-traffic-baseline.log                       # > 0 expected
head -1 .fixtures/mud-traffic-baseline.log                     # format preserved
```

**For Plan 07 (docs/refactor-playbook.md):** The exit-code contract (0/1/2), CLI flag shape, and regex above should be quoted verbatim in the playbook's "Restore baseline fixture" card.

**No blockers.** The fixture file itself is NOT committed — Wave-2 plans regenerate it on-demand. Plan 05 and Plan 06 can proceed in parallel without this one needing follow-up.

## Threat Flags

None. This plan adds a local-only CLI tool that only reads a filesystem path and writes to another filesystem path — no new network endpoints, auth surface, or schema changes.

## Self-Check: PASSED

- FOUND: scripts/extract-baseline.ts
- FOUND: .gitignore (with `.fixtures/` entry)
- FOUND: .planning/phases/01-safety-harness-scaffolding-infrastructure/01-01-SUMMARY.md
- FOUND: commit 2504de1 (Task 1)
- FOUND: commit ee50370 (Task 2)

---
*Phase: 01-safety-harness-scaffolding-infrastructure*
*Completed: 2026-04-19*
