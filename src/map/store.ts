import type { DatabaseClient } from "../db";
import type { MapAlias, MapEdge, MapNode, MapSnapshot } from "./types";

export interface FarmZoneSettings {
  targets: string;
  healCommands: string;
  healThreshold: number;
  loot: string;
  periodicActionEnabled: boolean;
  periodicActionGotoAlias1: string;
  periodicActionCommand: string;
  periodicActionGotoAlias2: string;
  periodicActionIntervalMin: number;
  survivalEnabled: boolean;
}

export interface SurvivalSettings {
  container: string;
  foodItems: string;
  flaskItems: string;
  buyFoodAlias: string;
  buyFoodCommands: string;
  fillFlaskAlias: string;
  fillFlaskCommands: string;
}

export interface GameItem {
  name: string;
  itemType: string;
  data: Record<string, unknown>;
  firstSeen: Date;
  lastSeen: Date;
}

export interface RoomAutoCommand {
  vnum: number;
  command: string;
}

export interface MapStore {
  initialize(): Promise<void>;
  upsertRoom(vnum: number, name: string, exits: MapNode["exits"], closedExits: MapNode["closedExits"]): Promise<void>;
  upsertEdge(edge: MapEdge): Promise<void>;
  getSnapshot(currentVnum: number | null): Promise<MapSnapshot>;
  reset(): Promise<void>;
  setAlias(vnum: number, alias: string): Promise<void>;
  deleteAlias(vnum: number): Promise<void>;
  getAliases(): Promise<MapAlias[]>;
  resolveAliasAll(alias: string): Promise<number[]>;
  getFarmSettings(zoneId: number): Promise<FarmZoneSettings | null>;
  setFarmSettings(zoneId: number, settings: FarmZoneSettings): Promise<void>;
  getSurvivalSettings(): Promise<SurvivalSettings | null>;
  setSurvivalSettings(settings: SurvivalSettings): Promise<void>;
  upsertItem(name: string, itemType: string, data: Record<string, unknown>): Promise<void>;
  getItems(): Promise<GameItem[]>;
  setRoomAutoCommand(vnum: number, command: string): Promise<void>;
  deleteRoomAutoCommand(vnum: number): Promise<void>;
  getRoomAutoCommands(): Promise<RoomAutoCommand[]>;
  getRoomAutoCommand(vnum: number): Promise<string | null>;
}

interface RoomRow {
  vnum: number;
  name: string;
  exits: string[];
  closed_exits: string[];
  visited: boolean;
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

interface ItemRow {
  name: string;
  item_type: string;
  data: Record<string, unknown>;
  first_seen: Date;
  last_seen: Date;
}

export function createMapStore(database: DatabaseClient): MapStore {
  return {
    async initialize(): Promise<void> {
      await database`
        CREATE TABLE IF NOT EXISTS map_rooms (
          vnum INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          exits TEXT[] NOT NULL DEFAULT '{}',
          closed_exits TEXT[] NOT NULL DEFAULT '{}',
          visited BOOLEAN NOT NULL DEFAULT TRUE,
          first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await database`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'map_rooms' AND column_name = 'exits'
          ) THEN
            ALTER TABLE map_rooms ADD COLUMN exits TEXT[] NOT NULL DEFAULT '{}';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'map_rooms' AND column_name = 'visited'
          ) THEN
            ALTER TABLE map_rooms ADD COLUMN visited BOOLEAN NOT NULL DEFAULT TRUE;
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'map_rooms' AND column_name = 'closed_exits'
          ) THEN
            ALTER TABLE map_rooms ADD COLUMN closed_exits TEXT[] NOT NULL DEFAULT '{}';
          END IF;
        END$$
      `;

      await database`
        CREATE TABLE IF NOT EXISTS map_edges (
          from_vnum INTEGER NOT NULL REFERENCES map_rooms(vnum) ON DELETE CASCADE,
          to_vnum INTEGER NOT NULL REFERENCES map_rooms(vnum) ON DELETE CASCADE,
          direction TEXT NOT NULL,
          is_portal BOOLEAN NOT NULL DEFAULT FALSE,
          first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (from_vnum, to_vnum, direction)
        )
      `;

      await database`CREATE INDEX IF NOT EXISTS map_edges_to_vnum_idx ON map_edges (to_vnum)`;

      await database`
        CREATE TABLE IF NOT EXISTS map_aliases (
          vnum INTEGER PRIMARY KEY REFERENCES map_rooms(vnum) ON DELETE CASCADE,
          alias TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await database`
        CREATE TABLE IF NOT EXISTS farm_zone_settings (
          zone_id INTEGER PRIMARY KEY,
          settings JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await database`
        CREATE TABLE IF NOT EXISTS game_items (
          name TEXT PRIMARY KEY,
          item_type TEXT NOT NULL,
          data JSONB NOT NULL DEFAULT '{}',
          first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await database`
        CREATE TABLE IF NOT EXISTS survival_settings (
          id INTEGER PRIMARY KEY DEFAULT 1,
          settings JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CHECK (id = 1)
        )
      `;

      await database`
        CREATE TABLE IF NOT EXISTS room_auto_commands (
          vnum INTEGER PRIMARY KEY REFERENCES map_rooms(vnum) ON DELETE CASCADE,
          command TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
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
        SELECT vnum, name, exits, closed_exits, visited
        FROM map_rooms
        ORDER BY vnum ASC
      `;

      const edges = await database<EdgeRow[]>`
        SELECT from_vnum, to_vnum, direction, is_portal
        FROM map_edges
        ORDER BY from_vnum ASC, to_vnum ASC, direction ASC
      `;

      return {
        currentVnum,
        nodes: nodes.map((node: RoomRow): MapNode => ({
          vnum: node.vnum,
          name: node.name,
          exits: (node.exits ?? []) as MapNode["exits"],
          closedExits: (node.closed_exits ?? []) as MapNode["closedExits"],
          visited: node.visited ?? true,
        })),
        edges: edges.map((edge: EdgeRow): MapEdge => ({
          fromVnum: edge.from_vnum,
          toVnum: edge.to_vnum,
          direction: edge.direction,
          isPortal: edge.is_portal || getZoneId(edge.from_vnum) !== getZoneId(edge.to_vnum),
        })),
      };
    },

    async reset(): Promise<void> {
      await database`TRUNCATE TABLE map_rooms CASCADE`;
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

    async getFarmSettings(zoneId: number): Promise<FarmZoneSettings | null> {
      const rows = await database<FarmSettingsRow[]>`
        SELECT settings FROM farm_zone_settings WHERE zone_id = ${zoneId}
      `;
      const raw = rows[0]?.settings ?? null;
      if (raw === null) return null;
      if (typeof raw === "string") return JSON.parse(raw) as FarmZoneSettings;
      return raw;
    },

    async setFarmSettings(zoneId: number, settings: FarmZoneSettings): Promise<void> {
      const settingsJson = JSON.stringify(settings);
      await database`
        INSERT INTO farm_zone_settings (zone_id, settings, updated_at)
        VALUES (${zoneId}, ${settingsJson}::jsonb, NOW())
        ON CONFLICT (zone_id)
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

    async upsertItem(name: string, itemType: string, data: Record<string, unknown>): Promise<void> {
      const dataJson = JSON.stringify(data);
      await database`
        INSERT INTO game_items (name, item_type, data, first_seen, last_seen)
        VALUES (${name}, ${itemType}, ${dataJson}::jsonb, NOW(), NOW())
        ON CONFLICT (name)
        DO UPDATE SET
          item_type = EXCLUDED.item_type,
          data = EXCLUDED.data,
          last_seen = NOW()
      `;
    },

    async getItems(): Promise<GameItem[]> {
      const rows = await database<ItemRow[]>`
        SELECT name, item_type, data, first_seen, last_seen
        FROM game_items
        ORDER BY name ASC
      `;
      return rows.map((row: ItemRow): GameItem => ({
        name: row.name,
        itemType: row.item_type,
        data: typeof row.data === "string" ? (JSON.parse(row.data) as Record<string, unknown>) : row.data,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
      }));
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
  };
}

function getZoneId(vnum: number): number {
  return Math.floor(vnum / 100);
}
