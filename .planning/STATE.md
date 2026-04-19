---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Ready to execute
last_updated: "2026-04-19T00:00:00.000Z"
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 7
  completed_plans: 0
---

# STATE: bylins-bot — Monolith Refactor

**Initialized:** 2026-04-18
**Milestone:** monolith refactor (behaviour-preserving)

## Project Reference

**Core Value:** Сделать кодобазу проще в работе — разобрать монолиты и устранить >15-секундное зависание UI после reload — не меняя поведение бота.

**Current Focus:** Phase 1 — Safety Harness + Scaffolding Infrastructure. Regression oracle и структурные примитивы до любых доменных правок.

**Primary Constraints:**

- Behaviour-preserving: bit-for-bit identical bot behaviour (farm/combat/zone-scripts/triggers)
- Factory pattern `createXxx({deps})`; no classes in domain code
- Single-user, single-session assumption holds
- Bun + TypeScript strict + Postgres (porsager) — locked
- GitNexus workflow (`impact` before edit, `detect_changes` before commit, `rename` not find-and-replace)

## Current Position

**Phase:** 1 of 4 — Safety Harness + Scaffolding Infrastructure
**Plan:** 7 plans drafted across 3 waves — ready for `/gsd-execute-phase 1`
**Status:** Ready to execute
**Progress:**

```
Overall:  [░░░░░░░░░░░░░░░░░░░░]   0% (0/36 requirements)
Phase 1:  [░░░░░░░░░░░░░░░░░░░░]   0% (0/9 requirements — SAFE-*, INFRA-*)
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

### Open Questions (for future plan-phase sessions)

- Phase 2: navigation-first (user preference) vs leaf-first (research recommendation)? — decide at `/gsd-plan-phase 2`
- Phase 1: `mitt` (3.0.1, <200 bytes) vs roll-your-own `createMudBus` (~80 LOC) for INFRA-01? STACK.md says both valid; decide on plan-phase
- Phase 1: `postgres-shift` (0.1.0, Dec 2022, low maintenance) vs roll-your-own (~40 LOC) for INFRA-03? STACK.md says both valid
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

**Last action:** Phase 1 planned — 7 plans across 3 waves, verification PASSED (5 non-blocking warnings).
**Next command:** `/gsd-execute-phase 1` — run Wave 1 (Plans 01, 02, 03) in parallel, then Wave 2 (04, 05), then Wave 3 (06, 07).
**Last file edited:** `.planning/phases/01-safety-harness-scaffolding-infrastructure/01-0{1..7}-PLAN.md`, `.planning/phases/01-safety-harness-scaffolding-infrastructure/01-PATTERNS.md`
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
- `src/map/store.ts` (785 LOC) — touches in Phase 1 (migration framework adoption)

---
*State initialized: 2026-04-18 after roadmap creation*
