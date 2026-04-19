# Requirements: bylins-bot — Monolith Refactor

**Defined:** 2026-04-18
**Core Value:** Сделать кодобазу проще в работе — разобрать монолиты и устранить >15-секундное зависание UI после reload — не меняя поведение бота.

## v1 Requirements

Рефактор-инициатива. Каждое требование сохраняет поведение бота (behaviour-preserving). Категории отражают структуру работы: SAFETY (гарантии регрессии) → INFRA (scaffolding) → SERVER/CLIENT (extractions) → FREEZE (diagnostics + fix) → TESTS.

### Safety Harness

- [x] **SAFE-01**: Captured baseline — tooling to reproduce 30-минутный лог реального MUD-трафика в `.fixtures/mud-traffic-baseline.log` (gitignored, D-04 local-only); `scripts/extract-baseline.ts` streams a time-windowed slice from `/var/log/bylins-bot/mud-traffic.log` on demand
- [ ] **SAFE-02**: Parser snapshot harness — `scripts/parser-snapshot.ts` прогоняет `src/map/parser.ts` по baseline и пишет `snapshots/before.jsonl`; diff-тест падает если поведение парсера изменилось
- [ ] **SAFE-03**: Deterministic clock injection — `NowProvider` и `TimerProvider` порты внедрены в controllers, заменяют прямые `Date.now()` / `setTimeout` там где это нужно для тестов
- [ ] **SAFE-04**: `docs/mud-phrases.md` — инвентарь всех hardcoded-фраз/регексов русского MUD по файлу и назначению (triggers, survival, market, bazaar, farm2, prompt-stats)
- [ ] **SAFE-05**: Behaviour-preserving commit convention — один refactor-PR = зелёный replay-harness diff + зелёный `bun test`; `docs/refactor-playbook.md` описывает процесс

### Infrastructure

- [x] **INFRA-01**: Event bus — `src/bus/mud-event-bus.ts` с типизированным `MudEvent` discriminated union, sync-delivery семантикой (match with current `onMudText`), `emit`/`on`/`once`/`off`/`onAny` API, returns unsubscribe closures
- [x] **INFRA-02**: Ports layer — `src/ports/` с чистыми interfaces: `MudCommandSink`, `Broadcaster`, `NowProvider`, `TimerProvider`, `SessionTeardownRegistry` (MapStore intentionally deferred per D-28 — остаётся в `src/map/store.ts`); + 3 default factory impls в `src/ports/defaults/`
- [ ] **INFRA-03**: Migration framework — таблица `schema_migrations` + numbered SQL-скрипты в `src/map/migrations/`, runner с advisory lock + идемпотентностью + baseline-seed для уже-мигрированного prod
- [ ] **INFRA-04**: Inline DDL удалён — все `ALTER TABLE IF NOT EXISTS` / `DROP TABLE` из `mapStore.initialize()` перенесены в numbered migrations; `initialize()` сводится к вызову migration runner'а

### Server Extraction

- [ ] **SRV-01**: `stats-parser.ts` извлечён — `MAX_STATS_REGEXP`/`PROMPT_STATS_REGEXP` + `statsHp*`/`statsEnergy*`/`statsLevel`/`statsDsu` state + broadcast логика вынесены в `createStatsController({ bus, broadcaster })`
- [ ] **SRV-02**: `chat-parser.ts` извлечён — `CHAT_FILTER_NAMES`, `isChatLine`, `extractChatLines`, `extractMarketSales` в `createChatController({ bus, mapStore })`
- [ ] **SRV-03**: `loot-sort.ts` извлечён — `scheduleLootSort`, `sortLootedItems`, `autoSortInventory`, `pendingLootItems`, `rashodExemptKeywords` state + timer в `createLootSortController({ bus, mudCommandSink, nowProvider, timerProvider, teardown })`
- [ ] **SRV-04**: `navigation-controller.ts` извлечён — `NavigationState`, `startNavigation`, `startNavigationToNearest`, `onceRoomChanged` и связанные функции (~760 строк) в `createNavigationController({ bus, mapStore, pathfinder, mudCommandSink, teardown })`
- [ ] **SRV-05**: `browser-gateway.ts` извлечён — WebSocket `message` handler (~line 1600) и `switch (event.type)` в `createBrowserGateway({ bus, mudCommandSink, deps })`
- [ ] **SRV-06**: `server.ts` ≤ ~400 LOC — остаётся как composition root: создаёт bus, wires ports → controllers → adapters, регистрирует teardown; нет доменной логики, нет module-level mutable state (кроме минимально-необходимых singleton'ов рантайма)

### Event Bus Cutover

- [ ] **BUS-01**: MUD-text shim — bus emits `mud_text_raw` **одновременно** со срабатыванием старого `mudTextHandlers: Set` (strangler-fig; oба path'а живы до финала)
- [ ] **BUS-02**: Все извлечённые controllers подписываются через bus (не через `addMudTextListener`) — миграция по одному controller'у за PR
- [ ] **BUS-03**: `mudTextHandlers: Set<Handler>` и `addMudTextListener` удалены после миграции последнего consumer'а; `server.ts` больше не экспортирует callback-API

### Client Split

- [ ] **CLI-01**: `client/features/hotkeys.ts` извлечён — `loadHotkeys`, `saveHotkeys`, два `keydown` handler'а (lines 935–997) из `main.ts`
- [ ] **CLI-02**: `client/features/zone-script-panel.ts` извлечён — loop-config persistence + wiring из `main.ts`
- [ ] **CLI-03**: `client/main.ts` ≤ ~300 LOC — остаётся как pure bootstrap (DOM init + wiring)
- [ ] **CLI-04**: `client/map/layout.ts` извлечён — pure grid-layout algorithm, unit-testable, из `map-grid.ts`
- [ ] **CLI-05**: `client/map/render.ts` извлечён — DOM rendering/cytoscape wiring из `map-grid.ts`
- [ ] **CLI-06**: `client/map/interactions.ts` извлечён — pointer/click handlers из `map-grid.ts`
- [ ] **CLI-07**: `wiki/client.ts` извлечён — HTTP + proxies из `wiki.ts`
- [ ] **CLI-08**: `wiki/parser.ts` извлечён — HTML → structured data из `wiki.ts`
- [ ] **CLI-09**: `wiki/slots.ts` извлечён — slot constants из `wiki.ts`

### Frontend Freeze

- [ ] **FREEZE-01**: Diagnosis report — Chrome DevTools Performance flamegraph реального F5 reload + `performance.mark()` инструментация + feature-flag bisect; root cause задокументирован в `.planning/debug/frontend-freeze.md` с минимум 2-of-3 independent confirmations (profiler + bisect + server-timing)
- [ ] **FREEZE-02**: Freeze устранён — UI становится интерактивным за < 2 сек после F5 на типичном профиле (30 комнат в активной зоне); замер через `performance.mark()` `bootstrap_start` → `first_interactive`; regression-тест в CI (manual if no CI)

### Tests

- [ ] **TEST-01**: `src/map/parser.ts` — bun:test snapshot-тесты против baseline fixture (расширение существующего `parser.test.ts`)
- [ ] **TEST-02**: `src/triggers.ts` — unit-тесты для dodge/stand-up/rearm/assist/light против записанных MUD-реплик
- [ ] **TEST-03**: `src/farm2/` — тесты для controller state machine, tick scheduling, combat flee, session teardown
- [ ] **TEST-04**: `src/mud-connection.ts` — тесты telnet state machine, reconnect backoff, keepalive timer
- [ ] **TEST-05**: `src/map/store.ts` — интеграционные тесты на тестовую Postgres: upsertRoom/upsertEdge, conflict resolution, `getZoneSnapshot`
- [ ] **TEST-06**: Extracted controllers (stats/chat/loot/navigation) — по одному unit-test файлу на каждый, покрывающему happy-path + edge case из fixture
- [ ] **TEST-07**: `client/map/layout.ts` — property-based тесты через `fast-check` для grid-layout алгоритма

## v2 Requirements

Deferred — следующая итерация после этого milestone.

### Security

- **SEC-01**: Password rotation — убрать `"respect1"` из исходников, MUD passwords в env
- **SEC-02**: Telegram token leak hardening — error handling не логирует URL с токеном
- **SEC-03**: WS rate limiting + token check — защита локальной WebSocket после Caddy

### Tooling

- **TOOL-01**: CI pipeline — GitHub Actions на bun test + `gitnexus analyze` smoke test
- **TOOL-02**: Lint/format — biome или prettier + pre-commit hook
- **TOOL-03**: Structured logging — JSON-лог с session-id + log rotation в app

### Performance

- **PERF-01**: `map_delta` protocol — incremental map snapshot updates вместо full-snapshot broadcast
- **PERF-02**: `autoSortInventory` без round-trip — использовать `containerTracker` как source of truth
- **PERF-03**: Log write буферизация — `createWriteStream` вместо `appendFileSync`

## Out of Scope

Явно исключено. Задокументировано чтобы предотвратить scope creep.

| Feature | Reason |
|---------|--------|
| Изменения игровой логики (farm/combat/trigger behaviour) | Behaviour-preserving refactor; поведение бота не меняется |
| Смена runtime (Bun → Node) | Стек зафиксирован, не цель |
| Смена DB (Postgres → другое) | Стек зафиксирован |
| ORM adoption (Prisma/Drizzle) | Несовместимо с `postgres` (porsager) driver; scope creep |
| Multi-character одновременно | Scaling path, не боль сейчас |
| Классы / DI-контейнер | Сохраняем функциональный factory-паттерн |
| Password rotation (SEC-01) | В v2 — требует доступа к MUD-аккаунтам, не блокирует рефактор |
| CI pipeline (TOOL-01) | В v2 — важно, но не ускоряет основную цель |
| Lint/format (TOOL-02) | В v2 |
| `map_delta` protocol (PERF-01) | Условно-v2; только если FREEZE-01 укажет что это корень hang'а |
| Fix bugs discovered во время рефактора | Анти-фича A1 — уничтожает regression oracle; документировать и отложить |
| Parallelize DB writes | Анти-фича A13 — data corruption до fix `upsertEdge` race |
| Rewrite `map-grid.ts` до профайлинга | Анти-фича A10 — scope creep, unbounded |
| Zone-scripts TODO-temp repair (286.ts, 104.ts) | Data/workflow concern, не refactor-тема |
| Deploy change (pm2 / Caddy / ecosystem.config) | Инфра не болит, не цель |

## Traceability

Populated during roadmap creation (2026-04-18).

| Requirement | Phase | Status |
|-------------|-------|--------|
| SAFE-01 | Phase 1 | Complete (Plan 01 — 2026-04-19) |
| SAFE-02 | Phase 1 | Pending |
| SAFE-03 | Phase 1 | Partial (ports + defaults shipped in 01-03; per-controller injection deferred to Phase 2 per D-15) |
| SAFE-04 | Phase 1 | Pending |
| SAFE-05 | Phase 1 | Pending |
| INFRA-01 | Phase 1 | Complete (01-02-PLAN.md) |
| INFRA-02 | Phase 1 | Complete (01-03-PLAN.md — 2026-04-19) |
| INFRA-03 | Phase 1 | Pending |
| INFRA-04 | Phase 1 | Pending |
| SRV-01 | Phase 2 | Pending |
| SRV-02 | Phase 2 | Pending |
| SRV-03 | Phase 2 | Pending |
| SRV-04 | Phase 2 | Pending |
| SRV-05 | Phase 2 | Pending |
| SRV-06 | Phase 2 | Pending |
| BUS-01 | Phase 2 | Pending |
| BUS-02 | Phase 2 | Pending |
| BUS-03 | Phase 3 | Pending |
| CLI-01 | Phase 3 | Pending |
| CLI-02 | Phase 3 | Pending |
| CLI-03 | Phase 3 | Pending |
| CLI-04 | Phase 3 | Pending |
| CLI-05 | Phase 3 | Pending |
| CLI-06 | Phase 3 | Pending |
| CLI-07 | Phase 3 | Pending |
| CLI-08 | Phase 3 | Pending |
| CLI-09 | Phase 3 | Pending |
| FREEZE-01 | Phase 3 | Pending |
| FREEZE-02 | Phase 3 | Pending |
| TEST-01 | Phase 4 | Pending |
| TEST-02 | Phase 4 | Pending |
| TEST-03 | Phase 4 | Pending |
| TEST-04 | Phase 4 | Pending |
| TEST-05 | Phase 4 | Pending |
| TEST-06 | Phase 4 | Pending |
| TEST-07 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 36 total
- Mapped to phases: 36 ✓
- Unmapped: 0
- Phase 1 (Safety Harness + Scaffolding Infrastructure): 9 requirements
- Phase 2 (server.ts Extraction + Bus Cutover): 8 requirements
- Phase 3 (Client Split + Freeze Fix + Bus Finalization): 12 requirements
- Phase 4 (Hot-Path Tests): 7 requirements

---
*Requirements defined: 2026-04-18*
*Last updated: 2026-04-18 with traceability populated after roadmap creation*
