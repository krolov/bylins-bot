// ---------------------------------------------------------------------------
// Session sub-router — owns 4 events that open/close or toggle the MUD
// session itself.
//
//   - connect          open the TCP session for the given profile
//   - send             forward a free-form command to the MUD
//   - disconnect       tear the session down
//   - debug_log_toggle toggle mud-in/mud-out logging to debug.log
// ---------------------------------------------------------------------------
import type { ClientEvent } from "../../events.type.ts";
import type { BunServerWebSocket } from "../constants.ts";
import type { ClientMessageRouterDeps, SubRouter } from "./types.ts";

const OWNS = new Set<ClientEvent["type"]>([
  "connect",
  "send",
  "disconnect",
  "debug_log_toggle",
]);

export function createSessionRouter(deps: ClientMessageRouterDeps): SubRouter {
  const {
    mudConnection,
    mapStore,
    triggers,
    logEvent,
    sanitizeLogText,
    handleSendCommand,
    broadcastServerEvent,
  } = deps;

  async function handle(ws: BunServerWebSocket, event: ClientEvent): Promise<void> {
    switch (event.type) {
      case "connect":
        logEvent(ws, "browser-in", "connect");
        if (event.payload?.profileId) {
          deps.setActiveProfileId(event.payload.profileId);
        }
        await mudConnection.connectToMud(ws, event.payload);
        void mapStore.getTriggerSettings(deps.getActiveProfileId()).then((saved) => {
          if (saved) triggers.setEnabled(saved);
        }).catch((error: unknown) => {
          logEvent(
            ws,
            "error",
            error instanceof Error ? error.message : "Unknown error loading trigger settings",
          );
        });
        break;
      case "send":
        logEvent(ws, "browser-in", sanitizeLogText(event.payload?.command?.trim() || ""), {
          type: "send",
        });
        handleSendCommand(ws, event.payload?.command);
        break;
      case "disconnect":
        logEvent(ws, "browser-in", "disconnect");
        mudConnection.teardownSession(ws, "Disconnected by user.");
        break;
      case "debug_log_toggle": {
        const next = event.payload?.enabled ?? !deps.getDebugLogEnabled();
        deps.setDebugLogEnabled(next);
        logEvent(ws, "browser-in", "debug_log_toggle", { enabled: next });
        broadcastServerEvent({ type: "debug_log_state", payload: { enabled: next } });
        break;
      }
    }
  }

  return { owns: OWNS, handle };
}
