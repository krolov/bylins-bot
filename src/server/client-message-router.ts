// ---------------------------------------------------------------------------
// Client message router — the single big switch that dispatches every
// ClientEvent received over the browser WebSocket. Previously this lived
// inline inside server.ts `websocket.message(ws, message)`.
//
// Each case still does exactly what it did before; nothing is consolidated
// or refactored. This is purely a code-organization move so server.ts can
// stay focused on wiring and top-level orchestration.
//
// The router reads/writes three pieces of mutable top-level state via
// getter/setter pairs: activeProfileId, debugLogEnabled, mapRecordingEnabled.
// ---------------------------------------------------------------------------
import type { ClientEvent, ConnectPayload, ServerEvent, WsData } from "../events.type.ts";
import type { BunServerWebSocket } from "./constants.ts";
import type { LogEventFn } from "./logging.ts";
import type { MapStore } from "../map/store.ts";
import type { TrackerState } from "../map/types";
import type { Session } from "../mud-connection.ts";
import type { TriggerState } from "../triggers.ts";
import { normalizeFarmZoneSettings, normalizeSurvivalSettings } from "../settings-normalizers.ts";
import { normalizeSurvivalConfig, resolveSurvivalCommands, survivalSettingsToConfig } from "../survival-script.ts";
import { runCompareScan } from "../compare-scan/index.ts";
import { searchAndCacheWikiItem } from "../wiki.ts";
import { findVorozheRoute } from "../vorozhe-graph.ts";

interface FarmControllerLike {
  setLoopEnabled: (enabled: boolean) => void;
  setScriptEnabled: (enabled: boolean, zoneId?: number) => void;
  resolveAttackTarget: (currentRoomId: number) => Promise<string | null>;
}

interface TriggersLike {
  setEnabled: (state: Partial<TriggerState>) => void;
  getState: () => TriggerState;
}

interface SurvivalControllerLike {
  updateConfig: (cfg: ReturnType<typeof normalizeSurvivalConfig>) => void;
}

interface GatherControllerLike {
  getState: () => import("../gather-script.ts").GatherState;
  setEnabled: (enabled: boolean) => void;
}

interface RepairControllerLike {
  run: () => Promise<void> | void;
}

interface ContainerTrackerLike {
  startEquippedScan: () => void;
}

interface MudConnectionLike {
  connectToMud: (ws: BunServerWebSocket, payload?: ConnectPayload) => Promise<void>;
  teardownSession: (ws: BunServerWebSocket | null, message: string) => void;
  writeAndLogMudCommand: (
    ws: BunServerWebSocket | null,
    socket: NonNullable<Session["tcpSocket"]>,
    command: string,
    origin: string,
  ) => void;
}

export interface ClientMessageRouterDeps {
  /** Shared MUD session (read-only from router). */
  session: Session;
  /** MUD I/O + teardown. */
  mudConnection: MudConnectionLike;
  /** Controllers the client can toggle/command. */
  farmController: FarmControllerLike;
  triggers: TriggersLike;
  survivalController: SurvivalControllerLike;
  gatherController: GatherControllerLike;
  repairController: RepairControllerLike;
  containerTracker: ContainerTrackerLike;
  /** Tracker state — only currentRoomId is read/reset. */
  trackerState: TrackerState;
  /** Map persistence + settings store. */
  mapStore: MapStore;
  /** Runtime config (read-only). */
  runtimeConfig: typeof import("../config.ts").runtimeConfig;
  /** Mutable top-level state accessors. */
  getActiveProfileId: () => string;
  setActiveProfileId: (id: string) => void;
  getDebugLogEnabled: () => boolean;
  setDebugLogEnabled: (enabled: boolean) => void;
  getMapRecordingEnabled: () => boolean;
  setMapRecordingEnabled: (enabled: boolean) => void;
  /** Broadcast + per-socket send helpers. */
  sendServerEvent: (ws: BunServerWebSocket, event: ServerEvent) => void;
  broadcastServerEvent: (event: ServerEvent) => void;
  /** Structured logger. */
  logEvent: LogEventFn;
  /** Escapes \r\n for logging. */
  sanitizeLogText: (text: string) => string;
  /** Raw mud-text listener set (used by compare-scan). */
  mudTextHandlers: Set<(text: string) => void>;
  /** Container inspector (used by goto_and_run survival flow). */
  inspectContainer: (ws: BunServerWebSocket | null, container: string) => Promise<string>;
  /** Navigation entrypoints. */
  startNavigationToNearest: (
    ws: BunServerWebSocket,
    vnums: number[],
  ) => Promise<void>;
  stopNavigation: () => void;
  /** Map-state reset used by `map_reset`. */
  resetMapState: () => void;
  /** Snapshot broadcasters. */
  broadcastMapSnapshot: (type: "map_snapshot" | "map_update") => Promise<void>;
  broadcastAliasesSnapshot: () => Promise<void>;
  broadcastRoomAutoCommandsSnapshot: () => Promise<void>;
  /** Compose+send handler for the `send` event. */
  handleSendCommand: (ws: BunServerWebSocket, command: string | undefined) => void;
  /** Reply with survival settings on request. */
  sendSurvivalSettings: (ws: BunServerWebSocket) => Promise<void>;
}

export interface ClientMessageRouter {
  handleMessage: (ws: BunServerWebSocket, event: ClientEvent) => Promise<void>;
}

export function createClientMessageRouter(
  deps: ClientMessageRouterDeps,
): ClientMessageRouter {
  const {
    session,
    mudConnection,
    farmController,
    triggers,
    survivalController,
    gatherController,
    repairController,
    containerTracker,
    trackerState,
    mapStore,
    runtimeConfig,
    sendServerEvent,
    broadcastServerEvent,
    logEvent,
    sanitizeLogText,
    mudTextHandlers,
    inspectContainer,
    startNavigationToNearest,
    stopNavigation,
    resetMapState,
    broadcastMapSnapshot,
    broadcastAliasesSnapshot,
    broadcastRoomAutoCommandsSnapshot,
    handleSendCommand,
    sendSurvivalSettings,
  } = deps;

  async function handleMessage(
    ws: BunServerWebSocket,
    event: ClientEvent,
  ): Promise<void> {
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
      case "debug_log_toggle": {
        const next = event.payload?.enabled ?? !deps.getDebugLogEnabled();
        deps.setDebugLogEnabled(next);
        logEvent(ws, "browser-in", "debug_log_toggle", { enabled: next });
        broadcastServerEvent({ type: "debug_log_state", payload: { enabled: next } });
        break;
      }
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
              const currentCount = "достаточно";
              broadcastServerEvent({
                type: "status",
                payload: { state: session.state, message: `[survival] уже ${currentCount} еды` },
              });
              break;
            }
            resolvedCommands = result;
          }
          await startNavigationToNearest(ws, vnums);
          for (const cmd of resolvedCommands) {
            if (session.tcpSocket && session.connected) {
              mudConnection.writeAndLogMudCommand(ws, session.tcpSocket!, cmd, "goto_and_run");
              await new Promise<void>((resolve) => setTimeout(resolve, runtimeConfig.commandDelayMs));
            }
          }
        }
        break;
      }
      case "navigate_stop": {
        logEvent(ws, "browser-in", "navigate_stop");
        stopNavigation();
        break;
      }
      case "farm_settings_get": {
        const zoneId = event.payload?.zoneId;
        if (typeof zoneId === "number") {
          logEvent(ws, "browser-in", "farm_settings_get", { zoneId });
          const settings = await mapStore.getFarmSettings(deps.getActiveProfileId(), zoneId);
          sendServerEvent(ws, {
            type: "farm_settings_data",
            payload: { zoneId, settings },
          });
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
      case "survival_settings_get": {
        logEvent(ws, "browser-in", "survival_settings_get");
        await sendSurvivalSettings(ws);
        break;
      }
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
      case "triggers_toggle": {
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
      }
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
      case "inspect_container": {
        const containerKey = event.payload?.container;
        if (
          containerKey !== "склад" &&
          containerKey !== "расход" &&
          containerKey !== "базар" &&
          containerKey !== "хлам"
        ) break;
        logEvent(ws, "browser-in", `inspect_container: ${containerKey}`);
        if (session.tcpSocket && session.connected) {
          mudConnection.writeAndLogMudCommand(ws, session.tcpSocket, `осм ${containerKey}`, "inspect-container");
        }
        break;
      }
      case "inspect_inventory": {
        logEvent(ws, "browser-in", "inspect_inventory");
        if (session.tcpSocket && session.connected) {
          mudConnection.writeAndLogMudCommand(ws, session.tcpSocket, "инв", "inspect-inventory");
        }
        break;
      }
      case "equipped_scan": {
        logEvent(ws, "browser-in", "equipped_scan");
        if (session.tcpSocket && session.connected) {
          containerTracker.startEquippedScan();
          mudConnection.writeAndLogMudCommand(ws, session.tcpSocket, "equipment", "equipped-scan");
        }
        break;
      }
      case "inventory_auto_sort": {
        const items = event.payload?.items ?? [];
        logEvent(ws, "browser-in", `inventory_auto_sort: ${items.length} items`);
        const commands: Array<{ command: string }> = [];
        for (const item of items) {
          const maxPrice = await mapStore.getMarketMaxPrice(item.name);
          const kw = item.name.split(/\s+/)[0] ?? item.name;
          if (maxPrice !== null) {
            commands.push({ command: `пол ${kw} базар` });
          } else {
            commands.push({ command: `пол ${kw} хлам` });
          }
        }
        sendServerEvent(ws, { type: "inventory_sort_result", payload: { commands } });
        break;
      }
      case "bazaar_max_price_request": {
        const itemName = event.payload?.itemName ?? "";
        const maxPrice = await mapStore.getMarketMaxPrice(itemName);
        sendServerEvent(ws, { type: "bazaar_max_price_response", payload: { itemName, maxPrice } });
        break;
      }
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
      case "item_db_get": {
        logEvent(ws, "browser-in", "item_db_get");
        const items = await mapStore.getItems();
        sendServerEvent(ws, { type: "items_data", payload: { items } });
        break;
      }
      case "wiki_item_search": {
        const query = event.payload?.query?.trim() ?? "";
        logEvent(ws, "browser-in", `wiki_item_search: ${query}`);
        if (!query) break;
        try {
          const result = await searchAndCacheWikiItem(query, mapStore, runtimeConfig.wikiProxies);
          sendServerEvent(ws, { type: "wiki_item_search_result", payload: { query, ...result } });
        } catch (err: unknown) {
          sendServerEvent(ws, {
            type: "wiki_item_search_result",
            payload: { query, found: false, error: err instanceof Error ? err.message : "Ошибка поиска" },
          });
        }
        break;
      }
      case "vorozhe_route_find": {
        const from = event.payload?.from?.trim() ?? "";
        const to = event.payload?.to?.trim() ?? "";
        logEvent(ws, "browser-in", `vorozhe_route_find: ${from} → ${to}`);
        if (!from || !to) break;
        const result = findVorozheRoute(from, to);
        sendServerEvent(ws, {
          type: "vorozhe_route_result",
          payload: {
            from,
            to,
            found: result.found,
            steps: result.steps,
            totalItems: result.totalItems as Record<string, number>,
          },
        });
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
      case "compare_scan_start": {
        logEvent(ws, "browser-in", "compare_scan_start");
        if (!session.tcpSocket || !session.connected) {
          sendServerEvent(ws, { type: "error", payload: { message: "Не подключены к MUD." } });
          break;
        }
        void runCompareScan({
          sendCommand: (cmd) => mudConnection.writeAndLogMudCommand(null, session.tcpSocket!, cmd, "compare-scan"),
          registerTextHandler: (h) => mudTextHandlers.add(h),
          unregisterTextHandler: (h) => mudTextHandlers.delete(h),
          onProgress: (msg) => {
            logEvent(ws, "browser-out", `[compare-scan] ${msg}`);
            broadcastServerEvent({ type: "compare_scan_progress", payload: { message: msg } });
          },
          waitForOutput: (_ms) => Promise.resolve(""),
          cancelWait: () => {},
          getItemByName: (name) => mapStore.getItemByName(name),
          upsertItem: (name, itemType, data, hasWikiData, hasGameData) =>
            mapStore.upsertItem(name, itemType, data, hasWikiData, hasGameData),
          wikiProxies: runtimeConfig.wikiProxies,
        }).then((result) => {
          broadcastServerEvent({ type: "compare_scan_result", payload: result });
        }).catch((err: unknown) => {
          broadcastServerEvent({
            type: "error",
            payload: { message: err instanceof Error ? err.message : "Ошибка сравнятора." },
          });
        });
        break;
      }
      case "compare_apply": {
        logEvent(ws, "browser-in", `compare_apply: ${event.payload.commands.join(" ; ")}`);
        if (!session.tcpSocket || !session.connected) {
          sendServerEvent(ws, { type: "error", payload: { message: "Не подключены к MUD." } });
          break;
        }
        const compareSocket = session.tcpSocket;
        for (const cmd of event.payload.commands) {
          mudConnection.writeAndLogMudCommand(null, compareSocket, cmd, "compare-apply");
        }
        break;
      }
      case "repair_start": {
        logEvent(ws, "browser-in", "repair_start");
        void repairController.run();
        break;
      }
    }
  }

  return { handleMessage };
}
