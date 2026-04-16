// ---------------------------------------------------------------------------
// Shared types for the client-message sub-routers. Each sub-router handles
// a fixed subset of ClientEvent types and receives the full
// ClientMessageRouterDeps struct; destructuring makes it clear per module
// which parts of the deps struct it actually uses.
// ---------------------------------------------------------------------------
import type { ClientEvent, ConnectPayload, ServerEvent } from "../../events.type.ts";
import type { BunServerWebSocket } from "../constants.ts";
import type { LogEventFn } from "../logging.ts";
import type { MapStore } from "../../map/store.ts";
import type { TrackerState } from "../../map/types";
import type { Session } from "../../mud-connection.ts";
import type { TriggerState } from "../../triggers.ts";
import type { normalizeSurvivalConfig } from "../../survival-script.ts";

/** A sub-router claims ownership of a fixed set of ClientEvent types. */
export interface SubRouter {
  readonly owns: ReadonlySet<ClientEvent["type"]>;
  handle(ws: BunServerWebSocket, event: ClientEvent): Promise<void>;
}

export interface FarmControllerLike {
  setLoopEnabled: (enabled: boolean) => void;
  setScriptEnabled: (enabled: boolean, zoneId?: number) => void;
  resolveAttackTarget: (currentRoomId: number) => Promise<string | null>;
}

export interface TriggersLike {
  setEnabled: (state: Partial<TriggerState>) => void;
  getState: () => TriggerState;
}

export interface SurvivalControllerLike {
  updateConfig: (cfg: ReturnType<typeof normalizeSurvivalConfig>) => void;
}

export interface GatherControllerLike {
  getState: () => import("../../gather-script.ts").GatherState;
  setEnabled: (enabled: boolean) => void;
}

export interface RepairControllerLike {
  run: () => Promise<void> | void;
}

export interface ContainerTrackerLike {
  startEquippedScan: () => void;
}

export interface MudConnectionLike {
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
  session: Session;
  mudConnection: MudConnectionLike;
  farmController: FarmControllerLike;
  triggers: TriggersLike;
  survivalController: SurvivalControllerLike;
  gatherController: GatherControllerLike;
  repairController: RepairControllerLike;
  containerTracker: ContainerTrackerLike;
  trackerState: TrackerState;
  mapStore: MapStore;
  runtimeConfig: typeof import("../../config.ts").runtimeConfig;

  getActiveProfileId: () => string;
  setActiveProfileId: (id: string) => void;
  getDebugLogEnabled: () => boolean;
  setDebugLogEnabled: (enabled: boolean) => void;
  getMapRecordingEnabled: () => boolean;
  setMapRecordingEnabled: (enabled: boolean) => void;

  sendServerEvent: (ws: BunServerWebSocket, event: ServerEvent) => void;
  broadcastServerEvent: (event: ServerEvent) => void;
  logEvent: LogEventFn;
  sanitizeLogText: (text: string) => string;

  mudTextHandlers: Set<(text: string) => void>;
  inspectContainer: (ws: BunServerWebSocket | null, container: string) => Promise<string>;
  startNavigationToNearest: (ws: BunServerWebSocket, vnums: number[]) => Promise<void>;
  stopNavigation: () => void;
  resetMapState: () => void;
  broadcastMapSnapshot: (type: "map_snapshot" | "map_update") => Promise<void>;
  broadcastAliasesSnapshot: () => Promise<void>;
  broadcastRoomAutoCommandsSnapshot: () => Promise<void>;
  handleSendCommand: (ws: BunServerWebSocket, command: string | undefined) => void;
  sendSurvivalSettings: (ws: BunServerWebSocket) => Promise<void>;
}
