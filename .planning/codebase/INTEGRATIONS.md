# External Integrations

**Analysis Date:** 2026-04-18

## APIs & External Services

**MUD Game Server (primary integration):**
- `bylins.su:7000` (default, configurable via `MUD_HOST`/`MUD_PORT`) — Russian-language text MUD.
- Transport: raw TCP (optionally TLS if `MUD_TLS=true`). Established via `Bun.connect({ hostname, port, tls, socket: { ... } })` in `src/mud-connection.ts`.
- Protocol: Telnet with custom IAC state machine (`src/mud-connection.ts` constants `IAC=255`, `DONT=254`, `DO=253`, `WONT=252`, `WILL=251`, `SB=250`, `SE=240`). The bot auto-responds `WONT`/`DONT` to every negotiation in `respondToTelnetNegotiation()`.
- Line ending: `\r\n` or `\n` based on `MUD_LINE_ENDING`.
- Keepalive: empty command every 30s (`KEEPALIVE_INTERVAL_MS = 30_000`).
- Auto-reconnect backoff: `[5s, 10s, 20s, 30s, 60s]` then 60s retry interval (`RECONNECT_DELAYS_MS` in `src/mud-connection.ts`).
- Startup commands are profile-specific (menu navigation + login + password); see `src/profiles.ts` and `src/startup-script.ts`.
- Auth: credentials are the startup commands themselves (the MUD is the "identity provider").

**bylins.su wiki (item database scraping):**
- Base URL: `https://wiki.bylins.su/stuff.php` (constants in `src/wiki.ts` and `scripts/wiki-mcp.ts`, `scripts/gear-advisor.ts`).
- Access: HTTP GET with query params `q=<query>` (search) and `id=<number>` (item card) — documented in `docs/wiki-stuff-api.md`.
- Client: built-in `fetch()` with `User-Agent: "bylins-bot/1.0 wiki"`. Responses are HTML and parsed by `stripHtml()` in `src/wiki.ts`.
- Optional HTTP proxy rotation: `WIKI_PROXIES` env var → parsed by `loadProxies()` in `src/wiki.ts` and `createProxyPicker()` (round-robin). Per-request `proxy` option is passed to `fetch()` (Bun-specific).
- Caching: `scripts/wiki-mcp.ts` persists raw HTML in `scripts/wiki-mcp-cache.json` (2.8 MB, gitignored). Runtime cache also persists through the `game_items` Postgres table.
- Auth: none (public wiki).

**Telegram Bot API (outbound notifications):**
- URL: `https://api.telegram.org/bot${telegramBotToken}/sendMessage` (see `src/bazaar-notifier.ts:72`).
- Method: `POST` with `Content-Type: application/json`, body `{ chat_id, text, parse_mode: "HTML" }`.
- Credentials: `TELEGRAM_BOT_TOKEN` (from @BotFather) and `TELEGRAM_CHAT_ID` (from @userinfobot). Empty strings disable notifications silently.
- Use cases: watched bazaar items (e.g. "танцующей тени" set), auction lots/bids, double-XP bonus announcements, bonus time remaining, bonus ended. Also emits a message when automation triggers `bazaar_buy`.

**Model Context Protocol (MCP) local servers:**
- Two local MCP servers defined in `opencode.json`:
  - `bylins-wiki` → `bash .opencode/bin/run-wiki-mcp.sh` wraps `scripts/wiki-mcp.ts` (provides wiki lookup/search tools over the item DB).
  - `bylins-client` → `bash .opencode/bin/run-client-mcp.sh` wraps `scripts/client-mcp.ts` (connects to the running bot via `ws://127.0.0.1:3211/ws` as a monitoring client).
- Third MCP server (not project-owned): `gitnexus` CLI MCP binary at `/root/.local/share/gitnexus-mcp/node_modules/.bin/gitnexus mcp`.
- Transport: stdio (`StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`).
- Input validation: `zod` schemas on every MCP tool.

## Data Storage

**Databases:**
- **PostgreSQL** (required, fail-fast if absent).
  - Connection string env var: `DATABASE_URL` (default in `.env.example`: `postgres://bylins:bylins@localhost:5432/bylins_bot`).
  - Client: `postgres` npm package (tagged-template interface). Instantiated once in `src/db.ts` as `export const sql = postgres(runtimeConfig.databaseUrl)`.
  - Production container: `postgres:17-alpine` (`deploy/docker-compose.yml`).
  - DDL is bootstrapped at app start by `createMapStore(database).initialize()` in `src/map/store.ts`. Tables (auto-created on boot):
    - `map_rooms` — `vnum PK`, `name`, `exits TEXT[]`, `closed_exits TEXT[]`, `visited`, `first_seen`, `last_seen`.
    - `zone_names` — `zone_id PK`, `name`.
    - `farm_zone_settings` — `(profile_id, zone_id) PK`, `settings JSONB`, `updated_at`.
    - `zone_script_settings` — `id PK` (default `'global'`), `settings JSONB`, `updated_at`.
    - `chat_messages` — `id BIGSERIAL PK`, `text`, `ts BIGINT`, `created_at`.
    - `game_items` — `name PK`, `item_type`, `data JSONB`, `has_wiki_data`, `has_game_data`, `first_seen`, `last_seen`. Schema is upgraded via idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...` statements.
    - `market_sales` — `id BIGSERIAL PK`, `source`, `lot_number`, `item_name`, `price`, `is_ours`, `sold_at`.
  - Migration strategy: `CREATE TABLE IF NOT EXISTS ...` + guarded `ALTER` blocks only; no migration framework.
  - Pooling: default (`postgres()` without options in `src/db.ts`). Scripts that run alongside use `{ max: 2 }` (see `scripts/wiki-mcp.ts`).

**File Storage:**
- Local filesystem only. Specifically:
  - `scripts/wiki-mcp-cache.json` — persistent HTML cache for wiki responses (2.8 MB, gitignored).
  - Log file writes via `appendFileSync` in `src/server.ts` (`node:fs`).
- No S3 / object storage integration.

**Caching:**
- No Redis/Memcached.
- In-memory buffers in `src/server.ts` (`recentOutputChunks`, `browserClients` Set).
- In-memory map state in `src/map/memory-store.ts` (synced to Postgres).
- JSON file cache for wiki (`scripts/wiki-mcp-cache.json`).

## Authentication & Identity

**App Authentication (browser UI):**
- **HTTP Basic Auth** enforced exclusively at the Caddy reverse-proxy layer (`deploy/Caddyfile`). The Bun app has NO auth logic.
- Credentials: `BASIC_AUTH_USERNAME` + `BASIC_AUTH_PASSWORD_HASH` (bcrypt hash generated via `caddy hash-password --plaintext '...'`).
- TLS termination: Caddy automatically provisions HTTPS for `DOMAIN` (via Let's Encrypt, built into Caddy 2).
- When bypassing Caddy (e.g., direct `localhost:3000` in dev), the app is fully open.

**MUD Authentication:**
- Character login via `startupCommands` in each profile (`src/profiles.ts`): `["5", "<char_name>", "<password>", ""]`. Password currently `respect1` for all profiles (hard-coded). Sent as plain text over the Telnet TCP link.

**No External Auth Provider:** No OAuth, no Supabase, no Auth0, no Clerk, no JWT. The browser `WebSocket` at `/ws` is unauthenticated at the app layer.

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry, Datadog, Bugsnag, or equivalent.

**Logs:**
- Custom event logger `logEvent(ws, direction, message, details)` in `src/server.ts`. Directions: `session`, `mud-in`, `mud-out`, `browser-in`, `browser-out`, `error`.
- Logs are appended to a file on disk via `appendFileSync` (`node:fs`) and broadcast to connected WebSocket clients as `ServerEvent`.
- `console.log`/`console.error` used in the build script (`scripts/build-client.ts`) and smoke test (`scripts/smoke-test.ts`).
- PM2 handles process-level stdout/stderr capture in production (`ecosystem.config.cjs`, `max_restarts: 10`, `min_uptime: "5s"`).

**Health Checks:**
- PostgreSQL container has a `pg_isready` healthcheck (`deploy/docker-compose.yml`). No HTTP healthcheck endpoint on the app.

## CI/CD & Deployment

**Hosting:**
- Single-server deployment at `sc.kerat.ru` (see `README.md` and `deploy/`). DNS is expected to point directly at the host.
- Docker Compose (`deploy/docker-compose.yml`) orchestrates `app` + `postgres` + `caddy` containers.
- Alternative: direct-host PM2 (`ecosystem.config.cjs`) managing `bylins-bot` process.

**CI Pipeline:**
- None detected. No `.github/workflows/`, no `.gitlab-ci.yml`, no CircleCI / Travis configs.

**Build artifacts:**
- `public/client.js`, `public/client.js.map`, `public/chunk-*.js`, `public/styles.min.css` — all gitignored, rebuilt on each `bun run start` or Docker image build.

## Environment Configuration

**Required env vars (app won't start without them):**
- `DATABASE_URL` — hard fail in `src/config.ts:109` if empty.

**Important env vars with defaults:**
- `HOST=0.0.0.0`, `PORT=3000` (PM2 overrides to `3211`).
- `MUD_HOST=bylins.su`, `MUD_PORT=7000`, `MUD_TLS=false`, `MUD_AUTO_CONNECT=true`.
- `MUD_STARTUP_COMMANDS=5;;воинмир;;respect1`, `MUD_COMMAND_DELAY_MS=150`, `MUD_LINE_ENDING=crlf`.

**Optional env vars:**
- `WIKI_PROXIES` — proxy list for wiki.bylins.su fetches.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — disables notifier when empty.
- `DOMAIN`, `BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD_HASH` — consumed by Caddy only.
- `BYLINS_BOT_URL` — MCP-client-only, default `ws://127.0.0.1:3211/ws`.

**Secrets location:**
- `.env` (gitignored) for local and PM2 environments.
- `ecosystem.config.cjs` currently inlines most env vars including a placeholder `BASIC_AUTH_PASSWORD_HASH=$2a$14$replace_me_with_a_real_hash` — real secrets expected to be set outside the repo.
- No dedicated secret manager (no Vault, no AWS Secrets Manager, no Doppler).

## Webhooks & Callbacks

**Incoming:**
- None. No webhook endpoints defined in `src/server.ts`. The only HTTP routes are: `/ws` (WebSocket upgrade), `/api/config` (GET), `/api/profiles` (GET), `/api/map/snapshot` (GET), and static file serving from `public/`.

**Outgoing:**
- `POST https://api.telegram.org/bot<TOKEN>/sendMessage` — one-way fire-and-forget notifications (`src/bazaar-notifier.ts`).
- `GET https://wiki.bylins.su/stuff.php?...` — wiki scraping (`src/wiki.ts`, `scripts/wiki-mcp.ts`, `scripts/gear-advisor.ts`).

## Internal Communication

**Browser ↔ Server:**
- Single WebSocket at `/ws` defined in `src/server.ts:1359` (`Bun.serve` with `websocket` handler). Session ID per connection: `crypto.randomUUID()`.
- Client-side `WebSocket` wrapper with reconnect + pending-queue in `src/client/net.ts`.
- Message contracts: `ClientEvent` / `ServerEvent` discriminated unions in `src/events.type.ts`.

**Server ↔ MUD:**
- Single persistent TCP connection per app instance (one `Session` held in `createMudConnection()` closure in `src/mud-connection.ts`). All browser clients share this session.

---

*Integration audit: 2026-04-18*
