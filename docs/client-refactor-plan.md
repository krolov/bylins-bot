# Рефакторинг клиента + ускорение старта

## Контекст

Браузерный клиент MUD-бота — это один монолитный файл `src/client.ts` на **5525 строк**.
Пользователь жалуется, что на старте клиент очень тормозит. Нужно:
1. Разбить `client.ts` на аккуратные модули (небольшое число файлов, понятные зоны ответственности).
2. Устранить тормоза при старте без потери функциональности.

Ветка разработки: `claude/refactor-client-performance-YQZmB`.

---

## База знаний о проекте

### Сборка и раздача клиента

- **Скрипт**: `bun run scripts/build-client.ts` (package.json, скрипт `build:client`).
- **Бандлер**: `Bun.build()` — entry `./src/client.ts`, target `browser`, format `esm`, sourcemap `external`, outdir `./public`, naming `client.js`.
- **Минификация: НЕТ** (нет флага `minify`).
- **Код-сплиттинг: НЕТ** (один entry, один `client.js`).
- **HTML**: `public/index.html:591` → `<script type="module" src="/client.js?v=5">`; `?v=5` — ручной кеш-бастинг.
- **CSS**: `public/styles.css` (2735 строк) — синхронный `<link>` в `<head>`, блокирует рендер, не минифицирован.
- **tsconfig**: target ESNext, moduleResolution `Bundler`, lib `ESNext, DOM`.
- **Сервер**: `src/server.ts` раздаёт статику из `public/`; `client.ts` **не импортируется** сервером — они делят только типы через `events.type.ts`.

### Что есть внутри client.ts (5525 строк, единственный import — тип `SurvivalSettings`)

**Типы и контракты (1–365)** — 14 top-level интерфейсов + `ServerEvent` union (28 вариантов) + `ClientEvent` union (13 вариантов).

**DOM-рефы (366–577)** — 178 вызовов `requireElement<T>()` + модульные let/const: connect-form, topbar, output, map-canvas, container-panels, action-buttons, все модалки, vorozhe, compare, item-db, hotkeys, splitters. Все в глобальном скоупе.

**Подсистемы (по строкам):**

| Строки | Подсистема |
|---|---|
| 1–365 | Типы `ServerEvent` / `ClientEvent` / payload'ы |
| 366–577 | DOM-рефы + начальные const'ы + `VOROZHE_CITIES` |
| 579–681 | Farm-settings: типы, defaults, normalize, fill/open/close модалки |
| 685–723 | Triggers state + `renderAssistTanks` + open/close модалки |
| 727–994 | Item-DB UI: фильтр, табы, renderItemDbTable, openItemDetailModal, renderItemDetail |
| 995–1107 | Commit settings, `switchMapTab`/`switchContainerTab`, alias/auto-cmd popups, map-context-menu |
| 1108–1440 | Nav-panel: зоны, поиск, neighbor/far zones, pagination, `updateStatsBar` |
| 1441–1607 | WS state, map snapshot state, farm2/zone-script state, `AVAILABLE_ZONE_SCRIPTS`, current* state |
| 1608–1641 | ANSI + константы рендера карты |
| 1643–2051 | Map grid: `GridCell`, `gridLayout`, `integrateSnapshot` (тяжёлый layout) |
| 2052–2598 | `renderGridMap`, map pointer handlers, `updateMap`, `createDefaultTerminalStyle` |
| 2599–3264 | Zone graph, localStorage zoneNames, `layoutZoneGraph`, `renderZoneMap`, global-map open/close, zone-rename |
| 3266–3520 | ANSI parsing + `appendOutput` + chat + `updateConnectButton` |
| 3521–3612 | `renderFarmButton`, `renderScriptSteps`, `renderMapRecordingButton`, `getSocketUrl` |
| 3613–3987 | `scheduleReconnect`, `flushPendingQueue`, `createSocket` (switch на 28 кейсов!), `ensureSocketOpen`, `sendClientEvent`, `loadDefaults` |
| 3988–4077 | Connect/disconnect form, command-input history, command-form submit |
| 4078–4300 | Все click-хэндлеры action-кнопок: clear, reset-map, z-level, farm-toggle, survival actions, triggers, item-db, map-recording, gather, sell, scratch, equip, debug, refresh containers, compare, vorozhe, item-db tabs/search |
| 4302–4596 | Compare Advisor |
| 4597–4818 | Inventory / bazaar / containers render, `requestBazaarMaxPrices` |
| 4819–5117 | Vorozhe render + `initVorozheModal` (стартовый хотспот) + wiki-поиск |
| 5118–5407 | Hotkeys: storage, `DEFAULT_HOTKEYS`, `loadHotkeys`/`saveHotkeys`, модалка, key-capture, commit |
| 5408–5525 | Splitter'ы + `loadPanelSplit` + bootstrap-хвост (`void loadDefaults().then(ensureSocketOpen)`) |

### Подтверждённые стартовые хотспоты

| # | Место | Описание | Severity |
|---|---|---|---|
| 1 | `loadZoneNames()` @ 2613, `loadPanelSplit()` @ 5437, `loadHotkeys()` @ 5169 | Три sync `localStorage.getItem` + `JSON.parse` + последующий inline-style mutation → reflow | MEDIUM |
| 2 | `initVorozheModal()` @ 5380 → 4882–4908 | Создаёт ~50 DOM-узлов + 50 listener'ов для модалки, которую большинство не открывает | MEDIUM |
| 3 | `public/styles.css` 2735 строк, не минифицирован, в `<head>` | Блокирует первый рендер | MEDIUM |
| 4 | Монолит 5525 строк, без minify, без splitting | Весь парсится и выполняется до `loadDefaults()` | MEDIUM |
| 5 | 178 `requireElement()` вызовов на модуль-init | Линейный оверхед, но приемлемый | LOW |

**Что не тормозит старт**: модалки item-db/hotkeys/survival/triggers/farm/global-map рендерятся по открытию; item-db данные грузятся по запросу; WS-команды идут после `onopen`; тяжёлые `renderGridMap`/`layoutZoneGraph` срабатывают только на `map_snapshot`/`map_update`.

### Глобальное состояние (70+ переменных)

Всё в модульном скоупе. Ключевые группы: соединение (`socket`, `pendingOpenPromise`, `reconnectTimer`, `reconnectDelay`, `pendingQueue`), карта (`latestMapSnapshot`, `gridLayout`, `zoneNames`, `currentZLevel`), инвентарь/UI (`itemDbAllItems`, `currentSurvivalSettings`, `currentTriggerState`, `hotkeys`, `commandHistory`), модалки (`vorozheFrom/To`, `farmModalZoneId`, `aliasPopupVnum`, `autoCmdPopupVnum`, `globalMapZoneRenameId`). После разбивки это станет полями либо мелких модулей-состояний (`state/*.ts`), либо параметров фабричных функций.

---

## Финальный план рефакторинга

### Цель 1. Архитектура модулей (~16 файлов вместо одного)

Вся клиентская логика переезжает в `src/client/`, единственный entry для билда меняется с `./src/client.ts` на `./src/client/main.ts`.

```
src/client/
  main.ts                  — bootstrap: получает DOM, создаёт state, net; запускает ленивую инициализацию
  dom.ts                   — все requireElement<T>() сведены в одну функцию queryDom(): DomRefs
  state.ts                 — центральный mutable-стор (поля вместо module-globals) + геттеры/сеттеры
  settings.ts              — localStorage: zoneNames, hotkeys, panel/container splits, last-profile
  net.ts                   — WebSocket: createSocket, reconnect, sendClientEvent, ensureSocketOpen, loadDefaults
  dispatcher.ts            — единственный switch 28-case: парсит ServerEvent и вызывает handlers
  terminal.ts              — ANSI parsing, appendOutput, chat, command-input + history
  hotkeys.ts               — loadHotkeys/save, document-dispatch, isTextInputFocused
  layout.ts                — splitters (panel + container), updateStatsBar, action-buttons badges
  actions.ts               — все click-хэндлеры action-sidebar + farm-toggle + debug-log + map-recording

  map/
    grid.ts                — integrateSnapshot, renderGridMap, updateMap, z-level, pointer handlers
    zones.ts               — zone-graph, layoutZoneGraph, renderZoneMap, global-map open/close, zone-rename popup
    nav.ts                 — nav-panel, search, neighbor/far/visited zones, pagination

  panels/
    containers.ts          — inventory/bazaar/storage/junk/расход render, refresh, auto-sort
    script.ts              — render zone-script steps + script-toggle
    alias-popup.ts         — alias + auto-cmd + map-context-menu popups

  modals/                  — КАЖДАЯ модалка = отдельный файл; подгружаются через dynamic import()
    farm-settings.ts
    survival.ts
    triggers.ts
    item-db.ts             — + wiki-поиск + item-detail
    hotkeys-modal.ts
    vorozhe.ts             — DOM-кнопки городов строятся ЛЕНИВО при первом open
    compare.ts
```

**Принципы:**
- `main.ts` получает `DomRefs` из `dom.ts`, создаёт `State`, вызывает `createNet({state, dom, dispatcher})` и `bindActions({state, dom, net})`.
- Модалки импортируются динамически — `import("./modals/item-db.ts").then(m => m.open(state, dom))`. Это разносит их код в отдельные chunks и убирает из critical-path.
- `dispatcher.ts` не вызывает модалки напрямую: вместо этого эмитит события в `state`/EventTarget, модалка при открытии сама подпишется. Или dispatcher имеет хук-мапу, которую модалки заполняют при первом open.
- `state.ts` — простой класс/объект, типизированный, с явными setState-методами (без фреймворка).
- Никаких новых зависимостей — чистый TS + DOM.

### Цель 2. Устранение тормозов старта (без потери функциональности)

**Клиент-бандл:**
1. Включить `minify: true` и `splitting: true` в `scripts/build-client.ts` → dynamic `import()` станут отдельными chunks, основной bundle резко похудеет.
2. Обновить HTML-тег: `<script type="module" src="/client.js?v=6">` (bump кеша).
3. Динамическая подгрузка модалок — содержимое модалок (почти половина client.ts) убирается с critical-path.

**Init-путь `main.ts`:**
1. `queryDom()` → пробросить рефы.
2. Синхронно стартовать только критическое: terminal, command-input, connect-form, splitters (нужны для первого кадра).
3. `queueMicrotask(() => loadDefaults().then(ensureSocketOpen))` — чтобы socket init не задерживал раскраску.
4. `requestIdleCallback(() => { loadHotkeys(); bindHotkeysDispatch(); })` — hotkeys только после idle.
5. `requestIdleCallback(() => loadZoneNames())` — zoneNames нужны только для nav/global-map; если их нет, получим Map() позже.
6. **Полностью убрать eager `initVorozheModal()`** — модалка сама строит кнопки в `openVorozheModal()` при первом вызове (guard по флагу `modalBuilt`).
7. `loadPanelSplit()` вызывается синхронно (нужен для первого layout), но чтение localStorage → `try/catch`, без JSON.parse (там просто числа).

**CSS:**
1. Минифицировать `styles.css` в build-шаге (bun нативно умеет `cssMinify` или через `bun build --minify` на CSS-entry; альтернатива — `lightningcss` установлен в бане bun) — положить `styles.min.css`, HTML подключает минифицированную версию.
2. Сохранить исходник `styles.css` только как source-of-truth; HTML грузит `/styles.min.css?v=6`.

**HTML:**
1. Добавить `<link rel="preload" href="/client.js?v=6" as="script" crossorigin>` перед `<script type="module">` — параллельная загрузка bundle пока парсится CSS.
2. Добавить `<link rel="modulepreload" href="/client.js?v=6">` для быстрого discovery модулей.
3. При желании (низкий приоритет) — `<link rel="preconnect" href="wss://…">` для WS, но хост динамический, так что пропустим.

**Доп. микро-оптимизации:**
- `sendClientEvent` / dispatcher — не меняем, это уже быстро.
- `requireElement` → один проход через объект-литерал вместо 178 вызовов (одно querySelector с фильтром по id'ам), но выигрыш копеечный; оставим как есть для читаемости, просто в `dom.ts`.

### Цель 3. Совместимость и безопасность

- Никакой логики не теряется: переезжают **идентичные** функции в модули; публичный API из `events.type.ts` не меняется.
- Серверной части (`src/server.ts`, REST, WS) не касаемся.
- Для каждого переносимого символа бежим `gitnexus_impact({target, direction:"upstream"})`; клиентские внутренности не должны иметь внешних callers (client.ts сейчас — terminal node графа), так что d=1 ожидается пустым.
- Коммит маленькими кусками: (1) каркас `src/client/`, пустой `main.ts`, build-скрипт переключаем на новый entry, но главный `client.ts` ещё работает side-by-side; (2) переезд по подсистемам — net → terminal → layout/actions → panels → map → modals; (3) уборка старого `client.ts`; (4) включение minify/splitting; (5) preload/HTML.

### Критические файлы
- `src/client.ts` (5525 строк) — распилить.
- `scripts/build-client.ts` — entry + minify + splitting + CSS minify.
- `public/index.html` — entry-имя, `?v=6`, preload-теги, switch на `styles.min.css`.
- `package.json` — поля scripts при необходимости.
- `src/events.type.ts` — не трогаем, он уже делит типы с сервером.

### Переиспользование существующего
- `src/map/*`, `src/farm2/*`, `src/zone-scripts/*`, `src/compare-scan/*` — уже модульны, client их НЕ импортирует (они серверные). Не трогаем.
- `src/wiki.ts` (955 строк) — серверный; в клиент попадает только через сообщения сервера. Не трогаем.
- `src/settings-normalizers.ts`, `src/profiles.ts`, `src/events.type.ts` — общие контракты; клиент импортирует только типы.

---

## Верификация

Функциональная (прогнать вручную в браузере):
- Соединение → WS открывается, в терминале видны `осм склад1`, `осм склад2`, `инв`.
- Все action-кнопки работают: buy-food, fill-flask, repair, compare, survival, triggers, hotkeys, item-db, map-recording, global-map, farm-settings, gather-toggle, gather-sell, scratch-clan, equip-all, vorozhe, debug-log.
- Все три таба container-panels: inventory/nav/script — переключаются и заполняются.
- Карта: рисуется, drag, dbl-click, context-menu, z-level, alias-popup, auto-cmd-popup.
- Compare-advisor открывается и рисует таблицу.
- Global-map открывается, поиск зоны работает, zone-rename сохраняется.
- Vorozhe: кнопки городов строятся при первом открытии (проверить в devtools Network — chunk подгружается).
- Hotkeys: F1-F12 работают в фокусе вне input.
- Splitters: тащатся, сохраняются в localStorage.
- Re-connect: при разрыве WS — экспоненциальный backoff.
- Фарм включается/выключается.

Перф (devtools Performance + Lighthouse):
- **Time-to-first-contentful-paint**: снижение ≥30% (ожидаем за счёт minify CSS + preload + splitting).
- **Main-thread scripting at startup**: client.js парсится меньше, модалочные chunks не грузятся до клика.
- **Total blocking time**: меньше.

GitNexus self-check перед коммитом:
- `gitnexus_impact` пустой/LOW для переносимых клиентских функций.
- `gitnexus_detect_changes({scope:"all"})` — только `src/client/*`, `src/client.ts` (удалён), `scripts/build-client.ts`, `public/index.html`.
- После финального коммита: `npx gitnexus analyze` (или автохук).

---

*Статус: исследование завершено, план финализирован.*

---

## Прогресс реализации (снимок на момент коммита плана)

### Применённые быстрые перф-победы (коммит `9bc423c`)
- `Bun.build`: `minify: true`, `splitting: true`, entry → `src/client/main.ts`.
- `public/index.html`: `<link rel="modulepreload" href="/client.js?v=6">`, `?v=5` → `?v=6`.
- `initVorozheModal()` идемпотентен и вызывается лениво из `openVorozheModal()` (−50 DOM-узлов и listener'ов со старта).

### Извлечения в отдельные модули (коммиты `62c3bea` → `51d4056`)

```
src/client/
  main.ts                 (~3680 строк — диспетчер, actions, карта, inventory, hotkeys runtime)
  types.ts                (423) — все public типы и ServerEvent/ClientEvent юнионы
  constants.ts            (167) — VOROZHE_CITIES, AVAILABLE_ZONE_SCRIPTS, DEFAULT_HOTKEYS,
                                 WEAPON_COLUMNS, ARMOR_COLUMNS, DIR_DELTA, OPPOSITE_DIR,
                                 DIRECTION_PRIORITY, SCRIPT_STEP_ICONS
  bus.ts                  (26)  — pub-sub с last-payload replay-кэшем
  modals/
    vorozhe.ts            (145) — dynamic chunk
    compare.ts            (283) — dynamic chunk
    item-db.ts            (367) — dynamic chunk (+ wiki search)
    hotkeys.ts            (194) — dynamic chunk (runtime остался eager в main.ts)
    triggers.ts           (163) — dynamic chunk
```

### Достигнутый финальный bundle layout

| Чанк | Размер | Когда грузится |
|---|---|---|
| `client.js` | 67.1 KB | Eager (старт) |
| chunk-shared (bus + const) | 5.4 KB | Eager (импортирован main.ts) |
| chunk-item-db | 7.6 KB | На клик 📦 |
| chunk-compare | 7.1 KB | На клик ⚖️ |
| chunk-hotkeys | 3.6 KB | На клик 🎹 |
| chunk-triggers | 3.0 KB | На клик ⚡ |
| chunk-vorozhe | 2.8 KB | На клик 🧙 |
| typings-shim | 0.5 KB | Ленивый |

**Критический путь: 94.3 KB → 72.5 KB (−23 %).** Bootstrap в headless Chromium: ~125 мс.

### Шаблон для извлечения новых модалок

1. Создать `src/client/modals/<name>.ts` со своим `requireElement<T>()`, DOM-рефами, локальным состоянием, лениво-guarded `init()`.
2. Входящие server-events: в `main.ts` dispatcher заменить прямой вызов на `bus.emit("<event_type>", message.payload)`. В модалке `bus.on("<event_type>", handler)` — replay-кэш сам применит последнюю payload, пришедшую до загрузки чанка.
3. Исходящие client-events: модалка вызывает `bus.emit("client_send", ev)` вместо прямого `sendClientEvent`. В `main.ts` уже зарегистрировано `bus.on("client_send", sendClientEvent)`.
4. Из `main.ts` удалить: DOM-рефы (кроме button-а запуска), функции модалки, listener'ы, state, Escape-branch (модалка ставит свой `document.addEventListener("keydown")` в `init()`).
5. Заменить listener на кнопке запуска:
   ```ts
   <btn>.addEventListener("click", () => {
     void import("./modals/<name>.ts").then((m) => m.open<Name>Modal());
   });
   ```
6. Прогнать `bun run smoke` — должен остаться зелёным.
7. Добавить позитивную проверку подгрузки нового чанка в `scripts/smoke-test.ts`.

### Smoke-тест

`bun run smoke` — собирает клиент, поднимает mock-бэкенд (статика + WS-stub + `/api/config` + `/api/profiles`), запускает headless Chromium через глобально установленный Playwright, проверяет:
- action-сайдбар смонтирован (17 кнопок по ID);
- Vorozhe-чанк подгружается и строит 25+25 кнопок после клика;
- Compare-advisor показывает статус "Сканирование..." после клика;
- Item-DB и Hotkeys модалки открываются и закрываются;
- container-табы переключаются;
- нет `console.error` и `pageerror` во время bootstrap.

### Сессия #2 (ветка `claude/continue-frontend-refactor-7Mvnx`)

Добавлены чанки + CSS минификация. Плюс preload-хинт.

```
src/client/
  modals/
    farm-settings.ts       (122) — dynamic chunk, открытие через bus replay
    survival.ts            (123) — dynamic chunk, settings state остаётся в main
    global-map.ts          (684) — dynamic chunk, ZONE GRAPH/RENAME (самый большой)
```

Изменения в `main.ts`:
- Удалены `defaultFarmSettings`, `normalizeFarmSettings`, `fillFarmModal`, `openFarmSettingsModal`, `closeFarmSettingsModal`, `commitFarmSettings`, `farmModalZoneId`, все DOM refs `farmModal*`.
- Удалены `fillSurvivalModal`, `openSurvivalSettingsModal`, `closeSurvivalSettingsModal`, `commitSurvivalSettings`, все DOM refs `survivalModal*`.
- Удалены `buildZoneGraph`, `layoutZoneGraph`, `routeZoneEdge`, `renderZoneMap`, `openGlobalMap`, `closeGlobalMap`, `applyGlobalMapSearch`, `updateGlobalMapZoomLabel`, `openZoneRenamePopup`, `closeZoneRenamePopup`, `saveZoneRename`, `globalMapZoom`, `globalMapOpen`, `globalMapSearchQuery`, `globalMapZoneRenameId`, `globalMapDragOrigin`, `globalMapDidDrag`, `ZONE_CELL/TILE/PAD`, все DOM refs `globalMap*`/`zoneRename*`.
- В `updateMap`: добавлены `bus.emit("zone_names", zoneNames)` (когда меняется) и `bus.emit("map_full_snapshot", latestFullSnapshot)`.
- Новый bus listener: `zone_name_set_local` — main мутирует свою `zoneNames` Map и сохраняет в localStorage.
- На `globalMapButton.click`: emit current snapshot+zoneNames в bus, затем dynamic import.

`scripts/build-client.ts`: добавлен второй проход — `Bun.build({entrypoints:["./public/styles.css"], minify:true, naming:"styles.min.css"})`. Размер: 51460 → 36746 байт (−28.6%).

`public/index.html`: cache-bumped с `?v=6` на `?v=7`, добавлен `<link rel="preload" as="script">` для client.js, `<link rel="stylesheet">` переключён на `/styles.min.css`.

`.gitignore`: добавлен `public/styles.min.css`.

### Достигнутый bundle layout (сессия #2)

| Чанк | Размер | Когда грузится |
|---|---|---|
| `client.js` | 53.9 KB | Eager (старт) |
| `styles.min.css` | 36.7 KB | Eager (preload) |
| chunk-shared (bus + const) | 5.4 KB | Eager (импортирован main.ts) |
| chunk-global-map | 10.6 KB | На клик 🗺️ |
| chunk-item-db | 7.6 KB | На клик 📦 |
| chunk-compare | 7.1 KB | На клик ⚖️ |
| chunk-hotkeys | 3.6 KB | На клик 🎹 |
| chunk-triggers | 3.0 KB | На клик ⚡ |
| chunk-farm-settings | 2.8 KB | На клик 🌾⚙️ |
| chunk-vorozhe | 2.8 KB | На клик 🧙 |
| chunk-survival | 2.6 KB | На клик 🍞⚙️ |

**Критический путь: 67.1 KB → 53.9 KB (−19.7%)** + минифицированный CSS экономит ещё ~14.7 KB.
Bootstrap в headless Chromium: ~100–220 мс.

### main.ts по сессиям

| Метрика | Сессия #1 (после Triggers) | Сессия #2 (после Global Map) |
|---|---|---|
| `src/client/main.ts` LOC | 3974 | 3174 |
| Дельта | базовый снимок | **−800 строк** |

### Сессия #3 (ветка `claude/continue-frontend-refactor-ccWkI`)

Структурный распил `main.ts` без code-splitting — эти модули нужны eager,
dynamic import тут не помог бы. Цель — читаемость и локальность изменений.

```
src/client/
  terminal.ts            (285) — ANSI-парсер, appendOutput/appendSystemLine/
                                 appendChatMessage/appendStyledText. Создаётся
                                 фабрикой `createTerminal({outputElement,
                                 chatOutputElement, onRawText})`. Callback
                                 `onRawText` получает сырой chunk — main
                                 использует его для парсинга combat-prompt'a
                                 ("[Ринли:Ранен]") в `lastEnemy` для `$target`
                                 в хоткеях.
  inventory.ts           (234) — renderContainerList / renderInventoryList
                                 (склад/расход/базар/хлам + инв). Все кнопки
                                 шлют команды через `bus.emit("client_send",ev)`
                                 — модуль не знает про socket.
  splitters.ts           (117) — panel + container splitters. Один export
                                 `initSplitters()`, который читает localStorage,
                                 применяет grid-template-columns и вешает
                                 drag-handlers.
```

Изменения в `main.ts`:
- Удалены: `ESCAPE`, `ansiState`, `createDefaultTerminalStyle`, `cloneStyle`,
  `resetStyle`, `mapAnsiCodeToColor`, `applyAnsiCodes`, `classNamesForStyle`,
  `isScrolledToBottom`, `appendStyledText`, `parseAnsiSegments`,
  `appendOutput`, `appendSystemLine`, `appendChatMessage`,
  `MAX_OUTPUT_SEGMENTS`, `OUTPUT_TRIM_COUNT`, `MAX_CHAT_LINES` (все ушли
  в `terminal.ts`).
- Удалены: `renderItemRow`, `renderBazaarSellRow`, `renderContainerList`,
  `renderInventoryList`, `requestBazaarMaxPrices`, `sortItems` — в
  `inventory.ts`.
- Удалены: `PANEL_SPLIT_*`, `CONTAINER_SPLIT_*` константы,
  `shellEl`/`panelSplitterEl`/`containerSplitterEl`, `currentContainerPx`,
  `applyPanelSplit`/`applyContainerSplit`/`loadPanelSplit`, два
  `if (panelSplitterEl !== null && shellEl !== null)` IIFE-блока — в
  `splitters.ts`.
- Добавлено: `const { appendOutput, appendSystemLine, appendChatMessage,
  appendStyledText, resetAnsiState } = createTerminal(...)`, `initSplitters()`,
  `import { renderContainerList, renderInventoryList } from "./inventory.ts"`.
- `clearOutputButton` click handler теперь вызывает `resetAnsiState()` вместо
  прямого обращения к `ansiState.pendingEscape` / `ansiState.style`.

### main.ts по сессиям

| Метрика | Сессия #1 | Сессия #2 | Сессия #3 |
|---|---|---|---|
| `src/client/main.ts` LOC | 3974 | 3174 | 2604 |
| Дельта к предыдущей | базовый снимок | −800 строк | **−570 строк** |

### Bundle layout после сессии #3

| Чанк | Размер | Когда грузится |
|---|---|---|
| `client.js` | 54.3 KB | Eager (старт) — +0.4 KB vs #2 (factory-closure overhead) |
| `styles.min.css` | 36.7 KB | Eager (preload) |
| chunk-shared (bus + const) | 5.4 KB | Eager (импортирован main.ts) |
| chunk-global-map | 10.6 KB | На клик 🗺️ |
| chunk-item-db | 7.6 KB | На клик 📦 |
| chunk-compare | 7.1 KB | На клик ⚖️ |
| chunk-hotkeys | 3.6 KB | На клик 🎹 |
| chunk-triggers | 3.0 KB | На клик ⚡ |
| chunk-farm-settings | 2.8 KB | На клик 🌾⚙️ |
| chunk-vorozhe | 2.8 KB | На клик 🧙 |
| chunk-survival | 2.6 KB | На клик 🍞⚙️ |

Smoke bootstrap в headless Chromium: **140–150 мс** (стабильно).

### Сессия #4 (ветка `claude/continue-frontend-refactor-93c5m`)

Два небольших, но хорошо изолированных распила — popups и nav-panel.

```
src/client/
  popups.ts              (215) — alias / auto-cmd / map-context popups.
                                 Фабрика `createPopups({getAliases,
                                 getRoomAutoCommands, getNodeName})` возвращает
                                 `{openAliasPopup, openMapContextMenu}`;
                                 все остальные open/close/commit-handlers
                                 владеются самим модулем. Исходящие команды —
                                 через `bus.emit("client_send", ev)`.
  nav-panel.ts           (413) — левый нав-панель: aliases текущей зоны,
                                 соседние зоны, дальние зоны (BFS на
                                 zone-graph), инфинит-скролл по дальним,
                                 поиск. Фабрика `createNavPanel({getSnapshot,
                                 getFullSnapshot, getZoneNames, getAliases})`
                                 возвращает `{render, renderStatus}`. Модуль
                                 сам вешает listeners на `#nav-panel` scroll
                                 и `#nav-zones-search*`, владеет
                                 `navZonesSearchQuery`, `farZonesPage`,
                                 `allNeighbor/Far/VisitedZones`,
                                 `allFarZonesFiltered`. `getZoneId` инлайнен
                                 в модуль (pure `Math.floor(vnum/100)`).
```

Изменения в `main.ts`:
- Удалены DOM-рефы `aliasPopup*`, `autoCmdPopup*`, `mapContext*` (14 штук)
  и `nav*` (14 штук — `navAliasList`, `navZoneList`, `navFarZonesList`,
  `navZoneAliasesTitle`, `navZonesSearch`/`Clear`, `navPanel`,
  `navNeighborZonesSection`, `navFarZonesSection`, `navStatus`,
  `navCurrentRoom` и `Empty`-варианты).
- Удалены функции `openAliasPopup`, `closeAliasPopup`, `openAutoCmdPopup`,
  `closeAutoCmdPopup`, `openMapContextMenu`, `closeMapContextMenu`,
  `renderNavPanel`, `renderNavStatus`, `buildNavZoneItem`,
  `applyNavZonesFilter`, `loadMoreFarZones`, `buildNeighborZones`,
  `buildFarZones`, `buildAllVisitedZones`.
- Удалено состояние `aliasPopupVnum`, `autoCmdPopupVnum`,
  `mapContextMenuVnum`, `navZonesSearchQuery`, `farZonesPage`,
  `FAR_ZONES_PAGE_SIZE`, `allFarZones`, `allNeighborZones`,
  `allVisitedZones`, `allFarZonesFiltered`.
- Удалены listener-блоки popups (save/delete/close для alias- и
  auto-cmd-попапов, map-context-menu items, Escape/click-outside guard)
  и nav (scroll, search input/clear).
- Удалены type-импорты `NeighborZone`, `FarZone`.
- Добавлены `const { openAliasPopup, openMapContextMenu } = createPopups({...})`
  и `const { render: renderNavPanel, renderStatus: renderNavStatus } = createNavPanel({...})`.

### main.ts по сессиям

| Метрика | #1 | #2 | #3 | #4 |
|---|---|---|---|---|
| `src/client/main.ts` LOC | 3974 | 3174 | 2604 | 2084 |
| Дельта к предыдущей | базовый | −800 | −570 | **−520** |

### Bundle layout после сессии #4

| Чанк | Размер | Когда грузится |
|---|---|---|
| `client.js` | 53.9 KB | Eager (старт) |
| `styles.min.css` | 36.7 KB | Eager (preload) |
| chunk-shared (bus + const) | 5.4 KB | Eager (импортирован main.ts) |
| chunk-global-map | 10.6 KB | На клик 🗺️ |
| chunk-item-db | 7.6 KB | На клик 📦 |
| chunk-compare | 7.1 KB | На клик ⚖️ |
| chunk-hotkeys | 3.6 KB | На клик 🎹 |
| chunk-triggers | 3.0 KB | На клик ⚡ |
| chunk-farm-settings | 2.8 KB | На клик 🌾⚙️ |
| chunk-vorozhe | 2.8 KB | На клик 🧙 |
| chunk-survival | 2.6 KB | На клик 🍞⚙️ |

`client.js` чуть меньше, чем в #3 (было 54.3 KB, стало 53.9 KB), хотя фабрик
добавилось две — видимо, минификатор получил чище область для DCE, а
инлайн `getZoneId` сократил повторы.

Smoke bootstrap в headless Chromium: **~250–300 мс** (оверхед первого
запуска с чистым playwright-профилем; стабильный повторный — 140–170 мс).

### Сессия #5 (ветка `claude/continue-refactoring-ldLR5`)

Самый крупный распил проекта — вытаскиваем всю подсистему рендера карты.

```
src/client/
  map-grid.ts            (1046) — фабрика `createMapGrid({mapCanvasElement,
                                  zLevelLabel, zLevelDownButton, zLevelUpButton,
                                  getAliases, onAliasPopup, onMapContextMenu,
                                  onMapUpdated})`. Возвращает
                                  `{updateMap, forceFullRerender,
                                  getLatestSnapshot, getLatestFullSnapshot,
                                  getZoneNames, setZoneName}`.
                                  Внутри: CELL/TILE/PAD константы,
                                  gridLayout/collisionDisplacedVnums/
                                  mapRoomElements state, last*Layout* кэши,
                                  latestMapSnapshot/latestFullSnapshot,
                                  mapDragOrigin/mapDidDrag, zoneNames
                                  (localStorage-backed), cellKey/placeRoom/
                                  resetGridLayout/getZoneId helpers,
                                  `integrateSnapshot` (358 строк — layout
                                  алгоритм), `updateZLevelControls`,
                                  `renderGridMap` (434 строки с всеми SVG
                                  edge/stub/portal рисовальщиками),
                                  `updateMap`, `loadZoneNames/saveZoneNames`.
                                  Pointer/dblclick/contextmenu handlers
                                  навешиваются на `mapCanvasElement` внутри
                                  фабрики. zLevel-кнопки тоже навешиваются
                                  внутри. Bus-emits `zone_names` и
                                  `map_full_snapshot` — по-прежнему летят
                                  из `updateMap` в global-map модалку через
                                  replay-кэш шины.
```

Изменения в `main.ts`:

- Добавлен `import { createMapGrid } from "./map-grid.ts"`.
- Удалены импорты `MapNodePayload`, `MapEdgePayload`, `GridCell`, `ColumnDef`,
  `GameItemPayload`, `TerminalStyle`, `ProfileInfo`, `WEAPON_COLUMNS`,
  `ARMOR_COLUMNS`, `DIR_DELTA`, `OPPOSITE_DIR`, `DIRECTION_PRIORITY` —
  больше не используются.
- Удалены (ушли в `map-grid.ts`): `CELL`, `TILE`, `PAD`, `ZONE_GAP`,
  `COMPONENT_GAP`, `gridLayout`, `collisionDisplacedVnums`, `currentZLevel`,
  `availableZLevels`, `mapRoomElements`, `lastLayoutNodeCount`,
  `lastLayoutEdgeCount`, `lastRenderedZone`, `lastRenderedZLevel`,
  `lastRenderedMinX`, `lastRenderedMaxY`, `cellKey`, `placeRoom`,
  `resetGridLayout`, `getZoneId`, `integrateSnapshot`, `updateZLevelControls`,
  `renderGridMap`, `mapDragOrigin`, `mapDidDrag`, все pointer/dblclick/
  contextmenu handlers на `mapCanvasElement`, `updateMap`, `loadZoneNames`,
  `saveZoneNames`, `zoneNames`, `latestMapSnapshot`, `latestFullSnapshot`,
  click-handlers на `zLevelDownButton`/`zLevelUpButton`.
- Форвард-объявления `let openAliasPopup`, `openMapContextMenu`,
  `renderNavPanel`, `renderNavStatus` — чтобы `mapGrid` мог построиться
  раньше popups/nav-panel, а их замыкания на mapGrid.getLatestSnapshot()
  работали корректно.
- Диспетчер `map_snapshot`/`map_update` вызывает `mapGrid.updateMap(...)`.
  `aliases_snapshot` — `mapGrid.forceFullRerender()` вместо пары
  `lastLayoutNodeCount = -1; renderGridMap(latestMapSnapshot);`.
- `farmSettingsButton.click`: `getZoneId(trackerCurrentVnum ?? 0)` → инлайн
  `Math.floor((trackerCurrentVnum ?? 0) / 100)`.
- `globalMapButton.click`: читает `mapGrid.getLatestFullSnapshot()` и
  `mapGrid.getZoneNames()`.
- `bus.on("zone_name_set_local")` теперь делегирует `mapGrid.setZoneName`.

### main.ts по сессиям

| Метрика | #1 | #2 | #3 | #4 | #5 |
|---|---|---|---|---|---|
| `src/client/main.ts` LOC | 3974 | 3174 | 2604 | 2084 | 1087 |
| Дельта к предыдущей | базовый | −800 | −570 | −520 | **−997** |

### Bundle layout после сессии #5

| Чанк | Размер | Когда грузится |
|---|---|---|
| `client.js` | 54.9 KB | Eager (старт) — +1.0 KB vs #4 (factory-closure overhead для mapGrid) |
| `styles.min.css` | 36.7 KB | Eager (preload) |
| chunk-shared (bus + const) | 5.4 KB | Eager |
| chunk-global-map | 10.6 KB | На клик 🗺️ |
| chunk-item-db | 7.6 KB | На клик 📦 |
| chunk-compare | 7.1 KB | На клик ⚖️ |
| chunk-hotkeys | 3.6 KB | На клик 🎹 |
| chunk-triggers | 3.0 KB | На клик ⚡ |
| chunk-farm-settings | 2.8 KB | На клик 🌾⚙️ |
| chunk-vorozhe | 2.8 KB | На клик 🧙 |
| chunk-survival | 2.6 KB | На клик 🍞⚙️ |

Smoke bootstrap в headless Chromium: **~380 мс** (быстрее, чем в #4 — возможно, прогретый playwright-кэш; но не медленнее).

### Сессия #6 (ветка `claude/continue-frontend-refactor-YGAwB`)

Два куска: (1) выносим socket-lifecycle в отдельный модуль, dispatcher
остаётся в main.ts; (2) расширяем modulepreload на eager-чанки, чтобы
shared chunk шёл параллельно с `client.js`, а не после его парсинга.

```
src/client/
  net.ts                 (149) — фабрика `createNet({onMessage})`. Владеет
                                 `socket`, `pendingOpenPromise`, `reconnectTimer`,
                                 `reconnectDelay`, `reconnectEnabled`, `pendingQueue`.
                                 Экспортирует `{sendClientEvent, ensureSocketOpen,
                                 enableReconnect}`. На `open` шлёт warm-up
                                 тройку `осм склад1 / осм склад2 / инв` через
                                 собственный `sendClientEvent`. На входящее
                                 сообщение парсит JSON и делегирует в
                                 `onMessage(event)`. На `close` запускает
                                 экспоненциальный backoff (1s → 30s).
                                 Reconnect включается вызовом
                                 `enableReconnect()` из bootstrap после
                                 успешного `loadDefaults()` — до этого
                                 неудачи подключения не порождают лавину
                                 ретраев.
```

Изменения в `main.ts`:

- Добавлен `import { createNet } from "./net.ts"`.
- Удалены: `socket`, `pendingOpenPromise`, `reconnectTimer`, `reconnectDelay`,
  `reconnectEnabled`, `pendingQueue`, `RECONNECT_DELAY_MAX`, `getSocketUrl`,
  `scheduleReconnect`, `flushPendingQueue`, `createSocket`, `sendClientEvent`,
  `ensureSocketOpen` (все в `net.ts`).
- Большой switch на 28 case (парсинг `ServerEvent`) вытащен из inline
  `nextSocket.addEventListener("message")` в hoisted function declaration
  `handleServerEvent(message)`. Это важно: function declaration хойстится,
  поэтому `createNet({ onMessage: handleServerEvent })` на строке ниже
  работает, несмотря на forward reference к `sendClientEvent` внутри switch.
- После `createNet`: `const { sendClientEvent, ensureSocketOpen } = net;` —
  все existing call-sites (`sendClientEvent(...)`, `ensureSocketOpen()`)
  продолжают работать без изменений.
- Bootstrap-хвост: `reconnectEnabled = true` → `net.enableReconnect()`.
- Перемещён `bus.on("client_send", ...)` с верха main.ts (где он был до
  `sendClientEvent`-forward-ref) на позицию после `createNet` — теперь
  `sendClientEvent` уже связан.

`scripts/build-client.ts`: после JS/CSS-билдов читает `./public/client.js`,
вырезает static-import prelude (`/^(?:import[^;]+;)+/`), экстрагирует имена
eager-чанков (`/["']\.\/(chunk-[a-z0-9]+\.js)["']/g`), и переписывает
`public/index.html` между маркерами `<!-- chunk-preload:start -->` /
`<!-- chunk-preload:end -->` списком `<link rel="modulepreload">` для этих
чанков. Dynamic `import(...)` не попадают в prelude (они внутри кода, не в
top-level statement'ах), поэтому lazy-чанки не preloadятся. Перезапись
идемпотентна — если содержимое между маркерами совпадает, файл не
трогается.

`public/index.html`: между `<link rel="modulepreload" href="/client.js">`
и `<link rel="stylesheet">` вставлены маркеры:

```html
<!-- chunk-preload:start -->
<link rel="modulepreload" href="/chunk-wtr0d5hw.js" />
<link rel="modulepreload" href="/chunk-bezgv9t7.js" />
<!-- chunk-preload:end -->
```

Это даёт браузеру спекулятивный discovery shared-чанка сразу из HTML: он
начинает fetch одновременно с `client.js`, вместо того чтобы ждать, пока
модуль распарсится и выстрелит собственный `import`.

### main.ts по сессиям

| Метрика | #1 | #2 | #3 | #4 | #5 | #6 |
|---|---|---|---|---|---|---|
| `src/client/main.ts` LOC | 3974 | 3174 | 2604 | 2084 | 1087 | 980 |
| Дельта к предыдущей | базовый | −800 | −570 | −520 | −997 | **−107** |

### Bundle layout после сессии #6

| Чанк | Размер | Когда грузится |
|---|---|---|
| `client.js` | 55.1 KB | Eager (старт) |
| `styles.min.css` | 35.9 KB | Eager (preload) |
| chunk-shared (bus + const) | 5.3 KB | Eager (**теперь preload**) |
| chunk-typings-shim | 0.5 KB | Eager (**теперь preload**) |
| chunk-global-map | 10.4 KB | На клик 🗺️ |
| chunk-item-db | 7.4 KB | На клик 📦 |
| chunk-compare | 6.9 KB | На клик ⚖️ |
| chunk-hotkeys | 3.5 KB | На клик 🎹 |
| chunk-triggers | 2.9 KB | На клик ⚡ |
| chunk-farm-settings | 2.7 KB | На клик 🌾⚙️ |
| chunk-vorozhe | 2.7 KB | На клик 🧙 |
| chunk-survival | 2.5 KB | На клик 🍞⚙️ |

`client.js` формально вырос на +0.2 KB против #5 (factory-замыкание для
net добавляет чуть-чуть оверхеда vs модуль-скоуп globals), но на
wall-clock time это компенсируется preload'ом shared-чанка: теперь
browser fetch'ит `client.js` + `chunk-wtr0d5hw.js` + `chunk-bezgv9t7.js`
параллельно из HTML prescan, а не sequentially.

Smoke bootstrap в headless Chromium: **~200–230 мс**.

### Что осталось (для будущей сессии)

1. **Разбивка `handleServerEvent`** (28 case) на хендлеры по доменам —
   например `src/client/handlers/containers.ts` для `*_contents`/
   `bazaar_max_price_response`, `handlers/combat.ts` для `stats_update`/
   `combat_state`, и т.д. main.ts станет тоньше, но переплёт со state
   (state-mutators) делает это структурной, а не code-splitting-работой.
2. **Извлечение state в `state.ts`** — все `let current*` (currentStats,
   currentAliases, currentSurvivalStatus, currentNavState, currentSurvivalSettings,
   currentRoomAutoCommands, farm2Enabled/ZoneId, trackerCurrentVnum,
   zoneScriptState, mapRecordingEnabled, hotkeys, commandHistory,
   lastEnemy, pendingEquippedAction) в один типизированный store с
   explicit setters. Обеспечит централизованный audit-log того, кто и
   когда мутирует состояние.
3. **Автоматическое `?v=N` cache-busting** в `scripts/build-client.ts` —
   сейчас `?v=7` захардкожен в index.html. При смене client.js хэш
   чанков меняется (преодолевает proxy-кеш), но сам `client.js`
   остаётся тем же именем, так что `?v=N` всё ещё нужен для bump'а при
   изменении содержимого. Можно автогенерить на основе content-hash.

### Коммиты в ветке `claude/refactor-client-performance-YQZmB`

1. `9bc423c` perf(client): quick startup wins + bundle splitting/minify
2. `62c3bea` refactor(client): start modular split + headless smoke test
3. `e9cea7f` refactor(client): extract Vorozhe modal as dynamic-import chunk
4. `b24db96` refactor(client): extract Compare Advisor modal as dynamic chunk
5. `409e787` refactor(client): extract Item DB / wiki-search modal as dynamic chunk
6. `696173a` refactor(client): extract Hotkeys modal as dynamic chunk
7. `51d4056` refactor(client): extract Triggers modal as dynamic chunk

### Коммиты в ветке `claude/continue-frontend-refactor-7Mvnx`

1. `7f45df8` perf(client): minify CSS, preload bundle, bump cache (?v=7)
2. `e64ec31` refactor(client): extract Farm, Survival, Global Map modals as dynamic chunks

### Коммиты в ветке `claude/continue-frontend-refactor-ccWkI`

1. `3af463e` refactor(client): split main.ts into terminal/inventory/splitters modules

### Коммиты в ветке `claude/continue-frontend-refactor-93c5m`

1. `3c62ece` refactor(client): extract popups + nav-panel into dedicated modules

### Коммиты в ветке `claude/continue-refactoring-ldLR5`

1. `8bbb2f2` refactor(client): extract map grid renderer into dedicated module

### Коммиты в ветке `claude/continue-frontend-refactor-YGAwB`

(добавляются по мере коммитов в этой сессии)
