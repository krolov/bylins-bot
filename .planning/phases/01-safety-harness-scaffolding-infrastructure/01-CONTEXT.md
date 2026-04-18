# Phase 1: Safety Harness + Scaffolding Infrastructure - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Установлен regression oracle (baseline log-fixture + parser snapshot + replay harness) и структурные примитивы (ports layer, типизированный event bus, Postgres migration framework). **Ни одного символа доменной логики ещё не двигаем** — эта фаза готовит инструменты, которыми Phase 2 будет безопасно извлекать монолиты.

Входит: SAFE-01 (baseline), SAFE-02 (parser snapshot), SAFE-03 (clock/timer injection), SAFE-04 (mud-phrases inventory), SAFE-05 (refactor-playbook + commit convention), INFRA-01 (bus), INFRA-02 (ports), INFRA-03 (migration framework), INFRA-04 (inline DDL → migrations).

Не входит: извлечения из `server.ts`/`client/main.ts`/`map-grid.ts`/`wiki.ts`, фикс freeze, написание тестов для hot-path модулей (всё это — Phase 2-4).

</domain>

<decisions>
## Implementation Decisions

### Baseline Capture (SAFE-01)
- **D-01:** Baseline-фикстура вырезается из существующего `/var/log/bylins-bot/mud-traffic.log` (756MB доступно), а не записывается отдельной live-сессией
- **D-02:** Содержание baseline — **смешанный поток**: активный farm + chat + bazaar + repair + survival tick (30-минутное окно с разнообразием events); покрывает move/mob/loot/stats парсеры И chat/bazaar/repair/survival controllers
- **D-03:** Формат файла — сохранить текущий log format (`[timestamp] session=X direction=Y message=Z` с ANSI и экранированными `\r\n`); парсер baseline → в структуру `{ timestamp, session, direction, message }`
- **D-04:** Storage — `.fixtures/mud-traffic-baseline.log` **gitignored, local only**; `.fixtures/` добавляется в `.gitignore`; в `docs/refactor-playbook.md` — инструкция как восстановить baseline из `/var/log/bylins-bot/mud-traffic.log`
- **D-05:** Sanitization **не требуется** по решению пользователя — лог OK как есть (пароли в MUD-protocol не шлются явно, chat-контент приемлем для локальной разработки)

### Replay Harness (SAFE-01 runtime)
- **D-06:** Oracle записывает **все side-effects**: bus emit-sequence (kind + payload) + `mud-out` команды + WS broadcast'ы (ServerEvent'ы) + DB-вызовы (метод + args) — полный behavioural oracle
- **D-07:** DB работает через **Mock** — spy-имплементация `MapStore` записывает SQL-вызовы как последовательность; не требуется test-Postgres instance, harness быстрый и hermetic; DB-специфичные баги (upsertEdge race) ловятся интеграционными тестами в Phase 4
- **D-08:** Diff — **JSONL + deep-diff**: каждый side-effect одна строка JSON с `kind`/`args`/`meta`; сравнение `snapshots/before.jsonl` vs `snapshots/after.jsonl` через `jsondiffpatch` или similar; output — структурированный patch, не текстовый diff
- **D-09:** Запуск — **manual + pre-commit hook**: `bun run replay:check` запускается вручную; pre-commit hook (git hook, не husky) вызывает `replay:check` на ветках, матчащих `refactor/*` или с commit msg содержащим `refactor(...)` — матчинг конвенции из `docs/refactor-playbook.md`
- **D-10:** Non-determinism — `NowProvider`/`TimerProvider` (из D-14) используются в harness'е с deterministic fake clock (счётчик ms), seed из baseline timestamp; random-seed не требуется (нет `Math.random` в hot path)

### Parser Snapshot (SAFE-02)
- **D-11:** `scripts/parser-snapshot.ts` прогоняет `src/map/parser.ts` по baseline fixture (только `direction=mud-in` записи) и пишет `snapshots/parser-before.jsonl` (initial) + `snapshots/parser-after.jsonl` (per-run); каждая строка — `{chunkIndex, events: ParsedEvent[]}`
- **D-12:** Diff — та же стратегия (JSONL + deep-diff) что и replay-harness
- **D-13:** Первоначальный snapshot создаётся в Phase 1 до любых правок парсера; считается "behaviour of record" — refactor'ы должны сохранять его байт-в-байт

### Clock & Timer Injection (SAFE-03)
- **D-14:** Создаём порты `NowProvider { now(): number }` и `TimerProvider { setTimeout, clearTimeout, setInterval, clearInterval }`; default-имплементации — прямые алиасы на `Date.now` / globalThis timers; fake-имплементации — для тестов и harness
- **D-15:** Scope в Phase 1 — **только добавить порты и default-имплементацию** в `src/ports/`; injection в существующие controllers (farm2, survival, triggers) происходит в Phase 2 **по мере их извлечения**, не сейчас; это избегает big-bang изменения и сохраняет behaviour-preserving invariant

### mud-phrases Inventory (SAFE-04)
- **D-16:** `docs/mud-phrases.md` — plain markdown со структурой: `## <file>` → `### <feature>` (dodge / survival-thirst / prompt-stats / bazaar-sale / repair / market / loot-corpse / triggers-stand / и т.д.) → regex literal + краткое purpose + example match string
- **D-17:** Не автогенерируем — это human-curated док; grep по `new RegExp\\(|RE\\s*=|REGEXP\\s*=` для первоначальной выборки, далее ручная организация по features
- **D-18:** Цель — единый индекс фраз, чтобы при апдейте MUD-текстов было видно где править; апдейт документа обязателен при добавлении новых регексов (prevent regex drift)

### Refactor Playbook (SAFE-05)
- **D-19:** `docs/refactor-playbook.md` содержит:
  - Pre-flight checklist: `gitnexus_impact` перед правкой, `gitnexus_detect_changes` до commit, `bun run replay:check` зелёный, `bun test` зелёный, parser snapshot zero-diff
  - Commit convention: PR title `refactor(phaseN): <what>`; один структурный PR = одно извлечение + его сабскрайбер на bus (no mixed-purpose PRs)
  - Regression определение: **strict byte-equality** baseline diff (не tolerance-based); любой diff блочит merge
  - Как восстановить baseline fixture из `/var/log/bylins-bot/mud-traffic.log`
  - Как запустить harness локально
- **D-20:** Pre-commit hook добавляется как shell script в `.githooks/pre-commit`; инструкция `git config core.hooksPath .githooks` в playbook'е

### Event Bus (INFRA-01)
- **D-21:** **Roll-your-own** в `src/bus/mud-event-bus.ts` ~80 LOC — ближе к стилю проекта (factory + closed-over state), 0 новых dependencies, полный контроль
- **D-22:** API — `createMudBus(): MudEventBus` с методами `emit(event)`, `on(kind, handler): UnsubFn`, `once(kind, handler): UnsubFn`, `off(kind, handler)`, `onAny(handler): UnsubFn`; sync-delivery; listener-snapshot-before-iterate (защита от self-remove mid-dispatch); return-value subscribe = unsubscribe closure
- **D-23:** Событие в Phase 1 — **только** `MudTextRawEvent: { kind: "mud_text_raw", text: string }`; discriminated union готов к расширению; `session_teardown`, `room_parsed`, `combat_started` добавляем в Phase 2 при extractions по мере необходимости
- **D-24:** Error handling — try/catch per handler; ошибка одного listener'а не прерывает остальных; пишется через существующий `logEvent(null, "error", ...)` (матчит project convention; соответствует AGENTS.md rule "no empty catch")
- **D-25:** Unit тесты bus'а в `src/bus/mud-event-bus.test.ts`: emit без handlers, emit с many handlers, self-remove mid-dispatch, once (авто-unsub), onAny, handler error isolation, typed payload check

### Ports Layer (INFRA-02)
- **D-26:** `src/ports/` содержит interfaces (TypeScript `interface` / `type`), **не** классы и **не** factory'и; default-имплементации в `src/ports/defaults/`
- **D-27:** Phase 1 ports: `MudCommandSink` (sendRaw + sendTo-like methods — извлечь из server.ts signatures), `Broadcaster` (broadcast ServerEvent to browser clients), `NowProvider`, `TimerProvider`, `SessionTeardownRegistry` (register + invokeAll)
- **D-28:** `MapStore` interface уже существует (`src/map/store.ts`) — **не трогаем** в Phase 1; оставляем на месте, Phase 2 может переместить в `src/ports/` если потребуется
- **D-29:** Ни один существующий controller в Phase 1 порты **не использует** — они предвычислены для Phase 2 extractions; в Phase 1 просто создание interface файлов + default impls

### Migration Framework (INFRA-03, INFRA-04)
- **D-30:** **Roll-your-own** ~40 LOC runner в `src/map/migrations/runner.ts`; использует `postgres` (porsager) driver через `sql.file()` / `sql.unsafe()`; не добавляем postgres-shift dependency
- **D-31:** Baseline-strategy — **"pump на schema_migrations"**: runner при старте проверяет существование таблицы `schema_migrations` (id text primary key, applied_at timestamptz); если таблицы нет И в DB есть `map_rooms` — runner создаёт таблицу и INSERT'ит все known migration IDs БЕЗ выполнения SQL (seed); далее normal run (выполняет только незарегистрированные)
- **D-32:** Naming — **timestamp**: `YYYYMMDDHHMMSS-description.sql` (например `20260418180000-baseline.sql`, `20260418180100-add-has-wiki-data.sql`); никогда не коллизии при параллельных ветках; lexicographic sort = chronological
- **D-33:** Advisory lock — **да**: runner выполняет `SELECT pg_advisory_xact_lock(727465)` (хеш "bylins") внутри транзакции; блокирует concurrent migration runners; даже если сейчас PM2 single-instance, cheap insurance
- **D-34:** Phase 1 migration content — (a) `20260418180000-baseline.sql` — полный dump текущей схемы (запустить `pg_dump --schema-only` на prod, cleanup ownership/defaults, commit); (b) миграции для текущего inline-DDL из `mapStore.initialize()` (`ALTER TABLE game_items ADD COLUMN IF NOT EXISTS has_wiki_data`, `DROP TABLE farm_zone_settings` guard); после — `mapStore.initialize()` сводится к `await runMigrations(sql)` и удалению inline DDL
- **D-35:** Runner лог — каждое применённое migration печатается через `logEvent(null, "session", "applied migration ${id}")`; failure — abort transaction, re-throw, процесс падает (fail-fast)

### Phase 1 PR Granularity
- **D-36:** Структурный разбор на 6-8 PR'ов (планер решит точный split); рекомендуемый порядок:
  1. `.fixtures/` gitignore + baseline extraction script + committed baseline fixture (baseline only, harness не ещё)
  2. `src/bus/mud-event-bus.ts` + tests (пустой ещё не используется)
  3. `src/ports/` + defaults (пустые ещё не используется)
  4. `src/map/migrations/runner.ts` + baseline + текущие inline → migrations; `mapStore.initialize()` switch to runner (**самое рискованное; отдельный PR**)
  5. `scripts/parser-snapshot.ts` + initial `snapshots/parser-before.jsonl`
  6. `scripts/replay-harness.ts` + Mock store + initial `snapshots/replay-before.jsonl`
  7. `.githooks/pre-commit` + playbook + mud-phrases inventory
- **D-37:** Каждый PR — отдельный commit; `gitnexus_detect_changes` зелёный (scope только ожидаемые файлы); `bun test` + `bun run build` зелёные; migration-PR требует особого внимания к D-31 baseline-pump логике на реальной prod DB (протестировать на локальной копии dump'а сначала)

### Claude's Discretion
- Точное разбиение на таски внутри PLAN.md — планер решает
- Структура `docs/mud-phrases.md` — organization choice (by-file vs by-feature vs by-regex-family)
- Имена portов (`MudCommandSink` vs `MudCommands` vs `CommandSink`) — планер/executor выбирают; консистентность важнее точного имени
- Deep-diff библиотека (`jsondiffpatch` vs `deep-diff` vs самописный) — планер пусть оценит dependencies
- Mock-MapStore имплементация — пустые методы или записывающий spy; executor выберет

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Context
- `.planning/PROJECT.md` — Core Value (behaviour-preserving), Key Decisions, Out of Scope
- `.planning/REQUIREMENTS.md` — SAFE-01..05 + INFRA-01..04 требования
- `.planning/ROADMAP.md` — Phase 1 success criteria, dependency graph
- `.planning/STATE.md` — project memory

### Research
- `.planning/research/SUMMARY.md` — обзор, pitfalls, open questions
- `.planning/research/STACK.md` — mitt/postgres-shift discussion, fast-check, Bun --cpu-prof
- `.planning/research/ARCHITECTURE.md` — MudEvent discriminated union дизайн, ports-and-adapters, strangler-fig
- `.planning/research/PITFALLS.md` — Pitfall 1 (double-fire), Pitfall 3 (regex drift), Pitfall 4 (migration baseline), Pitfall 6 (gitnexus blind spots)
- `.planning/research/FEATURES.md` — T1 (baseline), T2 (regression oracle), D1 (log-replay harness)

### Codebase Map
- `.planning/codebase/ARCHITECTURE.md` — текущий factory-DI стиль, mudTextHandlers pattern
- `.planning/codebase/STRUCTURE.md` — директория `src/` layout, `src/map/store.ts`
- `.planning/codebase/CONVENTIONS.md` — code-style, no-any, factory-pattern, logEvent
- `.planning/codebase/CONCERNS.md` — inline DDL (store.ts:184-199, 241-245), server.ts mutable state, mudTextHandlers Set

### Project Rules
- `CLAUDE.md` — GitNexus workflow (impact before edit, detect_changes before commit, rename не find-and-replace)
- `AGENTS.md` — no-any, no empty catch, logEvent convention, "Never await inside a loop" (project code style)

### Live Artifacts (non-repo)
- `/var/log/bylins-bot/mud-traffic.log` — 756MB live MUD traffic, source для baseline fixture (D-01..05)
- `/var/log/bylins-bot/last-profile.txt` — current active profile (informational)

### Source Files Referenced
- `src/server.ts` — `mudTextHandlers: Set<Handler>` + `addMudTextListener` pattern; `logEvent`; `appendFileSync` для mud-traffic.log; inline shutdown hooks
- `src/mud-connection.ts` — `onMudText` callback, `session.sessionTeardownHooks`, reconnect state
- `src/map/store.ts` — inline `initialize()` DDL (baseline для migration framework); `upsertEdge` race (known bug)
- `src/map/memory-store.ts` — reference для Mock MapStore shape
- `src/map/parser.ts` + `parser.test.ts` — target для SAFE-02 snapshot; existing test suite

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `logEvent(session, direction, message, meta?)` из `src/server.ts` — текущий логгер; bus error handler использует эту функцию
- `src/map/memory-store.ts` — готовый in-memory MapStore (`createMemoryStore()`); шаблон для Mock variant в replay-harness
- `src/map/parser.ts` — парсер готов к snapshot'у; `parser.test.ts` — шаблон тестовой структуры
- `sessionTeardownHooks` в `mud-connection.ts` — pattern для `SessionTeardownRegistry` порта

### Established Patterns
- Factory-DI: `createXxx({deps})` — каждый новый модуль (bus, runner, ports/*) следует этой форме; composition в `server.ts`
- Logging: `logEvent(null, "session"|"error"|"mud-in"|"mud-out"|"browser-in"|"browser-out", message, meta?)` — единственный log API; bus/runner/harness используют его (не `console.log`)
- ANSI обработка: `src/map/parser.ts` уже имеет regex'ы для ANSI escapes; replay-harness использует его для парсинга baseline
- Telnet / mud-in format: `\r\n`-separated chunks; baseline парсер должен корректно обрабатывать escape-sequence в stored log

### Integration Points
- Bus шим впишется в `server.ts` onMudText вывод (рядом с existing `mudTextHandlers`-iteration) — **в Phase 2**, не сейчас; Phase 1 только создаёт bus
- `mapStore.initialize()` в `src/map/store.ts` — единственная точка входа для DDL; Phase 1 заменит её содержимое на вызов migration runner'а (это самый рискованный PR phase'ы)
- `.githooks/pre-commit` — новый hook; инструкция `git config core.hooksPath .githooks` в `docs/refactor-playbook.md`
- `.gitignore` — добавить `.fixtures/` и `snapshots/`
- `package.json` — новые scripts: `replay:check`, `parser:snapshot`, `migrate`, `migrate:status`

</code_context>

<specifics>
## Specific Ideas

- Структурированный формат лога (`[timestamp] session=X direction=Y message=Z`) уже доказано работоспособен — baseline парсер повторяет логику `logEvent` backwards
- Session-id `system` vs конкретный uuid в логе — replay-harness различает system events (server-side) и browser-session events
- ANSI и escape-sequences в лог-файле уже в экранированном виде (`\u001b[1;31m`, `\\r\\n`) — baseline reader должен де-экранировать перед подачей в парсер
- Для migration runner-а `DROP TABLE farm_zone_settings` guard (store.ts:184-199) — отдельная "destructive" migration; требует карточку в playbook'е ("destructive migrations list")

</specifics>

<deferred>
## Deferred Ideas

- **Clock injection во все существующие controllers** — откладывается на Phase 2 per-extraction (не big-bang в Phase 1)
- **MapStore port move** — MapStore остаётся в `src/map/store.ts`; перемещение в `src/ports/` — Phase 2 если понадобится
- **Granular events** (`room_parsed`, `combat_started`, `mob_appeared`) — Phase 2 при extractions
- **CI pipeline для replay-harness** — GitHub Actions отдельно в v2 TOOL-01
- **fast-check + property tests** — Phase 4 (tests-last); Phase 1 только bun:test для bus
- **Test-Postgres integration setup** — не требуется в Phase 1; добавим в Phase 4 для TEST-05 (map-store integration tests)
- **Delete unused `@ladybugdb/core` devDep** — noted в CONCERNS.md; не Phase 1 задача

</deferred>

---

*Phase: 01-safety-harness-scaffolding-infrastructure*
*Context gathered: 2026-04-18*
