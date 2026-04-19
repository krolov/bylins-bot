import type { DatabaseClient } from "../db";
import type { MapAlias, MapEdge, MapNode, MapSnapshot } from "./types";
import { runMigrations } from "./migrations/runner.ts";
export interface FarmZoneSettings {
  attackCommand: string;
  skinningSalvoEnabled: boolean;
  skinningSkinVerb: string;
  lootMeatCommand: string;
  lootHideCommand: string;
}

export interface ZoneScriptSettings {
  assistTarget?: string;
}

export interface SurvivalSettings {
  container: string;
  foodItem: string;
  eatCommand: string;
}

export interface TriggerSettings {
  dodge: boolean;
  standUp: boolean;
  rearm: boolean;
  assist?: boolean;
  assistTanks?: string[];
}

export interface GameItem {
  name: string;
  itemType: string;
  data: Record<string, unknown>;
  hasWikiData: boolean;
  hasGameData: boolean;
  firstSeen: Date;
  lastSeen: Date;
}

export interface MarketSale {
  id: number;
  source: "bazaar" | "auction";
  lotNumber: number | null;
  itemName: string;
  price: number;
  isOurs: boolean;
  soldAt: Date;
}

export interface MobName {
  id: number;
  roomName: string | null;
  combatName: string | null;
  lastSeenVnum: number | null;
  blacklisted: boolean;
  firstSeen: Date;
  lastSeen: Date;
}

export interface RoomAutoCommand {
  vnum: number;
  command: string;
}

interface QuestCompletionRow {
  quest_id: string;
  completed_at: Date;
  grivnas: number | null;
}

export interface QuestCompletion {
  completedAt: Date;
  grivnas: number | null;
}

export interface MapStore {
  initialize(): Promise<void>;
  upsertRoom(vnum: number, name: string, exits: MapNode["exits"], closedExits: MapNode["closedExits"]): Promise<void>;
  upsertEdge(edge: MapEdge): Promise<void>;
  getSnapshot(currentVnum: number | null): Promise<MapSnapshot>;
  getZoneSnapshot(currentVnum: number | null): Promise<MapSnapshot>;
  reset(): Promise<void>;
  deleteZone(zoneId: number): Promise<void>;
  setAlias(vnum: number, alias: string): Promise<void>;
  deleteAlias(vnum: number): Promise<void>;
  getAliases(): Promise<MapAlias[]>;
  resolveAliasAll(alias: string): Promise<number[]>;
  getFarmSettings(profileId: string, zoneId: number): Promise<FarmZoneSettings | null>;
  setFarmSettings(profileId: string, zoneId: number, settings: FarmZoneSettings): Promise<void>;
  getZoneScriptSettings(): Promise<ZoneScriptSettings>;
  setZoneScriptSettings(settings: ZoneScriptSettings): Promise<void>;
  getSurvivalSettings(): Promise<SurvivalSettings | null>;
  setSurvivalSettings(settings: SurvivalSettings): Promise<void>;
  getTriggerSettings(profileId: string): Promise<TriggerSettings | null>;
  setTriggerSettings(profileId: string, settings: TriggerSettings): Promise<void>;
  upsertItem(name: string, itemType: string, data: Record<string, unknown>, hasWikiData: boolean, hasGameData: boolean): Promise<void>;
  getItemByName(name: string): Promise<GameItem | null>;
  getItems(): Promise<GameItem[]>;
  getZoneNames(): Promise<Array<[number, string]>>;
  setZoneName(zoneId: number, name: string): Promise<void>;
  deleteZoneName(zoneId: number): Promise<void>;
  setRoomAutoCommand(vnum: number, command: string): Promise<void>;
  deleteRoomAutoCommand(vnum: number): Promise<void>;
  getRoomAutoCommands(): Promise<RoomAutoCommand[]>;
  getRoomAutoCommand(vnum: number): Promise<string | null>;
  getQuestCompletions(): Promise<Record<string, QuestCompletion>>;
  setQuestCompleted(questId: string): Promise<void>;
  setQuestGrivnas(questId: string, grivnas: number | null): Promise<void>;
  saveMobRoomName(name: string, vnum: number | null, combatName?: string): Promise<void>;
  saveMobCombatName(name: string, vnum: number | null): Promise<void>;
  getMobNames(): Promise<MobName[]>;
  getMobCombatNamesByZone(zoneId: number): Promise<string[]>;
  getCombatNameByRoomName(roomName: string): Promise<string | null>;
  isRoomNameBlacklisted(roomName: string): Promise<boolean>;
  saveChatMessage(text: string, timestamp: number): Promise<void>;
  getRecentChatMessages(): Promise<Array<{ text: string; timestamp: number }>>;
  saveMarketSale(sale: Omit<MarketSale, "id">): Promise<void>;
  getMarketSales(limit?: number): Promise<MarketSale[]>;
  getMarketMaxPrice(itemName: string): Promise<number | null>;
}

interface RoomRow {
  vnum: number;
  name: string;
  exits: string[];
  closed_exits: string[];
  visited: boolean;
  color: string | null;
}

interface EdgeRow {
  from_vnum: number;
  to_vnum: number;
  direction: MapEdge["direction"];
  is_portal: boolean;
}

interface AliasRow {
  vnum: number;
  alias: string;
}

interface FarmSettingsRow {
  settings: FarmZoneSettings;
}

interface ZoneScriptSettingsRow {
  settings: ZoneScriptSettings;
}

interface ItemRow {
  name: string;
  item_type: string;
  data: Record<string, unknown>;
  has_wiki_data: boolean;
  has_game_data: boolean;
  first_seen: Date;
  last_seen: Date;
}

interface MobNameRow {
  id: number;
  room_name: string | null;
  combat_name: string | null;
  last_seen_vnum: number | null;
  blacklisted: boolean;
  first_seen: Date;
  last_seen: Date;
}

function parseItemData(raw: unknown): Record<string, unknown> {
  const step1 = typeof raw === "string" ? JSON.parse(raw) : raw;
  const step2 = typeof step1 === "string" ? JSON.parse(step1) : step1;
  return step2 as Record<string, unknown>;
}

export function createMapStore(database: DatabaseClient): MapStore {
  return {
    async initialize(): Promise<void> {
      await runMigrations(database);
    },

    async upsertRoom(vnum: number, name: string, exits: MapNode["exits"], closedExits: MapNode["closedExits"]): Promise<void> {
      await database`
        INSERT INTO map_rooms (vnum, name, exits, closed_exits, visited)
        VALUES (${vnum}, ${name}, ${exits}, ${closedExits}, TRUE)
        ON CONFLICT (vnum)
        DO UPDATE SET
          name = EXCLUDED.name,
          exits = EXCLUDED.exits,
          closed_exits = EXCLUDED.closed_exits,
          visited = TRUE,
          last_seen = NOW()
      `;
    },

    async upsertEdge(edge: MapEdge): Promise<void> {
      const normalizedIsPortal = edge.isPortal || getZoneId(edge.fromVnum) !== getZoneId(edge.toVnum);

      await database`
        INSERT INTO map_rooms (vnum, name, exits, visited)
        VALUES (${edge.toVnum}, ${"Unknown"}, ${[] as string[]}, FALSE)
        ON CONFLICT (vnum)
        DO NOTHING
      `;

      interface ConflictRow { to_vnum: number; is_portal: boolean }
      const conflicts = await database<ConflictRow[]>`
        SELECT to_vnum, is_portal
        FROM map_edges
        WHERE from_vnum = ${edge.fromVnum}
          AND direction = ${edge.direction}
          AND to_vnum != ${edge.toVnum}
      `;

      for (const conflict of conflicts) {
        if (!conflict.is_portal) {
          return;
        }
        await database`
          DELETE FROM map_edges
          WHERE from_vnum = ${edge.fromVnum}
            AND to_vnum = ${conflict.to_vnum}
            AND direction = ${edge.direction}
        `;
      }

      await database`
        INSERT INTO map_edges (from_vnum, to_vnum, direction, is_portal)
        VALUES (${edge.fromVnum}, ${edge.toVnum}, ${edge.direction}, ${normalizedIsPortal})
        ON CONFLICT (from_vnum, to_vnum, direction)
        DO UPDATE SET
          is_portal = EXCLUDED.is_portal,
          last_seen = NOW()
      `;
    },

    async getSnapshot(currentVnum: number | null): Promise<MapSnapshot> {
      const nodes = await database<RoomRow[]>`
        SELECT r.vnum, r.name, r.exits, r.closed_exits, r.visited,
               COALESCE(c.color, r.color) AS color
        FROM map_rooms r
        LEFT JOIN room_colors c ON c.vnum = r.vnum
        ORDER BY r.vnum ASC
      `;

      const edges = await database<EdgeRow[]>`
        SELECT from_vnum, to_vnum, direction, is_portal
        FROM map_edges
        ORDER BY from_vnum ASC, to_vnum ASC, direction ASC
      `;

      const zoneNameRows = await database<{ zone_id: number; name: string }[]>`
        SELECT zone_id, name FROM zone_names ORDER BY zone_id ASC
      `;

      return {
        currentVnum,
        nodes: nodes.map((node: RoomRow): MapNode => ({
          vnum: node.vnum,
          name: node.name,
          exits: (node.exits ?? []) as MapNode["exits"],
          closedExits: (node.closed_exits ?? []) as MapNode["closedExits"],
          visited: node.visited ?? true,
          color: node.color ?? undefined,
        })),
        edges: edges.map((edge: EdgeRow): MapEdge => ({
          fromVnum: edge.from_vnum,
          toVnum: edge.to_vnum,
          direction: edge.direction,
          isPortal: edge.is_portal || getZoneId(edge.from_vnum) !== getZoneId(edge.to_vnum),
        })),
        zoneNames: zoneNameRows.map((row) => [row.zone_id, row.name]),
      };
    },

    async getZoneSnapshot(currentVnum: number | null): Promise<MapSnapshot> {
      if (currentVnum === null) {
        return { currentVnum: null, nodes: [], edges: [], zoneNames: [] };
      }

      const zoneId = getZoneId(currentVnum);
      const zoneMin = zoneId * 100;
      const zoneMax = zoneId * 100 + 99;

      const nodes = await database<RoomRow[]>`
        SELECT r.vnum, r.name, r.exits, r.closed_exits, r.visited,
               COALESCE(c.color, r.color) AS color
        FROM map_rooms r
        LEFT JOIN room_colors c ON c.vnum = r.vnum
        WHERE r.vnum >= ${zoneMin} AND r.vnum <= ${zoneMax}
        ORDER BY r.vnum ASC
      `;

      const edges = await database<EdgeRow[]>`
        SELECT from_vnum, to_vnum, direction, is_portal
        FROM map_edges
        WHERE (from_vnum >= ${zoneMin} AND from_vnum <= ${zoneMax})
           OR (to_vnum >= ${zoneMin} AND to_vnum <= ${zoneMax})
        ORDER BY from_vnum ASC, to_vnum ASC, direction ASC
      `;

      const zoneNameRows = await database<{ zone_id: number; name: string }[]>`
        SELECT zone_id, name FROM zone_names ORDER BY zone_id ASC
      `;

      return {
        currentVnum,
        nodes: nodes.map((node: RoomRow): MapNode => ({
          vnum: node.vnum,
          name: node.name,
          exits: (node.exits ?? []) as MapNode["exits"],
          closedExits: (node.closed_exits ?? []) as MapNode["closedExits"],
          visited: node.visited ?? true,
          color: node.color ?? undefined,
        })),
        edges: edges.map((edge: EdgeRow): MapEdge => ({
          fromVnum: edge.from_vnum,
          toVnum: edge.to_vnum,
          direction: edge.direction,
          isPortal: edge.is_portal || getZoneId(edge.from_vnum) !== getZoneId(edge.to_vnum),
        })),
        zoneNames: zoneNameRows.map((row) => [row.zone_id, row.name]),
      };
    },

    async reset(): Promise<void> {
      await database`TRUNCATE TABLE map_rooms CASCADE`;
    },

    async deleteZone(zoneId: number): Promise<void> {
      await database`DELETE FROM map_rooms WHERE FLOOR(vnum::float / 100) = ${zoneId}`;
    },

    async setAlias(vnum: number, alias: string): Promise<void> {
      await database`
        INSERT INTO map_aliases (vnum, alias)
        VALUES (${vnum}, ${alias})
        ON CONFLICT (vnum)
        DO UPDATE SET alias = EXCLUDED.alias
      `;
    },

    async deleteAlias(vnum: number): Promise<void> {
      await database`DELETE FROM map_aliases WHERE vnum = ${vnum}`;
    },

    async getAliases(): Promise<MapAlias[]> {
      const rows = await database<AliasRow[]>`
        SELECT vnum, alias FROM map_aliases ORDER BY alias ASC
      `;
      return rows.map((row: AliasRow): MapAlias => ({
        vnum: row.vnum,
        alias: row.alias,
      }));
    },

    async resolveAliasAll(alias: string): Promise<number[]> {
      const rows = await database<AliasRow[]>`
        SELECT vnum FROM map_aliases WHERE LOWER(alias) = LOWER(${alias})
      `;
      return rows.map((row: AliasRow) => row.vnum);
    },

    async getFarmSettings(profileId: string, zoneId: number): Promise<FarmZoneSettings | null> {
      const rows = await database<FarmSettingsRow[]>`
        SELECT settings FROM farm_zone_settings WHERE profile_id = ${profileId} AND zone_id = ${zoneId}
      `;
      const raw = rows[0]?.settings ?? null;
      if (raw === null) return null;
      if (typeof raw === "string") return JSON.parse(raw) as FarmZoneSettings;
      return raw;
    },

    async setFarmSettings(profileId: string, zoneId: number, settings: FarmZoneSettings): Promise<void> {
      const settingsJson = JSON.stringify(settings);
      await database`
        INSERT INTO farm_zone_settings (profile_id, zone_id, settings, updated_at)
        VALUES (${profileId}, ${zoneId}, ${settingsJson}::jsonb, NOW())
        ON CONFLICT (profile_id, zone_id)
        DO UPDATE SET
          settings = EXCLUDED.settings,
          updated_at = NOW()
      `;
    },

    async getZoneScriptSettings(): Promise<ZoneScriptSettings> {
      const rows = await database<ZoneScriptSettingsRow[]>`
        SELECT settings FROM zone_script_settings WHERE id = 'global'
      `;
      const raw = rows[0]?.settings;
      if (raw === undefined || raw === null) return {};
      if (typeof raw === "string") return JSON.parse(raw) as ZoneScriptSettings;
      return raw;
    },

    async setZoneScriptSettings(settings: ZoneScriptSettings): Promise<void> {
      const settingsJson = JSON.stringify(settings);
      await database`
        INSERT INTO zone_script_settings (id, settings, updated_at)
        VALUES ('global', ${settingsJson}::jsonb, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          settings = EXCLUDED.settings,
          updated_at = NOW()
      `;
    },

    async getSurvivalSettings(): Promise<SurvivalSettings | null> {
      const rows = await database<{ settings: SurvivalSettings }[]>`
        SELECT settings FROM survival_settings WHERE id = 1
      `;
      const raw = rows[0]?.settings ?? null;
      if (raw === null) return null;
      if (typeof raw === "string") return JSON.parse(raw) as SurvivalSettings;
      return raw;
    },

    async setSurvivalSettings(settings: SurvivalSettings): Promise<void> {
      const settingsJson = JSON.stringify(settings);
      await database`
        INSERT INTO survival_settings (id, settings, updated_at)
        VALUES (1, ${settingsJson}::jsonb, NOW())
        ON CONFLICT (id)
        DO UPDATE SET
          settings = EXCLUDED.settings,
          updated_at = NOW()
      `;
    },

    async getTriggerSettings(profileId: string): Promise<TriggerSettings | null> {
      const rows = await database<{ settings: TriggerSettings }[]>`
        SELECT settings FROM trigger_settings WHERE profile_id = ${profileId}
      `;
      const raw = rows[0]?.settings ?? null;
      if (raw === null) return null;
      if (typeof raw === "string") return JSON.parse(raw) as TriggerSettings;
      return raw;
    },

    async setTriggerSettings(profileId: string, settings: TriggerSettings): Promise<void> {
      const settingsJson = JSON.stringify(settings);
      await database`
        INSERT INTO trigger_settings (profile_id, settings, updated_at)
        VALUES (${profileId}, ${settingsJson}::jsonb, NOW())
        ON CONFLICT (profile_id)
        DO UPDATE SET
          settings = EXCLUDED.settings,
          updated_at = NOW()
      `;
    },

    async upsertItem(name: string, itemType: string, data: Record<string, unknown>, hasWikiData: boolean, hasGameData: boolean): Promise<void> {
      const dataJson = JSON.stringify(data);
      await database`
        INSERT INTO game_items (name, item_type, data, has_wiki_data, has_game_data, first_seen, last_seen)
        VALUES (${name}, ${itemType}, ${dataJson}::jsonb, ${hasWikiData}, ${hasGameData}, NOW(), NOW())
        ON CONFLICT (name)
        DO UPDATE SET
          item_type = EXCLUDED.item_type,
          data = EXCLUDED.data,
          has_wiki_data = EXCLUDED.has_wiki_data OR game_items.has_wiki_data,
          has_game_data = EXCLUDED.has_game_data OR game_items.has_game_data,
          last_seen = NOW()
      `;
    },

    async getItemByName(name: string): Promise<GameItem | null> {
      const rows = await database<ItemRow[]>`
        SELECT name, item_type, data, has_wiki_data, has_game_data, first_seen, last_seen
        FROM game_items
        WHERE name = ${name}
        LIMIT 1
      `;
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        name: row.name,
        itemType: row.item_type,
        data: parseItemData(row.data),
        hasWikiData: row.has_wiki_data,
        hasGameData: row.has_game_data,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
      };
    },

    async getItems(): Promise<GameItem[]> {
      const rows = await database<ItemRow[]>`
        SELECT name, item_type, data, has_wiki_data, has_game_data, first_seen, last_seen
        FROM game_items
        ORDER BY name ASC
      `;
      return rows.map((row: ItemRow): GameItem => ({
        name: row.name,
        itemType: row.item_type,
        data: parseItemData(row.data),
        hasWikiData: row.has_wiki_data,
        hasGameData: row.has_game_data,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
      }));
    },

    async getZoneNames(): Promise<Array<[number, string]>> {
      const rows = await database<{ zone_id: number; name: string }[]>`
        SELECT zone_id, name FROM zone_names ORDER BY zone_id ASC
      `;
      return rows.map((row) => [row.zone_id, row.name]);
    },

    async setZoneName(zoneId: number, name: string): Promise<void> {
      await database`
        INSERT INTO zone_names (zone_id, name)
        VALUES (${zoneId}, ${name})
        ON CONFLICT (zone_id) DO UPDATE SET name = EXCLUDED.name
      `;
    },

    async deleteZoneName(zoneId: number): Promise<void> {
      await database`DELETE FROM zone_names WHERE zone_id = ${zoneId}`;
    },

    async setRoomAutoCommand(vnum: number, command: string): Promise<void> {
      await database`
        INSERT INTO room_auto_commands (vnum, command)
        VALUES (${vnum}, ${command})
        ON CONFLICT (vnum)
        DO UPDATE SET command = EXCLUDED.command
      `;
    },

    async deleteRoomAutoCommand(vnum: number): Promise<void> {
      await database`DELETE FROM room_auto_commands WHERE vnum = ${vnum}`;
    },

    async getRoomAutoCommands(): Promise<RoomAutoCommand[]> {
      const rows = await database<{ vnum: number; command: string }[]>`
        SELECT vnum, command FROM room_auto_commands ORDER BY vnum ASC
      `;
      return rows.map((row) => ({ vnum: row.vnum, command: row.command }));
    },

    async getRoomAutoCommand(vnum: number): Promise<string | null> {
      const rows = await database<{ command: string }[]>`
        SELECT command FROM room_auto_commands WHERE vnum = ${vnum}
      `;
      return rows[0]?.command ?? null;
    },

    async getQuestCompletions(): Promise<Record<string, QuestCompletion>> {
      const rows = await database<QuestCompletionRow[]>`
        SELECT quest_id, completed_at, grivnas
        FROM quest_completions
      `;

      return Object.fromEntries(rows.map((row) => [row.quest_id, { completedAt: row.completed_at, grivnas: row.grivnas } satisfies QuestCompletion]));
    },

    async setQuestCompleted(questId: string): Promise<void> {
      await database`
        INSERT INTO quest_completions (quest_id, completed_at)
        VALUES (${questId}, NOW())
        ON CONFLICT (quest_id)
        DO UPDATE SET completed_at = EXCLUDED.completed_at
      `;
    },

    async setQuestGrivnas(questId: string, grivnas: number | null): Promise<void> {
      await database`
        INSERT INTO quest_completions (quest_id, grivnas)
        VALUES (${questId}, ${grivnas})
        ON CONFLICT (quest_id)
        DO UPDATE SET grivnas = EXCLUDED.grivnas
      `;
    },

    async saveMobRoomName(name: string, vnum: number | null, combatName?: string): Promise<void> {
      if (combatName !== undefined) {
        await database`
          INSERT INTO mob_names (room_name, combat_name, last_seen_vnum, first_seen, last_seen)
          VALUES (${name}, ${combatName}, ${vnum}, NOW(), NOW())
          ON CONFLICT (room_name)
          DO UPDATE SET
            combat_name = EXCLUDED.combat_name,
            last_seen_vnum = EXCLUDED.last_seen_vnum,
            last_seen = NOW()
        `;
      } else {
        await database`
          INSERT INTO mob_names (room_name, last_seen_vnum, first_seen, last_seen)
          VALUES (${name}, ${vnum}, NOW(), NOW())
          ON CONFLICT (room_name)
          DO UPDATE SET
            last_seen_vnum = EXCLUDED.last_seen_vnum,
            last_seen = NOW()
        `;
      }
    },

    async saveMobCombatName(name: string, vnum: number | null): Promise<void> {
      await database`
        INSERT INTO mob_names (combat_name, last_seen_vnum, first_seen, last_seen)
        SELECT ${name}, ${vnum}, NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM mob_names WHERE combat_name = ${name}
        )
      `;
      await database`
        UPDATE mob_names
        SET last_seen = NOW(), last_seen_vnum = ${vnum}
        WHERE combat_name = ${name}
      `;
    },

    async getMobNames(): Promise<MobName[]> {
      const rows = await database<MobNameRow[]>`
        SELECT id, room_name, combat_name, last_seen_vnum, blacklisted, first_seen, last_seen
        FROM mob_names
        ORDER BY id ASC
      `;
      return rows.map((row: MobNameRow): MobName => ({
        id: row.id,
        roomName: row.room_name,
        combatName: row.combat_name,
        lastSeenVnum: row.last_seen_vnum,
        blacklisted: row.blacklisted,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
      }));
    },

    async getMobCombatNamesByZone(zoneId: number): Promise<string[]> {
      const rows = await database<{ combat_name: string }[]>`
        SELECT combat_name
        FROM mob_names
        WHERE combat_name IS NOT NULL
          AND last_seen_vnum IS NOT NULL
          AND blacklisted = FALSE
          AND FLOOR(last_seen_vnum::float / 100) = ${zoneId}
      `;
      return rows.map((row) => row.combat_name);
    },

    async getCombatNameByRoomName(roomName: string): Promise<string | null> {
      const rows = await database<{ combat_name: string | null }[]>`
        SELECT combat_name
        FROM mob_names
        WHERE room_name = ${roomName}
          AND combat_name IS NOT NULL
          AND blacklisted = FALSE
        LIMIT 1
      `;
      return rows[0]?.combat_name ?? null;
    },

    async isRoomNameBlacklisted(roomName: string): Promise<boolean> {
      const rows = await database<{ blacklisted: boolean }[]>`
        SELECT blacklisted
        FROM mob_names
        WHERE room_name = ${roomName}
          AND blacklisted = TRUE
        LIMIT 1
      `;
      return rows.length > 0;
    },

    async saveChatMessage(text: string, timestamp: number): Promise<void> {
      await database`
        INSERT INTO chat_messages (text, ts) VALUES (${text}, ${timestamp})
      `;
    },

    async getRecentChatMessages(): Promise<Array<{ text: string; timestamp: number }>> {
      const rows = await database<{ text: string; ts: string }[]>`
        SELECT text, ts FROM chat_messages ORDER BY ts ASC
      `;
      return rows.map((r) => ({ text: r.text, timestamp: Number(r.ts) }));
    },

    async saveMarketSale(sale: Omit<MarketSale, "id">): Promise<void> {
      await database`
        INSERT INTO market_sales (source, lot_number, item_name, price, is_ours, sold_at)
        VALUES (${sale.source}, ${sale.lotNumber}, ${sale.itemName}, ${sale.price}, ${sale.isOurs}, ${sale.soldAt})
      `;
    },

    async getMarketSales(limit = 200): Promise<MarketSale[]> {
      const rows = await database<{
        id: string;
        source: string;
        lot_number: number | null;
        item_name: string;
        price: number;
        is_ours: boolean;
        sold_at: Date;
      }[]>`
        SELECT id, source, lot_number, item_name, price, is_ours, sold_at
        FROM market_sales
        ORDER BY sold_at DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({
        id: Number(r.id),
        source: r.source as "bazaar" | "auction",
        lotNumber: r.lot_number,
        itemName: r.item_name,
        price: r.price,
        isOurs: r.is_ours,
        soldAt: r.sold_at,
      }));
    },
    async getMarketMaxPrice(itemName: string): Promise<number | null> {
      const rows = await database<{ max_price: number | null }[]>`
        SELECT MAX(price)::int AS max_price
        FROM market_sales
        WHERE item_name = ${itemName}
      `;
      return rows[0]?.max_price ?? null;
    },
  };
}

function getZoneId(vnum: number): number {
  return Math.floor(vnum / 100);
}
