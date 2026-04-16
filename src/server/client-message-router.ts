// ---------------------------------------------------------------------------
// Client message router — dispatches each ClientEvent received over the
// browser WebSocket to the sub-router that owns its event type. Each
// sub-router lives under src/server/routers/ and handles a small, related
// group of events:
//
//   - session-router      connect / send / disconnect / debug_log_toggle
//   - map-router          map, aliases, navigation, room auto-commands
//   - automation-router   farm, survival, triggers, gather, repair
//   - inventory-router    inspect / equip / auto-sort / bazaar price
//   - tools-router        item db, wiki, route finder, compare scan
//
// This file itself now contains only the dispatcher and the public type
// exports; every case body has moved to its sub-router.
// ---------------------------------------------------------------------------
import type { ClientEvent } from "../events.type.ts";
import type { BunServerWebSocket } from "./constants.ts";
import { createSessionRouter } from "./routers/session-router.ts";
import { createMapRouter } from "./routers/map-router.ts";
import { createAutomationRouter } from "./routers/automation-router.ts";
import { createInventoryRouter } from "./routers/inventory-router.ts";
import { createToolsRouter } from "./routers/tools-router.ts";
import type { ClientMessageRouterDeps, SubRouter } from "./routers/types.ts";

// Re-export public types so server.ts (and anything else wiring the router)
// can keep importing them from this module.
export type { ClientMessageRouterDeps } from "./routers/types.ts";

export interface ClientMessageRouter {
  handleMessage: (ws: BunServerWebSocket, event: ClientEvent) => Promise<void>;
}

export function createClientMessageRouter(
  deps: ClientMessageRouterDeps,
): ClientMessageRouter {
  const subRouters: SubRouter[] = [
    createSessionRouter(deps),
    createMapRouter(deps),
    createAutomationRouter(deps),
    createInventoryRouter(deps),
    createToolsRouter(deps),
  ];

  async function handleMessage(
    ws: BunServerWebSocket,
    event: ClientEvent,
  ): Promise<void> {
    for (const sub of subRouters) {
      if (sub.owns.has(event.type)) {
        await sub.handle(ws, event);
        return;
      }
    }
  }

  return { handleMessage };
}
