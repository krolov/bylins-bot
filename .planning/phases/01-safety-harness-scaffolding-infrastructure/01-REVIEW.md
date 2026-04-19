---
phase: 01-safety-harness-scaffolding-infrastructure
reviewed: 2026-04-19T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - .githooks/pre-commit
  - .gitignore
  - docs/mud-phrases.md
  - docs/refactor-playbook.md
  - package.json
  - scripts/extract-baseline.ts
  - scripts/lib/fake-clock.ts
  - scripts/lib/mock-map-store.ts
  - scripts/parser-snapshot.ts
  - scripts/replay-harness.ts
  - snapshots/.gitkeep
  - src/bus/mud-event-bus.test.ts
  - src/bus/mud-event-bus.ts
  - src/bus/types.ts
  - src/map/migrations/20260418180000-baseline.sql
  - src/map/migrations/20260418180100-add-has-wiki-data.sql
  - src/map/migrations/20260418180200-drop-farm-zone-settings.sql
  - src/map/migrations/runner.test.ts
  - src/map/migrations/runner.ts
  - src/map/store.ts
  - src/ports/broadcaster.ts
  - src/ports/defaults/now.ts
  - src/ports/defaults/session-teardown.ts
  - src/ports/defaults/timer.ts
  - src/ports/mud-command-sink.ts
  - src/ports/now-provider.ts
  - src/ports/session-teardown-registry.ts
  - src/ports/timer-provider.ts
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-04-19T00:00:00Z
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

Phase 1 delivers the safety-harness scaffolding: baseline extractor, parser-snapshot
and replay-harness oracles, typed event bus, ports layer, migration runner with
baseline-pump, and the refactor playbook plus pre-commit gate. The code is
consistently well-structured with clear contracts, careful error handling in the bus,
strict TS typing, and thoughtful commentary documenting why decisions were made.

No critical or security-class issues were found. Five warnings flag correctness and
reliability concerns that will matter once Phase 2 starts wiring controllers through
these primitives — most notably a broken commit-message detection path in the
pre-commit hook, a missing try/catch in the default session-teardown registry (unlike
the bus, which does isolate handler errors), and a readstream leak in the replay
harness. Six info items call out minor cleanup opportunities.

## Warnings

### WR-01: pre-commit hook's commit-message detection is unreliable

**File:** `.githooks/pre-commit:16-25`
**Issue:** The hook reads `.git/COMMIT_EDITMSG` to detect `refactor(` in the commit
message, but git writes `COMMIT_EDITMSG` AFTER running `pre-commit` (not before).
When pre-commit runs, the file contains a stale message from the previous commit (or
is empty on first commit). This means:
- `git commit -m "refactor(2): foo"` on a non-`refactor/*` branch may NOT trigger
  `replay:check`, depending on the prior message's contents — false negative.
- A developer who last typed `refactor(...)` and then does a non-refactor commit on
  main may trigger `replay:check` spuriously — false positive.

The branch-name check (`refactor/*`) works correctly and is the primary mechanism;
the commit-msg fallback is effectively broken for the intended use case. The playbook
at `docs/refactor-playbook.md:48-52` documents the `refactor(N): <what>` PR title
convention, so users reasonably expect message-based detection to work.

**Fix:** Either remove the commit-message branch (accept branch-name as the sole
gate) or move the message check to a `commit-msg` hook which runs after the message
is written:
```bash
# Option A: drop the elif; branch-only gate
if [[ "${branch}" != refactor/* ]]; then
  exit 0
fi
```
```bash
# Option B: split into .githooks/commit-msg that receives $1 = message file path
# (commit-msg hooks are invoked with the staged message file after pre-commit)
```

### WR-02: createDefaultSessionTeardownRegistry.invokeAll does not isolate hook errors

**File:** `src/ports/defaults/session-teardown.ts:12-16`
**Issue:** `invokeAll()` iterates `[...hooks]` (good — snapshot-before-iterate) but
calls each hook without try/catch. A single throwing hook stops teardown, leaving
subsequent hooks uninvoked. Compare with `src/bus/mud-event-bus.ts:24-28` which
carefully reports handler errors via `deps.onError` so that one bad subscriber
cannot break the dispatch. For a registry whose sole purpose is CLEANUP on session
end, a mid-iteration throw is especially costly — later teardown never runs, leaking
resources.
**Fix:**
```typescript
invokeAll(): void {
  for (const hook of [...hooks]) {
    try {
      hook();
    } catch (error: unknown) {
      // TODO: accept a deps.onError the way createMudBus does, and surface via that.
      // For Phase 1 scaffolding, swallow so subsequent hooks still run.
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[session-teardown] hook error: ${message}`);
    }
  }
}
```
Better still: follow the bus pattern and accept a `{ onError }` dependency so the
registry does not reach for `console` directly.

### WR-03: replay-harness.ts::extractFirstTimestamp leaks the read stream

**File:** `scripts/replay-harness.ts:141-152`
**Issue:** On an early match, the function calls `rl.close()` but never destroys the
underlying `createReadStream` handle. `rl.close()` only shuts down the readline
interface — the file descriptor can remain open until GC. Compare with
`scripts/extract-baseline.ts:131-134` which correctly calls both `rl.close()` AND
`readStream.destroy()`. On Windows and on long-lived test processes this can produce
EMFILE errors.
**Fix:**
```typescript
async function extractFirstTimestamp(fixturePath: string): Promise<number | null> {
  const readStream = createReadStream(fixturePath);
  const rl = createInterface({ input: readStream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const match = LOG_LINE_REGEXP.exec(line);
      if (match?.groups?.["ts"] !== undefined) {
        const parsed = Date.parse(match.groups["ts"]);
        return Number.isNaN(parsed) ? null : parsed;
      }
    }
    return null;
  } finally {
    rl.close();
    readStream.destroy();
  }
}
```

### WR-04: fake-clock.ts interval re-arm does not emit a schedule event

**File:** `scripts/lib/fake-clock.ts:108-114`
**Issue:** When an interval fires, the timer is re-armed in-place
(`ready.fireAt = currentMs + ready.intervalMs`) but no corresponding
`timer.schedule-interval` entry is emitted. The INITIAL `setInterval` call emits a
schedule entry, but subsequent re-arms are silent. Every subsequent interval fire
will be recorded via `timer.fire`, so the transcript remains sufficient for
byte-equality checks — but the temporal ordering story becomes harder to reason
about for Phase 2 reviewers: a subscriber that inspects the transcript looking for
"when was this interval next armed?" will only find the first schedule entry and
then N fire entries with no re-schedule markers between them. The harness promises
"exact temporal positioning, not wall-clock drift" (file-header comment, line 6) —
emitting a re-schedule entry on interval re-arm would honor that promise more
explicitly.
**Fix:**
```typescript
if (ready.kind === "interval" && ready.intervalMs !== undefined) {
  ready.fireAt = currentMs + ready.intervalMs;
  sink.emit({
    kind: "timer.schedule-interval",
    id: ready.id,
    delayMs: ready.intervalMs,
    atVirtualMs: currentMs,
    rearm: true,
  });
} else {
  ready.cancelled = true;
}
```
If this change is made AFTER the first replay-before.jsonl has been seeded, the
re-seed ritual in `docs/refactor-playbook.md:75-90` applies.

### WR-05: parser-snapshot.ts uses hardcoded DEFAULT_BEFORE_PATH for diff regardless of --out override

**File:** `scripts/parser-snapshot.ts:234`
**Issue:** `diffSnapshots(DEFAULT_BEFORE_PATH, args.out)` — the "before" path is
always `snapshots/parser-before.jsonl`, but the caller may have passed `--out` to
redirect the "after" output. There is no `--before` flag, so a caller who
overrides `--out` to compare against a different baseline cannot do so. The identical
issue exists in `scripts/replay-harness.ts:297`. This becomes a usability bug in
Phase 2 if a developer wants to compare two harness runs side-by-side against a
specific baseline (e.g., an archived pre-extraction snapshot).
**Fix:** Either add a `--before PATH` CLI flag to match `--out`, or document
explicitly that `--out` is for writing and the comparison target is always fixed.
Simplest patch:
```typescript
// In parseArgs:
let beforeOverride: string | null = null;
// ...
} else if (flag === "--before") {
  beforeOverride = value;
  i += 1;
}
// ...
const before = beforeOverride ?? DEFAULT_BEFORE_PATH;
return { writeInitial, fixture, out, before, help };

// In main:
const diff = diffSnapshots(args.before, args.out);
```

## Info

### IN-01: scripts/parser-snapshot.ts and scripts/replay-harness.ts duplicate extractMessageLiteral

**File:** `scripts/parser-snapshot.ts:101-117` and `scripts/replay-harness.ts:106-121`
**Issue:** The `extractMessageLiteral` helper is duplicated byte-identically across
both scripts. The replay-harness file even notes this in a comment: "Verbatim copy of
the helper shipped in scripts/parser-snapshot.ts — single source of truth." The
"single source of truth" framing is self-contradictory when the literal bytes are
copied into two files.
**Fix:** Extract to `scripts/lib/log-line.ts` exporting `LOG_LINE_REGEXP` and
`extractMessageLiteral`. Both scripts import. Keeps the drift-prevention guarantee
mechanical (tsc enforced) rather than human-enforced.

### IN-02: createFakeTimerProvider is a tombstone function

**File:** `scripts/lib/fake-clock.ts:149-155`
**Issue:** `createFakeTimerProvider()` immediately throws. The accompanying comment
explains WHY ("callers should use createFakeClock"), but an exported function whose
body is a throw is a code smell — callers cannot statically distinguish this from a
real impl. Two better options:
1. Delete the export. If it is truly not used, lint + tsc will not warn on removal.
2. Re-export it as a documented alias by returning a valid `TimerProvider` built
   atop `createFakeClock` internally.
**Fix:** Delete the export unless a concrete caller exists. If kept for API
symmetry, make the throw happen at call-time with a clearer explanation.

### IN-03: parseItemData double-JSON-parses without explaining why

**File:** `src/map/store.ts:171-175`
**Issue:** `parseItemData` conditionally applies `JSON.parse` twice:
```typescript
const step1 = typeof raw === "string" ? JSON.parse(raw) : raw;
const step2 = typeof step1 === "string" ? JSON.parse(step1) : step1;
```
This pattern exists because some rows in `game_items.data` were stored double-encoded
by older code paths. Without a comment, a reader can only guess. This code is
pre-Phase-1 (it lived in `store.ts` before extraction) but it remains in scope for
this review.
**Fix:** Add a one-line comment:
```typescript
function parseItemData(raw: unknown): Record<string, unknown> {
  // Legacy rows were stored as double-JSON-encoded strings via `JSON.stringify(JSON.stringify(obj))`.
  // Detect and unwrap: step1 unwraps the outer encoding, step2 unwraps inner-if-still-string.
  const step1 = typeof raw === "string" ? JSON.parse(raw) : raw;
  const step2 = typeof step1 === "string" ? JSON.parse(step1) : step1;
  return step2 as Record<string, unknown>;
}
```

### IN-04: migration runner sleeps on partial-list readdir

**File:** `src/map/migrations/runner.ts:35-40`
**Issue:** `listMigrationFiles()` reads `MIGRATIONS_DIR` once per `runMigrations`
call. If a developer drops a new `.sql` file into the migrations directory
mid-transaction (e.g., hot-reload during development), behavior depends on OS
filesystem semantics. Not a real production risk — runMigrations runs once at
startup — but worth a note.
**Fix:** Optional. Pre-read the listing at module-load time and export it:
```typescript
const MIGRATION_FILES = await listMigrationFiles();
```
Or simply document that the function is single-shot and not re-entrant. Current
behavior is already adequate; no code change strictly required.

### IN-05: mock-map-store.ts type-imports MapStore's member types but not MapStore itself via `import type`

**File:** `scripts/lib/mock-map-store.ts:12-22`
**Issue:** Line 12 uses `import type { MapStore }` (good), but the related types on
lines 13-22 are also imported as `import type { ... }`. This is fine — the issue is
that `MapStore` is imported from the same file as the member types but the style
is slightly inconsistent because two separate `import type` blocks exist for the
same source file. Merging them reduces friction on Phase 2 refactors.
**Fix:**
```typescript
import type {
  GameItem,
  MapStore,
  MarketSale,
  MobName,
  QuestCompletion,
  RoomAutoCommand,
  ZoneScriptSettings,
} from "../../src/map/store.ts";
```
Purely cosmetic; tsc accepts both forms.

### IN-06: snapshots/.gitkeep is an empty file — consider documenting its purpose

**File:** `snapshots/.gitkeep:1`
**Issue:** An empty `.gitkeep` ensures the directory is tracked pre-seed. A single
comment line would help onboarding developers understand why the directory exists
before any snapshot has been generated. Since `snapshots/*.jsonl` files ARE
committed per `docs/refactor-playbook.md:116-121`, the keep-file becomes dead weight
after the first seed. Optional cleanup.
**Fix:** Replace with a minimal `snapshots/README.md` that documents the expected
file names (`parser-before.jsonl`, `replay-before.jsonl`) and points at the playbook.
Or leave as-is and remove once snapshots are seeded.

---

_Reviewed: 2026-04-19T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
