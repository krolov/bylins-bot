// ---------------------------------------------------------------------------
// Initial-state sender — packs together every sendServerEvent the server
// fires when a new browser WebSocket connects. Moved out of server.ts so
// the server module stays focused on wiring.
//
// Two pieces:
//   - sendDefaults(ws): runtime config + current state of all controllers
//   - sendBrowserOpenSnapshot(ws): runtime defaults + status + recent
//     output + chat history + map snapshot + survival settings (the full
//     welcome payload every time a client opens the socket)
// ---------------------------------------------------------------------------
import type { BunServerWebSocket } from "./constants.ts";
import type { LogEventFn } from "./logging.ts";
import type { MapStore } from "../map/store.ts";
import type { ServerEvent } from "../events.type.ts";
import type { Session } from "../mud-connection.ts";
import type { StatsTracker } from "./stats.ts";

interface FarmControllerLike {
  getLoopState: () => import("../farm/index.ts").Farm2StateSnapshot;
  getScriptState: () => import("../farm/index.ts").ZoneScriptStateSnapshot;
  getZoneList: () => Array<{
    zoneId: number;
    zoneName: string;
    hundreds: number[];
    stepLabels: string[];
  }>;
}

interface TriggersLike {
  getState: () => import("../triggers.ts").TriggerState;
}

interface SurvivalControllerLike {
  getStatus: () => import("../survival-script.ts").SurvivalStatus;
}

interface RepairControllerLike {
  isRunning: () => boolean;
}

interface GatherControllerLike {
  getState: () => import("../gather-script.ts").GatherState;
}

interface CombatStateLike {
  getInCombat: () => boolean;
}

export interface InitialStateDeps {
  runtimeConfig: typeof import("../config.ts").runtimeConfig;
  farmController: FarmControllerLike;
  triggers: TriggersLike;
  survivalController: SurvivalControllerLike;
  repairController: RepairControllerLike;
  gatherController: GatherControllerLike;
  combatState: CombatStateLike;
  statsTracker: StatsTracker;
  session: Session;
  mapStore: MapStore;
  sendServerEvent: (ws: BunServerWebSocket, event: ServerEvent) => void;
  logEvent: LogEventFn;
  /** Reads the current map_recording toggle. */
  getMapRecordingEnabled: () => boolean;
  /** Recent MUD output chunks to replay for late-joining clients. */
  getRecentOutputChunks: () => string[];
  /** Sends the map snapshot (zone or full) to one client. */
  sendMapSnapshot: (ws: BunServerWebSocket) => Promise<void>;
  /** Sends the current survival settings to one client. */
  sendSurvivalSettings: (ws: BunServerWebSocket) => Promise<void>;
}

export interface InitialStateSender {
  /** Dumps controller state + defaults; called from sendBrowserOpenSnapshot. */
  sendDefaults: (ws: BunServerWebSocket) => void;
  /** Full welcome sequence fired by the websocket `open` handler. */
  sendBrowserOpenSnapshot: (ws: BunServerWebSocket) => void;
}

export function createInitialStateSender(deps: InitialStateDeps): InitialStateSender {
  const {
    runtimeConfig,
    farmController,
    triggers,
    survivalController,
    repairController,
    gatherController,
    combatState,
    statsTracker,
    session,
    mapStore,
    sendServerEvent,
    logEvent,
    getMapRecordingEnabled,
    getRecentOutputChunks,
    sendMapSnapshot,
    sendSurvivalSettings,
  } = deps;

  function sendDefaults(ws: BunServerWebSocket): void {
    sendServerEvent(ws, {
      type: "defaults",
      payload: {
        autoConnect: runtimeConfig.autoConnect,
        host: runtimeConfig.mudHost,
        port: runtimeConfig.mudPort,
        tls: runtimeConfig.mudTls,
        startupCommands: runtimeConfig.startupCommands,
        commandDelayMs: runtimeConfig.commandDelayMs,
      },
    });

    sendServerEvent(ws, { type: "farm2_state", payload: farmController.getLoopState() });
    sendServerEvent(ws, { type: "triggers_state", payload: triggers.getState() });
    sendServerEvent(ws, { type: "survival_status", payload: survivalController.getStatus() });
    sendServerEvent(ws, {
      type: "repair_state",
      payload: { running: repairController.isRunning(), message: "" },
    });
    sendServerEvent(ws, {
      type: "map_recording_state",
      payload: { enabled: getMapRecordingEnabled() },
    });
    sendServerEvent(ws, { type: "gather_state", payload: gatherController.getState() });
    sendServerEvent(ws, { type: "zone_script_state", payload: farmController.getScriptState() });
    sendServerEvent(ws, { type: "zone_script_list", payload: farmController.getZoneList() });
    sendServerEvent(ws, {
      type: "combat_state",
      payload: { inCombat: combatState.getInCombat() },
    });

    if (statsTracker.getHpMax() > 0 || statsTracker.getEnergyMax() > 0) {
      sendServerEvent(ws, {
        type: "stats_update",
        payload: {
          hp: statsTracker.getHp(),
          hpMax: statsTracker.getHpMax(),
          energy: statsTracker.getEnergy(),
          energyMax: statsTracker.getEnergyMax(),
        },
      });
    }
  }

  function sendBrowserOpenSnapshot(ws: BunServerWebSocket): void {
    sendDefaults(ws);
    sendServerEvent(ws, {
      type: "status",
      payload: { state: session.state, message: session.statusMessage },
    });

    const recent = getRecentOutputChunks();
    if (recent.length > 0) {
      sendServerEvent(ws, { type: "output", payload: { text: recent.join("") } });
    }

    void mapStore.getRecentChatMessages().then((messages) => {
      if (messages.length > 0) {
        sendServerEvent(ws, { type: "chat_history", payload: { messages } });
      }
    }).catch((error: unknown) => {
      logEvent(
        ws,
        "error",
        error instanceof Error ? `Chat history error: ${error.message}` : "Chat history error.",
      );
    });

    void sendMapSnapshot(ws);
    void sendSurvivalSettings(ws);
  }

  return { sendDefaults, sendBrowserOpenSnapshot };
}
