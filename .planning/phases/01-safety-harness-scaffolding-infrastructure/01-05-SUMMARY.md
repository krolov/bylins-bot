---
phase: 01-safety-harness-scaffolding-infrastructure
plan: 05
subsystem: infra
tags: [bun, cli, parser, snapshot, regression-oracle, jsonl, byte-diff]

# Dependency graph
requires:
  - "scripts/extract-baseline.ts (Plan 01) at runtime — produces the .fixtures/mud-traffic-baseline.log this script consumes"
  - "src/map/parser.ts exports createParserState + feedText (unchanged public contract)"
  - "LOG_LINE_REGEXP contract established by Plan 01 — reproduced verbatim"
provides:
  - "scripts/parser-snapshot.ts — Bun CLI that drives src/map/parser.ts over baseline fixture and emits JSONL (one line per chunk)"
  - "snapshots/ directory tracked in git via .gitkeep — receptacle for committed behaviour-of-record files"
  - "package.json script `parser:snapshot` — developer-facing command (diff mode default, `--write-initial` seeds the baseline snapshot)"
  - "JSONL entry contract: {chunkIndex: number, events: ParsedEvent[]} — one line per feedText() call, zero-event chunks still emit an entry with events:[]"
  - "Exit-code contract: 0 success (zero diff or --write-initial) / 1 diff-or-error / 2 fixture missing"
affects: [01-06-PLAN.md, 01-07-PLAN.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bun CLI style mirroring scripts/extract-baseline.ts + scripts/smoke-test.ts — bare comment header, hand-rolled argv parser, top-level await main(), process.stdout/stderr.write (no console.*)"
    - "Streaming file ingestion via node:fs createReadStream + node:readline createInterface (handles arbitrarily large baseline fixtures)"
    - "Shared single parser state across all chunks via one createParserState() held across the for-await loop — matches real server onMudText stream semantics (lineBuffer, rawLineBuffer, pendingMobs accumulate across chunks)"
    - "Byte-exact JSONL diff (no external deep-diff lib) — diffs are either textually identical or they're a regression, per D-19 strict-byte-equality regression definition"

key-files:
  created:
    - "scripts/parser-snapshot.ts"
    - "snapshots/.gitkeep"
  modified:
    - "package.json (added parser:snapshot script entry)"

key-decisions:
  - "LOG_LINE_REGEXP reused VERBATIM from Plan 01's scripts/extract-baseline.ts (stops at `message=` — does NOT capture the message body). The plan's action section gave a longer regex (captured message body), but its own acceptance criterion demanded byte-equality with Plan 01. Resolved in favor of Plan 01's invariant (Rule 3 deviation) — message body is sliced out of the line post-match via extractMessageLiteral() which walks the quoted string honouring backslash escapes, then JSON.parse'd."
  - "Single shared ParserState across entire stream — createParserState() called ONCE at script start, fed iteratively. Resetting per-chunk would corrupt output because the parser's lineBuffer/rawLineBuffer/pendingMobs accumulate across chunks."
  - "JSONL uses `{chunkIndex, events}` per line — per-chunk not per-event. Zero-event chunks still emit an entry with events:[] — the chunk-boundary is the load-bearing signal (D-11)."
  - "snapshots/parser-before.jsonl is NOT committed in this plan. Plan 05 ships tooling only; Plan 07's playbook documents the one-time developer ritual: run Plan 01 extract-baseline, then `bun run parser:snapshot --write-initial`, review output, commit the resulting parser-before.jsonl."
  - "Byte-exact diff over external deep-diff library — no new dependency, and per D-19 any textual divergence IS the regression signal we want."
  - "Exit codes split: 0 = success (including --write-initial), 1 = diff detected or runtime error, 2 = fixture missing. The 2/1 split lets automation distinguish 'developer hasn't generated baseline yet' from 'parser regressed'. Parallels Plan 01's 0/1/2 contract."

patterns-established:
  - "extractMessageLiteral helper pattern — walks a quoted JSON string literal honouring backslash escapes; reusable in Plan 06 replay-harness which parses the same log format"
  - "Byte-exact JSONL diff function shape (diffSnapshots) — returns {equal, firstDiff}; Plan 06 can copy this template for its own side-effect diff"

requirements-completed: [SAFE-02]

# Metrics
duration: 3.5min
completed: 2026-04-19
---

# Phase 01 Plan 05: Parser Snapshot Harness Summary

**Bun CLI that freezes src/map/parser.ts output against the committed baseline fixture as a JSONL snapshot; byte-exact diff catches any regex or logic drift at pre-commit time.**

## Performance

- **Duration:** ~3.5 min
- **Started:** 2026-04-19T09:09:17Z
- **Completed:** 2026-04-19T09:12:43Z
- **Tasks:** 2 completed
- **Files modified:** 3 (2 created, 1 appended)

## Accomplishments

- `scripts/parser-snapshot.ts` (248 LOC) ships with streaming I/O, handles arbitrarily large baseline fixtures without OOM
- CLI contract locked: `--write-initial` / `--fixture` / `--out` / `--help`
- Exit-code contract published for Plan 07 playbook: `0` success / `1` diff-or-error / `2` fixture missing
- `LOG_LINE_REGEXP` reproduced verbatim from Plan 01 — textual-equality check passes (`diff <(grep ...) <(grep ...)` yields no output)
- JSONL output format verified against synthetic 3-line fixture: mud-out line correctly filtered; 2 mud-in chunks yield 2 JSONL lines; each line is valid JSON matching `{chunkIndex, events}` shape
- `snapshots/` directory tracked via `.gitkeep`; `.gitignore` invariants preserved (`.fixtures/` gitignored per D-04, `snapshots/` NOT gitignored per D-13 — asymmetry intentional)
- `parser:snapshot` npm script runs correctly via `bun run parser:snapshot [flags]`
- Zero regressions — full test suite 35/35 pass (same as Plan 04 baseline)

## Task Commits

Each task was committed atomically:

1. **Task 1: scripts/parser-snapshot.ts** — `8905c0d` (feat)
2. **Task 2: snapshots/.gitkeep + package.json script** — `14e8a2a` (chore)

**Plan metadata:** (to be appended as docs commit with SUMMARY + STATE + ROADMAP)

## Files Created/Modified

- **Created** `scripts/parser-snapshot.ts` (248 LOC) — Bun CLI streaming parser snapshot harness. Reads baseline fixture line-by-line, matches LOG_LINE_REGEXP, filters direction=mud-in, extracts the quoted JSON message literal via `extractMessageLiteral()` (escape-aware scanner), `JSON.parse`s to obtain the real chunk text (real `\u001b` + `\r\n`), feeds through shared `createParserState` + `feedText`, emits `{chunkIndex, events}` JSONL. Two modes: `--write-initial` (seeds snapshots/parser-before.jsonl, no diff, exit 0) / default (writes snapshots/parser-after.jsonl and byte-diffs against parser-before.jsonl — exit 0 on match, 1 on diff). Missing fixture → exit 2 with reminder to run Plan 01's extract-baseline.
- **Created** `snapshots/.gitkeep` — zero-byte placeholder; ensures git tracks the directory before the first developer generates `parser-before.jsonl`. Per D-13 `snapshots/` is NOT added to `.gitignore` (contrast `.fixtures/` which IS per D-04).
- **Modified** `package.json` — added single line `"parser:snapshot": "bun run scripts/parser-snapshot.ts"` after the `gear` entry. All existing scripts preserved (dev, start, build:client, typecheck, build, test, smoke, gear, migrate, migrate:status).

## Decisions Made

See `key-decisions` in frontmatter. Summary:

- **LOG_LINE_REGEXP verbatim-reuse from Plan 01.** The plan's `<action>` section specified a longer regex with `(?<message>".*")( .*)?$`, but its own `<acceptance_criteria>` demanded byte-equality with `scripts/extract-baseline.ts`. The SUMMARY for Plan 01 locked the shorter regex (`/^\[(?<ts>[^\]]+)\] session=(?<session>\S+) direction=(?<direction>\S+) message=/`) as the single-source-of-truth invariant, and STATE.md's decision log reinforces this. Resolved the contradiction in favor of the invariant (Rule 3 deviation). Message body extraction is handled by a new helper `extractMessageLiteral(line, matchLength)` which walks the quoted-string suffix of the line respecting backslash escapes — equivalent functional behaviour, strictly additive to the contract.
- **JSONL one-line-per-chunk (not per-event).** Even chunks whose feedText returns `[]` emit an entry `{"chunkIndex":N,"events":[]}` — this preserves the chunk-boundary signal per D-11. Dropping zero-event chunks would lose sync between input line numbers and output line numbers and obscure which chunk a later non-empty event-emission came from.
- **Byte-exact diff, no library.** Per D-12/D-19 and the plan's interfaces section: lines are either identical or they're a regression. No tolerance, no semantic diff, no jsondiffpatch dep. Implementation is ~15 LOC (split both files on `\n`, compare element-wise, return first differing line).
- **snapshots/parser-before.jsonl deliberately NOT committed in this plan.** Generating it requires a real baseline fixture (Plan 01's `.fixtures/mud-traffic-baseline.log`), which is gitignored and local-only. The seed is a one-time developer ritual documented in Plan 07's playbook. Plan 05 ships tooling only; Plan 07 ships the process documentation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] LOG_LINE_REGEXP self-contradiction in plan**
- **Found during:** Task 1 pre-flight — comparing the plan's `<action>` regex to its `<acceptance_criteria>` `diff`-check gate.
- **Issue:** Plan's action section specified `/^\[(?<ts>[^\]]+)\] session=(?<session>\S+) direction=(?<direction>\S+) message=(?<message>".*")( .*)?$/` while its acceptance-criterion required textual equality with Plan 01's `scripts/extract-baseline.ts` regex, which is `/^\[(?<ts>[^\]]+)\] session=(?<session>\S+) direction=(?<direction>\S+) message=/` (stops at `message=`, no message-body capture).
- **Fix:** Used Plan 01's shorter regex verbatim (honours the "single source of truth" invariant logged in Plan 01's SUMMARY and STATE.md decisions). Extracted the message literal via a new `extractMessageLiteral(line, matchLength)` helper which walks the quoted-string tail honouring backslash escapes, returning the JSON-string literal ready for `JSON.parse`. Functional behaviour is identical to the plan's stated intent (JSON.parse of the message body) — only the decomposition differs.
- **Files modified:** `scripts/parser-snapshot.ts` (no separate helper commit — rolled into Task 1)
- **Commit:** `8905c0d`

**2. [Rule 3 - Blocking] Inline-comment `any` word triggered strict-grep gate**
- **Found during:** Task 1 acceptance verification.
- **Issue:** `grep -cE '\bany\b' scripts/parser-snapshot.ts` returned `1` (failing the gate) because the header comment contained the phrase "exit 1 on any diff". The plan's intent (per the gate's prose rationale "no `any` type annotations; `unknown` only via `catch (error: unknown)`") was satisfied — there were zero `any` type annotations — but the literal grep was snagging a natural-English word.
- **Fix:** Rephrased the comment: "exit 1 on any diff" → "exit 1 on every diff". Semantically identical; grep now returns `0`.
- **Files modified:** `scripts/parser-snapshot.ts`
- **Commit:** `8905c0d`

**Total deviations:** 2 (both Rule 3 — blocking plan self-contradictions; resolved in favor of the invariants documented elsewhere in the planning corpus)
**Impact on plan:** Zero scope creep. Both deviations resolve ambiguity/inconsistency in the plan's own wording; neither changes the delivered behaviour. All `<success_criteria>` and `<verification>` gates pass.

## Issues Encountered

None beyond the two deviations above. Typecheck clean on first write. Functional smoke-test with synthetic fixture produced correct JSONL on first run. `--write-initial` seed + default-mode diff round-trip confirmed: writing the same fixture twice produces byte-identical files.

## Self-Check Before Finishing

- `scripts/parser-snapshot.ts` exists: confirmed by `test -f`
- `snapshots/.gitkeep` exists and is zero bytes: confirmed
- `snapshots/` NOT in `.gitignore`: `grep -cE '^snapshots/?$' .gitignore` returns `0`
- `git check-ignore -q snapshots/parser-before.jsonl` exits non-zero (would be tracked if present)
- `package.json` `parser:snapshot` script present; `build`/`test` unchanged
- `bun run typecheck` clean
- `bun test` 35/35 pass (no regressions)
- Commits `8905c0d` and `14e8a2a` present in `git log`
- LOG_LINE_REGEXP byte-identical with Plan 01's: `diff <(grep 'LOG_LINE_REGEXP = ' scripts/parser-snapshot.ts) <(grep 'LOG_LINE_REGEXP = ' scripts/extract-baseline.ts)` returns no output
- `--help` exits 0; `--fixture /tmp/nonexistent` exits 2 with expected stderr message
- GitNexus impact analysis: not applicable — plan creates only new files; no pre-existing symbols edited. Imports `createParserState`/`feedText` are consumers of unchanged public contracts (src/map/parser.ts:44, :54)
- GitNexus detect_changes scope: commits affected only `scripts/parser-snapshot.ts`, `snapshots/.gitkeep`, `package.json` — zero unrelated scope bleed

## Next Phase Readiness

**Ready for Plan 06 (replay-harness):**
Plan 06 will consume the same `.fixtures/mud-traffic-baseline.log` and the same `LOG_LINE_REGEXP`. It should:
- Reuse the `extractMessageLiteral(line, matchLength)` pattern established here for parsing `message=<JSON literal>` suffixes.
- Reuse the byte-exact JSONL `diffSnapshots(beforePath, afterPath): {equal, firstDiff}` shape.
- Reuse the exit-code contract (`0`/`1`/`2`).

**Ready for Plan 07 (docs/refactor-playbook.md):**
Playbook's "Restore baseline fixture + seed snapshot" card should quote the ritual verbatim:

```bash
# 1. Generate baseline fixture (Plan 01 tooling)
bun run scripts/extract-baseline.ts --start <ISO> --minutes 30

# 2. Seed parser snapshot (Plan 05 tooling)
bun run parser:snapshot --write-initial

# 3. Inspect and commit
head -1 snapshots/parser-before.jsonl            # sanity check: valid JSON
wc -l snapshots/parser-before.jsonl               # row count > 0 expected
git add snapshots/parser-before.jsonl
git commit -m "feat(01): seed parser snapshot"

# 4. Any future parser regression triggers diff
bun run parser:snapshot                           # expect: exit 0, "zero diff"
```

**For the pre-commit hook in Plan 07:** after `refactor(...)` commits the hook must run `bun run parser:snapshot` in addition to the replay-harness check. Exit-code semantics: 0 = continue commit; 1 = block commit with the first-diff line printed; 2 = warn that baseline is missing but do NOT block (the developer may be on a fresh clone without a local fixture yet).

**No blockers.** Wave 3 plans (06 replay-harness, 07 playbook + hook) unblocked.

## Known Stubs

None. The CLI is fully functional; no hardcoded empty values or placeholder data. `snapshots/parser-before.jsonl` being absent is intentional (developer-generated artifact) and explicitly documented in Plan 07's playbook card above.

## Threat Flags

None. This plan adds a local-only CLI tool that:
- Reads a filesystem path (.fixtures/ — gitignored, dev-local)
- Writes a filesystem path (snapshots/ — committed)
- Imports pure parser functions (createParserState, feedText) — no network, no DB, no auth, no IPC
- Does NOT introduce new external dependencies

Zero new network endpoints, auth paths, file-access patterns outside the explicit fixture/snapshot paths, or schema changes.

## Self-Check: PASSED

- FOUND: scripts/parser-snapshot.ts
- FOUND: snapshots/.gitkeep (0 bytes)
- FOUND: package.json with `parser:snapshot` entry
- FOUND: .planning/phases/01-safety-harness-scaffolding-infrastructure/01-05-SUMMARY.md
- FOUND: commit 8905c0d (Task 1)
- FOUND: commit 14e8a2a (Task 2)
- CONFIRMED: LOG_LINE_REGEXP byte-identical with Plan 01
- CONFIRMED: .fixtures/ gitignored (Plan 01 invariant)
- CONFIRMED: snapshots/ NOT gitignored (D-13 invariant)
- CONFIRMED: bun test 35/35 pass (zero regressions)

---
*Phase: 01-safety-harness-scaffolding-infrastructure*
*Completed: 2026-04-19*
