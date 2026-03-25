import type { MapAlias, MapEdge, MapNode, MapSnapshot } from "./types";
import type { GameItem, MapStore, RoomAutoCommand } from "./store";

export function createMemoryMapStore(): MapStore {
  const rooms = new Map<number, MapNode>();
  const edges = new Map<string, MapEdge>();
  const aliases = new Map<number, string>();
  const autoCommands = new Map<number, string>();

  return {
    async initialize(): Promise<void> {},

    async upsertRoom(vnum: number, name: string, exits: MapNode["exits"], closedExits: MapNode["closedExits"]): Promise<void> {
      rooms.set(vnum, {
        vnum,
        name,
        exits,
        closedExits,
        visited: true,
      });
    },

    async upsertEdge(edge: MapEdge): Promise<void> {
      const key = `${edge.fromVnum}:${edge.toVnum}:${edge.direction}`;
      edges.set(key, {
        ...edge,
        isPortal: edge.isPortal || getZoneId(edge.fromVnum) !== getZoneId(edge.toVnum),
      });

      if (!rooms.has(edge.toVnum)) {
        rooms.set(edge.toVnum, {
          vnum: edge.toVnum,
          name: "Unknown",
          exits: [],
          closedExits: [],
          visited: false,
        });
      }
    },

    async getSnapshot(currentVnum: number | null): Promise<MapSnapshot> {
      return {
        currentVnum,
        nodes: Array.from(rooms.values()).sort((a, b) => a.vnum - b.vnum),
        edges: Array.from(edges.values()).map((edge) => ({
          ...edge,
          isPortal: edge.isPortal || getZoneId(edge.fromVnum) !== getZoneId(edge.toVnum),
        })).sort((a, b) => {
          if (a.fromVnum !== b.fromVnum) return a.fromVnum - b.fromVnum;
          if (a.toVnum !== b.toVnum) return a.toVnum - b.toVnum;
          return a.direction.localeCompare(b.direction);
        }),
      };
    },

    async reset(): Promise<void> {
      rooms.clear();
      edges.clear();
    },

    async deleteZone(zoneId: number): Promise<void> {
      for (const vnum of rooms.keys()) {
        if (getZoneId(vnum) === zoneId) rooms.delete(vnum);
      }
      for (const [key, edge] of edges.entries()) {
        if (getZoneId(edge.fromVnum) === zoneId) edges.delete(key);
      }
    },

    async setAlias(vnum: number, alias: string): Promise<void> {
      aliases.set(vnum, alias);
    },

    async deleteAlias(vnum: number): Promise<void> {
      aliases.delete(vnum);
    },

    async getAliases(): Promise<MapAlias[]> {
      return Array.from(aliases.entries())
        .map(([vnum, alias]): MapAlias => ({ vnum, alias }))
        .sort((a, b) => a.alias.localeCompare(b.alias));
    },

    async resolveAliasAll(alias: string): Promise<number[]> {
      const result: number[] = [];
      for (const [vnum, a] of aliases.entries()) {
        if (a === alias) result.push(vnum);
      }
      return result;
    },

    async getFarmSettings(_zoneId: number) {
      return null;
    },

    async setFarmSettings(_zoneId: number, _settings: unknown): Promise<void> {},

    async getSurvivalSettings() {
      return null;
    },

    async setSurvivalSettings(_settings: unknown): Promise<void> {},

    async getTriggerSettings(_profileId: string) {
      return null;
    },

    async setTriggerSettings(_profileId: string, _settings: unknown): Promise<void> {},

    async upsertItem(_name: string, _itemType: string, _data: Record<string, unknown>): Promise<void> {},

    async getItemByName(_name: string): Promise<GameItem | null> {
      return null;
    },

    async getItems(): Promise<GameItem[]> {
      return [];
    },

    async setRoomAutoCommand(vnum: number, command: string): Promise<void> {
      autoCommands.set(vnum, command);
    },

    async deleteRoomAutoCommand(vnum: number): Promise<void> {
      autoCommands.delete(vnum);
    },

    async getRoomAutoCommands(): Promise<RoomAutoCommand[]> {
      return Array.from(autoCommands.entries())
        .map(([vnum, command]): RoomAutoCommand => ({ vnum, command }))
        .sort((a, b) => a.vnum - b.vnum);
    },

    async getRoomAutoCommand(vnum: number): Promise<string | null> {
      return autoCommands.get(vnum) ?? null;
    },

    async getAutoSpellsSettings(_profileId: string) {
      return null;
    },

    async setAutoSpellsSettings(_profileId: string, _settings: unknown): Promise<void> {},
  };
}

function getZoneId(vnum: number): number {
  return Math.floor(vnum / 100);
}
