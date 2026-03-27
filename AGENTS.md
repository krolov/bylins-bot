# AGENTS.md — bylins-bot (sc-kerat-mud-client)

A MUD automation bot and browser client for the Russian-language MUD game `bylins.su:7000`.
Built with **Bun** (not Node.js). Never use `node`, `npm`, `npx`, or `yarn`.

---

## Build / Run / Test Commands

```bash
# Install dependencies
bun install

# Development (builds client + starts server with hot-reload)
bun run dev

# Production start (builds client + runs server)
bun run start

# Build only the browser client bundle (src/client.ts → public/client.js)
bun run build:client

# Type-check without emitting (no build output)
bun run typecheck

# Run all tests
bun test

# Run a single test file
bun test src/map/parser.test.ts

# Run tests matching a name pattern
bun test --test-name-pattern "handles portal"
```

No linter or formatter is configured. Do not add ESLint or Prettier without being asked.

### Перезапуск бота (bylins-bot server)

Когда пользователь говорит "перегрузи", "перезапусти", "рестарт" — он имеет в виду **бота/клиент игры**, а не opencode.

**Бот управляется через PM2, не через systemd.** `systemctl bylins-bot-web` отключён — не использовать.

```bash
# Перезапуск бота (production, PM2)
pm2 restart bylins-bot

# Статус бота
pm2 show bylins-bot

# Пересборка браузерного клиента (после изменений в src/client.ts)
bun run build:client

# Перезапуск opencode — только если явно сказано "перезапусти opencode"
kill $(pgrep -f "opencode web") && sleep 2 && nohup /root/.opencode/bin/opencode web --hostname 127.0.0.1 --port 4096 > /tmp/opencode.log 2>&1 &
```

После перезапуска бота проверяй статус через `bylins-client_get_status`.

---

## Логи

Все логи пишутся в `/var/log/bylins-bot/`:

| Файл | Содержимое |
|---|---|
| `mud-traffic.log` | Текущий лог: весь MUD-трафик (входящий/исходящий), события сессий, ошибки. Ротируется ежедневно через logrotate. |
| `mud-traffic.log.1` | Лог за предыдущие сутки (plain text, не сжат). |
| `mud-traffic.log.2.gz` | Лог за позапрошлые сутки (gzip). |
| `last-profile.txt` | ID последнего активного профиля MUD. |
| `server.log` | Текущий stdout/stderr systemd-сервиса. |
| `server.log.1` | stdout/stderr за предыдущие сутки. |

### Формат записей в mud-traffic.log

```
[2026-03-25T07:32:43.078Z] session=<uuid> direction=mud-in message="текст от MUD"
[2026-03-25T07:32:43.078Z] session=<uuid> direction=mud-out message="команда отправленная в MUD"
[2026-03-25T07:32:43.078Z] session=<uuid> direction=session message="Connect requested."
[2026-03-25T07:32:43.078Z] session=system direction=error message="описание ошибки"
```

Направления: `mud-in` (MUD → бот), `mud-out` (бот → MUD), `browser-in` (браузер → бот), `browser-out` (бот → браузер), `session` (события жизненного цикла), `error`.

### Просмотр логов

```bash
# Последние N строк текущего лога
tail -n 100 /var/log/bylins-bot/mud-traffic.log

# Поиск по времени смерти / конкретному событию
grep "07:3[0-9]" /var/log/bylins-bot/mud-traffic.log

# Лог за предыдущие сутки
tail -n 200 /var/log/bylins-bot/mud-traffic.log.1

# Лог позапрошлых суток (сжат)
zcat /var/log/bylins-bot/mud-traffic.log.2.gz | tail -n 200
```

---

## Project Structure

```
src/
  server.ts          # Main Bun HTTP + WebSocket server (~1600 lines, entry point)
  config.ts          # Env var parsing → RuntimeConfig (validates at startup)
  db.ts              # postgres client singleton
  combat-state.ts    # Combat detection state machine
  triggers.ts        # Auto-triggers (dodge, stand-up)
  farm-script.ts     # Farming automation controller
  survival-script.ts # Food/flask survival automation
  gear-scan.ts       # Gear scanning
  client.ts          # Browser-side TypeScript (bundled to public/client.js)
  map/
    types.ts          # All shared interfaces and type definitions
    parser.ts         # MUD text → ParsedEvent[] (stateful streaming parser)
    tracker.ts        # Movement tracking → edge inference
    store.ts          # PostgreSQL persistence layer
    memory-store.ts   # In-memory MapStore implementation
    pathfinder.ts     # BFS pathfinding
    parser.test.ts    # Unit tests co-located with source
    tracker.test.ts
scripts/
  build-client.ts    # Bundles src/client.ts → public/client.js
  wiki-mcp.ts        # MCP server for wiki data
  client-mcp.ts      # MCP server for live bot debug (WebSocket → bylins-bot)
  gear-advisor.ts    # Standalone gear advisor
  seed-items.ts      # DB seeding
public/              # Static files served by Bun HTTP
  index.html
  styles.css
  client.js          # Built artifact — do not edit manually
docs/                # Game domain documentation
deploy/              # Docker deployment (docker-compose + Caddyfile)
```

---

## Code Style Guidelines

### Runtime & Modules

- Runtime is **Bun**. Use `bun` for all commands.
- `"type": "module"` — ES modules throughout. No CommonJS (`require`).
- Bun runs `.ts` files directly — no compilation step for server code.
- `"verbatimModuleSyntax": true` is set in tsconfig — **`import type` is required** for type-only imports or the build will fail.

### Imports

```ts
// External packages
import postgres from "postgres";
import { z } from "zod";

// Node-compatible builtins use the node: prefix
import { appendFileSync } from "node:fs";

// Internal: relative paths WITH .ts extension
import { createCombatState } from "./combat-state.ts";
import type { CombatState } from "./combat-state.ts";
import type { Direction, MapSnapshot } from "./map/types.ts";

// Test files only
import { describe, test, expect } from "bun:test";
```

Order: external packages → node: builtins → internal relative. Separate with blank lines.

### Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Files | `kebab-case.ts` | `farm-script.ts`, `combat-state.ts` |
| Functions | `camelCase` | `createFarmController()`, `findPath()` |
| Interfaces & Types | `PascalCase` | `RuntimeConfig`, `MapSnapshot`, `ParsedEvent` |
| Constants (module-level primitives) | `SCREAMING_SNAKE_CASE` | `ANSI_ESCAPE_REGEXP`, `DODGE_INTERVAL_MS` |
| DB row interfaces (Postgres columns) | `snake_case` fields | `from_vnum`, `is_portal` |
| Public API / domain objects | `camelCase` fields | `fromVnum`, `isPortal` |

### TypeScript

- `"strict": true` — no implicit `any`, no skipping nullchecks.
- Never suppress errors with `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Use discriminated unions for event/state systems:
  ```ts
  type ParsedEvent =
    | { kind: "room"; room: ParsedRoom }
    | { kind: "movement"; direction: Direction }
    | { kind: "movement_blocked" }
  ```
- Use `satisfies` in tests for typed literals: `[...events] satisfies ParsedEvent[]`
- Prefer `ReturnType<typeof fn>` / `Awaited<ReturnType<...>>` for derived types.
- Explicit return types on all exported functions.

### Module Architecture — Factory Pattern (no classes)

All stateful modules use a **constructor function** that accepts a `deps` object. No classes, no `new`, no global singletons except at the top of `server.ts`.

```ts
// Define a deps interface
interface FarmControllerDependencies {
  getCurrentRoomId(): number | null;
  sendCommand(command: string): void;
  onLog(message: string): void;
}

// Export a factory function
export function createFarmController(deps: FarmControllerDependencies) {
  // private state here
  return {
    start() { ... },
    stop() { ... },
  };
}
```

New modules must follow this pattern. Inject all side-effectful operations via `deps`.

### Error Handling

```ts
// Always narrow `unknown` errors before accessing .message
void persistData(ws).catch((error: unknown) => {
  logEvent(ws, "error", error instanceof Error ? error.message : "Unknown error");
});

// Config validation throws at startup with a clear message
if (!runtimeConfig.databaseUrl) {
  throw new Error("DATABASE_URL is required. Refusing to start.");
}

// No custom error classes — plain Error objects throughout
```

Never use empty catch blocks. Never swallow errors silently.

### Logging

- No `console.log` / `console.error` anywhere in server code.
- In `server.ts`: log through the private `logEvent(ws, direction, message)` function.
- In sub-modules (farm, survival, triggers, etc.): log through the `onLog: (message: string) => void` dep injected via the `deps` object — it routes to `logEvent` on the caller side.
- Use `Bun.env` (not `process.env`) to access environment variables. All env access is centralized in `src/config.ts`; no other file reads `Bun.env` directly.

### Database (postgres.js)

```ts
// Tagged template literals for all queries — never string concatenation
const rows = await database`
  SELECT * FROM map_edges WHERE from_vnum = ${vnum}
`;

// Schema in initialize() with IF NOT EXISTS guards — no migration framework
await database`
  CREATE TABLE IF NOT EXISTS map_edges (
    from_vnum INT NOT NULL,
    direction TEXT NOT NULL,
    to_vnum INT NOT NULL
  )
`;

// Upsert via ON CONFLICT ... DO UPDATE
await database`
  INSERT INTO map_edges ${database(edge)}
  ON CONFLICT (from_vnum, direction) DO UPDATE SET to_vnum = EXCLUDED.to_vnum
`;
```

Schema changes belong in the `initialize()` function using `IF NOT EXISTS` or inline `DO $$ BEGIN ... END $$` blocks.

### Async Patterns

- `async/await` throughout. No raw Promise chains.
- Fire-and-forget with explicit `.catch`: `void fn().catch((e: unknown) => { ... })`
- Never `await` inside a loop when parallel execution is possible — use `Promise.all`.

---

## Testing

- **Framework**: `bun:test` (Jest-compatible API built into Bun)
- **Location**: Co-located `*.test.ts` files next to the source they test
- **Style**: `describe()` / `test()` / `expect()` — standard Jest API
- No mocking framework needed — constructor injection makes units testable with plain objects
- Tests cover stateful streaming parser, movement tracking, edge inference, portal detection

```ts
import { describe, test, expect } from "bun:test";

describe("parser", () => {
  test("emits room event on room header", () => {
    const parser = createParser();
    const events = parser.feedText("...");
    expect(events).toSatisfy((e) => e.some((x) => x.kind === "room"));
  });
});
```

---

## Environment & Deployment

- Required env vars: see `.env.example`. `DATABASE_URL` is mandatory — the server throws on startup without it.
- Bun reads `.env` automatically in development.
- Docker: `FROM oven/bun:1`; full stack via `deploy/docker-compose.yml` (app + postgres:17 + caddy).
- `public/client.js` is a build artifact — regenerate with `bun run build:client` after editing `src/client.ts`.

---

## MCP / Tooling

`opencode.json` registers two local MCP servers:

### `bylins-wiki` (`.opencode/bin/run-wiki-mcp.sh` → `scripts/wiki-mcp.ts`)
Wiki item lookup tools: `search_items`, `get_item`, `filter_by_affect`, `filter_by_slot`, `search_combined`, `analyze_gear`.

### `bylins-client` (`.opencode/bin/run-client-mcp.sh` → `scripts/client-mcp.ts`)
Live debug tools that connect via WebSocket to the running bylins-bot server at `ws://127.0.0.1:3211/ws` (override with `BYLINS_BOT_URL` env var). The MCP server auto-reconnects every 3s if the bot is down.

Tools: `get_status`, `send_command`, `get_output`, `get_logs`, `toggle_farm`, `get_events`.

**The bylins-bot server runs on the same machine as opencode.** Both MCP servers are always available during AI-assisted development — use `bylins-client` tools to send MUD commands and observe responses when debugging bot features.

Do not modify `opencode.json` without understanding its MCP tool registrations.

To restart opencode (e.g. after adding a new MCP server):
```bash
kill $(pgrep -f "opencode web") && sleep 2 && cd /root/bylins-bot && nohup /root/.opencode/bin/opencode web --hostname 127.0.0.1 --port 4096 > /tmp/opencode.log 2>&1 &
```

---

## Farm Settings — Data Flow

Когда нужно добавить новое поле в настройки фарма, его нужно прописать в **5 местах**:

1. **`src/map/store.ts` — `FarmZoneSettings`**
   Интерфейс "сырых" настроек зоны, хранящихся в PostgreSQL (JSON-колонка).
   Это source of truth для персистенции.

2. **`src/server.ts` — тип `periodicAction?` в `ClientEvent` (union-тип)**
   Опциональные поля входящего WebSocket-события `farm_toggle`.

3. **`src/server.ts` — `normalizeFarmZoneSettings()`**
   Нормализация при чтении из БД и при сохранении через `farm_settings_save`.

4. **`src/server.ts` — обработчик `farm_toggle`**
   Маппинг входящего события → `farmController.updateConfig()`.

5. **`src/farm-script.ts` — `PeriodicActionConfig` + `normalizePeriodicAction()`**
   Внутренний тип контроллера фарма. Если поле относится к периодическому действию — добавить сюда и в нормализацию.

**На стороне браузера (`src/client.ts`):**
- `PeriodicActionConfig` — локальная копия интерфейса (дублирует farm-script)
- `FarmSettings` — плоская структура настроек UI
- `defaultFarmSettings()` / `normalizeFarmSettings()` — дефолты и нормализация при чтении из localStorage
- `fillFarmModal()` — заполнение формы из `FarmSettings`
- `commitFarmSettings()` — сборка `FarmSettings` из DOM-элементов → отправка на сервер
- Каждое поле формы требует `requireElement<T>("#id")` в начале файла

**Цепочка сохранения:**
```
commitFarmSettings() → farm_settings_save → normalizeFarmZoneSettings → mapStore.setFarmSettings
```

**Цепочка применения при старте фарма:**
```
farm_toggle (browser) → updateConfig → normalizePeriodicAction → farmController state
```

**Примечание:** `bun run typecheck` может показывать pre-existing ошибки в `parser.test.ts` и `tracker.test.ts` (про `closedExits`) — они не связаны с настройками фарма и существовали до этого.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bylins-bot** (802 symbols, 2151 relationships, 69 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/bylins-bot/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bylins-bot/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bylins-bot/clusters` | All functional areas |
| `gitnexus://repo/bylins-bot/processes` | All execution flows |
| `gitnexus://repo/bylins-bot/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
