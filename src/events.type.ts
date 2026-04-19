import type { MapAlias, MapSnapshot } from "./map/types.ts";
import type { FarmZoneSettings, SurvivalSettings, GameItem, ZoneScriptSettings } from "./map/store.ts";
import type { Farm2StateSnapshot } from "./farm2/index.ts";
import type { TriggerState } from "./triggers.ts";
import type { GatherState } from "./gather-script.ts";
import type { CompareScanResult } from "./compare-scan/index.ts";
import type { ZoneScriptStateSnapshot } from "./zone-scripts/index.ts";
import type { ContainerKey } from "./container-tracker.ts";

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
  | { type: "quests_get" }
  | { type: "quest_complete"; payload: { questId: string } }
  | { type: "quest_set_grivnas"; payload: { questId: string; grivnas: number | null } }
  | { type: "map_reset" }
  | { type: "map_reset_area" }
  | { type: "farm2_toggle"; payload?: { enabled?: boolean } }
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
  | { type: "zone_script_settings_save"; payload?: Partial<ZoneScriptSettings> }
  | { type: "survival_settings_get" }
  | { type: "survival_settings_save"; payload?: Partial<SurvivalSettings> }
  | { type: "triggers_toggle"; payload?: Partial<TriggerState> }
  | { type: "item_db_get" }
  | { type: "room_auto_command_set"; payload?: { vnum?: number; command?: string } }
  | { type: "room_auto_command_delete"; payload?: { vnum?: number } }
  | { type: "room_auto_commands_get" }
  | { type: "compare_scan_start" }
  | { type: "compare_apply"; payload: { commands: string[] } }
  | { type: "repair_start" }
  | { type: "map_recording_toggle"; payload?: { enabled?: boolean } }
  | { type: "wiki_item_search"; payload?: { query?: string } }
  | { type: "vorozhe_route_find"; payload?: { from?: string; to?: string } }
  | { type: "gather_toggle"; payload?: { enabled?: boolean } }
  | { type: "gather_sell_bag" }
  | { type: "zone_script_toggle"; payload?: { enabled?: boolean; zoneId?: number } }
  | { type: "farming_toggle"; payload?: { enabled?: boolean; zoneId?: number } }
  | { type: "farm2_loop_set"; payload: { enabled: boolean; delayMinutes: number } }
  | { type: "zone_script_loop_set"; payload: { enabled: boolean; delayMinutes: number } }
  | { type: "zone_name_set"; payload: { zoneId: number; name: string | null } }
  | { type: "debug_log_toggle"; payload?: { enabled?: boolean } }
  | { type: "attack_nearest" }
  | { type: "inspect_container"; payload: { container: ContainerKey } }
  | { type: "inspect_inventory" }
  | { type: "inventory_auto_sort"; payload: { items: Array<{ name: string; count: number }> } }
  | { type: "bazaar_max_price_request"; payload: { itemName: string } }
  | { type: "equipped_scan" };

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
      type: "quests_data";
      payload: {
        quests: Array<{
          id: string;
          name: string;
          region: string;
          wikiUrl: string;
          cooldownUntil: number | null;
          grivnas: number | null;
        }>;
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
      type: "farm2_state";
      payload: Farm2StateSnapshot;
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
      type: "zone_script_settings";
      payload: ZoneScriptSettings;
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
  | { type: "repair_state"; payload: { running: boolean; message: string } }
  | { type: "map_recording_state"; payload: { enabled: boolean } }
  | { type: "combat_state"; payload: { inCombat: boolean } }
  | { type: "compare_scan_progress"; payload: { message: string } }
  | {
      type: "compare_scan_result";
      payload: CompareScanResult;
    }
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
    }
  | {
      type: "vorozhe_route_result";
      payload: {
        from: string;
        to: string;
        found: boolean;
        steps: Array<{ from: string; to: string; items: string[] }>;
        totalItems: Record<string, number>;
      };
    }
  | { type: "gather_state"; payload: GatherState }
  | { type: "zone_script_state"; payload: ZoneScriptStateSnapshot }
  | {
      type: "zone_script_list";
      payload: Array<{ zoneId: number; zoneName: string; hundreds: number[]; stepLabels: string[] }>;
    }
  | { type: "debug_log_state"; payload: { enabled: boolean } }
  | {
      type: "inventory_sort_result";
      payload: {
        commands: Array<{ command: string }>;
      };
    }
  | { type: "bazaar_max_price_response"; payload: { itemName: string; maxPrice: number | null } }
  | {
      type: "container_contents";
      payload: {
        container: ContainerKey;
        items: Array<{ name: string; count: number }>;
      };
    }
  | {
      type: "inventory_contents";
      payload: {
        items: Array<{ name: string; count: number }>;
      };
    }
  | {
      type: "equipped_contents";
      payload: {
        items: Array<{ slot: string; name: string; keyword: string; wearCmd: string; correctlyMarked: boolean }>;
      };
    }
  | {
      type: "chat_message";
      payload: {
        text: string;
        timestamp: number;
      };
    }
  | {
      type: "chat_history";
      payload: {
        messages: Array<{ text: string; timestamp: number }>;
      };
    }
  | { type: "equip_all" };

export type {
  FarmZoneSettings,
  SurvivalSettings,
  GameItem,
  ZoneScriptSettings,
} from "./map/store.ts";
export type { Farm2StateSnapshot } from "./farm2/index.ts";
export type { ZoneScriptStateSnapshot } from "./zone-scripts/index.ts";
export type { TriggerState } from "./triggers.ts";
export type { MapAlias, MapSnapshot } from "./map/types.ts";
export type { GatherState } from "./gather-script.ts";
export type { CandidateSource, CompareSlotResult, CompareCandidate, CompareScanResult } from "./compare-scan/index.ts";
export type { ContainerKey } from "./container-tracker.ts";
