// ---------------------------------------------------------------------------
// Snapshot broadcasters: wrap MapStore reads and dispatch the corresponding
// WS events to browser clients.
//
// The map snapshot has two scopes:
//   - "full"   whole graph visible to the character (getSnapshot)
//   - "zone"   only the current zone (getZoneSnapshot, cheaper for
//              incremental "map_update" broadcasts)
//
// Aliases and per-room auto-commands also have their own snapshot events.
// `sendInitialSnapshot` bundles map + aliases + auto-commands + current
// navigation state into a single sequence for a brand-new WS client.
// ---------------------------------------------------------------------------

import type { MapAlias, MapSnapshot, ServerEvent } from "../events.type.ts";
import type { BunServerWebSocket } from "./constants.ts";

export interface MapSnapshotStore {
  getSnapshot(currentVnum: number | null): Promise<MapSnapshot>;
  getZoneSnapshot(currentVnum: number | null): Promise<MapSnapshot>;
  getAliases(): Promise<MapAlias[]>;
  getRoomAutoCommands(): Promise<Array<{ vnum: number; command: string }>>;
}

export interface NavigationSnapshot {
  active: boolean;
  targetVnum: number | null;
  totalSteps: number;
  currentStep: number;
}

export interface SnapshotBroadcasterDeps {
  mapStore: MapSnapshotStore;
  broadcastServerEvent(event: ServerEvent): void;
  sendServerEvent(ws: BunServerWebSocket, event: ServerEvent): void;
  getCurrentRoomId(): number | null;
  getNavigationSnapshot(): NavigationSnapshot;
}

export interface SnapshotBroadcaster {
  getCurrentMapSnapshot(): Promise<MapSnapshot>;
  getCurrentZoneSnapshot(): Promise<MapSnapshot>;
  sendInitialSnapshot(ws: BunServerWebSocket): Promise<void>;
  broadcastMapSnapshot(kind: "map_snapshot" | "map_update"): Promise<void>;
  broadcastAliasesSnapshot(): Promise<void>;
  broadcastRoomAutoCommandsSnapshot(): Promise<void>;
}

export function createSnapshotBroadcaster(deps: SnapshotBroadcasterDeps): SnapshotBroadcaster {
  function getCurrentMapSnapshot(): Promise<MapSnapshot> {
    return deps.mapStore.getSnapshot(deps.getCurrentRoomId());
  }

  function getCurrentZoneSnapshot(): Promise<MapSnapshot> {
    return deps.mapStore.getZoneSnapshot(deps.getCurrentRoomId());
  }

  async function sendInitialSnapshot(ws: BunServerWebSocket): Promise<void> {
    deps.sendServerEvent(ws, {
      type: "map_snapshot",
      payload: await getCurrentMapSnapshot(),
    });

    const aliases = await deps.mapStore.getAliases();
    deps.sendServerEvent(ws, {
      type: "aliases_snapshot",
      payload: { aliases },
    });

    const autoCommandEntries = await deps.mapStore.getRoomAutoCommands();
    deps.sendServerEvent(ws, {
      type: "room_auto_commands_snapshot",
      payload: { entries: autoCommandEntries },
    });

    const nav = deps.getNavigationSnapshot();
    deps.sendServerEvent(ws, {
      type: "navigation_state",
      payload: nav,
    });
  }

  async function broadcastMapSnapshot(kind: "map_snapshot" | "map_update"): Promise<void> {
    const payload = kind === "map_update"
      ? await getCurrentZoneSnapshot()
      : await getCurrentMapSnapshot();
    deps.broadcastServerEvent({ type: kind, payload });
  }

  async function broadcastAliasesSnapshot(): Promise<void> {
    const aliases = await deps.mapStore.getAliases();
    deps.broadcastServerEvent({
      type: "aliases_snapshot",
      payload: { aliases },
    });
  }

  async function broadcastRoomAutoCommandsSnapshot(): Promise<void> {
    const entries = await deps.mapStore.getRoomAutoCommands();
    deps.broadcastServerEvent({
      type: "room_auto_commands_snapshot",
      payload: { entries },
    });
  }

  return {
    getCurrentMapSnapshot,
    getCurrentZoneSnapshot,
    sendInitialSnapshot,
    broadcastMapSnapshot,
    broadcastAliasesSnapshot,
    broadcastRoomAutoCommandsSnapshot,
  };
}
