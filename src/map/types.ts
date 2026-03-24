export type Direction = "north" | "south" | "east" | "west" | "up" | "down";

export interface ParsedRoom {
  vnum: number;
  name: string;
  exits: Direction[];
  closedExits: Direction[];
}

export type ParsedEvent =
  | {
      kind: "room";
      room: ParsedRoom;
    }
  | {
      kind: "movement";
      direction: Direction;
    }
  | {
      kind: "movement_blocked";
    }
  | {
      kind: "dark_room";
    };

export interface ParserState {
  lineBuffer: string;
  pendingRoomHeader: {
    vnum: number;
    name: string;
  } | null;
}

export interface PendingMove {
  sourceRoomId: number | null;
  direction: Direction;
  createdAt: number;
}

export interface TrackerState {
  currentRoomId: number | null;
  pendingMove: PendingMove | null;
}

export interface MapNode {
  vnum: number;
  name: string;
  exits: Direction[];
  closedExits: Direction[];
  visited: boolean;
}

export interface MapEdge {
  fromVnum: number;
  toVnum: number;
  direction: Direction;
  isPortal: boolean;
}

export interface MapSnapshot {
  nodes: MapNode[];
  edges: MapEdge[];
  currentVnum: number | null;
}

export interface MapAlias {
  vnum: number;
  alias: string;
}
