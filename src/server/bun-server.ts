// ---------------------------------------------------------------------------
// Bun.serve wrapper — wires the HTTP fetch handler + WebSocket lifecycle
// into a single Bun.Server. Pulled out of server.ts so the entrypoint
// doesn't have the full Bun.serve config block inline.
//
// Two things happen here:
//   1. HTTP fetch: /ws upgrade is handled inline; everything else goes to
//      httpRoutes (static files + /api/*).
//   2. WebSocket lifecycle: open registers the client + pushes initial
//      state; message parses the JSON envelope and forwards to the
//      router; close removes the client.
// ---------------------------------------------------------------------------
import type { BunServerWebSocket } from "./constants.ts";
import type { HttpRoutes } from "./http-routes.ts";
import type { InitialStateSender } from "./initial-state.ts";
import type { ClientMessageRouter } from "./client-message-router.ts";
import type { LogEventFn } from "./logging.ts";
import type { ClientEvent, ServerEvent, WsData } from "../events.type.ts";

export interface BunServerDeps {
  runtimeConfig: typeof import("../config.ts").runtimeConfig;
  logEvent: LogEventFn;
  httpRoutes: HttpRoutes;
  initialStateSender: InitialStateSender;
  clientMessageRouter: ClientMessageRouter;
  /** Shared set of connected browser clients; mutated on open/close. */
  browserClients: Set<BunServerWebSocket>;
  sendServerEvent: (ws: BunServerWebSocket, event: ServerEvent) => void;
  /** Decodes ArrayBuffer → string for incoming WS messages. */
  normalizeTextMessage: (message: string | Buffer) => string;
}

/** Spins up Bun.serve and returns the server instance. */
export function createBunServer(deps: BunServerDeps): Bun.Server<WsData> {
  const {
    runtimeConfig,
    logEvent,
    httpRoutes,
    initialStateSender,
    clientMessageRouter,
    browserClients,
    sendServerEvent,
    normalizeTextMessage,
  } = deps;

  return Bun.serve({
    hostname: runtimeConfig.host,
    port: runtimeConfig.port,
    async fetch(req, serverInstance) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        logEvent(null, "session", "WebSocket upgrade requested.", { path: url.pathname });
        const upgraded = serverInstance.upgrade(req, {
          data: { sessionId: crypto.randomUUID() } satisfies WsData,
        });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade failed.", { status: 500 });
      }

      return await httpRoutes.handle(url);
    },
    websocket: {
      data: {} as WsData,
      open(ws) {
        browserClients.add(ws);
        logEvent(ws, "session", "Browser WebSocket opened.");
        initialStateSender.sendBrowserOpenSnapshot(ws);
      },
      async message(ws, message) {
        let event: ClientEvent;
        try {
          event = JSON.parse(normalizeTextMessage(message)) as ClientEvent;
        } catch {
          logEvent(ws, "error", "Invalid browser message payload.");
          sendServerEvent(ws, { type: "error", payload: { message: "Invalid message payload." } });
          return;
        }
        await clientMessageRouter.handleMessage(ws, event);
      },
      close(ws) {
        logEvent(ws, "session", "Browser WebSocket closed.");
        browserClients.delete(ws);
      },
    },
  });
}
