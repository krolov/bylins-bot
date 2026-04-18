# Phase 1: Safety Harness + Scaffolding Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 01-safety-harness-scaffolding-infrastructure
**Areas discussed:** Baseline capture, Replay harness shape, Bus impl, Migration framework

---

## Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Baseline capture | How/what/where we record 30-min fixture | ✓ |
| Replay harness shape | What side-effects it records, DB strategy, diff format, when it runs | ✓ |
| Bus impl | mitt vs roll-your-own; event granularity; error handling | ✓ |
| Migration framework | postgres-shift vs roll-your-own; baseline strategy; naming; advisory lock | ✓ |

---

## Baseline Capture

### Source
| Option | Description | Selected |
|--------|-------------|----------|
| Existing log (Recommended) | Slice 30-min window from `/var/log/bylins-bot/mud-traffic.log` 756MB | ✓ |
| New live session | Record fresh controlled session (farm + chat + loot + combat) | |
| Mix | Slice from log + targeted live captures of rare events | |

**User's choice:** Existing log slice

### Content
| Option | Description | Selected |
|--------|-------------|----------|
| Active farm only | 30 min farm+combat; covers move/mob/loot/stats parsers only | |
| Mixed stream (Recommended) | farm + chat + bazaar + repair + survival-tick | ✓ |
| Parser input only | Only mud-in text without browser/session events | |

**User's choice:** Mixed stream

### Storage
| Option | Description | Selected |
|--------|-------------|----------|
| .fixtures/ commit (Recommended) | Commit fixture + snapshots; reproducible across dev machines | |
| gitignored, local only | `.fixtures/` gitignored; repo small but reproducibility worse | ✓ |
| Git LFS | For >100MB; not needed now | |

**User's choice:** gitignored, local only

### Sensitive Content
| Option | Description | Selected |
|--------|-------------|----------|
| Sanitize before commit (Recommended) | Scrub passwords/tokens/profile ID before fixture | |
| gitignored, raw | Don't commit; keep raw | |
| Нет сенситивного | User vote: log OK as-is | ✓ |

**User's choice:** No sensitive content — log OK as-is

---

## Replay Harness Shape

### Records
| Option | Description | Selected |
|--------|-------------|----------|
| All side-effects (Recommended) | emit-seq + mud-out commands + WS broadcasts + DB upserts | ✓ |
| Minimal: mud-out + DB | Commands to MUD + DB writes only | |
| Parser only | ParsedEvent[] from parser.ts (duplicates SAFE-02) | |

**User's choice:** All side-effects

### DB Strategy
| Option | Description | Selected |
|--------|-------------|----------|
| Test Postgres (Recommended) | Real pg instance via docker compose or local | |
| In-memory MapStore | Reuse existing memory-store.ts | |
| Mock | Spy in memory records SQL calls as sequence | ✓ |

**User's choice:** Mock spy

### Diff Format
| Option | Description | Selected |
|--------|-------------|----------|
| JSONL + deep-diff (Recommended) | Each side-effect one JSON line; structured diff output | ✓ |
| Byte-identical | Text snapshot; false diffs on timestamps/non-deterministic IDs | |
| bun:test snapshot | toMatchSnapshot integration | |

**User's choice:** JSONL + deep-diff

### When to Run
| Option | Description | Selected |
|--------|-------------|----------|
| Manual + pre-commit (Recommended) | `bun run replay:check` manual; pre-commit hook for refactor PRs | ✓ |
| Manual only | Discipline via playbook, no hooks | |
| In bun:test | Part of test suite — issues if requires real Postgres | |

**User's choice:** Manual + pre-commit hook

---

## Bus Impl

### Library
| Option | Description | Selected |
|--------|-------------|----------|
| Roll-your-own ~80 LOC (Recommended) | Factory style; 0 new deps; full control over sync semantics | ✓ |
| mitt@3.0.1 | 200 bytes; well-known; +1 dep; no built-in onAny/once | |

**User's choice:** Roll-your-own

### Event Granularity
| Option | Description | Selected |
|--------|-------------|----------|
| mud_text_raw only (Recommended) | Minimum for Phase 1; matches onMudText 1:1 | ✓ |
| Rich set | mud_text_raw + room_parsed + mob_appeared + combat_started + session_teardown | |
| Two core | mud_text_raw + session_teardown | |

**User's choice:** mud_text_raw only

### Error Handling
| Option | Description | Selected |
|--------|-------------|----------|
| try/catch + logEvent (Recommended) | One handler error doesn't interrupt others; matches current behaviour | ✓ |
| Unhandled throw | Strict but may kill session | |
| Collect + throw after | AggregateError; clean semantics but changes behaviour | |

**User's choice:** try/catch + logEvent

---

## Migration Framework

### Library
| Option | Description | Selected |
|--------|-------------|----------|
| Roll-your-own ~40 LOC (Recommended) | 0 new deps; `sql.file()` already covers it | ✓ |
| postgres-shift@0.1.0 | Same-author as postgres; battle-tested; +1 dep; last release Dec 2022 | |

**User's choice:** Roll-your-own

### Baseline Strategy
| Option | Description | Selected |
|--------|-------------|----------|
| Pump schema_migrations (Recommended) | Detect map_rooms + no schema_migrations → create table + INSERT IDs without running SQL | ✓ |
| Manual command | scripts/migrate.ts baseline-seed run once on prod | |
| Empty 001 migration | noop first migration creates schema_migrations | |

**User's choice:** Pump schema_migrations

### Naming
| Option | Description | Selected |
|--------|-------------|----------|
| NNNN-description.sql (Recommended) | 0001-baseline.sql; lexicographic = order; simpler merges | |
| Timestamp | YYYYMMDDHHMMSS-description.sql; never collides; bulkier | ✓ |

**User's choice:** Timestamp

### Advisory Lock
| Option | Description | Selected |
|--------|-------------|----------|
| Да (Recommended) | pg_advisory_xact_lock(N) before runner | ✓ |
| No — PM2 single-instance | Skip; add if scaling | |

**User's choice:** Yes, advisory lock

---

## Claude's Discretion

- Exact task breakdown within each PLAN.md
- Organization of `docs/mud-phrases.md` (by-file vs by-feature vs by-regex-family)
- Port naming (e.g., `MudCommandSink` vs `MudCommands` vs `CommandSink`)
- Deep-diff library choice (`jsondiffpatch` vs `deep-diff` vs hand-rolled)
- Mock-MapStore implementation style (empty methods vs recording spy)

## Deferred Ideas

- Clock injection into all existing controllers (Phase 2 per-extraction)
- MapStore port move (Phase 2 if needed)
- Granular events (room_parsed, combat_started) — Phase 2
- CI pipeline for replay-harness (v2 TOOL-01)
- fast-check property tests (Phase 4)
- Test-Postgres integration setup (Phase 4 for TEST-05)
- `@ladybugdb/core` devDep cleanup (not Phase 1)
