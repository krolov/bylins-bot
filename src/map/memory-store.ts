import type { MapAlias, MapEdge, MapNode, MapSnapshot } from "./types";
import type { GameItem, MapStore, MarketSale, MobName, QuestCompletion, RoomAutoCommand, ZoneScriptSettings } from "./store";

export function createMemoryMapStore(): MapStore {
  const rooms = new Map<number, MapNode>();
  const edges = new Map<string, MapEdge>();
  const aliases = new Map<number, string>();
  const autoCommands = new Map<number, string>();
  const questCompletions = new Map<string, QuestCompletion>();

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
        zoneNames: [],
      };
    },

    async getZoneSnapshot(currentVnum: number | null): Promise<MapSnapshot> {
      if (currentVnum === null) {
        return { currentVnum: null, nodes: [], edges: [], zoneNames: [] };
      }
      const zoneId = getZoneId(currentVnum);
      const zoneNodes = Array.from(rooms.values())
        .filter((n) => getZoneId(n.vnum) === zoneId)
        .sort((a, b) => a.vnum - b.vnum);
      const zoneEdges = Array.from(edges.values())
        .filter((e) => getZoneId(e.fromVnum) === zoneId || getZoneId(e.toVnum) === zoneId)
        .map((edge) => ({
          ...edge,
          isPortal: edge.isPortal || getZoneId(edge.fromVnum) !== getZoneId(edge.toVnum),
        }))
        .sort((a, b) => {
          if (a.fromVnum !== b.fromVnum) return a.fromVnum - b.fromVnum;
          if (a.toVnum !== b.toVnum) return a.toVnum - b.toVnum;
          return a.direction.localeCompare(b.direction);
        });
      return { currentVnum, nodes: zoneNodes, edges: zoneEdges, zoneNames: [] };
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

    async getFarmSettings(_profileId: string, _zoneId: number) {
      return null;
    },

    async setFarmSettings(_profileId: string, _zoneId: number, _settings: unknown): Promise<void> {},

    async getZoneScriptSettings(): Promise<ZoneScriptSettings> {
      return {};
    },

    async setZoneScriptSettings(_settings: ZoneScriptSettings): Promise<void> {},

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

    async getZoneNames(): Promise<Array<[number, string]>> {
      return [];
    },

    async setZoneName(_zoneId: number, _name: string): Promise<void> {},

    async deleteZoneName(_zoneId: number): Promise<void> {},

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

    async getQuestCompletions(): Promise<Record<string, QuestCompletion>> {
      return Object.fromEntries(questCompletions.entries());
    },

    async setQuestCompleted(questId: string): Promise<void> {
      const existing = questCompletions.get(questId);
      questCompletions.set(questId, {
        completedAt: new Date(),
        grivnas: existing?.grivnas ?? null,
      });
    },

    async setQuestGrivnas(questId: string, grivnas: number | null): Promise<void> {
      const existing = questCompletions.get(questId);
      questCompletions.set(questId, {
        completedAt: existing?.completedAt ?? new Date(),
        grivnas,
      });
    },

    async saveMobRoomName(_name: string, _vnum: number | null, _combatName?: string): Promise<void> {},

    async saveMobCombatName(_name: string, _vnum: number | null): Promise<void> {},

    async getMobNames(): Promise<MobName[]> {
      return [];
    },

    async getMobCombatNamesByZone(_zoneId: number): Promise<string[]> {
      return [];
    },

    async getCombatNameByRoomName(_roomName: string): Promise<string | null> {
      return null;
    },

    async isRoomNameBlacklisted(_roomName: string): Promise<boolean> {
      return false;
    },

    async saveChatMessage(_text: string, _timestamp: number): Promise<void> {},

    async getRecentChatMessages(): Promise<Array<{ text: string; timestamp: number }>> {
      return [];
    },

    async saveMarketSale(_sale: Omit<MarketSale, "id">): Promise<void> {},

    async getMarketSales(_limit?: number): Promise<MarketSale[]> {
      return [];
    },

    async getMarketMaxPrice(_itemName: string): Promise<number | null> {
      return null;
    },
  };
}

function getZoneId(vnum: number): number {
  return Math.floor(vnum / 100);
}
