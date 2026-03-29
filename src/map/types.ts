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
    }
  | {
      kind: "mobs_in_room";
      mobs: string[];
    }
  | {
      kind: "corpses_in_room";
      count: number;
    };

export interface ParserState {
  lineBuffer: string;
  rawLineBuffer: string;
  pendingRoomHeader: {
    vnum: number;
    name: string;
  } | null;
  pendingMobs: string[];
  pendingCorpseCount: number;
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
  color?: string;
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
  zoneNames: Array<[number, string]>;
}

export interface MapAlias {
  vnum: number;
  alias: string;
}
