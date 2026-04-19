# 01-04 Pre-flight: GitNexus Impact Audit on `mapStore.initialize`

**Date:** 2026-04-19
**Plan:** 01-04 (INFRA-03 + INFRA-04 — migration framework adoption)
**Author:** sequential executor agent
**Gate mandated by:** `CLAUDE.md` "Always Do" — MUST run impact analysis before editing any symbol.

## Index Freshness

- `.gitnexus/meta.json` → `lastCommit`: `1cf187a46c5c891e6c6d02bf524ea4b681ea95f0`
- `git rev-parse HEAD` at preflight time: `1cf187a` (`docs(01-03): complete ports-layer plan`)
- `stats.embeddings = 960` → embeddings present; future `analyze` runs must pass `--embeddings` to preserve them.
- **Index freshness verdict:** FRESH (HEAD matches `lastCommit`). No re-analyze needed.

## Impact Analysis — `initialize`

Command:

```
npx --no-install gitnexus impact initialize --repo bylins-bot --direction upstream
```

Result (verbatim JSON):

```json
{
  "target": {
    "id": "Method:src/map/store.ts:initialize",
    "name": "initialize",
    "type": "Method",
    "filePath": "src/map/store.ts"
  },
  "direction": "upstream",
  "impactedCount": 1,
  "risk": "LOW",
  "summary": { "direct": 1, "processes_affected": 0, "modules_affected": 0 },
  "affected_processes": [],
  "affected_modules": [],
  "byDepth": {
    "1": [
      {
        "depth": 1,
        "id": "File:src/server.ts",
        "name": "server.ts",
        "filePath": "src/server.ts",
        "relationType": "CALLS",
        "confidence": 0.9
      }
    ]
  }
}
```

- **d=1 (WILL BREAK):** `src/server.ts` — calls `mapStore.initialize()` once at startup. Expected per plan.
- **d=2 (LIKELY AFFECTED):** none returned.
- **Risk level:** LOW.

## Impact Analysis — `createMapStore`

Command:

```
npx --no-install gitnexus impact createMapStore --repo bylins-bot --direction upstream
```

Result (verbatim JSON):

```json
{
  "target": {
    "id": "Function:src/map/store.ts:createMapStore",
    "name": "createMapStore",
    "type": "Function",
    "filePath": "src/map/store.ts"
  },
  "direction": "upstream",
  "impactedCount": 1,
  "risk": "LOW",
  "summary": { "direct": 1, "processes_affected": 0, "modules_affected": 0 },
  "affected_processes": [],
  "affected_modules": [],
  "byDepth": {
    "1": [
      {
        "depth": 1,
        "id": "File:src/server.ts",
        "name": "server.ts",
        "filePath": "src/server.ts",
        "relationType": "CALLS",
        "confidence": 0.9
      }
    ]
  }
}
```

- **d=1 (WILL BREAK):** `src/server.ts`.
- **d=2 (LIKELY AFFECTED):** none.
- **Risk level:** LOW.

## Scope Confirmation — `initialize()` body line range

Command:

```bash
awk '/async initialize\(\): Promise<void> \{/{start=NR} /^    \},/ && start{print "initialize body: lines " start "-" NR; exit}' src/map/store.ts
```

Result: `initialize body: lines 178-293`

- Opening brace line: 178 (`async initialize(): Promise<void> {`)
- Closing line: 293 (`},`)
- Body length: 116 lines of inline DDL to be extracted.

Total file length: `wc -l src/map/store.ts` → 838 lines.

## HIGH/CRITICAL Risk Gate

Neither target returned HIGH or CRITICAL risk. Both report LOW. Gate: **not tripped**.

## Gate Decision

**APPROVED to proceed** — executing Tasks 2 through 5. Single d=1 caller (`src/server.ts`) will NOT be touched by Tasks 2-5 (interface `mapStore.initialize(): Promise<void>` is preserved; only the body is collapsed). No breaking signature change.

---

## Post-flight

Performed after Task 5 edits (store.ts collapse + package.json scripts). Confirms scope containment prior to the final commit.

### Tool availability note

The `gitnexus_detect_changes` tool is MCP-only and not exposed via the `gitnexus` CLI (confirmed via `npx gitnexus --help`). Post-flight is therefore performed via:

1. `git log --name-only 8c2cad6^..HEAD` to enumerate the files touched by this plan's commits.
2. `git diff --stat` on the working tree for files not yet committed.
3. Re-running `gitnexus impact initialize` to confirm the caller set is unchanged.

### Files touched by this plan (commits + working tree)

Commit-touched:

- `.planning/phases/01-safety-harness-scaffolding-infrastructure/01-04-preflight.md` (this file)
- `src/map/migrations/20260418180000-baseline.sql`
- `src/map/migrations/20260418180100-add-has-wiki-data.sql`
- `src/map/migrations/20260418180200-drop-farm-zone-settings.sql`
- `src/map/migrations/runner.ts`
- `src/map/migrations/runner.test.ts`

Working-tree (to be committed in Task 5):

- `src/map/store.ts` — initialize body replaced with `await runMigrations(database)`; new import line. `git diff --stat`: 145 lines changed (46+/103-).
- `package.json` — `scripts.migrate` + `scripts["migrate:status"]` added. `git diff --stat`: 4 lines changed.

Pre-existing working-tree modifications (unrelated to this plan, present at agent startup per STATE.md "Git status at creation"): `AGENTS.md`, `CLAUDE.md`, `public/index.html`, `public/styles.css`, `src/client/main.ts`, `src/client/map-grid.ts`, `src/client/types.ts`, `src/container-tracker.ts`, `src/events.type.ts`, `src/map/memory-store.ts`, `src/server.ts`, `src/zone-scripts/controller.ts`, `src/zone-scripts/farm-zone-executor2.ts`, `src/zone-scripts/types.ts`, `src/zone-scripts/zones/104.ts`, and untracked `docs/quest-list.md`, `src/client/quests.ts`. These are out-of-scope for this plan.

### Scope verdict

**PASS** — plan-scope edits are contained to `src/map/` + `package.json` + the preflight note as documented. No out-of-scope files were modified by this plan.

### Post-flight impact re-check on `initialize`

Command: `npx --no-install gitnexus impact initialize --repo bylins-bot --direction upstream` (post-Task-5, index refreshed).

Result:

```json
{
  "target": {
    "id": "Method:src/map/store.ts:initialize",
    "name": "initialize",
    "type": "Method",
    "filePath": "src/map/store.ts"
  },
  "direction": "upstream",
  "impactedCount": 1,
  "risk": "LOW",
  "byDepth": {
    "1": [
      { "depth": 1, "id": "File:src/server.ts", "name": "server.ts", "relationType": "CALLS", "confidence": 0.9 }
    ]
  }
}
```

Caller set: identical to pre-flight (`src/server.ts` at d=1, LOW risk). Interface preserved; no downstream breakage introduced.

### Final verification sequence (all passing at Task 5 completion)

```
bun run typecheck         # exit 0
bun test                  # 35 pass, 0 fail
grep -cE 'CREATE TABLE|ALTER TABLE|DROP TABLE|CREATE INDEX' src/map/store.ts  # 0
grep -c 'await runMigrations(database)' src/map/store.ts                     # 1
grep -c 'import { runMigrations }' src/map/store.ts                          # 1
wc -l src/map/store.ts                                                       # 726 (was 838, -112 lines)
```
