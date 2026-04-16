// ---------------------------------------------------------------------------
// Automation sub-router — owns every event that toggles or tunes one of the
// background controllers (farm, survival, triggers, gather, repair) plus
// the one-shot "attack nearest" and farm-per-zone settings.
//
//   - farm2_toggle / attack_nearest       farm loop on/off + single attack
//   - zone_script_toggle / farming_toggle zone-script on/off (two aliases)
//   - farm_settings_get / farm_settings_save
//   - survival_settings_get / survival_settings_save
//   - triggers_toggle
//   - gather_toggle / gather_sell_bag
//   - repair_start
// ---------------------------------------------------------------------------
import type { ClientEvent } from "../../events.type.ts";
import type { BunServerWebSocket } from "../constants.ts";
import { normalizeFarmZoneSettings, normalizeSurvivalSettings } from "../../settings-normalizers.ts";
import { survivalSettingsToConfig } from "../../survival-script.ts";
import type { ClientMessageRouterDeps, SubRouter } from "./types.ts";

const OWNS = new Set<ClientEvent["type"]>([
  "farm2_toggle",
  "attack_nearest",
  "zone_script_toggle",
  "farming_toggle",
  "farm_settings_get",
  "farm_settings_save",
  "survival_settings_get",
  "survival_settings_save",
  "triggers_toggle",
  "gather_toggle",
  "gather_sell_bag",
  "repair_start",
]);

export function createAutomationRouter(deps: ClientMessageRouterDeps): SubRouter {
  const {
    session,
    mudConnection,
    farmController,
    triggers,
    survivalController,
    gatherController,
    repairController,
    trackerState,
    mapStore,
    sendServerEvent,
    broadcastServerEvent,
    logEvent,
    sendSurvivalSettings,
  } = deps;

  async function handle(ws: BunServerWebSocket, event: ClientEvent): Promise<void> {
    switch (event.type) {
      case "farm2_toggle": {
        const enabled = event.payload?.enabled === true;
        logEvent(ws, "browser-in", "farm2_toggle", { enabled });
        farmController.setLoopEnabled(enabled);
        break;
      }
      case "attack_nearest": {
        logEvent(ws, "browser-in", "attack_nearest");
        const currentRoomId = trackerState.currentRoomId;
        if (currentRoomId !== null && session.tcpSocket && session.connected) {
          const target = await farmController.resolveAttackTarget(currentRoomId);
          if (target !== null) {
            mudConnection.writeAndLogMudCommand(ws, session.tcpSocket, "спрят", "attack-nearest");
            mudConnection.writeAndLogMudCommand(ws, session.tcpSocket, `закол ${target}`, "attack-nearest");
          }
        }
        break;
      }
      case "zone_script_toggle": {
        const enabled = event.payload?.enabled === true;
        const zoneId = typeof event.payload?.zoneId === "number" ? event.payload.zoneId : undefined;
        logEvent(ws, "browser-in", "zone_script_toggle", { enabled, zoneId });
        farmController.setScriptEnabled(enabled, zoneId);
        break;
      }
      case "farming_toggle": {
        const enabled = event.payload?.enabled === true;
        const zoneId = typeof event.payload?.zoneId === "number" ? event.payload.zoneId : 280;
        logEvent(ws, "browser-in", "farming_toggle", { enabled, zoneId });
        farmController.setScriptEnabled(enabled, zoneId);
        break;
      }
      case "farm_settings_get": {
        const zoneId = event.payload?.zoneId;
        if (typeof zoneId === "number") {
          logEvent(ws, "browser-in", "farm_settings_get", { zoneId });
          const settings = await mapStore.getFarmSettings(deps.getActiveProfileId(), zoneId);
          sendServerEvent(ws, { type: "farm_settings_data", payload: { zoneId, settings } });
        }
        break;
      }
      case "farm_settings_save": {
        const zoneId = event.payload?.zoneId;
        const raw = event.payload?.settings;
        if (typeof zoneId === "number" && raw) {
          const settings = normalizeFarmZoneSettings(raw);
          logEvent(ws, "browser-in", "farm_settings_save", { zoneId });
          await mapStore.setFarmSettings(deps.getActiveProfileId(), zoneId, settings);
        }
        break;
      }
      case "survival_settings_get":
        logEvent(ws, "browser-in", "survival_settings_get");
        await sendSurvivalSettings(ws);
        break;
      case "survival_settings_save": {
        const raw = event.payload;
        if (raw) {
          const settings = normalizeSurvivalSettings(raw);
          logEvent(ws, "browser-in", "survival_settings_save");
          await mapStore.setSurvivalSettings(settings);
          survivalController.updateConfig(survivalSettingsToConfig(settings));
        }
        break;
      }
      case "triggers_toggle":
        triggers.setEnabled(event.payload ?? {});
        void mapStore
          .setTriggerSettings(deps.getActiveProfileId(), triggers.getState())
          .catch((error: unknown) => {
            logEvent(
              ws,
              "error",
              error instanceof Error ? error.message : "Unknown error saving trigger settings",
            );
          });
        break;
      case "gather_toggle": {
        const newEnabled =
          typeof event.payload?.enabled === "boolean"
            ? event.payload.enabled
            : !gatherController.getState().enabled;
        gatherController.setEnabled(newEnabled);
        logEvent(ws, "browser-in", `gather_toggle enabled=${String(newEnabled)}`);
        broadcastServerEvent({ type: "gather_state", payload: gatherController.getState() });
        break;
      }
      case "gather_sell_bag": {
        logEvent(ws, "browser-in", "gather_sell_bag");
        const { bag } = gatherController.getState();
        if (session.tcpSocket && session.connected) {
          mudConnection.writeAndLogMudCommand(null, session.tcpSocket, `выставить все ${bag}`, "gather-script");
        }
        break;
      }
      case "repair_start":
        logEvent(ws, "browser-in", "repair_start");
        void repairController.run();
        break;
    }
  }

  return { owns: OWNS, handle };
}
