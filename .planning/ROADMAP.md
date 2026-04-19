# Roadmap: bylins-bot — Monolith Refactor

**Created:** 2026-04-18
**Milestone:** monolith refactor (behaviour-preserving)
**Granularity:** coarse (4 phases)
**Execution:** sequential
**Coverage:** 36/36 v1 requirements mapped

## Core Value Recap

Сделать кодобазу проще в работе — разобрать монолиты и устранить >15-секундное зависание UI после reload — **не меняя поведение бота**.

Behaviour-preserving invariant: после каждой фазы baseline replay harness даёт пустой diff, parser snapshot diff пустой, farm/combat/zone-scripts играют идентично.

## Phases

- [ ] **Phase 1: Safety Harness + Scaffolding Infrastructure** — Regression oracle + ports/bus/migration primitives готовы, ни одного символа ещё не двигаем
- [ ] **Phase 2: server.ts Extraction + Bus Cutover Strangler-Fig** — server.ts ≤400 LOC composition root, все controllers подписаны через bus, старая callback-цепочка ещё жива
- [ ] **Phase 3: Client Split + Frontend Freeze Diagnosis & Fix + Bus Finalization** — client monolith разобран, freeze устранён, `mudTextHandlers` удалён, все migrations в framework
- [ ] **Phase 4: Hot-Path Tests** — тесты для parser/triggers/farm2/mud-connection/map-store/extracted controllers/layout algorithm

## Phase Details

### Phase 1: Safety Harness + Scaffolding Infrastructure

**Goal**: Установлен regression oracle (baseline replay + parser snapshot) и структурные примитивы (ports, typed event bus, migration framework + baseline seed) — всё готово для безопасного извлечения символов без единого касания `server.ts` domain logic.

**Depends on**: Nothing (first phase)

**Requirements**: SAFE-01, SAFE-02, SAFE-03, SAFE-04, SAFE-05, INFRA-01, INFRA-02, INFRA-03, INFRA-04

**Success Criteria** (what must be TRUE):
  1. `bun run scripts/replay-harness.ts` воспроизводит 30 минут реального MUD-трафика из `.fixtures/mud-traffic-baseline.log` и emit-sequence + DB writes + broadcast ServerEvents совпадают с записанным snapshot (zero diff)
  2. `bun run scripts/parser-snapshot.ts` прогоняет `src/map/parser.ts` по baseline; `snapshots/after.jsonl` байт-идентичен `snapshots/before.jsonl`
  3. `src/bus/mud-event-bus.ts` существует с типизированным `MudEvent` discriminated union, sync-delivery семантикой (listener-snapshot-before-iterate, try/catch per handler); unit-тесты в `src/bus/mud-event-bus.test.ts` проходят (emit без handlers, emit с many, self-remove mid-dispatch, once, onAny)
  4. `src/ports/` содержит чистые interfaces `MudCommandSink`, `Broadcaster`, `MapStore`, `NowProvider`, `TimerProvider`, `SessionTeardownRegistry`; ни один controller пока их не импортирует (pre-wired)
  5. Migration framework работает: `schema_migrations` таблица создана в production через baseline-seed (не перезапуск `001_baseline.sql`), advisory lock держится во время миграции, `bun run scripts/verify-schema.ts` подтверждает что live prod schema матчится baseline dump; `mapStore.initialize()` сведён к вызову migration runner'а (inline `ALTER TABLE` удалены)
  6. `docs/mud-phrases.md` содержит инвентарь всех hardcoded Russian MUD-фраз/регексов по файлу и назначению; `docs/refactor-playbook.md` описывает commit convention "один refactor-PR = зелёный replay-harness diff + зелёный `bun test`"

**Plans**: TBD

---

### Phase 2: server.ts Extraction + Bus Cutover Strangler-Fig

**Goal**: `server.ts` сведён к композиционному корню (≤400 LOC, без доменной логики, без module-level mutable state кроме minimal runtime singletons); все пять доменов извлечены в `src/controllers/` и подписаны через bus; старая `mudTextHandlers: Set` цепочка всё ещё жива параллельно (финальное удаление — Phase 3) чтобы сохранить strangler-fig invariant "оба path'а одновременно эмитят в любой момент времени".

**Depends on**: Phase 1 (regression oracle, bus infrastructure, ports, migration framework)

**Requirements**: SRV-01, SRV-02, SRV-03, SRV-04, SRV-05, SRV-06, BUS-01, BUS-02

**Success Criteria** (what must be TRUE):
  1. Bus shim установлен в `server.ts` onMudText dispatch: `bus.emit({kind: "mud_text_raw", text})` вызывается **одновременно** со срабатыванием `mudTextHandlers: Set`; baseline replay harness даёт zero diff (ни одного duplicate side-effect, ни одного missed side-effect)
  2. `src/controllers/stats-parser.ts`, `chat-parser.ts`, `loot-sort.ts`, `navigation-controller.ts` существуют, каждый извлечён одним PR, каждый подписан через `bus.on("mud_text_raw", ...)` (не через `addMudTextListener`), каждый имеет teardown через `bus.on("session_teardown", ...)`; после каждой extraction — replay harness diff пустой, parser snapshot diff пустой
  3. `src/adapters/browser-gateway.ts` извлечён — WebSocket `message` handler + `switch (event.type)` переехал туда; server.ts больше не содержит inline `ClientEvent` routing
  4. `wc -l src/server.ts` ≤ 400; `grep -cE "^(let|const) [a-zA-Z]+ =" src/server.ts` показывает только minimal runtime singletons (`browserClients`, `activeProfileId`, `mudConnection`); ни одной regex/parsing/business-rule строки не осталось в `server.ts`
  5. `gitnexus_cypher` query "controllers/* importing server.ts or adapters/*" возвращает пустой результат (dependency direction соблюдена); `gitnexus_detect_changes` на каждой extraction-PR показывает только expected scope
  6. Порядок извлечения внутри фазы: stats → chat → loot-sort → navigation → browser-gateway (leaf-first: research-aligned leaf extractions сначала чтобы провалидировать harness на небольших поверхностях, затем navigation — самый большой блок ~760 LOC — после того как pattern доказан на трёх меньших). См. Planning Note ниже о user-preference для navigation-first.

**Plans**: TBD

**Planning Note on Ordering**: user в PROJECT.md Key Decisions указал "Начать с server.ts → навигация (~760 строк)" как точку входа. Research (PITFALLS.md + FEATURES.md) настойчиво рекомендует leaf-first: stats (~200 LOC, простейшие регексы, только broadcast+chat consumer) → chat → loot-sort → navigation (~760 LOC, самый большой с stateful `NavigationState` machine и `onceRoomChanged` семантикой). Рекомендация roadmapper'а — **leaf-first order**: harness проверяется трижды до того как мы трогаем самую большую extraction. Если после Phase 1 completion user настаивает на navigation-first, planner может переупорядочить внутри Phase 2 — это tactical decision на plan-phase уровне, не structural. Коммит [f255ab5] уже добавил `navigation-controller.ts` feature на 104-й зоне exit path — это clue что user хочет navigation-first; но behaviour-preserving invariant одинаково соблюдается в обеих ordering'ах, вопрос только в риск-профиле. **Phase 2 plan должен explicitly surface this tension к user confirmation на этапе `/gsd-plan-phase 2`**.

---

### Phase 3: Client Split + Frontend Freeze Diagnosis & Fix + Bus Finalization

**Goal**: Три клиентских монолита разобраны на feature-модули; >15-секундное зависание UI после reload диагностировано (flamegraph + 2-of-3 независимых подтверждений) и устранено (UI интерактивен < 2 сек); старая `mudTextHandlers: Set` + `addMudTextListener` удалены после миграции последнего consumer'а; migration framework adoption полностью завершён.

**Depends on**: Phase 2 (все controllers на bus — иначе `mudTextHandlers` нельзя удалять без потери событий)

**Requirements**: CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, CLI-07, CLI-08, CLI-09, FREEZE-01, FREEZE-02, BUS-03

**Success Criteria** (what must be TRUE):
  1. `src/client/main.ts` ≤ 300 LOC (pure bootstrap: DOM init + wiring); `src/client/features/hotkeys.ts` и `src/client/features/zone-script-panel.ts` извлечены с unit-testable factory-DI шейпами
  2. `src/client/map-grid.ts` разобран на `client/map/layout.ts` (pure grid algorithm — unit-testable), `client/map/render.ts` (DOM/cytoscape), `client/map/interactions.ts` (pointer/click); map renders identically по сравнению с pre-refactor (manual smoke: 10 минут farming в 30-room зоне, no visual regression)
  3. `src/wiki.ts` разбит на `wiki/client.ts`, `wiki/parser.ts`, `wiki/slots.ts`; wiki lookup по известному предмету даёт identical output
  4. `.planning/debug/frontend-freeze.md` содержит root cause diagnosis с минимум 2-of-3 independent confirmations (Chrome DevTools flamegraph + `performance.mark()` bisect + server-timing correlation); причина указана с file:line anchor'ом и LongTask duration
  5. UI интерактивен < 2 сек после F5 на типичном профиле (30-комнатная активная зона); замер через `performance.mark("bootstrap_start")` → `performance.mark("first_interactive")` repeatable across 5 reloads; regression тест задокументирован в `docs/refactor-playbook.md`
  6. `mudTextHandlers: Set<Handler>`, `addMudTextListener`, `registerTextHandler`, `unregisterTextHandler` удалены из `mud-connection.ts` и `server.ts`; `gitnexus_impact({target: "mudTextHandlers"})` возвращает пустой результат; bot стартует и farm/zone-scripts работают identically — replay harness даёт zero diff

**Plans**: TBD

**UI hint**: yes

---

### Phase 4: Hot-Path Tests

**Goal**: Критичные pre-существовавшие модули и newly-extracted controllers покрыты unit/integration тестами — parser (snapshot), triggers, farm2, mud-connection, map/store (integration), extracted controllers, map/layout (property-based). Тесты пишутся **после** структурного разбора потому что писать их против разобранных модулей значительно дешевле (per PROJECT.md Key Decision).

**Depends on**: Phase 3 (все modules извлечены; layout/render/interactions split делает grid-layout pure и testable)

**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-07

**Success Criteria** (what must be TRUE):
  1. `bun test` проходит зелёным; coverage для: `src/map/parser.ts` (snapshot-тесты против baseline fixture, расширение existing `parser.test.ts`); `src/triggers.ts` (dodge/stand-up/rearm/assist/light unit-тесты против recorded MUD replies); `src/farm2/` (controller state machine + tick scheduling + combat flee + session teardown); `src/mud-connection.ts` (telnet state machine + reconnect backoff + keepalive timer); `src/map/store.ts` (integration-тесты на test Postgres instance: upsertRoom/upsertEdge conflict resolution + getZoneSnapshot)
  2. Каждый извлечённый controller (stats-parser, chat-parser, loot-sort, navigation-controller) имеет хотя бы один test-файл, покрывающий happy-path + edge case из baseline fixture
  3. `client/map/layout.ts` имеет property-based тесты через `fast-check` для grid-layout алгоритма (invariants: output detectably laid out, no overlapping nodes, deterministic given same input)
  4. Все тесты используют deterministic clock injection (`NowProvider` / `TimerProvider` из Phase 1 ports) где есть timer-driven logic; нет `setTimeout`-based race conditions в тестах
  5. Replay harness всё ещё даёт zero diff vs baseline — написание тестов не привело к behaviour regression

**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Safety Harness + Scaffolding Infrastructure | 6/7 | In progress | - |
| 2. server.ts Extraction + Bus Cutover | 0/? | Not started | - |
| 3. Client Split + Freeze Fix + Bus Finalization | 0/? | Not started | - |
| 4. Hot-Path Tests | 0/? | Not started | - |

## Coverage Summary

| Category | Count | Phases |
|----------|-------|--------|
| Safety Harness (SAFE-*) | 5 | Phase 1 |
| Infrastructure (INFRA-*) | 4 | Phase 1 |
| Server Extraction (SRV-*) | 6 | Phase 2 |
| Event Bus Cutover (BUS-*) | 3 | Phase 2 (BUS-01, BUS-02), Phase 3 (BUS-03) |
| Client Split (CLI-*) | 9 | Phase 3 |
| Frontend Freeze (FREEZE-*) | 2 | Phase 3 |
| Tests (TEST-*) | 7 | Phase 4 |

**Total v1 requirements:** 36
**Mapped to phases:** 36
**Orphans:** 0

## Dependency Graph

```
Phase 1 (Safety Harness + Scaffolding)
   │   SAFE-01..05, INFRA-01..04
   │   ↓ provides: replay oracle, parser snapshot, bus, ports, migration framework
   │
Phase 2 (server.ts Extraction + Bus Cutover)
   │   SRV-01..06, BUS-01, BUS-02
   │   REQUIRES: Phase 1 replay harness (regression oracle for every extraction PR)
   │   REQUIRES: Phase 1 bus (shim BUS-01 cannot land without INFRA-01)
   │   REQUIRES: Phase 1 ports (controllers depend on MudCommandSink, Broadcaster, MapStore)
   │   ↓ provides: extracted controllers all subscribed via bus, server.ts ≤400 LOC
   │
Phase 3 (Client Split + Freeze Fix + Bus Finalization)
   │   CLI-01..09, FREEZE-01, FREEZE-02, BUS-03
   │   REQUIRES: Phase 2 all consumers on bus (BUS-03 delete can only land when no
   │             consumer uses mudTextHandlers, per strangler-fig invariant)
   │   Parallelization note: CLI-* and FREEZE-* touch different file trees than
   │   server-side — could theoretically parallelize, but `sequential` config says no
   │   ↓ provides: UI interactive <2s, client modular, old callback chain deleted
   │
Phase 4 (Hot-Path Tests)
       TEST-01..07
       REQUIRES: Phase 3 layout.ts extracted (layout property-based tests need pure module)
       REQUIRES: Phase 2 controllers extracted (TEST-06 targets these)
       per PROJECT.md Key Decision: tests come LAST — against разобранные modules, not
       against monolith
```

## Key Constraints Applied

- **Behaviour-preserving** (PROJECT.md Core Value): every success criterion includes "replay harness zero diff" or "parser snapshot diff empty" — these are pre-merge gates for every PR in Phases 2-4
- **Tests last** (PROJECT.md Key Decision): TEST-* live in their own phase; no "test coverage" criterion appears in earlier phases (unit tests for bus infrastructure in Phase 1 are bus-internal, not production-code tests)
- **Strangler-fig cutover** (PITFALLS.md Pitfall 1): BUS-01 shim → BUS-02 per-controller migration → BUS-03 delete splits across Phase 2 and Phase 3 precisely to keep both paths alive during migration window
- **Migration baseline safety** (PITFALLS.md Pitfall 4): INFRA-03 specifies "seed, not re-run" on production detection
- **Measure-before-fix** (PITFALLS.md Pitfall 5 + FREEZE-01): diagnosis is a separate requirement from fix, with 2-of-3 independent confirmations gate
- **GitNexus safety workflow** (CLAUDE.md): every extraction PR success criterion implicitly includes `gitnexus_impact` pre-edit + `gitnexus_detect_changes` pre-commit; enforced at plan-phase level not roadmap level

## Notes for Plan-Phase

- Phase 1 is the "lock the door before painting" phase — nothing domain is touched. If it slips, everything downstream is unsafe. Do NOT compress it.
- Phase 2 is the densest phase (8 requirements, 5 extractions). Expect plan-phase to decompose into 5-6 plans (one per extraction + bus shim plan). Sequential extraction within the phase: research recommends leaf-first (see Planning Note on Ordering).
- Phase 3 has two parallelizable tracks (client split / freeze diagnosis) and one sequential tail (BUS-03 delete after FREEZE fix stabilizes). Plan-phase should surface this in plan ordering.
- Phase 4 is least risky — tests only. Can be compressed if time pressure emerges. Deferrable partial coverage is acceptable only for TEST-05 (integration Postgres) per stack research which flagged that as the highest-effort test.

---
*Roadmap created: 2026-04-18*
*Last updated: 2026-04-18 after initial creation*
