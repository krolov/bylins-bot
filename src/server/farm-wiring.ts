// ---------------------------------------------------------------------------
// Farm controller wiring — packs the ~40-line FarmControllerDeps object
// that server.ts had inline into a single factory, so server.ts can just
// pass in the high-level ingredients.
//
// This is pure plumbing: no behavior change, no logic added. Every branch
// maps 1:1 to the previous inline block, sourced from the grouped deps.
// ---------------------------------------------------------------------------
import { createFarmController } from "../farm/index.ts";
import type { FarmController } from "../farm/index.ts";
import type { MapStore } from "../map/store.ts";
import type { TrackerState } from "../map/types";
import type { MoveResult, MoverTrackerFeedback, StealthMoveResult } from "../map/mover.ts";
import type { ServerEvent } from "../events.type.ts";
import type { Session } from "../mud-connection.ts";
import type { Direction } from "../map/types";

interface CombatStateLike {
  getInCombat: () => boolean;
  getTransition: () => { enteredCombat: boolean; exitedCombat: boolean };
  reset: () => void;
  handleMudText: (text: string) => void;
}

interface MoverLike {
  move: (direction: Direction, currentRoomId: number | null) => Promise<MoveResult>;
  stealthMove: (
    direction: Direction,
    currentRoomId: number | null,
  ) => Promise<StealthMoveResult>;
  onTrackerResult: (feedback: MoverTrackerFeedback) => void;
}

interface LootSorterLike {
  autoSortInventory: () => Promise<void>;
}

interface MudTextPipelineGetters {
  getVisibleMobs: () => Map<string, string>;
  getCorpseCount: () => number;
}

export interface FarmWiringDeps {
  session: Session;
  mapStore: MapStore;
  trackerState: TrackerState;
  mover: MoverLike;
  combatState: CombatStateLike;
  runtimeConfig: typeof import("../config.ts").runtimeConfig;

  /** Capture late-bound singletons via arrow closures. */
  lootSorter: LootSorterLike;
  pipeline: MudTextPipelineGetters;

  /** Pre-built command sender already tagged with origin="farm". */
  sendCommand: (command: string) => void;
  broadcastServerEvent: (event: ServerEvent) => void;
  /** Session-level log helper (equivalent to logEvent(null, "session", msg)). */
  logSession: (message: string) => void;

  /** Listener-hub wait helpers. */
  onMudTextOnce: (pattern: RegExp, timeoutMs: number) => Promise<void>;
  onceRoomChanged: (timeoutMs: number) => Promise<number | null>;
  refreshCurrentRoom: (timeoutMs: number) => Promise<number | null>;

  /** Navigation entry for script-mode moves. */
  navigateTo: (targetVnum: number) => Promise<void>;

  /** Currently active profile id (for per-profile zone settings). */
  getActiveProfileId: () => string;
}

export function createFarmWiring(deps: FarmWiringDeps): FarmController {
  const {
    session,
    mapStore,
    trackerState,
    mover,
    combatState,
    runtimeConfig,
    lootSorter,
    pipeline,
    sendCommand,
    broadcastServerEvent,
    logSession,
    onMudTextOnce,
    onceRoomChanged,
    refreshCurrentRoom,
    navigateTo,
    getActiveProfileId,
  } = deps;

  return createFarmController({
    // ── Shared plumbing ────────────────────────────────────────────────────
    getCurrentRoomId: () => trackerState.currentRoomId,
    isConnected: () => session.connected && Boolean(session.tcpSocket),
    getSnapshot: (currentVnum) => mapStore.getSnapshot(currentVnum),
    combatState,
    sendCommand,
    move: (direction) => mover.move(direction, trackerState.currentRoomId),
    reinitRoom: () => sendCommand("см"),
    onLog: logSession,
    // ── Loop-mode deps (formerly createFarm2Controller) ────────────────────
    getZoneSettings: (zoneId) => mapStore.getFarmSettings(getActiveProfileId(), zoneId),
    getMobCombatNamesByZone: (zoneId) => mapStore.getMobCombatNamesByZone(zoneId),
    getCombatNameByRoomName: (roomName) => mapStore.getCombatNameByRoomName(roomName),
    isRoomNameBlacklisted: (roomName) => mapStore.isRoomNameBlacklisted(roomName),
    linkMobRoomAndCombatName: (roomName, combatName, vnum) =>
      mapStore.saveMobRoomName(roomName, vnum, combatName),
    onLoopStateChange: (loopState) => broadcastServerEvent({ type: "farm2_state", payload: loopState }),
    onDebugLog: logSession,
    // ── Script-mode deps (formerly createZoneScriptController) ─────────────
    navigateTo,
    onMudTextOnce,
    onceRoomChanged,
    refreshCurrentRoom,
    stealthMove: (direction) => mover.stealthMove(direction, trackerState.currentRoomId),
    getVisibleTargets: () => new Map(pipeline.getVisibleMobs()),
    getCorpseCount: () => pipeline.getCorpseCount(),
    isStealthProfile: () =>
      runtimeConfig.profiles.find((p) => p.id === getActiveProfileId())?.stealthCombat === true,
    mobResolver: {
      getMobCombatNamesByZone: (zoneId) => mapStore.getMobCombatNamesByZone(zoneId),
      getCombatNameByRoomName: (roomName) => mapStore.getCombatNameByRoomName(roomName),
      isRoomNameBlacklisted: (roomName) => mapStore.isRoomNameBlacklisted(roomName),
      linkMobRoomAndCombatName: (roomName, combatName, vnum) =>
        mapStore.saveMobRoomName(roomName, vnum, combatName),
      onDebugLog: logSession,
    },
    autoSortInventory: () => lootSorter.autoSortInventory(),
    onScriptStateChange: (scriptState) =>
      broadcastServerEvent({ type: "zone_script_state", payload: scriptState }),
  });
}
