import type { MapAlias, MapSnapshot } from "./map/types.ts";
import type { FarmZoneSettings, SurvivalSettings, AutoSpellsSettings, SneakSettings, GameItem } from "./map/store.ts";
import type { PeriodicActionConfig, FarmStateSnapshot } from "./farm-script.ts";
import type { TriggerState } from "./triggers.ts";
import type { GearScanRow, SellItem } from "./gear-scan.ts";

export interface WsData {
  sessionId: string;
}

export interface ConnectPayload {
  host?: string;
  port?: number;
  tls?: boolean;
  startupCommands?: string[];
  commandDelayMs?: number;
  profileId?: string;
}

export type ClientEvent =
  | { type: "connect"; payload?: ConnectPayload }
  | { type: "send"; payload?: { command?: string } }
  | { type: "disconnect" }
  | { type: "map_reset" }
  | { type: "map_reset_area" }
  | {
      type: "farm_toggle";
      payload?: {
        enabled?: boolean;
        targetValues?: string[];
        healCommands?: string[];
        healThresholdPercent?: number;
        fleeCommand?: string;
        fleeThresholdPercent?: number;
        lootValues?: string[];
        periodicAction?: {
          enabled?: boolean;
          gotoAlias1?: string;
          commands?: string[];
          commandDelayMs?: number;
          gotoAlias2?: string;
          intervalMs?: number;
        };
        useStab?: boolean;
      };
    }
  | { type: "alias_set"; payload?: { vnum?: number; alias?: string } }
  | { type: "alias_delete"; payload?: { vnum?: number } }
  | { type: "navigate_to"; payload?: { vnums?: number[] } }
  | { type: "goto_and_run"; payload?: { vnums?: number[]; commands?: string[]; action?: "buy_food" | "fill_flask" } }
  | { type: "navigate_stop" }
  | { type: "farm_settings_get"; payload?: { zoneId?: number } }
  | {
      type: "farm_settings_save";
      payload?: {
        zoneId?: number;
        settings?: Partial<FarmZoneSettings>;
      };
    }
  | { type: "survival_settings_get" }
  | { type: "survival_settings_save"; payload?: Partial<SurvivalSettings> }
  | { type: "triggers_toggle"; payload?: Partial<TriggerState> }
  | { type: "item_db_get" }
  | { type: "room_auto_command_set"; payload?: { vnum?: number; command?: string } }
  | { type: "room_auto_command_delete"; payload?: { vnum?: number } }
  | { type: "room_auto_commands_get" }
  | { type: "gear_scan_start" }
  | { type: "bazaar_scan_start" }
  | { type: "gear_sell"; payload: { sellCommand: string } }
  | { type: "gear_drop"; payload: { dropCommand: string } }
  | { type: "gear_apply"; payload: { commands: string[] } }
  | { type: "repair_start" }
  | { type: "auto_spells_settings_get" }
  | { type: "auto_spells_settings_save"; payload?: Partial<AutoSpellsSettings> }
  | { type: "sneak_settings_get" }
  | { type: "sneak_settings_save"; payload?: Partial<SneakSettings> }
  | { type: "map_recording_toggle"; payload?: { enabled?: boolean } }
  | { type: "wiki_item_search"; payload?: { query?: string } };

export type ServerEvent =
  | {
      type: "status";
      payload: {
        state: "idle" | "connecting" | "connected" | "disconnected" | "error";
        message: string;
      };
    }
  | {
      type: "defaults";
      payload: {
        autoConnect: boolean;
        host: string;
        port: number;
        tls: boolean;
        startupCommands: string[];
        commandDelayMs: number;
      };
    }
  | {
      type: "output";
      payload: {
        text: string;
      };
    }
  | {
      type: "error";
      payload: {
        message: string;
      };
    }
  | {
      type: "map_snapshot";
      payload: MapSnapshot;
    }
  | {
      type: "map_update";
      payload: MapSnapshot;
    }
  | {
      type: "farm_state";
      payload: FarmStateSnapshot;
    }
  | {
      type: "stats_update";
      payload: {
        hp: number;
        hpMax: number;
        energy: number;
        energyMax: number;
      };
    }
  | {
      type: "aliases_snapshot";
      payload: {
        aliases: MapAlias[];
      };
    }
  | {
      type: "navigation_state";
      payload: {
        active: boolean;
        targetVnum: number | null;
        totalSteps: number;
        currentStep: number;
      };
    }
  | {
      type: "farm_settings_data";
      payload: {
        zoneId: number;
        settings: FarmZoneSettings | null;
      };
    }
  | {
      type: "survival_settings_data";
      payload: SurvivalSettings | null;
    }
  | {
      type: "survival_status";
      payload: {
        foodEmpty: boolean;
        flaskEmpty: boolean;
      };
    }
  | {
      type: "triggers_state";
      payload: TriggerState;
    }
  | {
      type: "items_data";
      payload: {
        items: GameItem[];
      };
    }
  | {
      type: "room_auto_commands_snapshot";
      payload: {
        entries: Array<{ vnum: number; command: string }>;
      };
    }
  | { type: "gear_scan_progress"; payload: { message: string } }
  | {
      type: "gear_scan_result";
      payload: {
        coins: number;
        rows: GearScanRow[];
        sellItems: SellItem[];
      };
    }
  | { type: "bazaar_scan_progress"; payload: { message: string } }
  | {
      type: "bazaar_scan_result";
      payload: {
        coins: number;
        rows: GearScanRow[];
        sellItems: SellItem[];
      };
    }
  | { type: "repair_state"; payload: { running: boolean; message: string } }
  | {
      type: "auto_spells_settings_data";
      payload: AutoSpellsSettings | null;
    }
  | {
      type: "sneak_settings_data";
      payload: SneakSettings | null;
    }
  | { type: "map_recording_state"; payload: { enabled: boolean } }
  | {
      type: "wiki_item_search_result";
      payload: {
        query: string;
        found: boolean;
        name?: string;
        itemType?: string;
        text?: string;
        loadLocation?: string;
        error?: string;
      };
    };

export type {
  FarmZoneSettings,
  SurvivalSettings,
  AutoSpellsSettings,
  SneakSettings,
  GameItem,
} from "./map/store.ts";
export type { PeriodicActionConfig, FarmStateSnapshot } from "./farm-script.ts";
export type { TriggerState } from "./triggers.ts";
export type { MapAlias, MapSnapshot } from "./map/types.ts";
export type { GearScanRow, SellItem } from "./gear-scan.ts";
