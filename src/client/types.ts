import type { SurvivalSettings } from "../events.type.ts";

export interface ConnectDefaults {
  autoConnect: boolean;
  host: string;
  port: number;
  tls: boolean;
  startupCommands: string[];
  commandDelayMs: number;
}

export interface ProfileInfo {
  id: string;
  name: string;
}

export interface ProfilesResponse {
  profiles: ProfileInfo[];
  defaultProfileId: string;
}

export type AnsiColorName =
  | "default"
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "bright-black"
  | "bright-red"
  | "bright-green"
  | "bright-yellow"
  | "bright-blue"
  | "bright-magenta"
  | "bright-cyan"
  | "bright-white";

export interface TerminalStyle {
  foreground: AnsiColorName;
  bold: boolean;
}

export interface AnsiSegment {
  text: string;
  style: TerminalStyle;
}

export interface MapNodePayload {
  vnum: number;
  name: string;
  exits: string[];
  closedExits: string[];
  visited: boolean;
  color?: string;
}

export interface MapEdgePayload {
  fromVnum: number;
  toVnum: number;
  direction: string;
  isPortal: boolean;
}

export interface MapSnapshotPayload {
  currentVnum: number | null;
  nodes: MapNodePayload[];
  edges: MapEdgePayload[];
  zoneNames: Array<[number, string]>;
}

export interface AliasPayload {
  vnum: number;
  alias: string;
}

export interface NavigationStatePayload {
  active: boolean;
  targetVnum: number | null;
  totalSteps: number;
  currentStep: number;
}

export interface GameItemPayload {
  name: string;
  itemType: string;
  data: Record<string, unknown>;
  firstSeen: string;
  lastSeen: string;
}

export interface FarmSettings {
  attackCommand: string;
  skinningSalvoEnabled: boolean;
  skinningSkinVerb: string;
  lootMeatCommand: string;
  lootHideCommand: string;
}

export interface FarmRuntimeStats {
  hp: number;
  hpMax: number;
  energy: number;
  energyMax: number;
}

export interface GridCell {
  vnum: number;
  gridX: number;
  gridY: number;
  zoneId: number;
  zLevel: number;
}

export interface NeighborZone {
  zoneId: number;
  entryVnums: number[];
}

export interface FarZone {
  zoneId: number;
  hops: number;
  entryVnums: number[];
}

export interface ZoneNode {
  zoneId: number;
  roomCount: number;
  visitedCount: number;
  gridX: number;
  gridY: number;
}

export interface ZoneEdge {
  fromZone: number;
  toZone: number;
  direction: string;
}

export type ColumnDef = { label: string; render: (data: Record<string, unknown>) => string; cls?: string };

export interface HotkeyEntry {
  key: string;
  command: string;
  combatCommand?: string;
  label: string;
}

export type CompareScanPayload = {
  hasShop: boolean;
  coins: number;
  slots: Array<{
    slot: string;
    currentItemName: string | null;
    currentScore: number;
    currentCard: {
      id: number;
      name: string;
      itemType: string;
      ac: number;
      armor: number;
      damageAvg: number;
      affects: string[];
      properties: string[];
      material: string;
      wearSlots: string[];
    } | null;
    candidates: Array<{
      itemId: number;
      itemName: string;
      price: number;
      listNumber: number;
      score: number;
      source: "shop" | "bazaar" | "inventory" | "guild_storage";
      hasGameData: boolean;
      card: {
        id: number;
        name: string;
        itemType: string;
        ac: number;
        armor: number;
        damageAvg: number;
        affects: string[];
        properties: string[];
        material: string;
        wearSlots: string[];
      };
    }>;
  }>;
  notFound: Array<{
    name: string;
    price: number;
    listNumber: number;
    source: "shop" | "bazaar" | "inventory" | "guild_storage";
  }>;
};

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
      payload: ConnectDefaults;
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
      payload: MapSnapshotPayload;
    }
  | {
      type: "map_update";
      payload: MapSnapshotPayload;
    }
  | {
       type: "farm2_state";
       payload: {
         enabled: boolean;
         zoneId: number | null;
         pendingActivation: boolean;
         attackCommand: string;
         targetValues: string[];
       };
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
        aliases: AliasPayload[];
      };
    }
  | {
      type: "navigation_state";
      payload: NavigationStatePayload;
    }
  | {
      type: "survival_status";
      payload: {
        foodEmpty: boolean;
        flaskEmpty: boolean;
      };
    }
  | {
      type: "farm_settings_data";
      payload: {
        zoneId: number;
        settings: FarmSettings | null;
      };
    }
  | {
      type: "survival_settings_data";
      payload: SurvivalSettings | null;
    }
   | {
       type: "triggers_state";
        payload: { dodge: boolean; standUp: boolean; rearm: boolean; curse: boolean; light: boolean; followLeader: boolean; assist: boolean; assistTanks: string[] };
    }
  | {
      type: "items_data";
      payload: {
        items: GameItemPayload[];
      };
    }
  | {
      type: "room_auto_commands_snapshot";
      payload: {
        entries: Array<{ vnum: number; command: string }>;
      };
    }
  | { type: "compare_scan_progress"; payload: { message: string } }
  | {
      type: "compare_scan_result";
      payload: CompareScanPayload;
    }
  | { type: "repair_state"; payload: { running: boolean; message: string } }
  | { type: "combat_state"; payload: { inCombat: boolean } }
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
  | { type: "gather_state"; payload: { enabled: boolean; bag: string } }
  | { type: "debug_log_state"; payload: { enabled: boolean } }
  | { type: "inventory_sort_result"; payload: { commands: Array<{ command: string }> } }
  | { type: "bazaar_max_price_response"; payload: { itemName: string; maxPrice: number | null } }
  | {
      type: "container_contents";
      payload: {
        container: "склад" | "расход" | "базар" | "хлам";
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
        items: Array<{ slot: string; name: string; keyword: string; wearCmd: string }>;
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
  | {
      type: "zone_script_state";
      payload: {
        enabled: boolean;
        zoneId: number | null;
        zoneName: string | null;
        currentStepIndex: number | null;
        steps: Array<{ index: number; label: string; status: string; error?: string }>;
        errorMessage: string | null;
      };
    };

export type ClientEvent =
  | {
      type: "connect";
      payload: Omit<ConnectDefaults, "autoConnect" | "startupCommands"> & { profileId?: string; startupCommands?: string[] };
    }
  | { type: "send"; payload: { command: string } }
  | { type: "disconnect" }
  | { type: "map_reset" }
  | { type: "map_reset_area" }
  | { type: "map_recording_toggle"; payload?: { enabled?: boolean } }
  | { type: "farm2_toggle"; payload?: { enabled?: boolean } }
  | { type: "alias_set"; payload: { vnum: number; alias: string } }
  | { type: "alias_delete"; payload: { vnum: number } }
  | { type: "navigate_to"; payload: { vnums: number[] } }
  | { type: "goto_and_run"; payload: { vnums: number[]; commands: string[]; action?: "buy_food" | "fill_flask" } }
  | { type: "navigate_stop" }
  | { type: "farm_settings_get"; payload: { zoneId: number } }
  | {
      type: "farm_settings_save";
      payload: {
        zoneId: number;
        settings: FarmSettings;
      };
    }
  | {
      type: "triggers_toggle";
      payload: { dodge?: boolean; standUp?: boolean; rearm?: boolean; curse?: boolean; light?: boolean; followLeader?: boolean; assist?: boolean; assistTanks?: string[] };
    }
  | { type: "item_db_get" }
  | { type: "room_auto_command_set"; payload: { vnum: number; command: string } }
  | { type: "room_auto_command_delete"; payload: { vnum: number } }
  | { type: "room_auto_commands_get" }
  | { type: "survival_settings_get" }
  | { type: "survival_settings_save"; payload: SurvivalSettings }
  | { type: "compare_scan_start" }
  | { type: "compare_apply"; payload: { commands: string[] } }
  | { type: "repair_start" }
  | { type: "wiki_item_search"; payload: { query: string } }
  | { type: "vorozhe_route_find"; payload: { from: string; to: string } }
  | { type: "gather_toggle"; payload?: { enabled?: boolean } }
  | { type: "gather_sell_bag" }
  | { type: "zone_name_set"; payload: { zoneId: number; name: string | null } }
  | { type: "debug_log_toggle"; payload?: { enabled?: boolean } }
  | { type: "attack_nearest" }
  | { type: "inspect_container"; payload: { container: "склад" | "расход" | "базар" | "хлам" } }
  | { type: "inspect_inventory" }
  | { type: "inventory_auto_sort"; payload: { items: Array<{ name: string; count: number }> } }
  | { type: "bazaar_max_price_request"; payload: { itemName: string } }
  | { type: "equipped_scan" }
  | { type: "zone_script_toggle"; payload?: { enabled?: boolean; zoneId?: number } }
  | { type: "farming_toggle"; payload?: { enabled?: boolean; zoneId?: number } };
