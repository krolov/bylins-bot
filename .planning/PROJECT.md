# bylins-bot

## What This Is

Bylins-bot — Bun/TypeScript-бот для русскоязычного MUD'а Bylins: держит TCP-сессию с игровым сервером, проксирует трафик в браузерный клиент через WebSocket и одновременно работает автономным агентом (farm/zone-скрипты, триггеры боя, survival, gather, repair, bazaar-watch). Карта мира и инвентарь персистятся в Postgres. Инструмент персонального использования для нескольких аккаунтов владельца.

## Core Value

Сделать кодобазу проще в работе — разобрать монолиты и устранить >15-секундное зависание UI после reload — **не меняя поведение бота**.

## Requirements

### Validated

<!-- Shipped and confirmed valuable via existing codebase. -->

- ✓ TCP-сессия с MUD + telnet negotiation + reconnect backoff — existing (`src/mud-connection.ts`)
- ✓ WebSocket-прокси MUD ↔ браузер — existing (`src/server.ts`)
- ✓ Парсер MUD-текста: комнаты/выходы/мобы/предметы/труп — existing (`src/map/parser.ts`)
- ✓ Автомаппер на Postgres (rooms, edges, aliases, zones) — existing (`src/map/store.ts`)
- ✓ Pathfinding (BFS по графу зоны) + навигация — existing (`src/map/pathfinder.ts`, nav в `server.ts`)
- ✓ Farm-контроллер (`farm2/`) — HP-recall, mob probe, tick-loop — existing
- ✓ Zone-scripts (скриптовые прогоны зон с navigate/command/wait_text/farm_zone) — existing (`src/zone-scripts/`)
- ✓ Survival (auto-eat/drink), triggers (dodge/stand/rearm/assist/light), gather (berry/herb/mushroom/branch), repair — existing
- ✓ Compare-scan (сравнение шмота со шопами/bazaar/inventory) — existing (`src/compare-scan/`)
- ✓ Bazaar-notifier c Telegram-алертами — existing (`src/bazaar-notifier.ts`)
- ✓ Container-tracker (парсинг инвентаря/экипировки/складов) — existing (`src/container-tracker.ts`)
- ✓ Item-identify (wiki-lookup неизвестных предметов) — existing
- ✓ Browser UI: терминал, map-grid, nav-panel, inventory, модалки — existing (`src/client/`)
- ✓ Профили персонажей + PM2-deploy + Caddy Basic Auth — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] Разобрать `src/server.ts` (1867 строк) на факторные модули — начать с навигации (~760 строк) → `navigation-controller.ts`
- [ ] Выделить из `server.ts`: stats-parser, chat-parser, loot-sort, browser-ws; оставить ≤ ~400 строк композиционного корня
- [ ] Разобрать `src/client/main.ts` (1029 строк) — вынести hotkeys и zone-script-panel, оставить `main.ts` как bootstrap
- [ ] Разобрать `src/client/map-grid.ts` (1046 строк) на `map-layout.ts` / `map-render.ts` / `map-interactions.ts`
- [ ] Разобрать `src/wiki.ts` (955 строк) на `wiki/client.ts` / `wiki/parser.ts` / `wiki/slots.ts`
- [ ] Диагностировать и устранить >15-секундное зависание UI после reload (происходит каждый reload, не только первый; UI полностью заморожен; гипотезы открыты — решать через профайлинг)
- [ ] Ввести event bus для MUD text fan-out взамен цепочки `onMudText` callback'ов в `mud-connection.ts`
- [ ] Добавить migration framework: таблица `schema_migrations` + нумерованные SQL-скрипты в `src/map/migrations/`, вместо inline `ALTER TABLE IF NOT EXISTS` в `mapStore.initialize()`
- [ ] После структурного разбора — написать тесты для критичных модулей (server.ts концерны, triggers, farm2, mud-connection, map/store) — отдельной фазой

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Изменение игровой логики/поведения бота (farm rhythm, recall conditions, trigger reactions) — это чистый рефактор; поведение должно остаться bit-for-bit таким же
- Смена runtime/DB (Bun → Node, Postgres → другое) — стек работает, фокус на структуре
- Изменение деплоя (pm2 + Caddy + ecosystem.config.cjs) — инфра не болит
- Password leak `respect1` → env / MUD-password rotation — важно, но в следующую итерацию (требует доступа к MUD-аккаунтам)
- CI pipeline / lint / formatter — в следующую итерацию; сейчас рефактор важнее
- Multi-character одновременно / multi-session — scaling path, не боль сейчас
- Переход на OOP/DI-контейнер — сохраняем функциональный стиль (factory + event bus)
- Тесты для wiki, container-tracker, compare-scan — вторичный приоритет; сначала hot-path

## Context

**Кодобаза:**
- Bun 1.x + TypeScript strict, 1240 символов, 3019 связей по GitNexus
- Преобладающий паттерн — `createXxx({deps})` factory с closed-over state, DI через typed `Deps` interface, композиция в `server.ts`
- Shared MUD-text bus через `onMudText` callback в `mud-connection.ts` + `mudTextHandlers: Set<Handler>` — кандидат на замену event bus
- Regex-first парсинг русского MUD-текста с ANSI escape'ами; фрагильно к изменениям палитры / формулировок мобов
- Postgres обязателен при старте (нет fallback), memory store используется только тестами
- Browser client: WebSocket + bus + terminal + map-grid + модалки (lazy-import)
- Тесты только в `src/map/parser.test.ts`, `src/map/tracker.test.ts` (~428 строк) — rest зеро
- Существует `docs/client-refactor-plan.md` с историей первого раунда рефактора клиента (5525 → 1029)

**Известные проблемные точки (подробно в `.planning/codebase/CONCERNS.md`):**
- 4 монолита: `server.ts` 1867, `client/main.ts` 1029, `client/map-grid.ts` 1046, `wiki.ts` 955
- Mutable module-level state в server.ts (~15+ `let`-переменных) — противоречит стилю проекта
- Full map snapshot broadcast на каждое movement (30x/мин) — подозреваемый для frontend hang
- Cytoscape ~500KB грузится eager — другой подозреваемый для hang
- Ad-hoc `ALTER TABLE IF NOT EXISTS` вместо migration-framework
- Zero tests для server.ts, triggers, farm2, mud-connection, map/store

**Пользовательские боли:**
- «Сложно работать» — любая фича трогает `server.ts`, merge-конфликты, cognitive load
- После F5 UI заморожен >15 секунд, каждый reload — main thread занят чем-то тяжёлым

## Constraints

- **Tech stack**: Bun + TypeScript strict + Postgres + `postgres` (porsager) — зафиксировано, замена вне скоупа
- **Pattern**: factory `createXxx({deps})` + event bus там, где это уменьшает связность; без классов в доменной логике; module-level mutable state только в `server.ts` в минимальном объёме (цель — вынести в контроллеры)
- **Behaviour preservation**: после каждой фазы farm-поведение / combat reactions / zone-scripts работают идентично (regression-test вручную по log-файлам из `/var/log/bylins-bot/mud-traffic.log.1`)
- **Safety**: GitNexus impact analysis ОБЯЗАТЕЛЕН перед каждой правкой символа; рефакторы используют `gitnexus_rename` не find-and-replace; `gitnexus_detect_changes` перед коммитом
- **Security**: no-`any`, no empty-catch, no `console.log` в server-коде — эти инварианты проекта закреплены в AGENTS.md, рефактор не должен их регрессировать
- **Single-user operation**: один активный MUD-соединение на сервер — multi-session не целевая
- **Dependencies**: cytoscape v3.33.1 — пока оставить, можно lazy-load как часть hang-fix

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Начать с `server.ts` → навигация (~760 строк) | Самый большой блок, сложная стейт-машина — высокий payoff, gitnexus даст safe rename | — Pending |
| Структура ПРЕЖДЕ тестов | Тестов почти нет; писать против монолита дороже чем против разобранного модуля; риск управляем через поведенческий regression-check | — Pending |
| Event bus для MUD-text fan-out | Текущая цепочка `onMudText` callback'ов связывает controllers; bus снизит связность, облегчит тесты | — Pending |
| Сохраняем factory-паттерн, не переходим на классы | Консистентность с существующим кодом, минимум сюрпризов при миграции | — Pending |
| Полный рефактор в одном milestone | Все 4 монолита + hang + event bus + migration framework — связанный блок работы | — Pending |
| Password/CI/lint — следующая итерация | Не рефакторные задачи, не ускоряют основную цель | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-18 after initialization*
