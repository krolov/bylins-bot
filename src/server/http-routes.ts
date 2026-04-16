// ---------------------------------------------------------------------------
// HTTP fetch handler — handles everything except the /ws WebSocket upgrade.
//
// Routes:
//   GET  /api/config          — runtime defaults (host/port/commands)
//   GET  /api/profiles        — available profile list
//   GET  /api/map/snapshot    — current map snapshot JSON
//   GET  /*                   — static files from ../public
//
// The /ws upgrade stays in server.ts because Bun.serve requires the
// server instance for `.upgrade(req, ...)`. Everything else is pure.
// ---------------------------------------------------------------------------
import type { RuntimeConfig } from "../config.ts";
import type { MapSnapshot } from "../events.type.ts";

export interface HttpRoutesDeps {
  runtimeConfig: RuntimeConfig;
  /** Resolves the current map snapshot for /api/map/snapshot. */
  getCurrentMapSnapshot: () => Promise<MapSnapshot>;
}

export interface HttpRoutes {
  /** Resolves the `Response` for any HTTP request (non-WebSocket). */
  handle: (url: URL) => Promise<Response>;
}

export function createHttpRoutes(deps: HttpRoutesDeps): HttpRoutes {
  function jsonResponse(data: unknown): Response {
    return new Response(JSON.stringify(data), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  function getStaticFile(pathname: string): Bun.BunFile {
    const safePath = pathname === "/" ? "/index.html" : pathname;
    return Bun.file(new URL(`../../public${safePath}`, import.meta.url));
  }

  async function handle(url: URL): Promise<Response> {
    if (url.pathname === "/api/config") {
      return jsonResponse({
        autoConnect: deps.runtimeConfig.autoConnect,
        host: deps.runtimeConfig.mudHost,
        port: deps.runtimeConfig.mudPort,
        tls: deps.runtimeConfig.mudTls,
        startupCommands: deps.runtimeConfig.startupCommands,
        commandDelayMs: deps.runtimeConfig.commandDelayMs,
      });
    }

    if (url.pathname === "/api/profiles") {
      return jsonResponse({
        profiles: deps.runtimeConfig.profiles.map((p) => ({ id: p.id, name: p.name })),
        defaultProfileId: deps.runtimeConfig.defaultProfileId,
      });
    }

    if (url.pathname === "/api/map/snapshot") {
      return jsonResponse(await deps.getCurrentMapSnapshot());
    }

    if (url.pathname.includes("..")) {
      return new Response("Invalid path.", { status: 400 });
    }

    const file = getStaticFile(url.pathname);
    const exists = await file.exists();
    if (!exists) {
      return new Response("Not found.", { status: 404 });
    }
    const response = new Response(file);
    response.headers.set("cache-control", "no-store");
    return response;
  }

  return { handle };
}
