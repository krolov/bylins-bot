// ---------------------------------------------------------------------------
// MUD text pipeline — the single entrypoint that every raw chunk of MUD
// output flows through after the session-level chat/market/loot sniffers
// have run. Responsibilities:
//
//   1. fan text out to stateful sub-systems (stats, combat, triggers,
//      survival, gather, item identifier);
//   2. react to combat enter/exit transitions (UI + survival scheduler);
//   3. drive the automapper — feed the parser, persist rooms/edges, and
//      broadcast map_update snapshots;
//   4. mirror visible mobs/corpses so the farm controller can see them;
//   5. notify room-change / room-refresh listeners registered on the hub.
//
// The pipeline owns the `visibleMobs` and `corpseCount` mirrors (previously
// `currentRoomMobs` / `currentRoomCorpseCount` in server.ts). Consumers read
// them via getVisibleMobs() / getCorpseCount().
//
// Extracted from src/server.ts to keep server.ts focused on orchestration.
// ---------------------------------------------------------------------------
import type { MapStore } from "../map/store.ts";
import { feedText } from "../map/parser.ts";
import type { ParserState, TrackerState } from "../map/types";
import { processParsedEvents } from "../map/tracker.ts";
import type { MoverTrackerFeedback } from "../map/mover.ts";
import type { StatsTracker } from "./stats.ts";
import type { BunServerWebSocket } from "./constants.ts";
import type { LogEventFn } from "./logging.ts";
import type { ServerEvent } from "../events.type.ts";
import type { RoomChangedListener, RoomRefreshListener } from "./listeners.ts";

const ANSI_ESCAPE_REGEXP = /\u001b\[[0-9;]*m/g;
const COMBAT_PROMPT_MOB_REGEXP = /\[([^\]:]+):[^\]]+\]/g;

/**
 * Minimal shape the pipeline needs from the combat state tracker.
 */
interface CombatStateLike {
  handleMudText: (text: string) => void;
  getTransition: () => { enteredCombat: boolean; exitedCombat: boolean };
  getInCombat: () => boolean;
}

/**
 * Minimal shape the pipeline needs from the triggers engine.
 */
interface TriggersLike {
  handleMudText: (text: string) => void;
  onCombatStart: () => void;
  onCombatEnd: () => void;
}

/**
 * Minimal shape the pipeline needs from script controllers that consume
 * raw text (survival + gather).
 */
interface TextConsumerLike {
  handleMudText: (text: string) => void;
}

/**
 * Minimal shape the pipeline needs from the item identifier.
 */
interface ItemIdentifierLike {
  handleChunk: (text: string) => Promise<void>;
}

/**
 * Minimal shape the pipeline needs from the farm controller — receives
 * the per-chunk parser summary so it can drive the loop/script FSMs.
 */
interface FarmControllerLike {
  handleMudText: (
    text: string,
    context: {
      roomChanged: boolean;
      roomDescriptionReceived: boolean;
      currentRoomId: number | null;
      mobsInRoom: string[];
      combatMobNames: string[];
      corpseCount: number;
    },
  ) => void;
}

export interface MudTextPipelineDeps {
  statsTracker: StatsTracker;
  combatState: CombatStateLike;
  triggers: TriggersLike;
  survivalController: TextConsumerLike;
  gatherController: TextConsumerLike;
  itemIdentifier: ItemIdentifierLike;
  farmController: FarmControllerLike;
  mover: { onTrackerResult: (feedback: MoverTrackerFeedback) => void };

  parserState: ParserState;
  trackerState: TrackerState;
  mapStore: MapStore;

  /** Broadcasts any server event to connected browser clients. */
  broadcastServerEvent: (event: ServerEvent) => void;
  /** Structured logger (shares the server-wide logEvent). */
  logEvent: LogEventFn;
  /** Broadcasts the current map snapshot (zone or full) to all clients. */
  broadcastMapSnapshot: (type: "map_snapshot" | "map_update") => Promise<void>;
  /** Arms the survival tick; called after combat-state transitions. */
  scheduleSurvivalTick: (delayMs: number) => void;
  /** Whether the automapper should persist rooms/edges. */
  getMapRecordingEnabled: () => boolean;

  /** Listener sets exposed by the listener hub. */
  roomChangedListeners: Set<RoomChangedListener>;
  roomRefreshListeners: Set<RoomRefreshListener>;
}

export interface MudTextPipeline {
  /** Main entrypoint — call once for every raw text chunk from the MUD. */
  handleMudText: (text: string, ws: BunServerWebSocket | null) => Promise<void>;
  /** Most recent visible mobs in the current room (lowercased key). */
  getVisibleMobs: () => Map<string, string>;
  /** Corpse count last parsed in the current room. */
  getCorpseCount: () => number;
}

export function createMudTextPipeline(deps: MudTextPipelineDeps): MudTextPipeline {
  const visibleMobs = new Map<string, string>();
  let corpseCount = 0;

  async function handleMudText(
    text: string,
    ws: BunServerWebSocket | null,
  ): Promise<void> {
    deps.statsTracker.parseAndBroadcast(text);

    deps.combatState.handleMudText(text);
    deps.triggers.handleMudText(text);
    deps.survivalController.handleMudText(text);
    deps.gatherController.handleMudText(text);

    const { enteredCombat, exitedCombat } = deps.combatState.getTransition();

    if (enteredCombat) {
      deps.triggers.onCombatStart();
      deps.broadcastServerEvent({ type: "combat_state", payload: { inCombat: true } });
    } else if (exitedCombat) {
      deps.triggers.onCombatEnd();
      deps.broadcastServerEvent({ type: "combat_state", payload: { inCombat: false } });
    }

    if (exitedCombat) {
      deps.scheduleSurvivalTick(50);
    } else if (!deps.combatState.getInCombat()) {
      deps.scheduleSurvivalTick(150);
    }

    void deps.itemIdentifier.handleChunk(text).catch((error: unknown) => {
      deps.logEvent(
        ws,
        "error",
        error instanceof Error ? `Item parser error: ${error.message}` : "Item parser error.",
      );
    });

    const events = feedText(deps.parserState, text);
    const previousRoomId = deps.trackerState.currentRoomId;

    const mobsInRoom: string[] = [];
    let parsedCorpseCount = 0;
    for (const event of events) {
      if (event.kind === "mobs_in_room") {
        for (const name of event.mobs) {
          if (!mobsInRoom.includes(name)) mobsInRoom.push(name);
        }
      }
      if (event.kind === "corpses_in_room") {
        parsedCorpseCount += event.count;
      }
    }

    const roomEvent = events.find((event) => event.kind === "room");
    if (roomEvent?.kind === "room") {
      deps.logEvent(
        null,
        "session",
        `[zone-debug] parsed room event vnum=${roomEvent.room.vnum} mobs=[${mobsInRoom.join(" | ")}]`,
      );
    }

    if (events.some((e) => e.kind === "room")) {
      visibleMobs.clear();
      for (const name of mobsInRoom) {
        visibleMobs.set(name.toLowerCase(), name);
      }
      corpseCount = parsedCorpseCount;
      deps.logEvent(
        null,
        "session",
        `[zone-debug] currentRoomMobs updated room=${deps.trackerState.currentRoomId} values=[${[...visibleMobs.values()].join(" | ")}]`,
      );
      for (const listener of deps.roomRefreshListeners) {
        listener(deps.trackerState.currentRoomId);
      }
    }

    const strippedText = text.replace(ANSI_ESCAPE_REGEXP, "");
    const vnumAtCombatSave = deps.trackerState.currentRoomId;
    const combatMobNames: string[] = [];
    for (const line of strippedText.split("\n")) {
      const blocks = [...line.matchAll(COMBAT_PROMPT_MOB_REGEXP)];
      if (blocks.length < 2) continue;
      for (const match of blocks.slice(1)) {
        const mobName = match[1].trim();
        if (mobName && !combatMobNames.includes(mobName)) {
          combatMobNames.push(mobName);
          void deps.mapStore.saveMobCombatName(mobName, vnumAtCombatSave).catch((error: unknown) => {
            deps.logEvent(
              ws,
              "error",
              error instanceof Error ? `Mob combat name save error: ${error.message}` : "Mob combat name save error.",
            );
          });
        }
      }
    }

    if (events.length === 0) {
      deps.farmController.handleMudText(text, {
        roomChanged: false,
        roomDescriptionReceived: false,
        currentRoomId: deps.trackerState.currentRoomId,
        mobsInRoom: [],
        combatMobNames,
        corpseCount: 0,
      });
      return;
    }

    const result = processParsedEvents(deps.trackerState, events);

    if (deps.getMapRecordingEnabled()) {
      for (const room of result.rooms) {
        await deps.mapStore.upsertRoom(room.vnum, room.name, room.exits, room.closedExits);
      }

      for (const edge of result.edges) {
        await deps.mapStore.upsertEdge(edge);
      }
    }

    await deps.broadcastMapSnapshot("map_update");

    if (result.rooms.length > 0 || result.edges.length > 0) {
      deps.logEvent(ws, "session", "Automapper updated.", {
        rooms: result.rooms.length,
        edges: result.edges.length,
        currentVnum: result.currentVnum,
      });
    }

    deps.mover.onTrackerResult({
      currentVnum: deps.trackerState.currentRoomId,
      previousVnum: previousRoomId,
      movementBlocked: result.movementBlocked,
      roomDescriptionReceived: result.rooms.length > 0,
      visibleMobNames: mobsInRoom,
    });

    if (result.rooms.length > 0) {
      deps.logEvent(
        null,
        "session",
        `[zone-debug] mover feedback current=${deps.trackerState.currentRoomId} previous=${previousRoomId} roomDescriptionReceived=${result.rooms.length > 0} visibleMobNames=[${mobsInRoom.join(" | ")}]`,
      );
    }

    deps.farmController.handleMudText(text, {
      roomChanged: previousRoomId !== deps.trackerState.currentRoomId,
      roomDescriptionReceived: result.rooms.length > 0,
      currentRoomId: deps.trackerState.currentRoomId,
      mobsInRoom,
      combatMobNames,
      corpseCount: parsedCorpseCount,
    });

    if (
      deps.trackerState.currentRoomId !== null &&
      deps.trackerState.currentRoomId !== previousRoomId
    ) {
      const vnum = deps.trackerState.currentRoomId;
      for (const listener of deps.roomChangedListeners) {
        listener(vnum);
      }
    }
  }

  return {
    handleMudText,
    getVisibleMobs: () => visibleMobs,
    getCorpseCount: () => corpseCount,
  };
}
