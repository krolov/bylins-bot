# Project Research Summary

**Project:** bylins-bot — monolith refactor + event bus + migration framework + frontend freeze fix
**Domain:** Brownfield TypeScript/Bun refactor (factory-DI monolith → event-bus + modular)
**Researched:** 2026-04-18
**Confidence:** HIGH

## Executive Summary

This is a behaviour-preserving structural refactor of a production MUD bot. The codebase has four monolithic files (`server.ts` 1867 строк, `client/main.ts` 1029, `client/map-grid.ts` 1046, `wiki.ts` 955), zero tests on the hot path, and a >15-second UI freeze on every browser reload. The Core Value: сделать кодобазу проще в работе, сохранив поведение бота bit-for-bit. Все четыре измерения рисёрча сходятся в одном — рефактор трактуем, паттерны известны, риски почти полностью исполнительные, а не архитектурные.

Рекомендуемый подход — strangler-fig из *Working Effectively with Legacy Code*: сначала установить поведенческий baseline (log-replay harness), прежде чем двигать хоть один символ; затем извлекать по нарастанию риска — от мелких узлов к навигации; event bus живёт рядом со старым `Set<Handler>`, не замещая его одной комитом. Migration framework приходит до любых новых schema-изменений и умеет сидить baseline на уже "полу-мигрированной" production DB. Frontend-freeze диагностируется Chrome DevTools flamegraph'ом ДО любых правок.

Главный риск — silent regression: без тестов неправильный regex-флаг, потерянный timer handle или event bus с изменённым порядком слушателей не дадут compile error — они дадут смерть персонажа в игре. Phase 0 safety harness (log-replay, parser snapshots, commit discipline, PR gate) — это запирание двери до покраски. Пропустить или поспешить — все последующие фазы небезопасны.

## Key Findings

### Recommended Stack

См. [STACK.md](STACK.md). Три добавления к закреплённому стеку (Bun/TS/postgres porsager/Cytoscape) — все решают одну конкретную задачу рефактора без побочных изменений.

**Core technologies:**
- **mitt@3.0.1** — типизированный event bus (sub-200-байт, TS-дженерики, zero deps). Drop-in замена `mudTextHandlers: Set<Handler>` с теми же sync-семантиками. Альтернатива: roll-your-own ~80 строк — равноценно, стилистически даже ближе к проекту
- **postgres-shift@0.1.0** — migration framework от того же автора что и `postgres` (porsager). Альтернатива: roll-your-own ~40 строк на `sql.file()` + `schema_migrations` table — равноценно. `node-pg-migrate`/Prisma/Drizzle дисквалифицированы (требуют `pg`)
- **fast-check@4.7.0** внутри `bun:test` — property-based тесты для парсеров и BFS pathfinder. Runner-agnostic, работает с built-in Bun test runner
- **Bun `--cpu-prof` / `--heap-prof`** (server) + Chrome DevTools Performance panel (browser) — профилинг 15s freeze. Zero extra deps

### Expected Features

См. [FEATURES.md](FEATURES.md). 10 table-stakes активностей определяют "refactor done"; 12 differentiators — quality multipliers; 15 anti-features должны быть отвергнуты.

**Must have (table stakes):**
- T1: Log-replay characterization harness (baseline из реального `mud-traffic.log` до любых правок)
- T2: `server.ts` → ≤ ~400 LOC composition root (навигация/stats/chat/loot/ws извлечены)
- T3: Extract client/main.ts monolith (hotkeys, zone-script panel)
- T4: Event bus заменяет `onMudText` callback chain (через shim, не замещение)
- T5+T6: Migration framework + inline `ALTER TABLE IF NOT EXISTS` удалены
- T7: Frontend freeze диагностирован, root cause задокументирован с 2-of-3 independent confirmations
- T8: Per-PR gitnexus_impact + snapshot-diff gate
- T9: Targeted tests после структурного разбора (критичные модули)

**Should have (differentiators):**
- D1: Log-replay harness как regression oracle (single highest-leverage)
- D2: `docs/mud-phrases.md` — инвентаризация всех MUD-регексов по файлам и назначению
- D3: Deterministic clock/timer injection для тестируемости
- D4: Behaviour-preserving commit convention (один refactor = один PR, green regression)
- D5: Feature-flag bisect harness для freeze diagnosis

**Explicitly reject (anti-features):**
- A1: Fix bugs while refactoring — уничтожает regression oracle (документируй, отложи)
- A10: Rewrite `map-grid.ts` до профайлинга — unbounded scope
- A13: Parallelize DB writes до fix `upsertEdge` race — data corruption
- A11–A14: Feature creep из CONCERNS.md (password rotation, CI, lint, auto-map) — следующая итерация
- A5–A9: Новые фичи под видом "while we're here" — все в следующий milestone

### Architecture Approach

См. [ARCHITECTURE.md](ARCHITECTURE.md). Ports-and-adapters через существующий `createXxx({deps})` factory-стиль — рефактор не меняет парадигму, а применяет её к коду который сейчас лежит в `server.ts`. Зависимости направлены строго: `ports ← controllers ← adapters ← server.ts`, ни один controller не импортирует другой controller's implementation. Bus — только для fan-out (один источник → многие подписчики); для 1:1 и request/response остаются direct deps.

**Major components:**
1. **src/ports/** — чистые TypeScript interfaces (MudCommandSink, Broadcaster, MapStore, SessionTeardown)
2. **src/bus/** — `MudEventBus` с discriminated-union `MudEvent` + `Extract<Union, {kind: K}>` для strict-TS safety
3. **src/controllers/** — извлечённые доменные модули (stats-parser, chat-parser, loot-sort, navigation, browser-gateway)
4. **src/adapters/** — infrastructure glue (ws-adapter, mud-tcp-adapter, pg-adapter)
5. **server.ts** — thin composition root ≤400 LOC (создаёт bus, wires ports → controllers → adapters, регистрирует shutdown)
6. **client/features/** — `hotkeys`, `zone-script-panel`, `event-router`, split `map-grid` (layout/render/interactions)

### Critical Pitfalls

См. [PITFALLS.md](PITFALLS.md). Top 7 — каждый с file:line anchor из реального кода.

1. **Double-fire при bus cut-over** — шим-паттерн обязателен; никогда не wiring оба dispatch path одновременно. Миграция listener'ов по одному PR
2. **Closure-captured `let` leak** — `grep -n '\bVAR_NAME\b'` перед переносом любой module-level переменной; two-step: move then inline
3. **Regex drift при extraction** — cut-paste дословно; `snapshots/before.jsonl` ДО касания парсера; diff должен быть пустым
4. **Schema migration baseline mismatch** — детектить отсутствие `schema_migrations` на production и SEED-ить (не перезапускать baseline SQL)
5. **Speculative freeze fix** — measure-only фаза обязательна; fix PR должен включать flamegraph + 1 independent confirmation
6. **gitnexus_rename blind to string keys** — `grep -rn '"oldName"'` + JSONB column audit перед каждым rename; `CLAUDE.md` предупреждает сам
7. **Orphaned timers** — factory которая планирует должна владеть `clearTimeout`; каждая timer-factory exposes `shutdown()` registered in `sessionTeardownHooks`

## Implications for Roadmap

На основе рисёрча, предлагаемая структура — 8 фаз:

### Phase 1: Safety Harness (HARD GATE)
**Rationale:** Без regression oracle любой extraction — угадайка; ноль тестов на hot-path делает это MUST BEFORE.
**Delivers:** Log-replay harness + parser snapshots + clock injection + PR discipline
**Addresses:** T1, D1, D3, D4
**Avoids:** P1 (double-fire), P3 (regex drift), P5 (speculative fix)

### Phase 2: Scaffolding Infrastructure
**Rationale:** Bus + ports + migrations baseline — структурные примитивы, в которые въедут извлечённые модули. Риск минимальный: нет consumers, нет новых schema changes.
**Delivers:** `src/bus/` + `src/ports/` + migration framework с baseline-seeded on production
**Uses:** mitt (или roll-your-own) + postgres-shift (или roll-your-own)
**Implements:** Bus + ports + migrations subsystems из ARCHITECTURE.md

### Phase 3: server.ts Leaf Extractions
**Rationale:** Мелкие-низкорисковые первыми — проверяем harness до того как браться за navigation (~760 строк).
**Delivers:** stats-parser.ts + chat-parser.ts + market-sales + loot-sort — каждое своим PR
**Addresses:** T2 (частично), T8 gitnexus gate
**Avoids:** P2 closure leak, P3 regex drift (один snapshot-diff на каждый PR)

### Phase 4: server.ts Core Extractions
**Rationale:** Навигация и browser-gateway — самые большие куски, делаем после того как harness валидирован на leaf-фазе.
**Delivers:** navigation-controller.ts + browser-gateway.ts; `server.ts` ≤400 LOC
**Addresses:** T2 (полностью), T4 подготовка
**Avoids:** P6 gitnexus blind spot на dynamic routes — mandatory два прохода

### Phase 5: Frontend Freeze Diagnosis (MEASURE-ONLY)
**Rationale:** Root cause unknown; fix scope не определяем до профайла. Параллелизуемо с Phase 3-4.
**Delivers:** flamegraph report + root cause с 2-of-3 confirmations (profiler + bisect + server-timing)
**Addresses:** T7
**Avoids:** P5 speculative fix

### Phase 6: Client Monolith Split
**Rationale:** main.ts + map-grid.ts + wiki.ts — independent track; можно параллелить с серверным рефактором.
**Delivers:** client/features/hotkeys, zone-script-panel; map-grid split (layout/render/interactions); wiki split (client/parser/slots)
**Addresses:** T3

### Phase 7: Event Bus Cut-Over + Freeze Fix
**Rationale:** Каждый controller полностью на bus, старый `mudTextHandlers: Set` удалён. Freeze fix gated on Phase 5 findings.
**Delivers:** `Set<Handler>` callback chain deleted; freeze resolved
**Addresses:** T4 finalization + T7 fix
**Avoids:** P1 double-fire (last consumer = last PR), P5 unmeasured fix

### Phase 8: Post-Extraction Tests
**Rationale:** Per PROJECT.md Key Decision — тесты ПОСЛЕ структуры (писать против разобранных модулей дешевле чем против монолита).
**Delivers:** bun:test snapshots для parsers; fast-check для grid algo + BFS; unit-тесты для navigation, triggers, farm2, mud-connection, map/store
**Uses:** bun:test + fast-check

### Phase Ordering Rationale

- **Phase 1 → Phase 2 → Phases 3-6** — структурная зависимость: harness → scaffolding → extractions. Каждая фаза требует предыдущего как gate
- **Phases 5 и 6 параллелизуемы с Phase 3-4** — разные файловые области (server vs client vs profiling)
- **Phase 7 гейтится на Phase 5 findings** — fix scope условен
- **Phase 8 последний** — тесты против разобранной структуры, не против монолита, согласно PROJECT.md

### Research Flags

**Phases likely needing deeper research-phase during planning:**
- **Phase 7 (если map_delta — корень freeze):** `map_delta` event protocol дизайн (delta structure, client-side patch, reconnect state divergence) — архитектурно нетривиально. Флагить research-phase если Phase 5 укажет на full-snapshot broadcast
- **Phase 4 navigation extraction specifically:** самая большая и связанная. Обязательно `gitnexus_context` + `gitnexus_impact` sweep; следовать two-pass shim из ARCHITECTURE.md

**Phases with standard patterns (skip research-phase):**
- **Phase 1:** Feathers characterization-test playbook полностью специфицирован в PITFALLS.md
- **Phase 2:** bus type design полностью закодирован в ARCHITECTURE.md; migration baseline problem полностью адресован в PITFALLS.md Pitfall 4
- **Phase 3, 6 leaf modules:** паттерн проверен gold-standard'ом `src/farm2/`
- **Phase 5:** Chrome DevTools methodology стандартная; пошаговый playbook в FEATURES.md
- **Phase 7 migration finalization:** полностью специфицировано в PITFALLS.md
- **Phase 7 event bus cut-over phases A-E:** полностью описано в ARCHITECTURE.md
- **Phase 8:** fast-check + bun:test интеграция подтверждена в STACK.md

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Все выборы проверены против April 2026 official docs; совместимость с Bun 1.x и postgres@3.4.9 подтверждена; два открытых выбора (mitt vs roll-your-own; postgres-shift vs roll-your-own) оба valid |
| Features | HIGH | Каждый элемент заякорен на PROJECT.md constraint или CONCERNS.md line reference |
| Architecture | HIGH (patterns) / MEDIUM (LOC targets) | Bus type design полностью закодирован и сверен с существующим `farm2/`; LOC targets (400/250) — оценки ±20% |
| Pitfalls | HIGH | Каждый pitfall заякорен на конкретную строку исходника через прямой code inspection |

**Overall confidence:** HIGH

### Gaps to Address

- **Freeze root cause unknown до Phase 5** — Phase 7 freeze-fix scope условный placeholder; детальный план только после flamegraph'а
- **postgres-shift vs roll-your-own** — решить на планировании Phase 2; документировать в PROJECT.md Key Decisions
- **Loot-sort ↔ gather-script `onPickupForRaskhod` interaction** — рекомендация оставить direct callback (single consumer); решить на PR loot-sort extraction
- **combat-state bus events vs query** — рекомендация: оставить queryable singleton для этого milestone; bus events — пост-milestone полировка

## Sources

### Primary (HIGH confidence)
- Context7 + Bun официальные доки — `--cpu-prof`/`--heap-prof`, `bun:test` snapshot API
- postgres (porsager) README — явная рекомендация postgres-shift
- mitt GitHub — TS-дженерики, bundle size, sync-семантика
- fast-check@4.7.0 release notes — runner-agnostic usage
- Chrome DevTools Performance docs — стандартный flamegraph методология

### Secondary (MEDIUM confidence)
- *Working Effectively with Legacy Code* (Feathers) — characterization test pattern
- Martin Fowler *Refactoring* — strangler-fig применимость
- TypeScript discriminated-union patterns — established since TS 2.0

### Tertiary (LOW confidence)
- LOC targets (server.ts ≤400, extracted modules ≤250) — эмпирическая оценка ±20%, уточнять на фазе

---
*Research completed: 2026-04-18*
*Ready for roadmap: yes*
