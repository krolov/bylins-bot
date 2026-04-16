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

### Что осталось (для будущей сессии)

1. **`map-grid.ts`** (~1000 строк) — `integrateSnapshot` + `renderGridMap` +
   `updateMap` + z-level + pointer/drag handlers. Самый крупный кусок,
   сильно сцеплен с `latestMapSnapshot`, `gridLayout`, `mapRoomElements`,
   `currentZLevel`, `zoneNames`. Для извлечения нужен общий state-объект.
2. **`nav-panel.ts`** (~320 строк) — `renderNavPanel`, `buildNavZoneItem`,
   `applyNavZonesFilter`, `buildNeighborZones/FarZones/AllVisitedZones`,
   `renderNavStatus`. Сильная связь с `currentNavState`, `currentAliases`,
   `currentRoomAutoCommands`, `allNeighborZones/FarZones/VisitedZones`,
   `navZonesSearchQuery`, `farZonesPage`.
3. **`net.ts`** (~400 строк) — `createSocket`, `scheduleReconnect`,
   `flushPendingQueue`, `sendClientEvent`, `ensureSocketOpen`, `loadDefaults`,
   вместе с dispatcher'ом. Сердце clients↔server; нуждается в типобезопасной
   прокачке колбэков (dispatch, state-mutators).
4. **Alias/auto-cmd/map-context popups** (~150 строк) — маленький кластер
   `openAliasPopup`/`openAutoCmdPopup`/`openMapContextMenu` + их close/commit
   хэндлеры. Хорошая цель для одного файла `popups.ts`.
5. **Preload for hashed chunks** — `<link rel="modulepreload">` в
   `index.html` сейчас покрывает только `client.js`. Shared chunk подгружается
   вторым HTTP-запросом. Чтобы убрать этот hop, нужно генерировать HTML из
   билд-шага с реальными hash-именами чанков (или пере-именовать в стабильные
   имена).

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

(добавляются по мере коммитов в этой сессии)
