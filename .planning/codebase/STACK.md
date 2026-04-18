# Technology Stack

**Analysis Date:** 2026-04-18

## Languages

**Primary:**
- TypeScript 5.9.x - All server (`src/**/*.ts`), client (`src/client/**/*.ts`), and scripts (`scripts/**/*.ts`). Uses `ESNext` target with `strict` mode and `verbatimModuleSyntax`. Configured via `tsconfig.json`.

**Secondary:**
- CSS - Browser UI styles at `public/styles.css` (minified to `public/styles.min.css` by `scripts/build-client.ts`).
- HTML - Single-page UI shell at `public/index.html`.
- Shell - Deploy helpers under `.opencode/bin/run-*.sh` for launching MCP servers.

## Runtime

**Environment:**
- Bun (single runtime — used both as server and as test runner). Docker image `oven/bun:1` (see `Dockerfile`).
- Uses Bun-specific APIs: `Bun.serve`, `Bun.connect`, `Bun.sleep`, `Bun.build`, `Bun.file`, `Bun.env`, `Bun.ServerWebSocket`.
- Browser runtime for the client bundle (`public/client.js`, built from `src/client/main.ts` via `Bun.build` with `target: "browser"`).

**Package Manager:**
- Bun (lockfile `bun.lock` in repo root, lockfileVersion 1).
- `npm` is NOT used; scripts invoke `bun run ...`.
- Package name in `package.json`: `sc-kerat-mud-client` (project root `package.json` marked `"private": true`).

## Frameworks

**Core:**
- No web framework — raw `Bun.serve({ fetch, websocket })` in `src/server.ts` with manual HTTP routing (`/ws`, `/api/config`, `/api/profiles`, `/api/map/snapshot`, static file serving from `public/`).
- Raw TCP client via `Bun.connect()` in `src/mud-connection.ts` speaks Telnet (`IAC/DO/DONT/WILL/WONT/SB/SE` state machine).
- Raw browser `WebSocket` in `src/client/net.ts` with reconnect backoff and pending-queue.

**Testing:**
- `bun:test` — Bun's built-in test runner (`describe`, `test`, `expect` from `bun:test`).
- Test files live next to source: `src/map/parser.test.ts`, `src/map/tracker.test.ts`.
- Run via `bun test` (see `package.json` scripts).

**Build/Dev:**
- `Bun.build` (inside `scripts/build-client.ts`) — bundles `src/client/main.ts` into `public/client.js` as ESM with code-splitting (`splitting: true`), minification, external sourcemaps, `chunk-*.js` outputs.
- `scripts/build-client.ts` also post-processes `public/index.html` to insert `<link rel="modulepreload">` tags for eager chunks, between `<!-- chunk-preload:start --> / <!-- chunk-preload:end -->` markers.
- CSS bundling: `Bun.build` minifies `public/styles.css` → `public/styles.min.css`.
- Typecheck: `tsc --noEmit` (script: `bun run typecheck`).
- Dev mode: `bun --watch src/server.ts` (script: `bun run dev`).
- PM2 process manager for production runtime (`ecosystem.config.cjs`, app name `bylins-bot`).

## Key Dependencies

**Critical (runtime — declared in `package.json` `dependencies`):**
- `@modelcontextprotocol/sdk` ^1.27.1 — Used in `scripts/wiki-mcp.ts` and `scripts/client-mcp.ts` to expose MCP tool servers (`McpServer`, `StdioServerTransport` from `@modelcontextprotocol/sdk/server/mcp.js` / `stdio.js`). Also declared peer-style in `devDependencies` pipeline.
- `postgres` ^3.4.7 — PostgreSQL client. Used via `postgres("postgres://...")` in `src/db.ts` (exports `sql`), `scripts/wiki-mcp.ts`, `scripts/tsp-route.ts`, `scripts/debug-zone-map.ts`, `scripts/client-mcp.ts`. All DDL uses tagged templates (`sql\`CREATE TABLE ...\``).
- `zod` ^4.3.6 — Runtime validation and MCP tool input schemas (`scripts/wiki-mcp.ts`, `scripts/client-mcp.ts`, `scripts/tsp-route.ts`, `scripts/debug-zone-map.ts`).
- `cytoscape` ^3.33.1 — Graph library. Used for the global map modal in the browser client (see `src/client/modals/global-map.ts` and `src/client/map-grid.ts` with SVG fallbacks).

**Infrastructure / Dev dependencies:**
- `@ladybugdb/core` ^0.15.2 — Embedded vector/graph database used through the GitNexus analysis pipeline (pulled in transitively).
- `gitnexus` ^1.4.9 — Code-intelligence indexer (CLI `npx gitnexus analyze` / `gitnexus mcp`). Configured as local MCP server in `opencode.json`.
- `bun-types` latest — Type definitions for the Bun runtime (listed in `tsconfig.json` `types: ["bun-types"]`).
- `typescript` ^5.9.2 — Typechecker (emits nothing; `noEmit: true`).

**Trusted dependencies (native post-install allowed — see `package.json` `trustedDependencies`):**
- `onnxruntime-node`, `protobufjs`, multiple `tree-sitter-*` grammars (c, c-sharp, cpp, dart, go, java, javascript, php, python, ruby, rust, swift) — all transitive through `gitnexus`/`@ladybugdb/core`, not used directly by the bot.

## Configuration

**Environment:**
- Loaded via `Bun.env[...]` in `src/config.ts` (`readString`, `readNumber`, `readBoolean` helpers).
- `.env` file present at repo root (contents NOT read; secrets). `.env.example` documents all variables.
- Strict fail-fast: `src/config.ts` throws on boot if `DATABASE_URL` is unset ("Refusing to start without persistent automapper storage").

**Key runtime env vars (from `src/config.ts`, `.env.example`, `ecosystem.config.cjs`):**
- `HOST` (default `0.0.0.0`), `PORT` (default `3000`; PM2 overrides to `3211`).
- `MUD_AUTO_CONNECT`, `MUD_HOST` (default `bylins.su`), `MUD_PORT` (default `7000`), `MUD_TLS`, `MUD_STARTUP_COMMANDS` (split by `;;` or newlines), `MUD_COMMAND_DELAY_MS`, `MUD_LINE_ENDING` (`crlf`/`lf`).
- `DATABASE_URL` — REQUIRED, PostgreSQL DSN.
- `WIKI_PROXIES` — comma-separated `host:port:user:pass` entries; converted to `http://user:pass@host:port` in `src/config.ts` and `src/wiki.ts`.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — for `src/bazaar-notifier.ts`.
- `DOMAIN`, `BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD_HASH` — Caddy reverse proxy only (not read by the app).
- `BYLINS_BOT_URL` (MCP script only, default `ws://127.0.0.1:3211/ws`) — used by `scripts/client-mcp.ts`.

**Build:**
- `tsconfig.json` — strict TS, `module: ESNext`, `moduleResolution: Bundler`, `allowImportingTsExtensions: true` (imports use `.ts` suffix throughout).
- `scripts/build-client.ts` — client bundler entrypoint.
- `package.json` scripts: `dev`, `start`, `build:client`, `typecheck`, `build`, `test`, `smoke`, `gear`.

## Platform Requirements

**Development:**
- Bun 1.x runtime.
- Local PostgreSQL reachable at `DATABASE_URL` (default in `.env.example`: `postgres://bylins:bylins@localhost:5432/bylins_bot`).
- Outbound TCP to the MUD host (`bylins.su:7000` by default).
- Outbound HTTPS to `wiki.bylins.su` and (optional) `api.telegram.org`.

**Production:**
- Docker Compose stack at `deploy/docker-compose.yml`:
  - `app` — Bun app container built from `Dockerfile` (`FROM oven/bun:1`), exposes port 3000 internally.
  - `postgres` — image `postgres:17-alpine`, volume `pgdata`.
  - `caddy` — image `caddy:2.10-alpine`, ports 80/443, Basic Auth via `BASIC_AUTH_PASSWORD_HASH`, config in `deploy/Caddyfile`.
- Alternative: direct PM2 runtime on a host machine via `ecosystem.config.cjs` (name `bylins-bot`, script `/root/.bun/bin/bun`, `autorestart: true`, `max_restarts: 10`).
- No build step runs in production beyond `bun run build:client` triggered by `start` script and by the Dockerfile.

---

*Stack analysis: 2026-04-18*
