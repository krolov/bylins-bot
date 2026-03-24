import type { Direction, MapEdge, ParsedEvent, ParsedRoom, TrackerState } from "./types";

const PENDING_MOVE_TTL_MS = 10_000;

const COMMAND_TO_DIRECTION: Record<string, Direction> = {
  n: "north",
  north: "north",
  с: "north",
  север: "north",
  s: "south",
  south: "south",
  ю: "south",
  юг: "south",
  e: "east",
  east: "east",
  в: "east",
  восток: "east",
  w: "west",
  west: "west",
  з: "west",
  запад: "west",
  u: "up",
  up: "up",
  вв: "up",
  вверх: "up",
  d: "down",
  down: "down",
  вн: "down",
  вниз: "down",
};

export interface TrackerResult {
  rooms: ParsedRoom[];
  edges: MapEdge[];
  currentVnum: number | null;
}

export function createTrackerState(): TrackerState {
  return {
    currentRoomId: null,
    pendingMove: null,
  };
}

export function trackOutgoingCommand(state: TrackerState, command: string): void {
  const normalizedCommand = normalizeCommand(command);
  const direction = COMMAND_TO_DIRECTION[normalizedCommand];

  if (!direction) {
    return;
  }

  state.pendingMove = {
    sourceRoomId: state.currentRoomId,
    direction,
    createdAt: Date.now(),
  };
}

export function processParsedEvents(state: TrackerState, events: ParsedEvent[]): TrackerResult {
  const rooms: ParsedRoom[] = [];
  const edges: MapEdge[] = [];

  for (const event of events) {
    switch (event.kind) {
      case "movement":
        state.pendingMove = {
          sourceRoomId: state.currentRoomId,
          direction: event.direction,
          createdAt: Date.now(),
        };
        break;
      case "movement_blocked":
        state.pendingMove = null;
        break;
      case "dark_room":
        state.pendingMove = null;
        state.currentRoomId = null;
        break;
      case "room": {
        rooms.push(event.room);

        if (state.pendingMove && !hasPendingMoveExpired(state.pendingMove.createdAt)) {
          const { sourceRoomId, direction } = state.pendingMove;

          if (sourceRoomId !== null && sourceRoomId !== event.room.vnum) {
            edges.push({
              fromVnum: sourceRoomId,
              toVnum: event.room.vnum,
              direction,
              isPortal: getZoneId(sourceRoomId) !== getZoneId(event.room.vnum),
            });
          }
        }

        state.currentRoomId = event.room.vnum;
        state.pendingMove = null;
        break;
      }
    }
  }

  return {
    rooms,
    edges,
    currentVnum: state.currentRoomId,
  };
}

function normalizeCommand(command: string): string {
  return command.trim().toLowerCase();
}

function hasPendingMoveExpired(createdAt: number): boolean {
  return Date.now() - createdAt > PENDING_MOVE_TTL_MS;
}

function getZoneId(vnum: number): number {
  return Math.floor(vnum / 100);
}
