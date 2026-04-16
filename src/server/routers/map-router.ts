// ---------------------------------------------------------------------------
// Map sub-router — owns every event that mutates or queries the map, the
// navigator, or per-room metadata (aliases, auto-commands, zone names).
//
//   - map_reset / map_reset_area    wipe the map or the current zone
//   - map_recording_toggle          pause/resume automapper writes
//   - alias_set / alias_delete      per-room short names for navigation
//   - navigate_to / navigate_stop   start/stop pathfinding
//   - goto_and_run                  navigate then send a burst of commands
//                                   (handles the survival buy_food / fill_flask
//                                   action inline, same as the original)
//   - zone_name_set                 friendly name for a zone id
//   - room_auto_command_set/delete  auto-command scripts keyed by vnum
//   - room_auto_commands_get        snapshot of all auto-commands
// ---------------------------------------------------------------------------
import type { ClientEvent } from "../../events.type.ts";
import type { BunServerWebSocket } from "../constants.ts";
import { normalizeSurvivalSettings } from "../../settings-normalizers.ts";
import { normalizeSurvivalConfig, resolveSurvivalCommands } from "../../survival-script.ts";
import type { ClientMessageRouterDeps, SubRouter } from "./types.ts";

const OWNS = new Set<ClientEvent["type"]>([
  "map_reset",
  "map_reset_area",
  "map_recording_toggle",
  "alias_set",
  "alias_delete",
  "navigate_to",
  "goto_and_run",
  "navigate_stop",
  "zone_name_set",
  "room_auto_command_set",
  "room_auto_command_delete",
  "room_auto_commands_get",
]);

export function createMapRouter(deps: ClientMessageRouterDeps): SubRouter {
  const {
    session,
    mudConnection,
    trackerState,
    mapStore,
    runtimeConfig,
    sendServerEvent,
    broadcastServerEvent,
    logEvent,
    inspectContainer,
    startNavigationToNearest,
    stopNavigation,
    resetMapState,
    broadcastMapSnapshot,
    broadcastAliasesSnapshot,
    broadcastRoomAutoCommandsSnapshot,
  } = deps;

  async function handle(ws: BunServerWebSocket, event: ClientEvent): Promise<void> {
    switch (event.type) {
      case "map_reset":
        logEvent(ws, "browser-in", "map_reset");
        resetMapState();
        await mapStore.reset();
        await broadcastMapSnapshot("map_snapshot");
        break;
      case "map_reset_area": {
        logEvent(ws, "browser-in", "map_reset_area");
        const currentVnum = trackerState.currentRoomId;
        if (currentVnum !== null) {
          const zoneId = Math.floor(currentVnum / 100);
          await mapStore.deleteZone(zoneId);
          trackerState.currentRoomId = null;
          await broadcastMapSnapshot("map_snapshot");
        }
        break;
      }
      case "map_recording_toggle": {
        const next = event.payload?.enabled ?? !deps.getMapRecordingEnabled();
        deps.setMapRecordingEnabled(next);
        logEvent(ws, "browser-in", "map_recording_toggle", { enabled: next });
        broadcastServerEvent({ type: "map_recording_state", payload: { enabled: next } });
        break;
      }
      case "alias_set": {
        const vnum = event.payload?.vnum;
        const alias = event.payload?.alias?.trim();
        if (typeof vnum === "number" && alias) {
          logEvent(ws, "browser-in", "alias_set", { vnum, alias });
          await mapStore.setAlias(vnum, alias);
          await broadcastAliasesSnapshot();
        }
        break;
      }
      case "alias_delete": {
        const vnum = event.payload?.vnum;
        if (typeof vnum === "number") {
          logEvent(ws, "browser-in", "alias_delete", { vnum });
          await mapStore.deleteAlias(vnum);
          await broadcastAliasesSnapshot();
        }
        break;
      }
      case "navigate_to": {
        const vnums = event.payload?.vnums;
        if (Array.isArray(vnums) && vnums.length > 0) {
          logEvent(ws, "browser-in", "navigate_to", { vnums: vnums.join(",") });
          await startNavigationToNearest(ws, vnums);
        }
        break;
      }
      case "goto_and_run": {
        const vnums = event.payload?.vnums;
        const commands = event.payload?.commands;
        if (Array.isArray(vnums) && vnums.length > 0) {
          logEvent(ws, "browser-in", "goto_and_run", {
            vnums: vnums.join(","),
            commands: (commands ?? []).join(";"),
          });
          let resolvedCommands: string[] = Array.isArray(commands) ? commands : [];
          const action = event.payload?.action;
          if (action === "buy_food" || action === "fill_flask") {
            const survival = await mapStore.getSurvivalSettings();
            const ss = normalizeSurvivalSettings(survival ?? {});
            const survivalConfig = normalizeSurvivalConfig({
              enabled: true,
              container: ss.container,
              foodItems: ss.foodItems.split("\n").map((s) => s.trim()).filter(Boolean),
              flaskItems: ss.flaskItems.split("\n").map((s) => s.trim()).filter(Boolean),
              buyFoodItem: ss.buyFoodItem,
              buyFoodMax: ss.buyFoodMax,
              buyFoodAlias: ss.buyFoodAlias,
              fillFlaskAlias: ss.fillFlaskAlias,
              fillFlaskSource: ss.fillFlaskSource,
            });
            const result = await resolveSurvivalCommands(
              action,
              survivalConfig,
              (container) => inspectContainer(ws, container),
            );
            if (result === null) {
              broadcastServerEvent({
                type: "status",
                payload: { state: session.state, message: `[survival] уже достаточно еды` },
              });
              break;
            }
            resolvedCommands = result;
          }
          await startNavigationToNearest(ws, vnums);
          for (const cmd of resolvedCommands) {
            if (session.tcpSocket && session.connected) {
              mudConnection.writeAndLogMudCommand(ws, session.tcpSocket, cmd, "goto_and_run");
              await new Promise<void>((resolve) => setTimeout(resolve, runtimeConfig.commandDelayMs));
            }
          }
        }
        break;
      }
      case "navigate_stop":
        logEvent(ws, "browser-in", "navigate_stop");
        stopNavigation();
        break;
      case "zone_name_set": {
        const { zoneId, name } = event.payload;
        if (name === null || name === "") {
          await mapStore.deleteZoneName(zoneId);
          logEvent(ws, "browser-in", "zone_name_delete", { zoneId });
        } else {
          await mapStore.setZoneName(zoneId, name);
          logEvent(ws, "browser-in", "zone_name_set", { zoneId, name });
        }
        break;
      }
      case "room_auto_command_set": {
        const vnum = event.payload?.vnum;
        const command = event.payload?.command?.trim();
        if (typeof vnum === "number" && command) {
          logEvent(ws, "browser-in", "room_auto_command_set", { vnum, command });
          await mapStore.setRoomAutoCommand(vnum, command);
          await broadcastRoomAutoCommandsSnapshot();
        }
        break;
      }
      case "room_auto_command_delete": {
        const vnum = event.payload?.vnum;
        if (typeof vnum === "number") {
          logEvent(ws, "browser-in", "room_auto_command_delete", { vnum });
          await mapStore.deleteRoomAutoCommand(vnum);
          await broadcastRoomAutoCommandsSnapshot();
        }
        break;
      }
      case "room_auto_commands_get": {
        logEvent(ws, "browser-in", "room_auto_commands_get");
        const entries = await mapStore.getRoomAutoCommands();
        sendServerEvent(ws, { type: "room_auto_commands_snapshot", payload: { entries } });
        break;
      }
    }
  }

  return { owns: OWNS, handle };
}
