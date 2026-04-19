// Mock MapStore for the replay harness (SAFE-01 runtime; CONTEXT D-07).
//
// Satisfies the full `MapStore` interface from src/map/store.ts. Every method
// pushes a {kind:"mapStore.<method>", args:[...]} entry into the injected
// TranscriptSink and returns a minimal default — reads return empty arrays /
// null / {} to keep the pipeline moving; writes return Promise<void>. tsc
// guarantees completeness: adding a new MapStore method without updating this
// mock produces a typecheck error.
//
// No Postgres connection, no DB client import — hermetic spy.

import type { MapStore } from "../../src/map/store.ts";
import type {
  GameItem,
  MarketSale,
  MobName,
  QuestCompletion,
  RoomAutoCommand,
  ZoneScriptSettings,
} from "../../src/map/store.ts";
import type { MapAlias, MapEdge, MapSnapshot } from "../../src/map/types.ts";

import type { TranscriptSink } from "./fake-clock.ts";

export interface MockMapStoreDependencies {
  sink: TranscriptSink;
}

export function createMockMapStore(deps: MockMapStoreDependencies): MapStore {
  const { sink } = deps;

  function record(method: string, args: readonly unknown[]): void {
    sink.emit({ kind: `mapStore.${method}`, args });
  }

  function emptySnapshot(currentVnum: number | null): MapSnapshot {
    return { currentVnum, nodes: [], edges: [], zoneNames: [] };
  }

  return {
    async initialize(): Promise<void> {
      record("initialize", []);
    },
    async upsertRoom(vnum, name, exits, closedExits): Promise<void> {
      record("upsertRoom", [vnum, name, exits, closedExits]);
    },
    async upsertEdge(edge: MapEdge): Promise<void> {
      record("upsertEdge", [edge]);
    },
    async getSnapshot(currentVnum): Promise<MapSnapshot> {
      record("getSnapshot", [currentVnum]);
      return emptySnapshot(currentVnum);
    },
    async getZoneSnapshot(currentVnum): Promise<MapSnapshot> {
      record("getZoneSnapshot", [currentVnum]);
      return emptySnapshot(currentVnum);
    },
    async reset(): Promise<void> {
      record("reset", []);
    },
    async deleteZone(zoneId): Promise<void> {
      record("deleteZone", [zoneId]);
    },
    async setAlias(vnum, alias): Promise<void> {
      record("setAlias", [vnum, alias]);
    },
    async deleteAlias(vnum): Promise<void> {
      record("deleteAlias", [vnum]);
    },
    async getAliases(): Promise<MapAlias[]> {
      record("getAliases", []);
      return [];
    },
    async resolveAliasAll(alias): Promise<number[]> {
      record("resolveAliasAll", [alias]);
      return [];
    },
    async getFarmSettings(profileId, zoneId) {
      record("getFarmSettings", [profileId, zoneId]);
      return null;
    },
    async setFarmSettings(profileId, zoneId, settings): Promise<void> {
      record("setFarmSettings", [profileId, zoneId, settings]);
    },
    async getZoneScriptSettings(): Promise<ZoneScriptSettings> {
      record("getZoneScriptSettings", []);
      return {};
    },
    async setZoneScriptSettings(settings): Promise<void> {
      record("setZoneScriptSettings", [settings]);
    },
    async getSurvivalSettings() {
      record("getSurvivalSettings", []);
      return null;
    },
    async setSurvivalSettings(settings): Promise<void> {
      record("setSurvivalSettings", [settings]);
    },
    async getTriggerSettings(profileId) {
      record("getTriggerSettings", [profileId]);
      return null;
    },
    async setTriggerSettings(profileId, settings): Promise<void> {
      record("setTriggerSettings", [profileId, settings]);
    },
    async upsertItem(name, itemType, data, hasWikiData, hasGameData): Promise<void> {
      record("upsertItem", [name, itemType, data, hasWikiData, hasGameData]);
    },
    async getItemByName(name): Promise<GameItem | null> {
      record("getItemByName", [name]);
      return null;
    },
    async getItems(): Promise<GameItem[]> {
      record("getItems", []);
      return [];
    },
    async getZoneNames(): Promise<Array<[number, string]>> {
      record("getZoneNames", []);
      return [];
    },
    async setZoneName(zoneId, name): Promise<void> {
      record("setZoneName", [zoneId, name]);
    },
    async deleteZoneName(zoneId): Promise<void> {
      record("deleteZoneName", [zoneId]);
    },
    async setRoomAutoCommand(vnum, command): Promise<void> {
      record("setRoomAutoCommand", [vnum, command]);
    },
    async deleteRoomAutoCommand(vnum): Promise<void> {
      record("deleteRoomAutoCommand", [vnum]);
    },
    async getRoomAutoCommands(): Promise<RoomAutoCommand[]> {
      record("getRoomAutoCommands", []);
      return [];
    },
    async getRoomAutoCommand(vnum): Promise<string | null> {
      record("getRoomAutoCommand", [vnum]);
      return null;
    },
    async getQuestCompletions(): Promise<Record<string, QuestCompletion>> {
      record("getQuestCompletions", []);
      return {};
    },
    async setQuestCompleted(questId): Promise<void> {
      record("setQuestCompleted", [questId]);
    },
    async setQuestGrivnas(questId, grivnas): Promise<void> {
      record("setQuestGrivnas", [questId, grivnas]);
    },
    async saveMobRoomName(name, vnum, combatName): Promise<void> {
      record("saveMobRoomName", [name, vnum, combatName]);
    },
    async saveMobCombatName(name, vnum): Promise<void> {
      record("saveMobCombatName", [name, vnum]);
    },
    async getMobNames(): Promise<MobName[]> {
      record("getMobNames", []);
      return [];
    },
    async getMobCombatNamesByZone(zoneId): Promise<string[]> {
      record("getMobCombatNamesByZone", [zoneId]);
      return [];
    },
    async getCombatNameByRoomName(roomName): Promise<string | null> {
      record("getCombatNameByRoomName", [roomName]);
      return null;
    },
    async isRoomNameBlacklisted(roomName): Promise<boolean> {
      record("isRoomNameBlacklisted", [roomName]);
      return false;
    },
    async saveChatMessage(text, timestamp): Promise<void> {
      record("saveChatMessage", [text, timestamp]);
    },
    async getRecentChatMessages(): Promise<Array<{ text: string; timestamp: number }>> {
      record("getRecentChatMessages", []);
      return [];
    },
    async saveMarketSale(sale): Promise<void> {
      record("saveMarketSale", [sale]);
    },
    async getMarketSales(limit): Promise<MarketSale[]> {
      record("getMarketSales", [limit]);
      return [];
    },
    async getMarketMaxPrice(itemName): Promise<number | null> {
      record("getMarketMaxPrice", [itemName]);
      return null;
    },
  };
}
