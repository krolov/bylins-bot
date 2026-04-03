interface ConnectDefaults {
  autoConnect: boolean;
  host: string;
  port: number;
  tls: boolean;
  startupCommands: string[];
  commandDelayMs: number;
}

interface ProfileInfo {
  id: string;
  name: string;
}

interface ProfilesResponse {
  profiles: ProfileInfo[];
  defaultProfileId: string;
}

type AnsiColorName =
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

interface TerminalStyle {
  foreground: AnsiColorName;
  bold: boolean;
}

interface AnsiSegment {
  text: string;
  style: TerminalStyle;
}

interface MapNodePayload {
  vnum: number;
  name: string;
  exits: string[];
  closedExits: string[];
  visited: boolean;
  color?: string;
}

interface MapEdgePayload {
  fromVnum: number;
  toVnum: number;
  direction: string;
  isPortal: boolean;
}

interface MapSnapshotPayload {
  currentVnum: number | null;
  nodes: MapNodePayload[];
  edges: MapEdgePayload[];
  zoneNames: Array<[number, string]>;
}

interface AliasPayload {
  vnum: number;
  alias: string;
}

interface NavigationStatePayload {
  active: boolean;
  targetVnum: number | null;
  totalSteps: number;
  currentStep: number;
}

interface GameItemPayload {
  name: string;
  itemType: string;
  data: Record<string, unknown>;
  firstSeen: string;
  lastSeen: string;
}

type ServerEvent =
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
      payload: {
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
            source: "shop" | "bazaar" | "inventory";
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
      };
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
  | {
      type: "container_contents";
      payload: {
        container: "bag" | "chest";
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

type ClientEvent =
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
  | { type: "inspect_container"; payload: { container: "bag" | "chest" } }
  | { type: "inspect_inventory" }
| { type: "equipped_scan" }
| { type: "zone_script_toggle"; payload?: { enabled?: boolean; zoneId?: number } }
| { type: "farming_toggle"; payload?: { enabled?: boolean; zoneId?: number } };

import type { SurvivalSettings } from "./events.type.ts";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing required UI element: ${selector}`);
  }

  return element;
}

const connectForm = requireElement<HTMLFormElement>("#connect-form");
const commandForm = requireElement<HTMLFormElement>("#command-form");
const hostInput = requireElement<HTMLInputElement>("#host");
const portInput = requireElement<HTMLInputElement>("#port");
const tlsInput = requireElement<HTMLInputElement>("#tls");
const profileSelectInput = requireElement<HTMLSelectElement>("#profile-select");
const startupCommandsInput = requireElement<HTMLTextAreaElement>("#startup-commands");
const commandDelayInput = requireElement<HTMLInputElement>("#command-delay-ms");
const commandInput = requireElement<HTMLInputElement>("#command-input");
const statusElement = requireElement<HTMLElement>("#status");
const outputElement = requireElement<HTMLElement>("#output");
const chatOutputElement = requireElement<HTMLDivElement>("#chat-output");
const chatClearButton = requireElement<HTMLButtonElement>("#chat-clear-btn");
const disconnectButton = requireElement<HTMLButtonElement>("#disconnect-button");
const clearOutputButton = requireElement<HTMLButtonElement>("#clear-output-button");
const resetMapButton = requireElement<HTMLButtonElement>("#reset-map-button");
const zLevelDownButton = requireElement<HTMLButtonElement>("#z-level-down");
const zLevelUpButton = requireElement<HTMLButtonElement>("#z-level-up");
const zLevelLabel = requireElement<HTMLSpanElement>("#z-level-label");
const farmToggleButton = requireElement<HTMLButtonElement>("#farm-toggle-button");
const farmSettingsButton = requireElement<HTMLButtonElement>("#farm-settings-button");
const mapCanvasElement = requireElement<HTMLDivElement>("#map-canvas");
const hpBarFill = requireElement<HTMLElement>("#hp-bar-fill");
const hpBarLabel = requireElement<HTMLElement>("#hp-bar-label");
const energyBarFill = requireElement<HTMLElement>("#energy-bar-fill");
const energyBarLabel = requireElement<HTMLElement>("#energy-bar-label");
const mapTabMap = requireElement<HTMLButtonElement>("#map-tab-map");
const mapPanelMap = requireElement<HTMLDivElement>("#map-panel-map");
const containerTabInventory = requireElement<HTMLButtonElement>("#container-tab-inventory");
const containerTabNav = requireElement<HTMLButtonElement>("#container-tab-nav");
const containerTabScript = requireElement<HTMLButtonElement>("#container-tab-script");
const containerPanelInventory = requireElement<HTMLDivElement>("#container-panel-inventory");
const containerPanelNav = requireElement<HTMLDivElement>("#container-panel-nav");
const containerPanelScript = requireElement<HTMLDivElement>("#container-panel-script");
const scriptStepsList = requireElement<HTMLUListElement>("#script-steps-list");
const scriptPanelTitle = requireElement<HTMLSpanElement>("#script-panel-title");
const scriptStatusLine = requireElement<HTMLDivElement>("#script-status-line");
const scriptToggleBtn = requireElement<HTMLButtonElement>("#script-toggle-btn");
const navAliasList = requireElement<HTMLUListElement>("#nav-alias-list");
const navAliasListEmpty = requireElement<HTMLParagraphElement>("#nav-alias-list-empty");
const navZoneList = requireElement<HTMLUListElement>("#nav-zone-list");
const navZoneListEmpty = requireElement<HTMLParagraphElement>("#nav-zone-list-empty");
const navFarZonesList = requireElement<HTMLUListElement>("#nav-far-zones-list");
const navFarZonesListEmpty = requireElement<HTMLParagraphElement>("#nav-far-zones-list-empty");
const navZoneAliasesTitle = requireElement<HTMLDivElement>("#nav-zone-aliases-title");
const navStatus = requireElement<HTMLDivElement>("#nav-status");
const aliasPopup = requireElement<HTMLDivElement>("#alias-popup");
const aliasPopupTitle = requireElement<HTMLSpanElement>("#alias-popup-title");
const aliasPopupInput = requireElement<HTMLInputElement>("#alias-popup-input");
const aliasPopupSave = requireElement<HTMLButtonElement>("#alias-popup-save");
const aliasPopupDelete = requireElement<HTMLButtonElement>("#alias-popup-delete");
const aliasPopupClose = requireElement<HTMLButtonElement>("#alias-popup-close");

const mapContextMenu = requireElement<HTMLDivElement>("#map-context-menu");
const mapContextGo = requireElement<HTMLButtonElement>("#map-context-go");
const mapContextAlias = requireElement<HTMLButtonElement>("#map-context-alias");
const mapContextAliasDelete = requireElement<HTMLButtonElement>("#map-context-alias-delete");
const mapContextAutoCmd = requireElement<HTMLButtonElement>("#map-context-auto-cmd");
const mapContextAutoCmdDelete = requireElement<HTMLButtonElement>("#map-context-auto-cmd-delete");

const autoCmdPopup = requireElement<HTMLDivElement>("#auto-cmd-popup");
const autoCmdPopupTitle = requireElement<HTMLSpanElement>("#auto-cmd-popup-title");
const autoCmdPopupInput = requireElement<HTMLTextAreaElement>("#auto-cmd-popup-input");
const autoCmdPopupSave = requireElement<HTMLButtonElement>("#auto-cmd-popup-save");
const autoCmdPopupDelete = requireElement<HTMLButtonElement>("#auto-cmd-popup-delete");
const autoCmdPopupClose = requireElement<HTMLButtonElement>("#auto-cmd-popup-close");

const farmSettingsModal = requireElement<HTMLDivElement>("#farm-settings-modal");
const farmModalBackdrop = requireElement<HTMLDivElement>("#farm-settings-modal .farm-modal__backdrop");
const farmModalAttackCommand = requireElement<HTMLInputElement>("#farm-modal-attack-command");
const farmModalSkinningEnabled = requireElement<HTMLInputElement>("#farm-modal-skinning-enabled");
const farmModalSkinningVerb = requireElement<HTMLInputElement>("#farm-modal-skinning-verb");
const farmModalLootMeat = requireElement<HTMLInputElement>("#farm-modal-loot-meat");
const farmModalLootHide = requireElement<HTMLInputElement>("#farm-modal-loot-hide");
const farmModalClose = requireElement<HTMLButtonElement>("#farm-modal-close");
const farmModalCancel = requireElement<HTMLButtonElement>("#farm-modal-cancel");
const farmModalStart = requireElement<HTMLButtonElement>("#farm-modal-start");

const survivalSettingsButton = requireElement<HTMLButtonElement>("#survival-settings-button");
const survivalSettingsModal = requireElement<HTMLDivElement>("#survival-settings-modal");
const survivalModalBackdrop = requireElement<HTMLDivElement>("#survival-settings-modal .farm-modal__backdrop");
const survivalModalContainer = requireElement<HTMLInputElement>("#survival-modal-container");
const survivalModalFoodItems = requireElement<HTMLTextAreaElement>("#survival-modal-food-items");
const survivalModalFlaskItems = requireElement<HTMLTextAreaElement>("#survival-modal-flask-items");
const survivalModalBuyFoodAlias = requireElement<HTMLInputElement>("#survival-modal-buy-food-alias");
const survivalModalBuyFoodItem = requireElement<HTMLInputElement>("#survival-modal-buy-food-item");
const survivalModalBuyFoodMax = requireElement<HTMLInputElement>("#survival-modal-buy-food-max");

const survivalModalFillFlaskAlias = requireElement<HTMLInputElement>("#survival-modal-fill-flask-alias");
const survivalModalFillFlaskSource = requireElement<HTMLInputElement>("#survival-modal-fill-flask-source");
const survivalModalClose = requireElement<HTMLButtonElement>("#survival-modal-close");
const survivalModalCancel = requireElement<HTMLButtonElement>("#survival-modal-cancel");
const survivalModalSave = requireElement<HTMLButtonElement>("#survival-modal-save");

const buyFoodBtn = requireElement<HTMLButtonElement>("#buy-food-btn");
const fillFlaskBtn = requireElement<HTMLButtonElement>("#fill-flask-btn");
const repairBtn = requireElement<HTMLButtonElement>("#repair-btn");
const buyFoodBadge = requireElement<HTMLSpanElement>("#buy-food-badge");
const fillFlaskBadge = requireElement<HTMLSpanElement>("#fill-flask-badge");

const triggersButton = requireElement<HTMLButtonElement>("#triggers-button");
const triggersModal = requireElement<HTMLDivElement>("#triggers-modal");
const triggersModalBackdrop = requireElement<HTMLDivElement>("#triggers-modal .farm-modal__backdrop");
const triggersModalClose = requireElement<HTMLButtonElement>("#triggers-modal-close");
const triggersModalCancel = requireElement<HTMLButtonElement>("#triggers-modal-cancel");
const triggerDodgeCheckbox = requireElement<HTMLInputElement>("#trigger-dodge");
const triggerStandUpCheckbox = requireElement<HTMLInputElement>("#trigger-stand-up");
const triggerRearmCheckbox = requireElement<HTMLInputElement>("#trigger-rearm");
const triggerCurseCheckbox = requireElement<HTMLInputElement>("#trigger-curse");
const triggerLightCheckbox = requireElement<HTMLInputElement>("#trigger-light");
const triggerFollowLeaderCheckbox = requireElement<HTMLInputElement>("#trigger-follow-leader");
const triggerAssistCheckbox = requireElement<HTMLInputElement>("#trigger-assist");
const assistTanksList = requireElement<HTMLDivElement>("#assist-tanks-list");
const assistTankInput = requireElement<HTMLInputElement>("#assist-tank-input");
const assistTankAddBtn = requireElement<HTMLButtonElement>("#assist-tank-add-btn");

const itemDbButton = requireElement<HTMLButtonElement>("#item-db-button");

const mapRecordingButton = requireElement<HTMLButtonElement>("#map-recording-button");
const globalMapButton = requireElement<HTMLButtonElement>("#global-map-button");
const globalMapModal = requireElement<HTMLDivElement>("#global-map-modal");
const globalMapModalClose = requireElement<HTMLButtonElement>("#global-map-modal-close");
const globalMapCanvas = requireElement<HTMLDivElement>("#global-map-canvas");
const globalMapZoomIn = requireElement<HTMLButtonElement>("#global-map-zoom-in");
const globalMapZoomOut = requireElement<HTMLButtonElement>("#global-map-zoom-out");
const globalMapZoomLabel = requireElement<HTMLSpanElement>("#global-map-zoom-label");
const globalMapSearch = requireElement<HTMLInputElement>("#global-map-search");
const itemDbModal = requireElement<HTMLDivElement>("#item-db-modal");
const itemDbModalBackdrop = requireElement<HTMLDivElement>("#item-db-modal .farm-modal__backdrop");
const itemDbModalClose = requireElement<HTMLButtonElement>("#item-db-modal-close");
const itemDbTableBody = requireElement<HTMLTableSectionElement>("#item-db-table-body");
const itemDbThead = requireElement<HTMLTableSectionElement>("#item-db-thead");
const itemDbEmpty = requireElement<HTMLParagraphElement>("#item-db-empty");
const itemDbTabs = requireElement<HTMLDivElement>("#item-db-tabs");
const itemDbSearch = requireElement<HTMLInputElement>("#item-db-search");
const itemDbCount = requireElement<HTMLSpanElement>("#item-db-count");
const itemDbWikiInput = requireElement<HTMLInputElement>("#item-db-wiki-input");
const itemDbWikiBtn = requireElement<HTMLButtonElement>("#item-db-wiki-btn");
const itemDbWikiResult = requireElement<HTMLDivElement>("#item-db-wiki-result");

const itemDetailModal             = requireElement<HTMLDivElement>("#item-detail-modal");
const itemDetailModalBackdrop     = requireElement<HTMLDivElement>("#item-detail-modal .farm-modal__backdrop");
const itemDetailModalClose        = requireElement<HTMLButtonElement>("#item-detail-modal-close");
const itemDetailModalCloseFooter  = requireElement<HTMLButtonElement>("#item-detail-modal-close-footer");
const itemDetailModalTitle        = requireElement<HTMLSpanElement>("#item-detail-modal-title");
const itemDetailModalBody         = requireElement<HTMLDivElement>("#item-detail-modal-body");

const compareButton = requireElement<HTMLButtonElement>("#compare-button");
const compareAdvisorPanel = requireElement<HTMLDivElement>("#compare-advisor-panel");
const compareAdvisorClose = requireElement<HTMLButtonElement>("#compare-advisor-close");
const compareAdvisorTitle = requireElement<HTMLSpanElement>("#compare-advisor-title");
const compareAdvisorStatus = requireElement<HTMLParagraphElement>("#compare-advisor-status");
const compareAdvisorTableBody = requireElement<HTMLTableSectionElement>("#compare-advisor-table-body");
const compareAdvisorCoins = requireElement<HTMLParagraphElement>("#compare-advisor-coins");

const vorozheButton = requireElement<HTMLButtonElement>("#vorozhe-button");
const vorozheModal = requireElement<HTMLDivElement>("#vorozhe-modal");
const vorozheModalClose = requireElement<HTMLButtonElement>("#vorozhe-modal-close");
const vorozheModalCancel = requireElement<HTMLButtonElement>("#vorozhe-modal-cancel");
const vorozheModalBackdrop = requireElement<HTMLDivElement>("#vorozhe-modal .farm-modal__backdrop");
const vorozheFromButtons = requireElement<HTMLDivElement>("#vorozhe-from-buttons");
const vorozheToButtons = requireElement<HTMLDivElement>("#vorozhe-to-buttons");
const vorozheResult = requireElement<HTMLDivElement>("#vorozhe-result");
const vorozheNoRoute = requireElement<HTMLDivElement>("#vorozhe-no-route");
const vorozheRouteTable = requireElement<HTMLTableElement>("#vorozhe-route-table");
const vorozheRouteTbody = requireElement<HTMLTableSectionElement>("#vorozhe-route-tbody");
const vorozheTotal = requireElement<HTMLDivElement>("#vorozhe-total");

const gatherToggleButton = requireElement<HTMLButtonElement>("#gather-toggle-button");
const gatherSellButton = requireElement<HTMLButtonElement>("#gather-sell-button");
const scratchClanBtn = requireElement<HTMLButtonElement>("#scratch-clan-btn");
const equipAllBtn = requireElement<HTMLButtonElement>("#equip-all-btn");
const debugLogButton = requireElement<HTMLButtonElement>("#debug-log-button");

const bagPanelList = requireElement<HTMLTableSectionElement>("#bag-panel-list");
const chestPanelList = requireElement<HTMLTableSectionElement>("#chest-panel-list");
const inventoryPanelList = requireElement<HTMLTableSectionElement>("#inventory-panel-list");

const VOROZHE_CITIES = [
  "Брянск", "Великий Новгород", "Владимир", "Вышгород", "Галич",
  "Искоростень", "Киев", "Корсунь", "Курск", "Ладога",
  "Любеч", "Меньск", "Муром", "Переяславль", "Полоцк",
  "Псков", "Путивль", "Ростов Великий", "Русса", "Рязань",
  "Тверь", "Торжок", "Тотьма", "Туров", "Чернигов",
] as const;

let vorozheFrom: string | null = null;
let vororozheFromButtons: HTMLButtonElement[] = [];
let vorozheTo: string | null = null;
let vorozheToButtonsList: HTMLButtonElement[] = [];

let farmModalZoneId: number | null = null;
let currentSurvivalSettings: SurvivalSettings = defaultSurvivalSettings();

interface FarmSettings {
  attackCommand: string;
  skinningSalvoEnabled: boolean;
  skinningSkinVerb: string;
  lootMeatCommand: string;
  lootHideCommand: string;
}

interface FarmRuntimeStats {
  hp: number;
  hpMax: number;
  energy: number;
  energyMax: number;
}

function defaultFarmSettings(): FarmSettings {
  return {
    attackCommand: "заколоть",
    skinningSalvoEnabled: false,
    skinningSkinVerb: "освеж",
    lootMeatCommand: "пол все.мяс торб",
    lootHideCommand: "пол все.шкур торб",
  };
}

function defaultSurvivalSettings(): SurvivalSettings {
  return { container: "", foodItems: "", flaskItems: "", buyFoodItem: "", buyFoodMax: 20, buyFoodAlias: "", fillFlaskAlias: "", fillFlaskSource: "" };
}

function normalizeFarmSettings(raw: Partial<FarmSettings>): FarmSettings {
  const def = defaultFarmSettings();
  return {
    attackCommand: typeof raw.attackCommand === "string" ? raw.attackCommand : def.attackCommand,
    skinningSalvoEnabled: typeof raw.skinningSalvoEnabled === "boolean" ? raw.skinningSalvoEnabled : def.skinningSalvoEnabled,
    skinningSkinVerb: typeof raw.skinningSkinVerb === "string" ? raw.skinningSkinVerb : def.skinningSkinVerb,
    lootMeatCommand: typeof raw.lootMeatCommand === "string" ? raw.lootMeatCommand : def.lootMeatCommand,
    lootHideCommand: typeof raw.lootHideCommand === "string" ? raw.lootHideCommand : def.lootHideCommand,
  };
}

function normalizeSurvivalSettings(raw: Partial<SurvivalSettings>): SurvivalSettings {
  const def = defaultSurvivalSettings();
  return {
    container: typeof raw.container === "string" ? raw.container : def.container,
    foodItems: typeof raw.foodItems === "string" ? raw.foodItems : def.foodItems,
    flaskItems: typeof raw.flaskItems === "string" ? raw.flaskItems : def.flaskItems,
    buyFoodItem: typeof raw.buyFoodItem === "string" ? raw.buyFoodItem : def.buyFoodItem,
    buyFoodMax: typeof raw.buyFoodMax === "number" && Number.isFinite(raw.buyFoodMax) && raw.buyFoodMax > 0 ? Math.floor(raw.buyFoodMax) : def.buyFoodMax,
    buyFoodAlias: typeof raw.buyFoodAlias === "string" ? raw.buyFoodAlias : def.buyFoodAlias,
    fillFlaskAlias: typeof raw.fillFlaskAlias === "string" ? raw.fillFlaskAlias : def.fillFlaskAlias,
    fillFlaskSource: typeof raw.fillFlaskSource === "string" ? raw.fillFlaskSource : def.fillFlaskSource,
  };
}
function fillFarmModal(settings: FarmSettings): void {
  farmModalAttackCommand.value = settings.attackCommand;
  farmModalSkinningEnabled.checked = settings.skinningSalvoEnabled;
  farmModalSkinningVerb.value = settings.skinningSkinVerb;
  farmModalLootMeat.value = settings.lootMeatCommand;
  farmModalLootHide.value = settings.lootHideCommand;
}

function fillSurvivalModal(settings: SurvivalSettings): void {
  survivalModalContainer.value = settings.container;
  survivalModalFoodItems.value = settings.foodItems;
  survivalModalFlaskItems.value = settings.flaskItems;
  survivalModalBuyFoodItem.value = settings.buyFoodItem;
  survivalModalBuyFoodMax.value = String(settings.buyFoodMax);
  survivalModalBuyFoodAlias.value = settings.buyFoodAlias;
  survivalModalFillFlaskAlias.value = settings.fillFlaskAlias;
  survivalModalFillFlaskSource.value = settings.fillFlaskSource;
}

function parseFarmCommandValues(rawValue: string): string[] {
  return rawValue
    .split(/\r?\n/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function openFarmSettingsModal(): void {
  const zoneId = farm2ZoneId ?? getZoneId(trackerCurrentVnum ?? 0);
  farmModalZoneId = zoneId;

  fillFarmModal(defaultFarmSettings());
  farmSettingsModal.classList.remove("farm-modal--hidden");
  farmModalAttackCommand.focus();

  sendClientEvent({ type: "farm_settings_get", payload: { zoneId } });
}

function closeFarmSettingsModal(): void {
  farmModalZoneId = null;
  farmSettingsModal.classList.add("farm-modal--hidden");
}

function openSurvivalSettingsModal(): void {
  fillSurvivalModal(currentSurvivalSettings);
  survivalSettingsModal.classList.remove("farm-modal--hidden");
  survivalModalContainer.focus();
  sendClientEvent({ type: "survival_settings_get" });
}

function closeSurvivalSettingsModal(): void {
  survivalSettingsModal.classList.add("farm-modal--hidden");
}

let currentTriggerState: { dodge: boolean; standUp: boolean; rearm: boolean; curse: boolean; light: boolean; followLeader: boolean; assist: boolean; assistTanks: string[] } = { dodge: true, standUp: true, rearm: true, curse: false, light: false, followLeader: true, assist: false, assistTanks: [] };

function renderAssistTanks(tanks: string[]): void {
  assistTanksList.innerHTML = "";
  for (const tank of tanks) {
    const item = document.createElement("div");
    item.className = "assist-tank-item";
    const name = document.createElement("span");
    name.className = "assist-tank-item__name";
    name.textContent = tank;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "button-secondary button-small";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      const updated = currentTriggerState.assistTanks.filter((t) => t !== tank);
      currentTriggerState = { ...currentTriggerState, assistTanks: updated };
      sendClientEvent({ type: "triggers_toggle", payload: { assistTanks: updated } });
      renderAssistTanks(updated);
    });
    item.appendChild(name);
    item.appendChild(removeBtn);
    assistTanksList.appendChild(item);
  }
}

function openTriggersModal(): void {
  triggerDodgeCheckbox.checked = currentTriggerState.dodge;
  triggerStandUpCheckbox.checked = currentTriggerState.standUp;
  triggerRearmCheckbox.checked = currentTriggerState.rearm;
  triggerCurseCheckbox.checked = currentTriggerState.curse;
  triggerLightCheckbox.checked = currentTriggerState.light;
  triggerFollowLeaderCheckbox.checked = currentTriggerState.followLeader;
  triggerAssistCheckbox.checked = currentTriggerState.assist;
  renderAssistTanks(currentTriggerState.assistTanks);
  triggersModal.classList.remove("farm-modal--hidden");
}

function closeTriggersModal(): void {
  triggersModal.classList.add("farm-modal--hidden");
}

let itemDbAllItems: GameItemPayload[] = [];
let itemDbActiveTab = "all";
const itemDbRowMap = new WeakMap<HTMLTableRowElement, GameItemPayload>();

type ColumnDef = { label: string; render: (data: Record<string, unknown>) => string; cls?: string };

const WEAPON_COLUMNS: ColumnDef[] = [
  { label: "Класс",     render: d => String(d.weaponClass ?? d.class ?? "—"),      cls: "items-modal__cell--muted" },
  { label: "Кубики",    render: d => String(d.damageDice ?? d.damage_dice ?? "—"), cls: "items-modal__cell--mono" },
  { label: "Avg",       render: d => (d.damageAvg ?? d.damage_avg) != null ? String(d.damageAvg ?? d.damage_avg) : "—", cls: "items-modal__cell--mono" },
  { label: "Материал",  render: d => String(d.material ?? "—"),                    cls: "items-modal__cell--muted" },
  { label: "Прочность", render: d => d.durability_cur != null ? `${d.durability_cur}/${d.durability_max}` : "—" },
  { label: "Аффекты",   render: d => Array.isArray(d.affects) ? (d.affects as string[]).join(", ") || "—" : String(d.affects ?? "—"), cls: "items-modal__cell--tag" },
  { label: "Свойства",  render: d => Array.isArray(d.properties) ? (d.properties as string[]).join(", ") || "—" : String(d.extra_props ?? "—"), cls: "items-modal__cell--tag" },
];

const ARMOR_COLUMNS: ColumnDef[] = [
  { label: "Слот",      render: d => Array.isArray(d.wearSlots) ? (d.wearSlots as {slot:string}[]).map(s => typeof s === "string" ? s : s.slot).join(", ") || "—" : String(d.wear_slot ?? d.slot ?? "—"), cls: "items-modal__cell--muted" },
  { label: "Материал",  render: d => String(d.material ?? "—"),  cls: "items-modal__cell--muted" },
  { label: "Прочность", render: d => d.durability_cur != null ? `${d.durability_cur}/${d.durability_max}` : "—" },
  { label: "AC",        render: d => String(d.ac ?? d.armor ?? "—"), cls: "items-modal__cell--mono" },
  { label: "Аффекты",   render: d => Array.isArray(d.affects) ? (d.affects as string[]).join(", ") || "—" : String(d.affects ?? "—"), cls: "items-modal__cell--tag" },
  { label: "Свойства",  render: d => Array.isArray(d.properties) ? (d.properties as string[]).join(", ") || "—" : String(d.extra_props ?? "—"), cls: "items-modal__cell--tag" },
];

function getColumnsForTab(tab: string): ColumnDef[] {
  if (tab === "ОРУЖИЕ") return WEAPON_COLUMNS;
  if (tab === "БРОНЯ")  return ARMOR_COLUMNS;
  return [];
}

function renderGenericData(data: Record<string, unknown>): HTMLElement {
  const wrap = document.createElement("span");
  const entries = Object.entries(data).filter(([, v]) => v != null && v !== "" && v !== "ничего");
  wrap.textContent = entries.map(([k, v]) => {
    const val = typeof v === "object" ? JSON.stringify(v) : String(v);
    return `${k}: ${val}`;
  }).join(" · ");
  wrap.className = "items-modal__cell--muted";
  wrap.style.fontSize = "11px";
  return wrap;
}

function applyItemDbFilter(): void {
  const query = itemDbSearch.value.trim().toLowerCase();
  const tab   = itemDbActiveTab;
  const cols  = getColumnsForTab(tab);

  const filtered = itemDbAllItems.filter(item => {
    const tabMatch = tab === "all" || item.itemType === tab;
    const searchMatch = !query || item.name.toLowerCase().includes(query);
    return tabMatch && searchMatch;
  });

  itemDbTableBody.innerHTML = "";
  itemDbThead.querySelector("tr")!.innerHTML = "";

  if (filtered.length === 0) {
    itemDbEmpty.classList.remove("items-modal__empty--hidden");
    itemDbCount.textContent = "";
    return;
  }
  itemDbEmpty.classList.add("items-modal__empty--hidden");
  itemDbCount.textContent = `${filtered.length} предм.`;

  const headRow = itemDbThead.querySelector("tr")!;
  const nameHeader = document.createElement("th");
  nameHeader.className = "items-modal__th";
  nameHeader.textContent = "Название";
  headRow.appendChild(nameHeader);

  if (cols.length > 0) {
    for (const col of cols) {
      const th = document.createElement("th");
      th.className = "items-modal__th";
      th.textContent = col.label;
      headRow.appendChild(th);
    }
  } else {
    const th = document.createElement("th");
    th.className = "items-modal__th";
    th.textContent = "Данные";
    headRow.appendChild(th);

    const thType = document.createElement("th");
    thType.className = "items-modal__th";
    thType.textContent = "Тип";
    headRow.appendChild(thType);
  }

  for (const item of filtered) {
    const tr = document.createElement("tr");
    tr.className = "items-modal__row items-modal__row--clickable";
    itemDbRowMap.set(tr, item);

    const tdName = document.createElement("td");
    tdName.className = "items-modal__cell items-modal__cell--name";
    tdName.textContent = item.name;
    tr.appendChild(tdName);

    if (cols.length > 0) {
      for (const col of cols) {
        const td = document.createElement("td");
        td.className = `items-modal__cell${col.cls ? " " + col.cls : ""}`;
        td.textContent = col.render(item.data);
        tr.appendChild(td);
      }
    } else {
      const tdData = document.createElement("td");
      tdData.className = "items-modal__cell";
      tdData.appendChild(renderGenericData(item.data));
      tr.appendChild(tdData);

      const tdType = document.createElement("td");
      tdType.className = "items-modal__cell items-modal__cell--muted";
      tdType.textContent = item.itemType;
      tr.appendChild(tdType);
    }

    itemDbTableBody.appendChild(tr);
  }
}

function buildItemDbTabs(items: GameItemPayload[]): void {
  const types = [...new Set(items.map(i => i.itemType))].sort();
  itemDbTabs.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "items-modal__tab" + (itemDbActiveTab === "all" ? " items-modal__tab--active" : "");
  allBtn.dataset.tab = "all";
  allBtn.textContent = `Все (${items.length})`;
  itemDbTabs.appendChild(allBtn);

  for (const t of types) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "items-modal__tab" + (itemDbActiveTab === t ? " items-modal__tab--active" : "");
    btn.dataset.tab = t;
    btn.textContent = `${t} (${items.filter(i => i.itemType === t).length})`;
    itemDbTabs.appendChild(btn);
  }
}

function renderItemDbTable(items: GameItemPayload[]): void {
  itemDbAllItems = items;
  buildItemDbTabs(items);
  applyItemDbFilter();
}

function openItemDbModal(): void {
  itemDbModal.classList.remove("farm-modal--hidden");
  sendClientEvent({ type: "item_db_get" });
}

function closeItemDbModal(): void {
  itemDbModal.classList.add("farm-modal--hidden");
}

function openItemDetailModal(item: GameItemPayload): void {
  itemDetailModalTitle.textContent = item.name;
  renderItemDetail(item);
  itemDetailModal.classList.remove("farm-modal--hidden");
}

function closeItemDetailModal(): void {
  itemDetailModal.classList.add("farm-modal--hidden");
}

function renderItemDetail(item: GameItemPayload): void {
  const d = item.data;
  itemDetailModalBody.innerHTML = "";

  function row(label: string, value: string | null | undefined): void {
    if (value === null || value === undefined || value === "") return;
    const p = document.createElement("p");
    p.className = "item-detail-modal__row";
    const labelEl = document.createElement("span");
    labelEl.className = "item-detail-modal__label";
    labelEl.textContent = label + ": ";
    const valueEl = document.createElement("span");
    valueEl.className = "item-detail-modal__value";
    valueEl.textContent = value;
    p.appendChild(labelEl);
    p.appendChild(valueEl);
    itemDetailModalBody.appendChild(p);
  }

  function listSection(label: string, arr: unknown): void {
    if (!Array.isArray(arr) || arr.length === 0) return;
    const section = document.createElement("div");
    section.className = "item-detail-modal__section";
    const h = document.createElement("p");
    h.className = "item-detail-modal__section-title";
    h.textContent = label + ":";
    section.appendChild(h);
    for (const entry of arr) {
      const p = document.createElement("p");
      p.className = "item-detail-modal__list-item";
      if (typeof entry === "object" && entry !== null && "stat" in entry && "value" in entry) {
        p.textContent = `${(entry as { stat: string; value: number }).stat}: ${(entry as { stat: string; value: number }).value}`;
      } else {
        p.textContent = String(entry);
      }
      section.appendChild(p);
    }
    itemDetailModalBody.appendChild(section);
  }

  row("Тип", item.itemType);
  row("Материал", typeof d["material"] === "string" ? d["material"] : null);

  if (d["weaponClass"] != null) {
    row("Класс оружия", String(d["weaponClass"]));
  }
  if (d["damageDice"] != null) {
    row("Урон (кости)", String(d["damageDice"]));
  }
  if (d["damageAvg"] != null && Number(d["damageAvg"]) > 0) {
    row("Средний урон", String(d["damageAvg"]));
  }
  if (d["ac"] != null && Number(d["ac"]) !== 0) {
    row("AC", String(d["ac"]));
  }
  if (d["armor"] != null && Number(d["armor"]) !== 0) {
    row("Броня", String(d["armor"]));
  }
  if (d["remorts"] != null && Number(d["remorts"]) > 0) {
    row("Перевоплощений", String(d["remorts"]));
  }
  if (d["isMetal"] === true) {
    row("Металл", "да");
  }
  if (d["isShiny"] === true) {
    row("Блестящий", "да");
  }

  const wearSlots = d["wearSlots"];
  if (Array.isArray(wearSlots) && wearSlots.length > 0) {
    row("Слоты", (wearSlots as string[]).join(", "));
  }

  listSection("Аффекты", d["affects"]);
  listSection("Свойства", d["properties"]);
  listSection("Запрет классам", d["forbidden"]);
  listSection("Треб. правая рука", d["rightHandReqs"]);
  listSection("Треб. левая рука", d["leftHandReqs"]);
  listSection("Треб. обе руки", d["bothHandReqs"]);
  listSection("Треб. надевание", d["wearReqs"]);

  if (d["id"] != null) {
    row("Wiki ID", String(d["id"]));
  }

  const firstSeen = item.firstSeen ? new Date(item.firstSeen).toLocaleDateString("ru-RU") : null;
  const lastSeen = item.lastSeen ? new Date(item.lastSeen).toLocaleDateString("ru-RU") : null;
  if (firstSeen) row("Первый раз", firstSeen);
  if (lastSeen) row("Последний раз", lastSeen);

  if (itemDetailModalBody.children.length === 0) {
    const p = document.createElement("p");
    p.className = "item-detail-modal__empty";
    p.textContent = "Нет данных";
    itemDetailModalBody.appendChild(p);
  }
}


function commitSurvivalSettings(): void {
  currentSurvivalSettings = normalizeSurvivalSettings({
    container: survivalModalContainer.value.trim(),
    foodItems: survivalModalFoodItems.value.trim(),
    flaskItems: survivalModalFlaskItems.value.trim(),
    buyFoodItem: survivalModalBuyFoodItem.value.trim(),
    buyFoodMax: Number(survivalModalBuyFoodMax.value) || 20,
    buyFoodAlias: survivalModalBuyFoodAlias.value.trim(),
    fillFlaskAlias: survivalModalFillFlaskAlias.value.trim(),
    fillFlaskSource: survivalModalFillFlaskSource.value.trim(),
  });

  sendClientEvent({
    type: "survival_settings_save",
    payload: currentSurvivalSettings,
  });

  updateActionButtons();
  closeSurvivalSettingsModal();
}

function updateActionButtons(): void {
  buyFoodBtn.disabled = !currentSurvivalSettings.buyFoodAlias.trim() || !currentSurvivalSettings.buyFoodItem.trim();
  fillFlaskBtn.disabled = !currentSurvivalSettings.fillFlaskAlias.trim();
}

function updateActionBadges(): void {
  buyFoodBadge.classList.toggle("action-btn__badge--hidden", !currentSurvivalStatus.foodEmpty);
  fillFlaskBadge.classList.toggle("action-btn__badge--hidden", !currentSurvivalStatus.flaskEmpty);
}

function commitFarmSettings(): void {
  const settings: FarmSettings = {
    attackCommand: farmModalAttackCommand.value.trim(),
    skinningSalvoEnabled: farmModalSkinningEnabled.checked,
    skinningSkinVerb: farmModalSkinningVerb.value.trim(),
    lootMeatCommand: farmModalLootMeat.value.trim(),
    lootHideCommand: farmModalLootHide.value.trim(),
  };

  if (farmModalZoneId !== null) {
    sendClientEvent({
      type: "farm_settings_save",
      payload: { zoneId: farmModalZoneId, settings },
    });
  }

  closeFarmSettingsModal();
}

function switchMapTab(tab: "map"): void {
  mapTabMap.classList.toggle("map-tab--active", tab === "map");
  mapPanelMap.classList.toggle("map-tab-panel--hidden", tab !== "map");
}

function switchContainerTab(tab: "inventory" | "nav" | "script"): void {
  containerTabInventory.classList.toggle("map-tab--active", tab === "inventory");
  containerTabNav.classList.toggle("map-tab--active", tab === "nav");
  containerTabScript.classList.toggle("map-tab--active", tab === "script");
  containerPanelInventory.classList.toggle("container-panels__panel--hidden", tab !== "inventory");
  containerPanelNav.classList.toggle("container-panels__panel--hidden", tab !== "nav");
  containerPanelScript.classList.toggle("container-panels__panel--hidden", tab !== "script");
}

function openAliasPopup(vnum: number, existingAlias: string | undefined, roomName: string): void {
  aliasPopupVnum = vnum;
  aliasPopupTitle.textContent = `Алиас: ${roomName} (${vnum})`;
  aliasPopupInput.value = existingAlias ?? "";
  aliasPopupDelete.classList.toggle("alias-popup__delete--hidden", !existingAlias);
  aliasPopup.classList.remove("alias-popup--hidden");
  aliasPopupInput.focus();
}

function closeAliasPopup(): void {
  aliasPopupVnum = null;
  aliasPopup.classList.add("alias-popup--hidden");
}

function openAutoCmdPopup(vnum: number, existingCommand: string | undefined, roomName: string): void {
  autoCmdPopupVnum = vnum;
  autoCmdPopupTitle.textContent = `Авто-команда: ${roomName} (${vnum})`;
  autoCmdPopupInput.value = existingCommand ?? "";
  autoCmdPopupDelete.classList.toggle("alias-popup__delete--hidden", !existingCommand);
  autoCmdPopup.classList.remove("alias-popup--hidden");
  autoCmdPopupInput.focus();
}

function closeAutoCmdPopup(): void {
  autoCmdPopupVnum = null;
  autoCmdPopup.classList.add("alias-popup--hidden");
}

function openMapContextMenu(vnum: number, x: number, y: number): void {
  mapContextMenuVnum = vnum;
  const hasAlias = currentAliases.some((a) => a.vnum === vnum);
  mapContextAliasDelete.classList.toggle("map-context-menu__item--hidden", !hasAlias);
  const hasAutoCmd = currentRoomAutoCommands.has(vnum);
  mapContextAutoCmdDelete.classList.toggle("map-context-menu__item--hidden", !hasAutoCmd);
  mapContextAutoCmd.classList.toggle("map-context-menu__item--active", hasAutoCmd);
  mapContextAutoCmd.textContent = hasAutoCmd
    ? `Авто-команда: ${currentRoomAutoCommands.get(vnum)}…`
    : "Авто-команда…";
  mapContextMenu.style.left = `${x}px`;
  mapContextMenu.style.top = `${y}px`;
  mapContextMenu.classList.remove("map-context-menu--hidden");
  mapContextGo.focus();
}

function closeMapContextMenu(): void {
  mapContextMenuVnum = null;
  mapContextMenu.classList.add("map-context-menu--hidden");
}

function renderNavPanel(): void {
  const currentVnum = latestMapSnapshot.currentVnum;
  const currentZone = currentVnum !== null ? getZoneId(currentVnum) : null;

  navZoneAliasesTitle.textContent = currentZone !== null
    ? `Текущая зона ${zoneNames.get(currentZone) ? `— ${zoneNames.get(currentZone)}` : `(${currentZone}xx)`}`
    : "Текущая зона";

  const zoneAliases = currentZone !== null
    ? currentAliases.filter(a => getZoneId(a.vnum) === currentZone)
    : [];

  navAliasList.innerHTML = "";
  navAliasListEmpty.classList.toggle("alias-list-empty--hidden", zoneAliases.length > 0);

  for (const entry of zoneAliases) {
    const li = document.createElement("li");
    li.className = "alias-list__item";

    const label = document.createElement("span");
    label.className = "alias-list__label";
    label.textContent = entry.alias;

    const vnumSpan = document.createElement("span");
    vnumSpan.className = "alias-list__vnum";
    vnumSpan.textContent = String(entry.vnum);

    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "button-small alias-list__go";
    goBtn.textContent = "Идти";
    goBtn.addEventListener("click", () => {
      const aliasName = entry.alias.toLowerCase();
      const allVnums = currentAliases
        .filter(a => a.alias.toLowerCase() === aliasName)
        .map(a => a.vnum);
      sendClientEvent({ type: "navigate_to", payload: { vnums: allVnums } });
    });

    li.appendChild(label);
    li.appendChild(vnumSpan);
    li.appendChild(goBtn);
    navAliasList.appendChild(li);
  }

  const neighborZones = buildNeighborZones(currentZone);

  navZoneList.innerHTML = "";
  navZoneListEmpty.classList.toggle("alias-list-empty--hidden", neighborZones.length > 0);

  for (const zone of neighborZones) {
    const li = document.createElement("li");
    li.className = "nav-zone-list__item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "nav-zone-list__name";
    nameSpan.textContent = zoneNames.get(zone.zoneId) ?? `Зона ${zone.zoneId}xx`;

    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "button-small nav-zone-list__go";
    goBtn.textContent = "Идти";
    goBtn.addEventListener("click", () => {
      sendClientEvent({ type: "navigate_to", payload: { vnums: zone.entryVnums } });
    });

    li.appendChild(nameSpan);
    li.appendChild(goBtn);
    navZoneList.appendChild(li);
  }

  const neighborZoneIdSet = new Set(neighborZones.map(z => z.zoneId));
  const farZones = buildFarZones(currentZone, neighborZoneIdSet);

  navFarZonesList.innerHTML = "";
  navFarZonesListEmpty.classList.toggle("alias-list-empty--hidden", farZones.length > 0);

  for (const zone of farZones) {
    const li = document.createElement("li");
    li.className = "nav-zone-list__item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "nav-zone-list__name";
    nameSpan.textContent = zoneNames.get(zone.zoneId) ?? `Зона ${zone.zoneId}xx`;

    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "button-small nav-zone-list__go";
    goBtn.textContent = "Идти";
    goBtn.addEventListener("click", () => {
      sendClientEvent({ type: "navigate_to", payload: { vnums: zone.entryVnums } });
    });

    li.appendChild(nameSpan);
    li.appendChild(goBtn);
    navFarZonesList.appendChild(li);
  }
}

interface NeighborZone {
  zoneId: number;
  entryVnums: number[];
}

interface FarZone {
  zoneId: number;
  hops: number;
  entryVnums: number[];
}

function buildNeighborZones(currentZone: number | null): NeighborZone[] {
  if (currentZone === null || latestMapSnapshot.nodes.length === 0) return [];

  const neighborZoneIds = new Set<number>();
  for (const edge of latestMapSnapshot.edges) {
    const fromZone = getZoneId(edge.fromVnum);
    const toZone = getZoneId(edge.toVnum);
    if (fromZone === currentZone && toZone !== currentZone) {
      neighborZoneIds.add(toZone);
    }
    if (toZone === currentZone && fromZone !== currentZone) {
      neighborZoneIds.add(fromZone);
    }
  }

  const visitedVnums = new Set(
    latestMapSnapshot.nodes.filter(n => n.visited).map(n => n.vnum)
  );

  const result: NeighborZone[] = [];
  for (const zoneId of neighborZoneIds) {
    const zoneVnums = latestMapSnapshot.nodes
      .filter(n => getZoneId(n.vnum) === zoneId && visitedVnums.has(n.vnum))
      .map(n => n.vnum);
    if (zoneVnums.length > 0) {
      result.push({ zoneId, entryVnums: zoneVnums });
    }
  }

  result.sort((a, b) => {
    const nameA = zoneNames.get(a.zoneId) ?? "";
    const nameB = zoneNames.get(b.zoneId) ?? "";
    if (nameA && !nameB) return -1;
    if (!nameA && nameB) return 1;
    return nameA.localeCompare(nameB) || a.zoneId - b.zoneId;
  });

  return result;
}

function buildFarZones(currentZone: number | null, neighborZoneIds: Set<number>): FarZone[] {
  if (currentZone === null || latestMapSnapshot.nodes.length === 0) return [];

  // Build zone adjacency map from edges
  const zoneAdj = new Map<number, Set<number>>();
  for (const edge of latestMapSnapshot.edges) {
    const fromZone = getZoneId(edge.fromVnum);
    const toZone = getZoneId(edge.toVnum);
    if (fromZone === toZone) continue;
    if (!zoneAdj.has(fromZone)) zoneAdj.set(fromZone, new Set());
    if (!zoneAdj.has(toZone)) zoneAdj.set(toZone, new Set());
    zoneAdj.get(fromZone)!.add(toZone);
    zoneAdj.get(toZone)!.add(fromZone);
  }

  // BFS from currentZone, collect zones at hops 2–4
  const visited = new Set<number>([currentZone, ...neighborZoneIds]);
  const queue: Array<{ zoneId: number; hops: number }> = [];

  // Seed queue with neighbors (hop=1) as already-visited boundary
  for (const nz of neighborZoneIds) {
    queue.push({ zoneId: nz, hops: 1 });
  }

  const farZoneHops = new Map<number, number>(); // zoneId → hops

  let head = 0;
  while (head < queue.length) {
    const { zoneId, hops } = queue[head++]!;
    if (hops >= 4) continue;
    const neighbors = zoneAdj.get(zoneId);
    if (!neighbors) continue;
    for (const nz of neighbors) {
      if (visited.has(nz)) continue;
      visited.add(nz);
      farZoneHops.set(nz, hops + 1);
      queue.push({ zoneId: nz, hops: hops + 1 });
    }
  }

  const visitedVnums = new Set(
    latestMapSnapshot.nodes.filter(n => n.visited).map(n => n.vnum)
  );

  const result: FarZone[] = [];
  for (const [zoneId, hops] of farZoneHops) {
    const zoneVnums = latestMapSnapshot.nodes
      .filter(n => getZoneId(n.vnum) === zoneId && visitedVnums.has(n.vnum))
      .map(n => n.vnum);
    if (zoneVnums.length > 0) {
      result.push({ zoneId, hops, entryVnums: zoneVnums });
    }
  }

  result.sort((a, b) => {
    if (a.hops !== b.hops) return a.hops - b.hops;
    const nameA = zoneNames.get(a.zoneId) ?? "";
    const nameB = zoneNames.get(b.zoneId) ?? "";
    if (nameA && !nameB) return -1;
    if (!nameA && nameB) return 1;
    return nameA.localeCompare(nameB) || a.zoneId - b.zoneId;
  });

  return result;
}

function renderNavStatus(state: NavigationStatePayload): void {
  navStatus.innerHTML = "";
  if (!state.active) {
    navStatus.classList.add("nav-status--hidden");
    return;
  }

  navStatus.classList.remove("nav-status--hidden");
  const label = document.createElement("span");
  label.textContent = `Навигация: шаг ${state.currentStep + 1} / ${state.totalSteps}`;
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "button-secondary button-small";
  cancelBtn.textContent = "Отмена";
  cancelBtn.addEventListener("click", () => {
    sendClientEvent({ type: "navigate_stop" });
  });
  navStatus.appendChild(label);
  navStatus.appendChild(cancelBtn);
}

function updateStatsBar(hp: number, hpMax: number, energy: number, energyMax: number): void {
  const hpPct = hpMax > 0 ? Math.min(100, Math.round((hp / hpMax) * 100)) : 0;
  const energyPct = energyMax > 0 ? Math.min(100, Math.round((energy / energyMax) * 100)) : 0;
  hpBarFill.style.setProperty("--pct", `${hpPct}%`);
  hpBarLabel.textContent = `${hp}/${hpMax}`;
  energyBarFill.style.setProperty("--pct", `${energyPct}%`);
  energyBarLabel.textContent = `${energy}/${energyMax}`;
}

let socket: WebSocket | null = null;
let pendingOpenPromise: Promise<void> | null = null;
let autoConnectEnabled = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let reconnectEnabled = false;
const pendingQueue: ClientEvent[] = [];
const RECONNECT_DELAY_MAX = 30000;
let latestMapSnapshot: MapSnapshotPayload = {
  currentVnum: null,
  nodes: [],
  edges: [],
  zoneNames: [],
};
let globalMapZoom = 0.6;
let globalMapOpen = false;
let globalMapSearchQuery = "";
let mapRecordingEnabled = true;
let pendingEquippedAction: "scratch" | "equip" | null = null;

const INVENTORY_WEAR_CMD: Record<string, string> = {
  "правый указательный палец": "над",
  "левый указательный палец": "над",
  "на шее": "над",
  "на груди": "над",
  "на теле": "над",
  "на голове": "над",
  "на ногах": "над",
  "на ступнях": "над",
  "на кистях": "над",
  "на руках": "над",
  "на плечах": "над",
  "на поясе": "над",
  "на правом запястье": "над",
  "на левом запястье": "над",
  "в правой руке": "воор",
  "в левой руке": "держ",
};
let farm2Enabled = false;
let farm2ZoneId: number | null = null;
let farm2PendingActivation = false;
let zoneScriptState: ServerEvent & { type: "zone_script_state" } | null = null;
let trackerCurrentVnum: number | null = null;

const AVAILABLE_ZONE_SCRIPTS: Array<{ zoneId: number; name: string; hundreds: number[]; stepLabels: string[] }> = [
  {
    zoneId: 258,
    name: "Лес (зона 258)",
    hundreds: [258],
    stepLabels: [
      "Идти на 25804",
      "Открыть дверь",
      "Идти на 25805",
      "Ждать сообщение про лавочку",
      "Идти назад на 25804",
      "Двигать лавочку",
      "Взять ключ",
      "Идти на 25805",
      "Отпереть и открыть дверь",
      "Открыть дверь",
      "Идти на 25806",
      "Ждать реплику старика про шар",
      "Ответить: помогу",
      "Идти на 25807",
      "Раздвинуть ветки",
      "Идти на 25837",
      "Лезть на дуб",
      "Ждать появления духа леса",
      "Спросить про карликов",
      "Согласиться на задание духа",
      "Спуститься к дубу (25837)",
      "Лезть вниз",
      "Нырнуть в озеро",
    ],
  },
  {
    zoneId: 280,
    name: "Стоянка половцев",
    hundreds: [280, 281, 283, 284, 285, 286, 289],
    stepLabels: [
      "Идти к входу в стоянку (28000)",
      "Зачистить стоянку половцев",
    ],
  },
];

function getScriptForVnum(vnum: number): { zoneId: number; name: string; stepLabels: string[] } | undefined {
  const hundred = Math.floor(vnum / 100);
  return AVAILABLE_ZONE_SCRIPTS.find((s) => s.hundreds.includes(hundred));
}
let currentStats: FarmRuntimeStats = {
  hp: 0,
  hpMax: 0,
  energy: 0,
  energyMax: 0,
};

let currentAliases: AliasPayload[] = [];
let currentSurvivalStatus: { foodEmpty: boolean; flaskEmpty: boolean } = { foodEmpty: false, flaskEmpty: false };
let currentRoomAutoCommands: Map<number, string> = new Map();
let aliasPopupVnum: number | null = null;
let autoCmdPopupVnum: number | null = null;
let mapContextMenuVnum: number | null = null;
let currentNavState: NavigationStatePayload = {
  active: false,
  targetVnum: null,
  totalSteps: 0,
  currentStep: 0,
};

const ESCAPE = "\u001b";
const ansiState = {
  style: createDefaultTerminalStyle(),
  pendingEscape: "",
};

// ── Grid map renderer ────────────────────────────────────────────────────────

const DIR_DELTA: Record<string, [number, number]> = {
  north: [0, 1],
  south: [0, -1],
  east: [1, 0],
  west: [-1, 0],
};

const OPPOSITE_DIR: Record<string, string> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};

const DIRECTION_PRIORITY: Record<string, number> = {
  north: 0,
  east: 1,
  south: 2,
  west: 3,
  up: 4,
  down: 5,
};

const CELL = 56;
const TILE = 40;
const PAD = 2;

interface GridCell {
  vnum: number;
  gridX: number;
  gridY: number;
  zoneId: number;
  zLevel: number;
}

const gridLayout = new Map<number, GridCell>();
const ZONE_GAP = 8;
const COMPONENT_GAP = 4;

let currentZLevel = 0;
let availableZLevels: number[] = [0];

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function placeRoom(vnum: number, x: number, y: number, zLevel: number): void {
  gridLayout.set(vnum, { vnum, gridX: x, gridY: y, zoneId: getZoneId(vnum), zLevel });
}

function resetGridLayout(): void {
  gridLayout.clear();
}

function getZoneId(vnum: number): number {
  return Math.floor(vnum / 100);
}

function integrateSnapshot(snapshot: MapSnapshotPayload): void {
  const { nodes, edges } = snapshot;
  if (nodes.length === 0) return;

  const nodesByZone = new Map<number, number[]>();
  const zoneAdj = new Map<number, Map<number, { toVnum: number; direction: string }[]>>();

  for (const node of nodes) {
    const zoneId = getZoneId(node.vnum);
    const zoneNodes = nodesByZone.get(zoneId) ?? [];
    zoneNodes.push(node.vnum);
    nodesByZone.set(zoneId, zoneNodes);

    const adj = zoneAdj.get(zoneId) ?? new Map<number, { toVnum: number; direction: string }[]>();
    adj.set(node.vnum, adj.get(node.vnum) ?? []);
    zoneAdj.set(zoneId, adj);
  }

  for (const edge of edges) {
    const delta = DIR_DELTA[edge.direction];
    if (!delta || edge.isPortal) continue;

    const fromZoneId = getZoneId(edge.fromVnum);
    const toZoneId = getZoneId(edge.toVnum);
    if (fromZoneId !== toZoneId) continue;

    const adj = zoneAdj.get(fromZoneId);
    if (!adj) continue;

    adj.get(edge.fromVnum)?.push({ toVnum: edge.toVnum, direction: edge.direction });

    const reverseDirection =
      edge.direction === "north"
        ? "south"
        : edge.direction === "south"
          ? "north"
          : edge.direction === "east"
            ? "west"
            : edge.direction === "west"
              ? "east"
              : null;

    if (reverseDirection) {
      adj.get(edge.toVnum)?.push({ toVnum: edge.fromVnum, direction: reverseDirection });
    }
  }

  for (const entries of zoneAdj.values()) {
    for (const neighbors of entries.values()) {
      neighbors.sort((a, b) => {
        const aPriority = DIRECTION_PRIORITY[a.direction] ?? 99;
        const bPriority = DIRECTION_PRIORITY[b.direction] ?? 99;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return a.toVnum - b.toVnum;
      });
    }
  }

  const rootVnum =
    (snapshot.currentVnum != null && nodes.some((node) => node.vnum === snapshot.currentVnum)
      ? snapshot.currentVnum
      : null) ?? Math.min(...nodes.map((node) => node.vnum));
  const rootZoneId = getZoneId(rootVnum);

  const orderedZoneIds = [
    rootZoneId,
    ...Array.from(nodesByZone.keys())
      .filter((zoneId) => zoneId !== rootZoneId)
      .sort((a, b) => a - b),
  ];

  let zoneCursorX = 0;
  let previousZoneMaxX = 0;
  let isFirstZone = true;

  for (const zoneId of orderedZoneIds) {
    const zoneNodes = [...(nodesByZone.get(zoneId) ?? [])].sort((a, b) => a - b);
    if (zoneNodes.length === 0) continue;

    const adj = zoneAdj.get(zoneId) ?? new Map<number, { toVnum: number; direction: string }[]>();
    const localCoords = new Map<number, { x: number; y: number }>();
    const occupiedCells = new Map<string, number>(); // cellKey → vnum
    const unplaced = new Set(zoneNodes);
    let componentOriginX = 0;
    let localMinX = 0;
    let localMaxX = 0;
    let localMinY = 0;
    let localMaxY = 0;
    let isFirstComponent = true;

    const findFreeCell = (
      preferredX: number,
      preferredY: number,
      dx: number,
      dy: number,
    ): { x: number; y: number } => {
      // Shift perpendicular to the movement direction, step=2 to maintain grid spacing
      const perpStep = 2;
      const isHorizontal = dx !== 0;
      for (let offset = perpStep; offset <= 8; offset += perpStep) {
        for (const sign of [1, -1]) {
          const cx = preferredX + (isHorizontal ? 0 : sign * offset);
          const cy = preferredY + (isHorizontal ? sign * offset : 0);
          if (!occupiedCells.has(cellKey(cx, cy))) return { x: cx, y: cy };
        }
      }
      // Fallback: spiral search for any empty cell
      for (let radius = 1; radius <= 20; radius++) {
        for (let sx = -radius; sx <= radius; sx++) {
          for (let sy = -radius; sy <= radius; sy++) {
            if (Math.abs(sx) !== radius && Math.abs(sy) !== radius) continue;
            const cx = preferredX + sx * 2;
            const cy = preferredY + sy * 2;
            if (!occupiedCells.has(cellKey(cx, cy))) return { x: cx, y: cy };
          }
        }
      }
      return { x: preferredX, y: preferredY };
    };

    while (unplaced.size > 0) {
      const componentRoot = isFirstComponent && zoneId === rootZoneId && unplaced.has(rootVnum)
        ? rootVnum
        : Math.min(...unplaced);

      localCoords.set(componentRoot, { x: componentOriginX, y: 0 });
      occupiedCells.set(cellKey(componentOriginX, 0), componentRoot);
      unplaced.delete(componentRoot);

      const queue = [componentRoot];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const currentCoord = localCoords.get(current);
        if (!currentCoord) continue;

        for (const neighbor of adj.get(current) ?? []) {
          if (localCoords.has(neighbor.toVnum)) continue;
          const delta = DIR_DELTA[neighbor.direction];
          if (!delta) continue;

          const preferredX = currentCoord.x + delta[0];
          const preferredY = currentCoord.y + delta[1];

          let nextCoord: { x: number; y: number };
          const existingOccupant = occupiedCells.get(cellKey(preferredX, preferredY));
          if (existingOccupant !== undefined && existingOccupant !== neighbor.toVnum) {
            // Collision: another room already occupies the preferred cell — find a free one
            nextCoord = findFreeCell(preferredX, preferredY, delta[0], delta[1]);
          } else {
            nextCoord = { x: preferredX, y: preferredY };
          }

          localCoords.set(neighbor.toVnum, nextCoord);
          occupiedCells.set(cellKey(nextCoord.x, nextCoord.y), neighbor.toVnum);
          unplaced.delete(neighbor.toVnum);
          queue.push(neighbor.toVnum);

          if (nextCoord.x < localMinX) localMinX = nextCoord.x;
          if (nextCoord.x > localMaxX) localMaxX = nextCoord.x;
          if (nextCoord.y < localMinY) localMinY = nextCoord.y;
          if (nextCoord.y > localMaxY) localMaxY = nextCoord.y;
        }
      }

      componentOriginX = localMaxX + COMPONENT_GAP;
      isFirstComponent = false;
    }

    const zoneOffsetX = isFirstZone ? 0 : previousZoneMaxX + ZONE_GAP - localMinX;
    for (const [vnum, coord] of localCoords) {
      placeRoom(vnum, coord.x + zoneOffsetX, coord.y, 0);
    }

    previousZoneMaxX = localMaxX + zoneOffsetX;
    zoneCursorX = previousZoneMaxX + ZONE_GAP;
    previousZoneMaxX = zoneCursorX - ZONE_GAP;
    isFirstZone = false;
  }

  const zLevelEdges = edges.filter(
    (e) => (e.direction === "up" || e.direction === "down") &&
      !e.isPortal &&
      getZoneId(e.fromVnum) === getZoneId(e.toVnum)
  );

  const zLevelAdj = new Map<number, { toVnum: number; delta: number }[]>();
  for (const e of zLevelEdges) {
    const delta = e.direction === "up" ? 1 : -1;
    const fwd = zLevelAdj.get(e.fromVnum) ?? [];
    fwd.push({ toVnum: e.toVnum, delta });
    zLevelAdj.set(e.fromVnum, fwd);
    const rev = zLevelAdj.get(e.toVnum) ?? [];
    rev.push({ toVnum: e.fromVnum, delta: -delta });
    zLevelAdj.set(e.toVnum, rev);
  }

  const zLevelMap = new Map<number, number>();

  const horizontalAdj = new Map<number, number[]>();
  for (const e of edges) {
    if (!DIR_DELTA[e.direction] || e.isPortal || getZoneId(e.fromVnum) !== getZoneId(e.toVnum)) continue;
    const fwd = horizontalAdj.get(e.fromVnum) ?? [];
    fwd.push(e.toVnum);
    horizontalAdj.set(e.fromVnum, fwd);
    const rev = horizontalAdj.get(e.toVnum) ?? [];
    rev.push(e.fromVnum);
    horizontalAdj.set(e.toVnum, rev);
  }

  const componentOf = new Map<number, number>();
  const componentSeeds: number[] = [];
  const allVnums = Array.from(gridLayout.keys()).sort((a, b) => a - b);
  for (const vnum of allVnums) {
    if (componentOf.has(vnum)) continue;
    const compId = vnum;
    componentSeeds.push(compId);
    const bfsQ = [vnum];
    componentOf.set(vnum, compId);
    while (bfsQ.length > 0) {
      const cur = bfsQ.shift()!;
      for (const nb of horizontalAdj.get(cur) ?? []) {
        if (!componentOf.has(nb) && gridLayout.has(nb)) {
          componentOf.set(nb, compId);
          bfsQ.push(nb);
        }
      }
    }
  }

  const compZLevel = new Map<number, number>();
  for (const compId of componentSeeds.sort((a, b) => a - b)) {
    if (compZLevel.has(compId)) continue;
    const inferredZ = (() => {
      for (const vnum of allVnums) {
        if (componentOf.get(vnum) !== compId) continue;
        for (const { toVnum, delta } of zLevelAdj.get(vnum) ?? []) {
          const toComp = componentOf.get(toVnum);
          if (toComp !== undefined && toComp !== compId && compZLevel.has(toComp)) {
            return compZLevel.get(toComp)! - delta;
          }
        }
      }
      return 0;
    })();
    compZLevel.set(compId, inferredZ);
  }

  for (const [vnum, cell] of gridLayout) {
    const compId = componentOf.get(vnum);
    cell.zLevel = compId !== undefined ? (compZLevel.get(compId) ?? 0) : 0;
    zLevelMap.set(vnum, cell.zLevel);
  }

  for (const [vnum, cell] of gridLayout) {
    cell.zLevel = zLevelMap.get(vnum) ?? 0;
  }

  availableZLevels = Array.from(new Set(Array.from(gridLayout.values()).map((c) => c.zLevel))).sort((a, b) => a - b);

  if (snapshot.currentVnum != null && gridLayout.has(snapshot.currentVnum)) {
    currentZLevel = gridLayout.get(snapshot.currentVnum)!.zLevel;
  } else if (!availableZLevels.includes(currentZLevel)) {
    currentZLevel = availableZLevels[0] ?? 0;
  }

  updateZLevelControls();
}

function updateZLevelControls(): void {
  zLevelLabel.textContent = `${currentZLevel >= 0 ? "+" : ""}${currentZLevel}`;
  zLevelDownButton.disabled = currentZLevel <= (availableZLevels[0] ?? 0);
  zLevelUpButton.disabled = currentZLevel >= (availableZLevels[availableZLevels.length - 1] ?? 0);
}

function renderGridMap(snapshot: MapSnapshotPayload): void {
  mapCanvasElement.innerHTML = "";

  if (snapshot.nodes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "map-empty";
    empty.textContent = "No map data yet";
    mapCanvasElement.appendChild(empty);
    return;
  }

  if (gridLayout.size === 0) return;

  const nodeByVnum = new Map(snapshot.nodes.map((n) => [n.vnum, n]));
  const currentZoneId = snapshot.currentVnum != null ? getZoneId(snapshot.currentVnum) : null;
  const levelCells = new Map(
    Array.from(gridLayout.entries()).filter(([, cell]) =>
      cell.zLevel === currentZLevel &&
      (currentZoneId === null || cell.zoneId === currentZoneId)
    )
  );
  const visibleVnums = new Set(
    Array.from(levelCells.keys()).filter((vnum) => nodeByVnum.has(vnum))
  );

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const cell of levelCells.values()) {
    if (cell.gridX < minX) minX = cell.gridX;
    if (cell.gridY < minY) minY = cell.gridY;
    if (cell.gridX > maxX) maxX = cell.gridX;
    if (cell.gridY > maxY) maxY = cell.gridY;
  }

  for (const cell of levelCells.values()) {
    const node = nodeByVnum.get(cell.vnum);
    if (!node) continue;
    for (const dir of (node.exits ?? [])) {
      const delta = DIR_DELTA[dir];
      if (!delta) continue;
      const nx = cell.gridX + delta[0];
      const ny = cell.gridY + delta[1];
      const matchingNeighbor = Array.from(levelCells.values()).some(
        (candidate) =>
          candidate.vnum !== cell.vnum &&
          candidate.gridX === nx &&
          candidate.gridY === ny &&
          visibleVnums.has(candidate.vnum)
      );
      if (matchingNeighbor) continue;
      if (nx < minX) minX = nx;
      if (ny < minY) minY = ny;
      if (nx > maxX) maxX = nx;
      if (ny > maxY) maxY = ny;
    }
  }

  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  const canvasW = (cols + PAD * 2) * CELL;
  const canvasH = (rows + PAD * 2) * CELL;

  function toRenderY(gy: number): number {
    return maxY - gy;
  }

  function tileCenter(gx: number, gy: number): [number, number] {
    return [(gx - minX + PAD) * CELL + TILE / 2, (toRenderY(gy) + PAD) * CELL + TILE / 2];
  }

  const wrapper = document.createElement("div");
  wrapper.className = "map-wrapper";
  wrapper.style.width = `${canvasW}px`;
  wrapper.style.height = `${canvasH}px`;
  wrapper.style.position = "relative";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(canvasW));
  svg.setAttribute("height", String(canvasH));
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.pointerEvents = "none";

  const confirmedEdgeKeys = new Set<string>();
  for (const edge of snapshot.edges) {
    confirmedEdgeKeys.add(`${edge.fromVnum}:${edge.direction}`);
  }

  const portalVnums = new Set<number>();
  const drawnEdges = new Set<string>();
  for (const edge of snapshot.edges) {
    const fromCell = levelCells.get(edge.fromVnum);
    if (!fromCell) continue;
    const toCell = levelCells.get(edge.toVnum);

    if (edge.isPortal) {
      portalVnums.add(edge.fromVnum);
      if (!visibleVnums.has(edge.fromVnum)) continue;

      const [cx, cy] = tileCenter(fromCell.gridX, fromCell.gridY);
      const dirDelta = DIR_DELTA[edge.direction];
      if (!dirDelta) continue;

      const reach = TILE / 2 + (CELL - TILE) / 2 + 10;
      const ex = cx + dirDelta[0] * reach;
      const ey = cy - dirDelta[1] * reach;

      const stem = document.createElementNS("http://www.w3.org/2000/svg", "line");
      stem.setAttribute("x1", String(cx));
      stem.setAttribute("y1", String(cy));
      stem.setAttribute("x2", String(ex));
      stem.setAttribute("y2", String(ey));
      stem.setAttribute("class", "map-edge map-edge--portal-stem");
      svg.appendChild(stem);

      const crossHalf = 6;
      const [px, py] = dirDelta[0] !== 0 ? [0, crossHalf] : [crossHalf, 0];
      const cross = document.createElementNS("http://www.w3.org/2000/svg", "line");
      cross.setAttribute("x1", String(ex - px));
      cross.setAttribute("y1", String(ey - py));
      cross.setAttribute("x2", String(ex + px));
      cross.setAttribute("y2", String(ey + py));
      cross.setAttribute("class", "map-edge--portal-cross");
      svg.appendChild(cross);
      continue;
    }

    if (!toCell) continue;
    if (!visibleVnums.has(edge.fromVnum) || !visibleVnums.has(edge.toVnum)) continue;

    const edgeKey = [edge.fromVnum, edge.toVnum].sort().join("-");
    if (drawnEdges.has(edgeKey)) continue;
    drawnEdges.add(edgeKey);

    const [x1, y1] = tileCenter(fromCell.gridX, fromCell.gridY);
    const [x2, y2] = tileCenter(toCell.gridX, toCell.gridY);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    line.setAttribute("class", "map-edge");
    svg.appendChild(line);
  }

  wrapper.appendChild(svg);

  for (const cell of levelCells.values()) {
    const node = nodeByVnum.get(cell.vnum);
    if (!node) continue;

    const isCurrent = cell.vnum === snapshot.currentVnum;
    const px = (cell.gridX - minX + PAD) * CELL;
    const py = (toRenderY(cell.gridY) + PAD) * CELL;

    const tile = document.createElement("div");
    tile.className = isCurrent ? "map-room map-room--current" : "map-room";
    tile.style.left = `${px}px`;
    tile.style.top = `${py}px`;
    tile.style.width = `${TILE}px`;
    tile.style.height = `${TILE}px`;
    tile.setAttribute("data-vnum", String(cell.vnum));

    if (!isCurrent && node.color) {
      tile.style.background = node.color;
    }

    const nameEl = document.createElement("span");
    nameEl.className = "map-room__name";
    nameEl.textContent = node.name;
    tile.appendChild(nameEl);

    const aliasEntry = currentAliases.find((a) => a.vnum === cell.vnum);
    if (aliasEntry) {
      const aliasBadge = document.createElement("div");
      aliasBadge.className = "map-alias-badge";
      aliasBadge.textContent = aliasEntry.alias;
      tile.appendChild(aliasBadge);
    }

    const upDownExits = (node.exits ?? []).filter((d) => d === "up" || d === "down");
    if (upDownExits.length > 0) {
      const edgeDirections = new Set(
        snapshot.edges.filter((e) => e.fromVnum === cell.vnum).map((e) => e.direction)
      );
      const closedSet = new Set(node.closedExits ?? []);

      for (const dir of upDownExits) {
        const explored = edgeDirections.has(dir);
        const closed = closedSet.has(dir);
        const badge = document.createElement("div");
        badge.className = explored
          ? "map-exit-vertical map-exit-vertical--explored"
          : "map-exit-vertical map-exit-vertical--unknown";
        let symbol = dir === "up" ? "↑" : "↓";
        if (closed) symbol += "(w)";
        badge.textContent = symbol;
        tile.appendChild(badge);
      }
    }

    wrapper.appendChild(tile);
  }

  const STUB = 14;
  const drawnUnconfirmed = new Set<string>();

  for (const cell of levelCells.values()) {
    const node = nodeByVnum.get(cell.vnum);
    if (!node) continue;

    for (const dir of (node.exits ?? [])) {
      const delta = DIR_DELTA[dir];
      if (!delta) continue;

      const nx = cell.gridX + delta[0];
      const ny = cell.gridY + delta[1];
      const neighborCell = Array.from(levelCells.values()).find(
        (candidate) =>
          candidate.vnum !== cell.vnum &&
          candidate.gridX === nx &&
          candidate.gridY === ny &&
          visibleVnums.has(candidate.vnum)
      );

      if (neighborCell) {
        const edgeConfirmed =
          confirmedEdgeKeys.has(`${cell.vnum}:${dir}`) ||
          confirmedEdgeKeys.has(`${neighborCell.vnum}:${OPPOSITE_DIR[dir] ?? ""}`);
        if (edgeConfirmed) continue;

        const pairKey = [cell.vnum, neighborCell.vnum].sort().join("-") + ":" + dir;
        if (drawnUnconfirmed.has(pairKey)) continue;
        drawnUnconfirmed.add(pairKey);

        const [x1, y1] = tileCenter(cell.gridX, cell.gridY);
        const [x2, y2] = tileCenter(neighborCell.gridX, neighborCell.gridY);
        const GAP_HALF = 3;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len;
        const uy = dy / len;

        for (const [ax, ay, bx, by] of [
          [x1, y1, mx - ux * GAP_HALF, my - uy * GAP_HALF],
          [mx + ux * GAP_HALF, my + uy * GAP_HALF, x2, y2],
        ] as [number, number, number, number][]) {
          const seg = document.createElementNS("http://www.w3.org/2000/svg", "line");
          seg.setAttribute("x1", String(ax));
          seg.setAttribute("y1", String(ay));
          seg.setAttribute("x2", String(bx));
          seg.setAttribute("y2", String(by));
          seg.setAttribute("class", "map-edge map-edge--unconfirmed");
          svg.appendChild(seg);
        }
        continue;
      }

      const stubX = (nx - minX + PAD) * CELL + (TILE - STUB) / 2;
      const stubY = (toRenderY(ny) + PAD) * CELL + (TILE - STUB) / 2;

      const stub = document.createElement("div");
      stub.className = "map-room-stub";
      stub.style.left = `${stubX}px`;
      stub.style.top = `${stubY}px`;
      stub.style.width = `${STUB}px`;
      stub.style.height = `${STUB}px`;

      const isClosed = (node.closedExits ?? []).includes(dir);
      if (isClosed) {
        stub.className = "map-room-stub map-room-stub--door";
        const doorLabel = document.createElement("span");
        doorLabel.className = "map-stub-door-label";
        doorLabel.textContent = "(w)";
        stub.appendChild(doorLabel);
      } else {
        const stubSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        stubSvg.setAttribute("width", String(STUB));
        stubSvg.setAttribute("height", String(STUB));
        stubSvg.setAttribute("viewBox", `0 0 ${STUB} ${STUB}`);
        stubSvg.style.display = "block";
        const stubDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        stubDot.setAttribute("cx", String(STUB / 2));
        stubDot.setAttribute("cy", String(STUB / 2));
        stubDot.setAttribute("r", "2.5");
        stubDot.setAttribute("class", "map-stub-dot");
        stubSvg.appendChild(stubDot);
        stub.appendChild(stubSvg);
      }

      wrapper.appendChild(stub);

      const [x1, y1] = tileCenter(cell.gridX, cell.gridY);
      const stubCx = stubX + STUB / 2;
      const stubCy = stubY + STUB / 2;

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(stubCx));
      line.setAttribute("y2", String(stubCy));
      line.setAttribute("class", "map-edge map-edge--unknown");
      svg.appendChild(line);
    }
  }

  mapCanvasElement.appendChild(wrapper);

  const currentCell = snapshot.currentVnum != null ? levelCells.get(snapshot.currentVnum) : null;
  if (currentCell) {
    const snapCell = currentCell;
    requestAnimationFrame(() => {
      const [cx, cy] = tileCenter(snapCell.gridX, snapCell.gridY);
      mapCanvasElement.scrollLeft = cx - mapCanvasElement.clientWidth / 2;
      mapCanvasElement.scrollTop = cy - mapCanvasElement.clientHeight / 2;
    });
  }
}

let mapDragOrigin: { x: number; y: number; scrollLeft: number; scrollTop: number } | null = null;
let mapDidDrag = false;

mapCanvasElement.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  mapDidDrag = false;
  mapDragOrigin = {
    x: e.clientX,
    y: e.clientY,
    scrollLeft: mapCanvasElement.scrollLeft,
    scrollTop: mapCanvasElement.scrollTop,
  };
  mapCanvasElement.setPointerCapture(e.pointerId);
  mapCanvasElement.classList.add("map-canvas--dragging");
});

mapCanvasElement.addEventListener("pointermove", (e) => {
  if (!mapDragOrigin) return;
  if (Math.abs(e.clientX - mapDragOrigin.x) > 4 || Math.abs(e.clientY - mapDragOrigin.y) > 4) {
    mapDidDrag = true;
  }
  mapCanvasElement.scrollLeft = mapDragOrigin.scrollLeft - (e.clientX - mapDragOrigin.x);
  mapCanvasElement.scrollTop = mapDragOrigin.scrollTop - (e.clientY - mapDragOrigin.y);
});

mapCanvasElement.addEventListener("pointerup", () => {
  mapDragOrigin = null;
  mapCanvasElement.classList.remove("map-canvas--dragging");
});

mapCanvasElement.addEventListener("pointercancel", () => {
  mapDragOrigin = null;
  mapCanvasElement.classList.remove("map-canvas--dragging");
});

mapCanvasElement.addEventListener("dblclick", (e) => {
  if (mapDidDrag) return;
  const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
  if (!elementUnder) return;
  const tile = elementUnder.closest<HTMLElement>(".map-room");
  if (!tile) return;
  const vnumAttr = tile.getAttribute("data-vnum");
  if (!vnumAttr) return;
  const vnum = Number(vnumAttr);
  const snapshot = latestMapSnapshot;
  const node = snapshot.nodes.find((n) => n.vnum === vnum);
  openAliasPopup(vnum, currentAliases.find((a) => a.vnum === vnum)?.alias, node?.name ?? String(vnum));
});

mapCanvasElement.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
  if (!elementUnder) return;
  const tile = elementUnder.closest<HTMLElement>(".map-room");
  if (!tile) return;
  const vnumAttr = tile.getAttribute("data-vnum");
  if (!vnumAttr) return;
  openMapContextMenu(Number(vnumAttr), e.clientX, e.clientY);
});

function createDefaultTerminalStyle(): TerminalStyle {
  return {
    foreground: "default",
    bold: false,
  };
}

function updateMap(snapshot: MapSnapshotPayload, fullReset: boolean): void {
  latestMapSnapshot = snapshot;
  for (const [zoneId, name] of snapshot.zoneNames) {
    zoneNames.set(zoneId, name);
  }
  saveZoneNames(zoneNames);
  resetGridLayout();
  integrateSnapshot(snapshot);
  renderGridMap(snapshot);
  renderNavPanel();
}

interface ZoneNode {
  zoneId: number;
  roomCount: number;
  visitedCount: number;
  gridX: number;
  gridY: number;
}

interface ZoneEdge {
  fromZone: number;
  toZone: number;
  direction: string;
}

function loadZoneNames(): Map<number, string> {
  try {
    const raw = localStorage.getItem("zoneNames");
    if (!raw) return new Map();
    return new Map(JSON.parse(raw) as [number, string][]);
  } catch {
    return new Map();
  }
}

function saveZoneNames(names: Map<number, string>): void {
  localStorage.setItem("zoneNames", JSON.stringify(Array.from(names.entries())));
}

let zoneNames: Map<number, string> = loadZoneNames();

function buildZoneGraph(snapshot: MapSnapshotPayload): { zones: Map<number, ZoneNode>; edges: ZoneEdge[] } {
  const zones = new Map<number, ZoneNode>();

  for (const node of snapshot.nodes) {
    const zoneId = getZoneId(node.vnum);
    const existing = zones.get(zoneId);
    if (existing) {
      existing.roomCount++;
      if (node.visited) existing.visitedCount++;
    } else {
      zones.set(zoneId, { zoneId, roomCount: 1, visitedCount: node.visited ? 1 : 0, gridX: 0, gridY: 0 });
    }
  }

  const edgeSet = new Set<string>();
  const edges: ZoneEdge[] = [];
  for (const edge of snapshot.edges) {
    const fromZone = getZoneId(edge.fromVnum);
    const toZone = getZoneId(edge.toVnum);
    if (fromZone === toZone) continue;
    const key = fromZone < toZone ? `${fromZone}-${toZone}` : `${toZone}-${fromZone}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push({ fromZone, toZone, direction: edge.direction });
  }

  return { zones, edges };
}

function layoutZoneGraph(zones: Map<number, ZoneNode>, edges: ZoneEdge[]): void {
  if (zones.size === 0) return;

  const DIR_OFFSET: Record<string, [number, number]> = {
    north:     [0, -1],
    south:     [0,  1],
    east:      [1,  0],
    west:      [-1, 0],
    northeast: [1, -1],
    northwest: [-1, -1],
    southeast: [1,  1],
    southwest: [-1,  1],
    up:        [0, -1],
    down:      [0,  1],
  };

  const adj = new Map<number, { nb: number; dx: number; dy: number }[]>();
  for (const z of zones.keys()) adj.set(z, []);
  for (const edge of edges) {
    const off = DIR_OFFSET[edge.direction];
    const dx = off ? off[0] : 0;
    const dy = off ? off[1] : 0;
    adj.get(edge.fromZone)?.push({ nb: edge.toZone, dx,  dy  });
    adj.get(edge.toZone)?.push(  { nb: edge.fromZone, dx: -dx, dy: -dy });
  }

  const sortedZones = Array.from(zones.keys()).sort((a, b) => a - b);
  const col = new Map<number, number>();
  const row = new Map<number, number>();
  const visited = new Set<number>();
  const components: number[][] = [];

  for (const startZone of sortedZones) {
    if (visited.has(startZone)) continue;
    const comp: number[] = [];
    const q = [startZone];
    visited.add(startZone);
    while (q.length > 0) {
      const cur = q.shift()!;
      comp.push(cur);
      for (const { nb } of adj.get(cur) ?? []) {
        if (!visited.has(nb)) { visited.add(nb); q.push(nb); }
      }
    }
    components.push(comp);
  }

  function cellKey(x: number, y: number): string { return `${x},${y}`; }

  let globalOffsetX = 0;

  for (const component of components) {
    const root = component[0]!;
    const posX = new Map<number, number>();
    const posY = new Map<number, number>();
    const localOccupied = new Map<string, number>();

    posX.set(root, 0);
    posY.set(root, 0);
    localOccupied.set(cellKey(0, 0), root);

    const bfsQ = [root];
    const placed = new Set([root]);

    while (bfsQ.length > 0) {
      const cur = bfsQ.shift()!;
      const cx = posX.get(cur)!;
      const cy = posY.get(cur)!;

      for (const { nb, dx, dy } of adj.get(cur) ?? []) {
        if (placed.has(nb)) continue;
        placed.add(nb);

        let tx = cx + dx * 2;
        let ty = cy + dy * 2;

        if (localOccupied.has(cellKey(tx, ty))) {
          const perps: [number, number][] = dy !== 0
            ? [[2, 0], [-2, 0], [4, 0], [-4, 0], [6, 0], [-6, 0], [8, 0], [-8, 0]]
            : [[0, 2], [0, -2], [0, 4], [0, -4], [0, 6], [0, -6], [0, 8], [0, -8]];
          let found = false;
          for (const [ox, oy] of perps) {
            if (!localOccupied.has(cellKey(tx + ox, ty + oy))) {
              tx += ox; ty += oy; found = true; break;
            }
          }
          if (!found) {
            outer: for (let r = 2; r <= 16; r += 2) {
              for (let ox = -r; ox <= r; ox += 2) {
                for (let oy = -r; oy <= r; oy += 2) {
                  if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
                  if (!localOccupied.has(cellKey(tx + ox, ty + oy))) {
                    tx += ox; ty += oy; break outer;
                  }
                }
              }
            }
          }
        }

        posX.set(nb, tx);
        posY.set(nb, ty);
        localOccupied.set(cellKey(tx, ty), nb);
        bfsQ.push(nb);
      }
    }

    const allX = [...posX.values()];
    const allY = [...posY.values()];
    const minCX = Math.min(...allX);
    const maxCX = Math.max(...allX);

    for (const z of component) {
      col.set(z, globalOffsetX + (posX.get(z)! - minCX));
      row.set(z, posY.get(z)!);
    }

    globalOffsetX += (maxCX - minCX) + 4;
  }

  const allRows = [...row.values()];
  const minRow = Math.min(...allRows);

  for (const zoneId of zones.keys()) {
    const zone = zones.get(zoneId)!;
    zone.gridX = col.get(zoneId) ?? 0;
    zone.gridY = (row.get(zoneId) ?? 0) - minRow;
  }
}

function routeZoneEdge(
  fromZone: ZoneNode,
  toZone: ZoneNode,
  occupied: Set<string>,
): Array<[number, number]> {
  const sx = fromZone.gridX, sy = fromZone.gridY;
  const tx = toZone.gridX, ty = toZone.gridY;
  if (sx === tx && sy === ty) return [[sx, sy]];

  const key = (x: number, y: number): string => `${x},${y}`;

  const DIRS: [number, number][] = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
  ];

  type Node = { x: number; y: number; g: number; f: number; parent: Node | null };
  const open = new Map<string, Node>();
  const closed = new Set<string>();

  const startNode: Node = { x: sx, y: sy, g: 0, f: Math.abs(tx - sx) + Math.abs(ty - sy), parent: null };
  open.set(key(sx, sy), startNode);

  let iterations = 0;
  while (open.size > 0 && iterations++ < 2000) {
    let current: Node | null = null;
    for (const node of open.values()) {
      if (!current || node.f < current.f) current = node;
    }
    if (!current) break;

    if (current.x === tx && current.y === ty) {
      const path: Array<[number, number]> = [];
      let n: Node | null = current;
      while (n) { path.unshift([n.x, n.y]); n = n.parent; }
      return path;
    }

    open.delete(key(current.x, current.y));
    closed.add(key(current.x, current.y));

    for (const [dx, dy] of DIRS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const isTarget = nx === tx && ny === ty;
      if (!isTarget && occupied.has(nk)) continue;

      const moveCost = dx !== 0 && dy !== 0 ? 1.4 : 1.0;
      const crossPenalty = !isTarget && (
        (dx !== 0 && dy !== 0 && (occupied.has(key(current.x + dx, current.y)) || occupied.has(key(current.x, current.y + dy))))
      ) ? 3 : 0;
      const g = current.g + moveCost + crossPenalty;
      const h = Math.abs(tx - nx) + Math.abs(ty - ny);
      const existing = open.get(nk);
      if (!existing || g < existing.g) {
        open.set(nk, { x: nx, y: ny, g, f: g + h, parent: current });
      }
    }
  }

  return [[sx, sy], [tx, ty]];
}

const ZONE_CELL = 120;
const ZONE_TILE = 100;
const ZONE_PAD = 3;

let globalMapZoneRenameId: number | null = null;

function renderZoneMap(snapshot: MapSnapshotPayload): void {
  globalMapCanvas.innerHTML = "";

  if (snapshot.nodes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "map-empty";
    empty.textContent = "No map data yet";
    globalMapCanvas.appendChild(empty);
    return;
  }

  const { zones, edges } = buildZoneGraph(snapshot);
  if (zones.size === 0) return;

  layoutZoneGraph(zones, edges);

  const scale = globalMapZoom;
  const G_CELL = Math.round(ZONE_CELL * scale);
  const G_TILE = Math.round(ZONE_TILE * scale);
  const G_PAD = ZONE_PAD;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const z of zones.values()) {
    if (z.gridX < minX) minX = z.gridX;
    if (z.gridY < minY) minY = z.gridY;
    if (z.gridX > maxX) maxX = z.gridX;
    if (z.gridY > maxY) maxY = z.gridY;
  }

  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  const canvasW = (cols + G_PAD * 2) * G_CELL;
  const canvasH = (rows + G_PAD * 2) * G_CELL;

  function toRenderY(gy: number): number { return gy - minY; }
  function tileCenter(gx: number, gy: number): [number, number] {
    return [(gx - minX + G_PAD) * G_CELL + G_TILE / 2, (toRenderY(gy) + G_PAD) * G_CELL + G_TILE / 2];
  }
  function tileEdgePoint(gx: number, gy: number, towardGx: number, towardGy: number): [number, number] {
    const [cx, cy] = tileCenter(gx, gy);
    const dx = towardGx - gx;
    const dy = towardGy - gy;
    const half = G_TILE / 2;
    const ex = dx === 0 ? 0 : dx > 0 ? half : -half;
    const ey = dy === 0 ? 0 : dy > 0 ? half : -half;
    if (dx !== 0 && dy !== 0) {
      return [cx + ex, cy + ey];
    }
    return [cx + ex, cy + ey];
  }

  const wrapper = document.createElement("div");
  wrapper.style.width = `${canvasW}px`;
  wrapper.style.height = `${canvasH}px`;
  wrapper.style.position = "relative";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(canvasW));
  svg.setAttribute("height", String(canvasH));
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.pointerEvents = "none";

  const currentZoneId = snapshot.currentVnum != null ? getZoneId(snapshot.currentVnum) : null;

  const occupiedCells = new Set<string>(
    Array.from(zones.values()).map((z) => `${z.gridX},${z.gridY}`)
  );

  const pairEdgeCount = new Map<string, number>();
  const pairEdgeIndex = new Map<string, number>();
  for (const edge of edges) {
    const k = [Math.min(edge.fromZone, edge.toZone), Math.max(edge.fromZone, edge.toZone)].join(",");
    pairEdgeCount.set(k, (pairEdgeCount.get(k) ?? 0) + 1);
    pairEdgeIndex.set(k, 0);
  }

  function buildSvgPath(pixelPoints: [number, number][], offsetPx: number): string {
    if (pixelPoints.length < 2) return "";

    const applyOffset = (pts: [number, number][], offset: number): [number, number][] => {
      if (offset === 0 || pts.length < 2) return pts;
      const [ax, ay] = pts[0]!;
      const [bx, by] = pts[pts.length - 1]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      return pts.map(([x, y]) => [x + nx * offset, y + ny * offset] as [number, number]);
    };

    const pts = applyOffset(pixelPoints, offsetPx);

    if (pts.length === 2) {
      return `M ${pts[0]![0]},${pts[0]![1]} L ${pts[1]![0]},${pts[1]![1]}`;
    }

    let d = `M ${pts[0]![0]},${pts[0]![1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [px1, py1] = pts[i]!;
      const [px2, py2] = pts[i + 1]!;
      const qx = (px1 + px2) / 2;
      const qy = (py1 + py2) / 2;
      d += ` L ${px1},${py1} Q ${px1},${py1} ${qx},${qy}`;
    }
    d += ` L ${pts[pts.length - 1]![0]},${pts[pts.length - 1]![1]}`;
    return d;
  }

  for (const edge of edges) {
    const from = zones.get(edge.fromZone);
    const to = zones.get(edge.toZone);
    if (!from || !to) continue;

    const routePath = routeZoneEdge(from, to, occupiedCells);
    if (routePath.length < 2) continue;

    const pixelPoints: [number, number][] = routePath.map(([gx, gy], i) => {
      if (i === 0) {
        const [ngx, ngy] = routePath[1]!;
        return tileEdgePoint(gx, gy, ngx, ngy);
      }
      if (i === routePath.length - 1) {
        const [pgx, pgy] = routePath[routePath.length - 2]!;
        return tileEdgePoint(gx, gy, pgx, pgy);
      }
      return tileCenter(gx, gy);
    });

    const pairKey = [Math.min(edge.fromZone, edge.toZone), Math.max(edge.fromZone, edge.toZone)].join(",");
    const count = pairEdgeCount.get(pairKey) ?? 1;
    const idx = pairEdgeIndex.get(pairKey) ?? 0;
    pairEdgeIndex.set(pairKey, idx + 1);

    const BUNDLE_SPACING = 6;
    const offsetPx = count === 1 ? 0 : (idx - (count - 1) / 2) * BUNDLE_SPACING;

    const d = buildSvgPath(pixelPoints, offsetPx);

    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", d);
    pathEl.setAttribute("class", "global-map-portal-line");
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("data-from", String(edge.fromZone));
    pathEl.setAttribute("data-to", String(edge.toZone));
    svg.appendChild(pathEl);
  }

  function findZonePath(fromZoneId: number, toZoneId: number): Set<string> {
    if (fromZoneId === toZoneId) return new Set();
    const adj = new Map<number, number[]>();
    for (const e of edges) {
      if (!adj.has(e.fromZone)) adj.set(e.fromZone, []);
      if (!adj.has(e.toZone)) adj.set(e.toZone, []);
      adj.get(e.fromZone)!.push(e.toZone);
      adj.get(e.toZone)!.push(e.fromZone);
    }
    const prev = new Map<number, number>();
    const visited = new Set([fromZoneId]);
    const queue = [fromZoneId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === toZoneId) break;
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          prev.set(nb, cur);
          queue.push(nb);
        }
      }
    }
    const pathEdges = new Set<string>();
    let cur: number | undefined = toZoneId;
    while (cur !== undefined && prev.has(cur)) {
      const p: number = prev.get(cur)!;
      pathEdges.add(`${Math.min(p, cur)},${Math.max(p, cur)}`);
      cur = p;
    }
    return pathEdges;
  }

  wrapper.appendChild(svg);

  for (const zone of zones.values()) {
    const isCurrent = zone.zoneId === currentZoneId;
    const px = (zone.gridX - minX + G_PAD) * G_CELL;
    const py = (toRenderY(zone.gridY) + G_PAD) * G_CELL;

    const tile = document.createElement("div");
    tile.className = isCurrent ? "zone-tile zone-tile--current" : "zone-tile";
    tile.style.left = `${px}px`;
    tile.style.top = `${py}px`;
    tile.style.width = `${G_TILE}px`;
    tile.style.height = `${G_TILE}px`;
    tile.setAttribute("data-zone-id", String(zone.zoneId));

    const zIdStr = String(zone.zoneId);
    tile.addEventListener("mouseenter", () => {
      const pathEdges = currentZoneId != null && zone.zoneId !== currentZoneId
        ? findZonePath(zone.zoneId, currentZoneId)
        : new Set<string>();

      svg.querySelectorAll<SVGPathElement>("path").forEach((pl) => {
        const f = pl.getAttribute("data-from")!;
        const t = pl.getAttribute("data-to")!;
        const isConnected = f === zIdStr || t === zIdStr;
        const pairKey = `${Math.min(Number(f), Number(t))},${Math.max(Number(f), Number(t))}`;
        const isPath = pathEdges.has(pairKey);
        pl.classList.toggle("global-map-portal-line--active", isConnected && !isPath);
        pl.classList.toggle("global-map-portal-line--path", isPath);
        pl.classList.toggle("global-map-portal-line--dim", !isConnected && !isPath);
      });
    });
    tile.addEventListener("mouseleave", () => {
      svg.querySelectorAll<SVGPathElement>("path").forEach((pl) => {
        pl.classList.remove("global-map-portal-line--active", "global-map-portal-line--path", "global-map-portal-line--dim");
      });
    });

    const idEl = document.createElement("div");
    idEl.className = "zone-tile__id";
    idEl.textContent = `${zone.zoneId} - ${zone.visitedCount}`;
    tile.appendChild(idEl);

    const customName = zoneNames.get(zone.zoneId);
    const nameEl = document.createElement("div");
    nameEl.className = "zone-tile__name";
    nameEl.textContent = customName ?? "";
    tile.appendChild(nameEl);

    wrapper.appendChild(tile);
  }

  globalMapCanvas.appendChild(wrapper);

  if (currentZoneId != null) {
    const currentZone = zones.get(currentZoneId);
    if (currentZone) {
      const snapZone = currentZone;
      requestAnimationFrame(() => {
        const [cx, cy] = tileCenter(snapZone.gridX, snapZone.gridY);
        globalMapCanvas.scrollLeft = cx - globalMapCanvas.clientWidth / 2;
        globalMapCanvas.scrollTop = cy - globalMapCanvas.clientHeight / 2;
      });
    }
  }

  if (globalMapSearchQuery !== "") {
    applyGlobalMapSearch();
  }
}

function updateGlobalMapZoomLabel(): void {
  globalMapZoomLabel.textContent = `${Math.round(globalMapZoom * 100)}%`;
}

function openGlobalMap(): void {
  globalMapOpen = true;
  globalMapModal.classList.remove("global-map-modal--hidden");
  renderZoneMap(latestMapSnapshot);
}

function applyGlobalMapSearch(): void {
  const query = globalMapSearch.value.trim().toLowerCase();
  globalMapSearchQuery = query;
  const tiles = Array.from(globalMapCanvas.querySelectorAll<HTMLElement>(".zone-tile"));
  for (const tile of tiles) {
    const zoneId = tile.getAttribute("data-zone-id") ?? "";
    const zoneName = (zoneNames.get(Number(zoneId)) ?? "").toLowerCase();
    const matches = query === "" || zoneId.includes(query) || zoneName.includes(query);
    tile.classList.toggle("zone-tile--dimmed", !matches);
  }
}

function closeGlobalMap(): void {
  globalMapOpen = false;
  globalMapModal.classList.add("global-map-modal--hidden");
  closeZoneRenamePopup();
  globalMapSearch.value = "";
  globalMapSearchQuery = "";
}

globalMapButton.addEventListener("click", openGlobalMap);
globalMapModalClose.addEventListener("click", closeGlobalMap);
globalMapSearch.addEventListener("input", applyGlobalMapSearch);

globalMapModal.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target === globalMapModal || target.classList.contains("global-map-modal__backdrop")) {
    closeGlobalMap();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && globalMapOpen) closeGlobalMap();
});

globalMapZoomIn.addEventListener("click", () => {
  globalMapZoom = Math.min(2.0, parseFloat((globalMapZoom + 0.2).toFixed(1)));
  updateGlobalMapZoomLabel();
  if (globalMapOpen) renderZoneMap(latestMapSnapshot);
});

globalMapZoomOut.addEventListener("click", () => {
  globalMapZoom = Math.max(0.2, parseFloat((globalMapZoom - 0.2).toFixed(1)));
  updateGlobalMapZoomLabel();
  if (globalMapOpen) renderZoneMap(latestMapSnapshot);
});

let globalMapDragOrigin: { x: number; y: number; scrollLeft: number; scrollTop: number } | null = null;
let globalMapDidDrag = false;

globalMapCanvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  globalMapDidDrag = false;
  globalMapDragOrigin = {
    x: e.clientX,
    y: e.clientY,
    scrollLeft: globalMapCanvas.scrollLeft,
    scrollTop: globalMapCanvas.scrollTop,
  };
  globalMapCanvas.setPointerCapture(e.pointerId);
  globalMapCanvas.classList.add("map-canvas--dragging");
});

globalMapCanvas.addEventListener("pointermove", (e) => {
  if (!globalMapDragOrigin) return;
  if (Math.abs(e.clientX - globalMapDragOrigin.x) > 4 || Math.abs(e.clientY - globalMapDragOrigin.y) > 4) {
    globalMapDidDrag = true;
  }
  globalMapCanvas.scrollLeft = globalMapDragOrigin.scrollLeft - (e.clientX - globalMapDragOrigin.x);
  globalMapCanvas.scrollTop = globalMapDragOrigin.scrollTop - (e.clientY - globalMapDragOrigin.y);
});

globalMapCanvas.addEventListener("pointerup", () => {
  globalMapDragOrigin = null;
  globalMapCanvas.classList.remove("map-canvas--dragging");
});

globalMapCanvas.addEventListener("pointercancel", () => {
  globalMapDragOrigin = null;
  globalMapCanvas.classList.remove("map-canvas--dragging");
});

globalMapCanvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (globalMapDidDrag) return;
  const target = e.target as HTMLElement;
  const tile = target.closest<HTMLElement>(".zone-tile");
  if (!tile) return;
  const zoneId = Number(tile.getAttribute("data-zone-id"));
  if (isNaN(zoneId)) return;
  openZoneRenamePopup(zoneId, e.clientX, e.clientY);
});

const zoneRenamePopup = requireElement<HTMLDivElement>("#zone-rename-popup");
const zoneRenameInput = requireElement<HTMLInputElement>("#zone-rename-input");
const zoneRenameTitle = requireElement<HTMLSpanElement>("#zone-rename-title");
const zoneRenameSave = requireElement<HTMLButtonElement>("#zone-rename-save");
const zoneRenameDelete = requireElement<HTMLButtonElement>("#zone-rename-delete");
const zoneRenameClose = requireElement<HTMLButtonElement>("#zone-rename-close");

function openZoneRenamePopup(zoneId: number, clientX: number, clientY: number): void {
  globalMapZoneRenameId = zoneId;
  zoneRenameTitle.textContent = `Зона ${zoneId}`;
  zoneRenameInput.value = zoneNames.get(zoneId) ?? "";
  zoneRenamePopup.classList.remove("zone-rename-popup--hidden");

  const popupW = 220;
  const popupH = 100;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(clientX, vw - popupW - 8);
  const top = Math.min(clientY, vh - popupH - 8);
  zoneRenamePopup.style.left = `${left}px`;
  zoneRenamePopup.style.top = `${top}px`;
  requestAnimationFrame(() => zoneRenameInput.focus());
}

function closeZoneRenamePopup(): void {
  globalMapZoneRenameId = null;
  zoneRenamePopup.classList.add("zone-rename-popup--hidden");
}

function saveZoneRename(): void {
  if (globalMapZoneRenameId === null) return;
  const name = zoneRenameInput.value.trim();
  if (name) {
    zoneNames.set(globalMapZoneRenameId, name);
  } else {
    zoneNames.delete(globalMapZoneRenameId);
  }
  saveZoneNames(zoneNames);
  sendClientEvent({ type: "zone_name_set", payload: { zoneId: globalMapZoneRenameId, name: name || null } });
  closeZoneRenamePopup();
  if (globalMapOpen) renderZoneMap(latestMapSnapshot);
}

zoneRenameSave.addEventListener("click", saveZoneRename);
zoneRenameClose.addEventListener("click", closeZoneRenamePopup);
zoneRenameDelete.addEventListener("click", () => {
  if (globalMapZoneRenameId !== null) {
    zoneNames.delete(globalMapZoneRenameId);
    saveZoneNames(zoneNames);
    sendClientEvent({ type: "zone_name_set", payload: { zoneId: globalMapZoneRenameId, name: null } });
  }
  closeZoneRenamePopup();
  if (globalMapOpen) renderZoneMap(latestMapSnapshot);
});
zoneRenameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveZoneRename();
  if (e.key === "Escape") closeZoneRenamePopup();
});

function cloneStyle(style: TerminalStyle): TerminalStyle {
  return {
    foreground: style.foreground,
    bold: style.bold,
  };
}

function resetStyle(style: TerminalStyle): void {
  style.foreground = "default";
  style.bold = false;
}

function mapAnsiCodeToColor(code: number): AnsiColorName | null {
  switch (code) {
    case 30:
      return "black";
    case 31:
      return "red";
    case 32:
      return "green";
    case 33:
      return "yellow";
    case 34:
      return "blue";
    case 35:
      return "magenta";
    case 36:
      return "cyan";
    case 37:
      return "white";
    case 90:
      return "bright-black";
    case 91:
      return "bright-red";
    case 92:
      return "bright-green";
    case 93:
      return "bright-yellow";
    case 94:
      return "bright-blue";
    case 95:
      return "bright-magenta";
    case 96:
      return "bright-cyan";
    case 97:
      return "bright-white";
    default:
      return null;
  }
}

function applyAnsiCodes(style: TerminalStyle, codes: number[]): void {
  if (codes.length === 0) {
    resetStyle(style);
    return;
  }

  for (const code of codes) {
    if (code === 0) {
      resetStyle(style);
      continue;
    }

    if (code === 1) {
      style.bold = true;
      continue;
    }

    if (code === 22) {
      style.bold = false;
      continue;
    }

    if (code === 39) {
      style.foreground = "default";
      continue;
    }

    const color = mapAnsiCodeToColor(code);

    if (color) {
      style.foreground = color;
    }
  }
}

function classNamesForStyle(style: TerminalStyle): string[] {
  const classes = ["terminal-segment", `terminal-fg-${style.foreground}`];

  if (style.bold) {
    classes.push("terminal-bold");
  }

  return classes;
}

const MAX_OUTPUT_SEGMENTS = 2000;
const OUTPUT_TRIM_COUNT = 200;

function isScrolledToBottom(): boolean {
  const threshold = 50;
  return outputElement.scrollHeight - outputElement.scrollTop - outputElement.clientHeight <= threshold;
}

function appendStyledText(text: string, style: TerminalStyle): void {
  if (text.length === 0) {
    return;
  }

  const span = document.createElement("span");
  span.className = classNamesForStyle(style).join(" ");
  span.textContent = text;
  outputElement.append(span);
}

function parseAnsiSegments(chunk: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let text = `${ansiState.pendingEscape}${chunk}`;
  ansiState.pendingEscape = "";
  let cursor = 0;
  let currentText = "";

  const pushCurrentText = () => {
    if (currentText.length === 0) {
      return;
    }

    segments.push({
      text: currentText,
      style: cloneStyle(ansiState.style),
    });
    currentText = "";
  };

  while (cursor < text.length) {
    if (text[cursor] !== ESCAPE) {
      currentText += text[cursor];
      cursor += 1;
      continue;
    }

    const sequenceEnd = text.indexOf("m", cursor);

    if (sequenceEnd === -1) {
      ansiState.pendingEscape = text.slice(cursor);
      break;
    }

    pushCurrentText();

    const sequence = text.slice(cursor, sequenceEnd + 1);
    const sgrMatch = /^\u001b\[([0-9;]*)m$/.exec(sequence);

    if (!sgrMatch) {
      currentText += sequence;
      cursor = sequenceEnd + 1;
      continue;
    }

    const codes = sgrMatch[1]
      .split(";")
      .filter((part) => part.length > 0)
      .map((part) => Number(part))
      .filter((value) => Number.isInteger(value));

    applyAnsiCodes(ansiState.style, codes);
    cursor = sequenceEnd + 1;
  }

  pushCurrentText();
  return segments;
}

const MAX_CHAT_LINES = 200;

function appendChatMessage(text: string, timestamp: number): void {
  const isChatScrolledToBottom = chatOutputElement.scrollHeight - chatOutputElement.scrollTop - chatOutputElement.clientHeight <= 30;

  const line = document.createElement("span");
  line.className = "chat-line";

  const timeSpan = document.createElement("span");
  timeSpan.className = "chat-line__time";
  const d = new Date(timestamp);
  timeSpan.textContent = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  line.appendChild(timeSpan);

  const textSpan = document.createElement("span");
  textSpan.textContent = text;
  line.appendChild(textSpan);

  chatOutputElement.appendChild(line);

  const children = chatOutputElement.children;
  while (children.length > MAX_CHAT_LINES) {
    children[0]?.remove();
  }

  if (isChatScrolledToBottom) {
    chatOutputElement.scrollTop = chatOutputElement.scrollHeight;
  }
}

function appendOutput(text: string): void {
  const shouldAutoScroll = isScrolledToBottom();
  const segments = parseAnsiSegments(text);

  // Parse last enemy name from combat prompt: e.g. "... [Ринли:Невредима] [крестьянин:Ранен] > "
  // There may be multiple [...:...] blocks; take the last one as the current target.
  // Strip ANSI escape codes first — raw text may contain color sequences inside [...] blocks.
  const cleanText = text.replace(/\x1b\[[0-9;]*m/g, "");
  const combatPromptMatches = [...cleanText.matchAll(/\[([^\]:]+):[А-Яа-яЁё. ]+\]/g)];
  if (combatPromptMatches.length > 0) {
    const last = combatPromptMatches[combatPromptMatches.length - 1];
    if (last[1]) {
      const words = last[1].trim().split(/\s+/);
      lastEnemy = words.map((w) => w.slice(0, 4)).join(".");
    }
  }

  for (const segment of segments) {
    appendStyledText(segment.text, segment.style);
  }

  const children = outputElement.children;
  if (children.length > MAX_OUTPUT_SEGMENTS) {
    const scrollBefore = outputElement.scrollTop;
    const heightBefore = outputElement.scrollHeight;

    const toRemove = Math.min(OUTPUT_TRIM_COUNT, children.length - MAX_OUTPUT_SEGMENTS);
    for (let i = 0; i < toRemove; i++) {
      children[0]?.remove();
    }

    if (!shouldAutoScroll) {
      outputElement.scrollTop = scrollBefore - (heightBefore - outputElement.scrollHeight);
    }
  }

  if (shouldAutoScroll) {
    outputElement.scrollTop = outputElement.scrollHeight;
  }
}

function appendSystemLine(text: string): void {
  appendOutput(`\n[system] ${text}\n`);
}

function setStatus(text: string): void {
  statusElement.textContent = text;
}

function updateConnectButton(state: "idle" | "connecting" | "connected" | "disconnected" | "error"): void {
  const isActive = state === "connected" || state === "connecting";
  connectForm.querySelectorAll<HTMLButtonElement>("button[type='submit']").forEach((btn) => {
    btn.disabled = isActive;
  });
}

function renderFarmButton(): void {
  farmToggleButton.textContent = farm2Enabled
    ? farm2PendingActivation
      ? "Фарм: запуск..."
      : `Фарм: вкл${farm2ZoneId !== null ? ` (${farm2ZoneId})` : ""}`
    : "Фарм: выкл";
  farmToggleButton.classList.toggle("button-toggle-active", farm2Enabled);
}

const SCRIPT_STEP_ICONS: Record<string, string> = {
  pending: "○",
  active: "▶",
  done: "✓",
  error: "✗",
  skipped: "–",
};

function renderScriptSteps(state: { enabled: boolean; zoneName: string | null; steps: Array<{ index: number; label: string; status: string; error?: string }>; errorMessage: string | null }): void {
  scriptPanelTitle.textContent = state.zoneName ? `Скрипт: ${state.zoneName}` : "Скрипт";

  if (state.errorMessage) {
    scriptStatusLine.textContent = state.errorMessage;
    scriptStatusLine.classList.remove("script-status-line--hidden");
  } else {
    scriptStatusLine.classList.add("script-status-line--hidden");
  }

  if (state.enabled) {
    scriptToggleBtn.textContent = "Стоп";
    scriptToggleBtn.disabled = false;
  } else {
    const script = trackerCurrentVnum !== null ? getScriptForVnum(trackerCurrentVnum) : undefined;
    if (script !== undefined) {
      scriptToggleBtn.textContent = script.name;
      scriptToggleBtn.disabled = false;
    } else {
      scriptToggleBtn.textContent = "Нет скрипта";
      scriptToggleBtn.disabled = true;
    }
  }

  scriptStepsList.innerHTML = "";

  const stepsToRender: Array<{ label: string; status: string; error?: string }> =
    state.steps.length > 0
      ? state.steps
      : (trackerCurrentVnum !== null ? getScriptForVnum(trackerCurrentVnum) : undefined)?.stepLabels.map((label) => ({ label, status: "pending" })) ?? [];

  for (const step of stepsToRender) {
    const li = document.createElement("li");
    li.className = `script-step script-step--${step.status}`;

    const iconSpan = document.createElement("span");
    iconSpan.className = "script-step__icon";
    iconSpan.textContent = SCRIPT_STEP_ICONS[step.status] ?? "○";

    const labelSpan = document.createElement("span");
    labelSpan.className = "script-step__label";
    labelSpan.textContent = step.label;

    li.appendChild(iconSpan);
    li.appendChild(labelSpan);

    if (step.error) {
      const errorSpan = document.createElement("span");
      errorSpan.className = "script-step__error";
      errorSpan.textContent = step.error;
      li.appendChild(errorSpan);
    }

    scriptStepsList.appendChild(li);
  }
}

function renderMapRecordingButton(): void {
  mapRecordingButton.textContent = mapRecordingEnabled ? "🗺️" : "⏸️";
  mapRecordingButton.title = mapRecordingEnabled ? "Запись карты: вкл" : "Запись карты: выкл";
  mapRecordingButton.classList.toggle("button-toggle-active", !mapRecordingEnabled);
}

function readStartupCommands(): string[] {
  return startupCommandsInput.value
    .split(/\r?\n/g)
    .map((command) => command.trim())
    .filter((command) => command.length > 0);
}

function getSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null || !reconnectEnabled) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    socket = createSocket();
  }, reconnectDelay);

  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_DELAY_MAX);
}

function flushPendingQueue(): void {
  while (pendingQueue.length > 0 && socket?.readyState === WebSocket.OPEN) {
    const event = pendingQueue.shift()!;
    socket.send(JSON.stringify(event));
  }
}

function createSocket(): WebSocket {
  const nextSocket = new WebSocket(getSocketUrl());

  nextSocket.addEventListener("open", () => {
    reconnectDelay = 1000;
    setStatus("Connected");
    flushPendingQueue();
    sendClientEvent({ type: "send", payload: { command: "осм склад1" } });
    sendClientEvent({ type: "send", payload: { command: "осм склад2" } });
    sendClientEvent({ type: "send", payload: { command: "инв" } });
  });

  nextSocket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as ServerEvent;

    switch (message.type) {
      case "defaults":
        autoConnectEnabled = message.payload.autoConnect;
        hostInput.value = message.payload.host;
        portInput.value = String(message.payload.port);
        tlsInput.checked = message.payload.tls;
        startupCommandsInput.value = message.payload.startupCommands.join("\n");
        commandDelayInput.value = String(message.payload.commandDelayMs);
        break;
      case "status":
        setStatus(message.payload.message);
        appendSystemLine(message.payload.message);
        updateConnectButton(message.payload.state);
        break;
      case "output":
        appendOutput(message.payload.text);
        break;
      case "error":
        setStatus(message.payload.message);
        appendSystemLine(`error: ${message.payload.message}`);
        break;
      case "map_snapshot":
        trackerCurrentVnum = message.payload.currentVnum;
        updateMap(message.payload, true);
        if (zoneScriptState && !zoneScriptState.payload.enabled) {
          renderScriptSteps(zoneScriptState.payload);
        }
        break;
      case "map_update":
        trackerCurrentVnum = message.payload.currentVnum;
        updateMap(message.payload, false);
        if (zoneScriptState && !zoneScriptState.payload.enabled) {
          renderScriptSteps(zoneScriptState.payload);
        }
        break;
      case "farm2_state":
        farm2Enabled = message.payload.enabled;
        farm2ZoneId = message.payload.zoneId;
        farm2PendingActivation = message.payload.pendingActivation;
        renderFarmButton();
        break;
      case "zone_script_state":
        zoneScriptState = message;
        renderScriptSteps(message.payload);
        if (message.payload.enabled) {
          switchContainerTab("script");
        }
        break;
      case "stats_update":
        currentStats = message.payload;
        updateStatsBar(message.payload.hp, message.payload.hpMax, message.payload.energy, message.payload.energyMax);
        break;
      case "aliases_snapshot":
        currentAliases = message.payload.aliases;
        renderNavPanel();
        renderGridMap(latestMapSnapshot);
        break;
      case "navigation_state":
        currentNavState = message.payload;
        renderNavStatus(message.payload);
        break;
      case "survival_status":
        currentSurvivalStatus = message.payload;
        updateActionBadges();
        break;
      case "farm_settings_data": {
        const rawSettings = message.payload.settings;
        const parsedSettings = typeof rawSettings === "string"
          ? (() => { try { return JSON.parse(rawSettings) as Partial<FarmSettings>; } catch { return null; } })()
          : rawSettings;
        if (parsedSettings !== null) {
          const normalized = normalizeFarmSettings(parsedSettings);
          if (farmModalZoneId === message.payload.zoneId) {
            fillFarmModal(normalized);
          }
        }
        break;
      }
      case "survival_settings_data": {
        const raw = message.payload;
        if (raw !== null) {
          currentSurvivalSettings = normalizeSurvivalSettings(raw);
          if (!survivalSettingsModal.classList.contains("farm-modal--hidden")) {
            fillSurvivalModal(currentSurvivalSettings);
          }
          updateActionButtons();
        }
        break;
      }
      case "triggers_state":
        currentTriggerState = message.payload;
        triggerDodgeCheckbox.checked = message.payload.dodge;
        triggerStandUpCheckbox.checked = message.payload.standUp;
        triggerRearmCheckbox.checked = message.payload.rearm;
        triggerCurseCheckbox.checked = message.payload.curse;
        triggerLightCheckbox.checked = message.payload.light;
        triggerFollowLeaderCheckbox.checked = message.payload.followLeader;
        triggerAssistCheckbox.checked = message.payload.assist ?? false;
        if (!triggersModal.classList.contains("farm-modal--hidden")) {
          renderAssistTanks(message.payload.assistTanks ?? []);
        }
        break;
      case "map_recording_state":
        mapRecordingEnabled = message.payload.enabled;
        renderMapRecordingButton();
        break;
      case "gather_state":
        gatherToggleButton.classList.toggle("button-toggle-active", message.payload.enabled);
        break;
      case "debug_log_state":
        debugLogButton.classList.toggle("button-toggle-active", message.payload.enabled);
        debugLogButton.title = message.payload.enabled ? "Дебаг лог: вкл" : "Дебаг лог: выкл";
        break;
      case "combat_state":
        hotkeysInCombat = message.payload.inCombat;
        break;
      case "items_data":
        renderItemDbTable(message.payload.items);
        break;
      case "room_auto_commands_snapshot":
        currentRoomAutoCommands = new Map(message.payload.entries.map((e) => [e.vnum, e.command]));
        break;
      case "compare_scan_progress":
        compareAdvisorStatus.textContent = message.payload.message;
        break;
      case "compare_scan_result":
        renderComparePanel(message.payload);
        break;
      case "repair_state":
        repairBtn.disabled = message.payload.running;
        repairBtn.title = message.payload.running
          ? `Починка: ${message.payload.message}`
          : "Починить снаряжение";
        break;
      case "wiki_item_search_result": {
        const p = message.payload;
        itemDbWikiBtn.disabled = false;
        if (!p.found) {
          itemDbWikiResult.classList.add("items-modal__wiki-result--error");
          itemDbWikiResult.textContent = p.error ?? `«${p.query}» — не найдено на вики`;
        } else {
          itemDbWikiResult.classList.remove("items-modal__wiki-result--error");
          const parts: string[] = [];
          if (p.name) parts.push(`${p.name}${p.itemType ? ` (${p.itemType})` : ""}`);
          if (p.text) parts.push(p.text);
          if (p.loadLocation) parts.push(`Лоад: ${p.loadLocation}`);
          itemDbWikiResult.textContent = parts.join("\n\n") || "Найдено, но карточка пуста";
          sendClientEvent({ type: "item_db_get" });
        }
        break;
      }
      case "vorozhe_route_result": {
        renderVorozheResult(message.payload);
        break;
      }
      case "container_contents": {
        renderContainerList(
          message.payload.container === "bag" ? bagPanelList : chestPanelList,
          message.payload.items,
          message.payload.container,
        );
        break;
      }
      case "inventory_contents": {
        renderInventoryList(inventoryPanelList, message.payload.items);
        if (pendingEquippedAction === "equip") {
          pendingEquippedAction = null;
          const commands: string[] = [];
          for (const item of message.payload.items) {
            const slotMatch = /\*Ринли\s+\*([^*]+)\*+/i.exec(item.name);
            if (!slotMatch) continue;
            const slot = slotMatch[1]?.trim() ?? "";
            const wearCmd = INVENTORY_WEAR_CMD[slot] ?? "над";
            const cleanName = item.name.replace(/\*+[^*]*\*+/g, "").replace(/<[^>]+>/g, "").trim();
            const keyword = cleanName.split(/\s+/)[0] ?? cleanName;
            if (keyword) commands.push(`${wearCmd} ${keyword}`);
          }
          if (commands.length > 0) {
            sendClientEvent({ type: "compare_apply", payload: { commands } });
          }
        }
        break;
      }
      case "equipped_contents": {
        const items = message.payload.items;
        if (pendingEquippedAction === "scratch") {
          pendingEquippedAction = null;
          const commands: string[] = [];
          for (const item of items) {
            commands.push(`сня ${item.keyword}`);
            commands.push(`нацарапать клан ${item.keyword} Ринли *${item.slot}*`);
            commands.push(`${item.wearCmd} ${item.keyword}`);
          }
          sendClientEvent({ type: "compare_apply", payload: { commands } });
        }
        break;
      }
      case "chat_message": {
        appendChatMessage(message.payload.text, message.payload.timestamp);
        break;
      }
      case "chat_history": {
        for (const msg of message.payload.messages) {
          appendChatMessage(msg.text, msg.timestamp);
        }
        break;
      }
    }
  });

  nextSocket.addEventListener("close", () => {
    socket = null;
    pendingOpenPromise = null;
    scheduleReconnect();
  });

  nextSocket.addEventListener("error", () => {
    setStatus("Socket error — reconnecting…");
  });

  return nextSocket;
}

function ensureSocketOpen(): Promise<void> {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  if (!socket || socket.readyState === WebSocket.CLOSED) {
    socket = createSocket();
  }

  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  if (!pendingOpenPromise) {
    pendingOpenPromise = new Promise<void>((resolve, reject) => {
      if (!socket) {
        reject(new Error("Socket was not created."));
        return;
      }

      const handleOpen = () => {
        cleanup();
        pendingOpenPromise = null;
        resolve();
      };

      const handleClose = () => {
        cleanup();
        pendingOpenPromise = null;
        reject(new Error("Socket closed before opening."));
      };

      const cleanup = () => {
        socket?.removeEventListener("open", handleOpen);
        socket?.removeEventListener("close", handleClose);
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("close", handleClose);
    });
  }

  return pendingOpenPromise;
}

function sendClientEvent(message: ClientEvent): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return;
  }

  pendingQueue.push(message);

  if (!socket || socket.readyState === WebSocket.CLOSED) {
    socket = createSocket();
  }
}

async function loadDefaults(): Promise<void> {
  const [configResponse, profilesResponse] = await Promise.all([
    fetch("/api/config", { cache: "no-store" }),
    fetch("/api/profiles", { cache: "no-store" }),
  ]);

  if (!configResponse.ok) {
    throw new Error(`Failed to load defaults: ${configResponse.status}`);
  }

  const defaults = (await configResponse.json()) as ConnectDefaults;
  autoConnectEnabled = defaults.autoConnect;
  hostInput.value = defaults.host;
  portInput.value = String(defaults.port);
  tlsInput.checked = defaults.tls;
  startupCommandsInput.value = defaults.startupCommands.join("\n");
  commandDelayInput.value = String(defaults.commandDelayMs);

  if (profilesResponse.ok) {
    const data = (await profilesResponse.json()) as ProfilesResponse;
    const savedProfileId = localStorage.getItem(LAST_PROFILE_KEY);
    const selectId = savedProfileId ?? data.defaultProfileId;
    profileSelectInput.innerHTML = "";
    for (const profile of data.profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name;
      if (profile.id === selectId) {
        option.selected = true;
      }
      profileSelectInput.appendChild(option);
    }
  }
}

connectForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await ensureSocketOpen();
  } catch (error) {
    appendSystemLine(error instanceof Error ? error.message : "failed to open control socket");
    return;
  }

  const selectedProfileId = profileSelectInput.value || undefined;
  if (selectedProfileId) {
    localStorage.setItem(LAST_PROFILE_KEY, selectedProfileId);
  }
  sendClientEvent({
    type: "connect",
    payload: {
      host: hostInput.value.trim(),
      port: Number(portInput.value),
      tls: tlsInput.checked,
      profileId: selectedProfileId,
      startupCommands: selectedProfileId ? undefined : readStartupCommands(),
      commandDelayMs: Number(commandDelayInput.value) || 0,
    },
  });
});

disconnectButton.addEventListener("click", () => {
  sendClientEvent({ type: "disconnect" });
});

const commandHistory: string[] = [];
let historyIndex = -1;
let historySavedInput = "";

commandInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (commandHistory.length === 0) return;
    if (historyIndex === -1) {
      historySavedInput = commandInput.value;
      historyIndex = commandHistory.length - 1;
    } else if (historyIndex > 0) {
      historyIndex -= 1;
    }
    commandInput.value = commandHistory[historyIndex]!;
    commandInput.setSelectionRange(commandInput.value.length, commandInput.value.length);
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (historyIndex === -1) return;
    if (historyIndex < commandHistory.length - 1) {
      historyIndex += 1;
      commandInput.value = commandHistory[historyIndex]!;
    } else {
      historyIndex = -1;
      commandInput.value = historySavedInput;
    }
    commandInput.setSelectionRange(commandInput.value.length, commandInput.value.length);
  }
});

commandForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const raw = commandInput.value.trim();

  if (!raw) {
    return;
  }

  const parts = raw.split(";").map((p) => p.trim()).filter((p) => p.length > 0);

  if (parts.length === 0) {
    return;
  }

  if (commandHistory[commandHistory.length - 1] !== raw) {
    commandHistory.push(raw);
  }
  historyIndex = -1;
  historySavedInput = "";

  for (const command of parts) {
    sendClientEvent({
      type: "send",
      payload: { command },
    });
  }
  commandInput.value = "";
});

clearOutputButton.addEventListener("click", () => {
  outputElement.replaceChildren();
  ansiState.pendingEscape = "";
  ansiState.style = createDefaultTerminalStyle();
});

chatClearButton.addEventListener("click", () => {
  chatOutputElement.replaceChildren();
});

resetMapButton.addEventListener("click", () => {
  sendClientEvent({ type: "map_reset_area" });
});

zLevelDownButton.addEventListener("click", () => {
  const idx = availableZLevels.indexOf(currentZLevel);
  if (idx > 0) {
    currentZLevel = availableZLevels[idx - 1]!;
    updateZLevelControls();
    renderGridMap(latestMapSnapshot);
  }
});

zLevelUpButton.addEventListener("click", () => {
  const idx = availableZLevels.indexOf(currentZLevel);
  if (idx < availableZLevels.length - 1) {
    currentZLevel = availableZLevels[idx + 1]!;
    updateZLevelControls();
    renderGridMap(latestMapSnapshot);
  }
});

farmToggleButton.addEventListener("click", () => {
  sendClientEvent({
    type: "farm2_toggle",
    payload: { enabled: !farm2Enabled },
  });
});

farmSettingsButton.addEventListener("click", openFarmSettingsModal);

farmModalStart.addEventListener("click", () => {
  commitFarmSettings();
});

farmModalClose.addEventListener("click", () => {
  closeFarmSettingsModal();
});

farmModalCancel.addEventListener("click", () => {
  closeFarmSettingsModal();
});

farmModalBackdrop.addEventListener("click", () => {
  closeFarmSettingsModal();
});

survivalSettingsButton.addEventListener("click", openSurvivalSettingsModal);
survivalModalClose.addEventListener("click", closeSurvivalSettingsModal);
survivalModalCancel.addEventListener("click", closeSurvivalSettingsModal);
survivalModalBackdrop.addEventListener("click", closeSurvivalSettingsModal);
survivalModalSave.addEventListener("click", commitSurvivalSettings);

buyFoodBtn.addEventListener("click", () => {
  const alias = currentSurvivalSettings.buyFoodAlias.trim();
  if (alias) {
    const aliasName = alias.toLowerCase();
    const allVnums = currentAliases
      .filter(a => a.alias.toLowerCase() === aliasName)
      .map(a => a.vnum);
    if (allVnums.length > 0) {
      sendClientEvent({ type: "goto_and_run", payload: { vnums: allVnums, commands: [], action: "buy_food" } });
      return;
    }
    appendSystemLine(`[survival] алиас "${alias}" не найден на карте`);
    return;
  }
  appendSystemLine("[survival] не задан алиас места покупки еды");
});

fillFlaskBtn.addEventListener("click", () => {
  const alias = currentSurvivalSettings.fillFlaskAlias.trim();
  if (alias) {
    const aliasName = alias.toLowerCase();
    const allVnums = currentAliases
      .filter(a => a.alias.toLowerCase() === aliasName)
      .map(a => a.vnum);
    if (allVnums.length > 0) {
      sendClientEvent({ type: "goto_and_run", payload: { vnums: allVnums, commands: [], action: "fill_flask" } });
      return;
    }
    appendSystemLine(`[survival] алиас "${alias}" не найден на карте`);
    return;
  }
  appendSystemLine("[survival] не задан алиас места с водой");
});

repairBtn.addEventListener("click", () => {
  sendClientEvent({ type: "repair_start" });
});

triggersButton.addEventListener("click", openTriggersModal);
triggersModalClose.addEventListener("click", closeTriggersModal);
triggersModalCancel.addEventListener("click", closeTriggersModal);
triggersModalBackdrop.addEventListener("click", closeTriggersModal);

itemDbButton.addEventListener("click", openItemDbModal);
itemDbModalClose.addEventListener("click", closeItemDbModal);
itemDbModalBackdrop.addEventListener("click", closeItemDbModal);

itemDbTableBody.addEventListener("click", (e) => {
  const tr = (e.target as HTMLElement).closest<HTMLTableRowElement>("tr.items-modal__row");
  if (!tr) return;
  const item = itemDbRowMap.get(tr);
  if (!item) return;
  openItemDetailModal(item);
});

itemDetailModalClose.addEventListener("click", closeItemDetailModal);
itemDetailModalCloseFooter.addEventListener("click", closeItemDetailModal);
itemDetailModalBackdrop.addEventListener("click", closeItemDetailModal);

mapRecordingButton.addEventListener("click", () => {
  mapRecordingEnabled = !mapRecordingEnabled;
  sendClientEvent({ type: "map_recording_toggle", payload: { enabled: mapRecordingEnabled } });
  renderMapRecordingButton();
});

gatherToggleButton.addEventListener("click", () => {
  sendClientEvent({ type: "gather_toggle" });
});

gatherSellButton.addEventListener("click", () => {
  sendClientEvent({ type: "gather_sell_bag" });
});

scratchClanBtn.addEventListener("click", () => {
  pendingEquippedAction = "scratch";
  sendClientEvent({ type: "equipped_scan" });
});

equipAllBtn.addEventListener("click", () => {
  pendingEquippedAction = "equip";
  sendClientEvent({ type: "send", payload: { command: "инвентарь" } });
});

debugLogButton.addEventListener("click", () => {
  sendClientEvent({ type: "debug_log_toggle" });
});

document.querySelectorAll<HTMLButtonElement>(".container-panel__refresh").forEach((btn) => {
  btn.addEventListener("click", () => {
    const container = btn.dataset["container"] as "bag" | "chest" | undefined;
    if (container === "bag") {
      sendClientEvent({ type: "send", payload: { command: "осм склад1" } });
    } else if (container === "chest") {
      sendClientEvent({ type: "send", payload: { command: "осм склад2" } });
    } else {
      sendClientEvent({ type: "send", payload: { command: "инв" } });
    }
  });
});

compareButton.addEventListener("click", openCompareAdvisor);
compareAdvisorClose.addEventListener("click", closeCompareAdvisor);

vorozheButton.addEventListener("click", openVorozheModal);
vorozheModalClose.addEventListener("click", closeVorozheModal);
vorozheModalCancel.addEventListener("click", closeVorozheModal);
vorozheModalBackdrop.addEventListener("click", closeVorozheModal);

itemDbTabs.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-tab]");
  if (!btn) return;
  itemDbActiveTab = btn.dataset.tab!;
  itemDbTabs.querySelectorAll(".items-modal__tab").forEach(b => b.classList.remove("items-modal__tab--active"));
  btn.classList.add("items-modal__tab--active");
  applyItemDbFilter();
});

itemDbSearch.addEventListener("input", applyItemDbFilter);

// ─── Compare Advisor ──────────────────────────────────────────────────────────

function openCompareAdvisor(): void {
  compareAdvisorPanel.classList.remove("compare-advisor-panel--hidden");
  compareAdvisorStatus.textContent = "Сканирование...";
  compareAdvisorTableBody.innerHTML = "";
  sendClientEvent({ type: "compare_scan_start" });
}

function closeCompareAdvisor(): void {
  compareAdvisorPanel.classList.add("compare-advisor-panel--hidden");
}

type CompareScanPayload = {
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
      source: "shop" | "bazaar" | "inventory";
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
};

function buildTooltip(card: CompareScanPayload["slots"][0]["candidates"][0]["card"] | null): string {
  if (!card) return "";
  const lines: string[] = [];
  if (card.itemType) lines.push(`Тип: ${card.itemType}`);
  if (card.material) lines.push(`Материал: ${card.material}`);
  if (card.ac) lines.push(`Защита: ${card.ac}`);
  if (card.armor) lines.push(`Броня: ${card.armor}`);
  if (card.damageAvg) lines.push(`Урон (avg): ${card.damageAvg}`);
  if (card.affects.length > 0) lines.push("", ...card.affects.map((a) => `+ ${a}`));
  if (card.properties.length > 0) lines.push("", ...card.properties.map((p) => `• ${p}`));
  return lines.join("\n");
}

function attachTooltip(el: HTMLElement, text: string): void {
  if (!text) return;
  const tip = document.createElement("div");
  tip.className = "compare-advisor__tooltip";
  tip.textContent = text;
  el.appendChild(tip);
  el.addEventListener("mouseenter", () => {
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    tip.classList.toggle("compare-advisor__tooltip--above", spaceBelow < 160);
    tip.classList.add("compare-advisor__tooltip--visible");
  });
  el.addEventListener("mouseleave", () => {
    tip.classList.remove("compare-advisor__tooltip--visible");
  });
}

function renderComparePanel(payload: CompareScanPayload): void {
  compareAdvisorPanel.classList.remove("compare-advisor-panel--hidden");
  compareAdvisorCoins.textContent = payload.hasShop
    ? `Монет: ${payload.coins}`
    : `Монет: ${payload.coins} (магазина нет)`;

  compareAdvisorTableBody.innerHTML = "";

  for (const slot of payload.slots) {
    if (slot.candidates.length === 0) continue;

    // Current item row
    const currentRow = document.createElement("tr");
    currentRow.className = "compare-advisor__current-row";

    const slotTd = document.createElement("td");
    slotTd.className = "compare-advisor__slot-cell";
    slotTd.textContent = slot.slot;

    const currentNameTd = document.createElement("td");
    currentNameTd.className = "compare-advisor__current-item compare-advisor__item-name";
    currentNameTd.colSpan = 4;
    currentNameTd.textContent = slot.currentItemName
      ? `${slot.currentItemName} (${Math.round(slot.currentScore)} оч.)`
      : "— пусто —";
    if (slot.currentCard) attachTooltip(currentNameTd, buildTooltip(slot.currentCard));

    currentRow.appendChild(slotTd);
    currentRow.appendChild(currentNameTd);
    currentRow.appendChild(document.createElement("td"));
    compareAdvisorTableBody.appendChild(currentRow);

    // Candidate rows
    for (const c of slot.candidates) {
      const sourceLabel =
        c.source === "shop" ? `м:${c.listNumber}` :
        c.source === "bazaar" ? `б:${c.listNumber}` : "инв";
      const scoreDiff = Math.round(c.score - slot.currentScore);
      const diffText = scoreDiff > 0 ? `+${scoreDiff}` : `${scoreDiff}`;
      const diffClass = scoreDiff > 0 ? "compare-advisor__diff--better" : "compare-advisor__diff--worse";

      const tr = document.createElement("tr");
      tr.className = "compare-advisor__candidate-row";

      const nameCell = document.createElement("td");
      nameCell.className = "compare-advisor__name-cell compare-advisor__item-name compare-advisor__name-cell--indent";
      nameCell.colSpan = 2;
      nameCell.textContent = c.itemName;
      attachTooltip(nameCell, buildTooltip(c.card));

      const priceCell = document.createElement("td");
      priceCell.textContent = c.source === "inventory" ? "—" : `${c.price}`;

      const sourceCell = document.createElement("td");
      sourceCell.textContent = sourceLabel;

      const scoreCell = document.createElement("td");
      scoreCell.innerHTML = `${Math.round(c.score)} <span class="${diffClass}">(${diffText})</span>`;

      const actionCell = document.createElement("td");
      if (!c.hasGameData) {
        const charBtn = document.createElement("button");
        charBtn.type = "button";
        charBtn.className = "compare-advisor__char-btn button-secondary button-small";
        charBtn.textContent = "хар";
        charBtn.title = "Запросить характеристики из игры";
        charBtn.addEventListener("click", () => {
          const charCmd = c.source === "bazaar"
            ? `базар характ ${c.listNumber}`
            : `характ ${c.listNumber}`;
          sendClientEvent({ type: "send", payload: { command: charCmd } });
        });
        actionCell.appendChild(charBtn);
      }
      if (c.source !== "inventory") {
        const applyBtn = document.createElement("button");
        applyBtn.type = "button";
        applyBtn.className = "compare-advisor__apply-btn button-secondary button-small";
        applyBtn.textContent = "Взять";
        applyBtn.addEventListener("click", () => {
          const commands: string[] = [];
          if (c.source === "shop") commands.push(`купить ${c.listNumber}`);
          else if (c.source === "bazaar") commands.push(`bazaar buy ${c.listNumber}`);
          sendClientEvent({ type: "compare_apply", payload: { commands } });
        });
        actionCell.appendChild(applyBtn);
      }

      tr.appendChild(nameCell);
      tr.appendChild(priceCell);
      tr.appendChild(sourceCell);
      tr.appendChild(scoreCell);
      tr.appendChild(actionCell);
      compareAdvisorTableBody.appendChild(tr);
    }
  }
}

// ─── Container / Inventory lists ──────────────────────────────────────────────

function renderItemRow(
  item: { name: string; count: number },
  sellCommand: (kw: string, count: number) => string,
  dropCommand: (kw: string, count: number) => string,
): HTMLTableRowElement {
  const keyword = item.name.split(/\s+/)[0] ?? item.name;
  const tr = document.createElement("tr");

  const tdSell = document.createElement("td");
  tdSell.className = "container-panel__sell-cell";
  const sellBtn = document.createElement("button");
  sellBtn.type = "button";
  sellBtn.className = "container-panel__sell-btn";
  sellBtn.textContent = "П";
  sellBtn.title = "Продать";
  sellBtn.addEventListener("click", () => {
    const cmd = sellCommand(keyword, item.count);
    for (const part of cmd.split(";;").map((s) => s.trim()).filter(Boolean)) {
      sendClientEvent({ type: "send", payload: { command: part } });
    }
  });
  tdSell.appendChild(sellBtn);

  const tdDrop = document.createElement("td");
  tdDrop.className = "container-panel__sell-cell";
  const dropBtn = document.createElement("button");
  dropBtn.type = "button";
  dropBtn.className = "container-panel__sell-btn";
  dropBtn.textContent = "В";
  dropBtn.title = "Выбросить";
  dropBtn.addEventListener("click", () => {
    sendClientEvent({ type: "send", payload: { command: dropCommand(keyword, item.count) } });
  });
  tdDrop.appendChild(dropBtn);

  const tdCount = document.createElement("td");
  tdCount.className = "container-panel__count";
  tdCount.textContent = item.count > 1 ? `×${item.count}` : "";

  const tdName = document.createElement("td");
  tdName.className = "container-panel__name";
  tdName.textContent = item.name;

  tr.appendChild(tdSell);
  tr.appendChild(tdDrop);
  tr.appendChild(tdCount);
  tr.appendChild(tdName);
  return tr;
}

function sortItems<T extends { name: string; count: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"));
}

function renderContainerList(
  tbody: HTMLTableSectionElement,
  items: Array<{ name: string; count: number }>,
  container: string,
): void {
  tbody.innerHTML = "";
  const containerKw = container === "bag" ? "торб" : "сунду";
  const isChest = container === "chest";
  for (const item of sortItems(items)) {
    tbody.appendChild(renderItemRow(
      item,
      (kw) => isChest ? `базар выставить ${kw} 200` : `взя ${kw} склад1;;продать ${kw}`,
      (kw, count) => count > 1 ? `бросить все.${kw} ${containerKw}` : `бросить ${kw}`,
    ));
  }
}

function renderInventoryList(
  tbody: HTMLTableSectionElement,
  items: Array<{ name: string; count: number }>,
): void {
  tbody.innerHTML = "";
  for (const item of sortItems(items)) {
    tbody.appendChild(renderItemRow(
      item,
      (kw) => `продать ${kw}`,
      (kw, count) => count > 1 ? `бросить все.${kw}` : `бросить ${kw}`,
    ));
  }
}

// ─── Vorozhe modal ────────────────────────────────────────────────────────────

function maybeRequestVorozheRoute(): void {
  if (!vorozheFrom || !vorozheTo) return;
  sendClientEvent({ type: "vorozhe_route_find", payload: { from: vorozheFrom, to: vorozheTo } });
}

function openVorozheModal(): void {
  vorozheModal.classList.remove("farm-modal--hidden");
}

function closeVorozheModal(): void {
  vorozheModal.classList.add("farm-modal--hidden");
}

function renderVorozheResult(payload: {
  from: string;
  to: string;
  found: boolean;
  steps: Array<{ from: string; to: string; items: string[] }>;
  totalItems: Record<string, number>;
}): void {
  vorozheResult.classList.remove("vorozhe-modal__result--hidden");

  if (!payload.found || payload.steps.length === 0) {
    vorozheNoRoute.classList.remove("vorozhe-modal__no-route--hidden");
    vorozheNoRoute.textContent =
      payload.from === payload.to ? "Вы уже в этом городе" : "Маршрут не найден";
    vorozheRouteTable.classList.add("vorozhe-modal__table--hidden");
    vorozheTotal.classList.add("vorozhe-modal__total--hidden");
    return;
  }

  vorozheNoRoute.classList.add("vorozhe-modal__no-route--hidden");
  vorozheRouteTable.classList.remove("vorozhe-modal__table--hidden");
  vorozheTotal.classList.remove("vorozhe-modal__total--hidden");

  vorozheRouteTbody.innerHTML = "";
  for (const step of payload.steps) {
    const tr = document.createElement("tr");
    const tdFrom = document.createElement("td");
    tdFrom.textContent = step.from;
    const tdTo = document.createElement("td");
    tdTo.textContent = step.to;
    const tdItems = document.createElement("td");
    for (const item of step.items) {
      const badge = document.createElement("span");
      badge.className = "vorozhe-item-badge";
      badge.textContent = item;
      tdItems.appendChild(badge);
    }
    tr.appendChild(tdFrom);
    tr.appendChild(tdTo);
    tr.appendChild(tdItems);
    vorozheRouteTbody.appendChild(tr);
  }

  const totalEntries = Object.entries(payload.totalItems);
  if (totalEntries.length > 0) {
    vorozheTotal.textContent = `Итого нужно: ${totalEntries.map(([item, count]) => `${item} ×${count}`).join(", ")}`;
  } else {
    vorozheTotal.classList.add("vorozhe-modal__total--hidden");
  }
}

function initVorozheModal(): void {
  VOROZHE_CITIES.forEach((city) => {
    const fromBtn = document.createElement("button");
    fromBtn.type = "button";
    fromBtn.className = "vorozhe-city-btn";
    fromBtn.textContent = city;
    fromBtn.addEventListener("click", () => {
      vorozheFrom = city;
      vororozheFromButtons.forEach((b) => b.classList.remove("vorozhe-city-btn--active"));
      fromBtn.classList.add("vorozhe-city-btn--active");
      maybeRequestVorozheRoute();
    });
    vorozheFromButtons.appendChild(fromBtn);
    vororozheFromButtons.push(fromBtn);

    const toBtn = document.createElement("button");
    toBtn.type = "button";
    toBtn.className = "vorozhe-city-btn";
    toBtn.textContent = city;
    toBtn.addEventListener("click", () => {
      vorozheTo = city;
      vorozheToButtonsList.forEach((b) => b.classList.remove("vorozhe-city-btn--active"));
      toBtn.classList.add("vorozhe-city-btn--active");
      maybeRequestVorozheRoute();
    });
    vorozheToButtons.appendChild(toBtn);
    vorozheToButtonsList.push(toBtn);
  });
}

function doWikiSearch(): void {
  const query = itemDbWikiInput.value.trim();
  if (!query) return;
  itemDbWikiResult.textContent = "Ищу...";
  itemDbWikiResult.classList.remove("items-modal__wiki-result--hidden", "items-modal__wiki-result--error");
  itemDbWikiBtn.disabled = true;
  sendClientEvent({ type: "wiki_item_search", payload: { query } });
}

itemDbWikiBtn.addEventListener("click", doWikiSearch);
itemDbWikiInput.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Enter") doWikiSearch();
});

triggerDodgeCheckbox.addEventListener("change", () => {
  currentTriggerState = { ...currentTriggerState, dodge: triggerDodgeCheckbox.checked };
  sendClientEvent({ type: "triggers_toggle", payload: { dodge: triggerDodgeCheckbox.checked } });
});

triggerStandUpCheckbox.addEventListener("change", () => {
  currentTriggerState = { ...currentTriggerState, standUp: triggerStandUpCheckbox.checked };
  sendClientEvent({ type: "triggers_toggle", payload: { standUp: triggerStandUpCheckbox.checked } });
});

triggerRearmCheckbox.addEventListener("change", () => {
  currentTriggerState = { ...currentTriggerState, rearm: triggerRearmCheckbox.checked };
  sendClientEvent({ type: "triggers_toggle", payload: { rearm: triggerRearmCheckbox.checked } });
});

triggerCurseCheckbox.addEventListener("change", () => {
  currentTriggerState = { ...currentTriggerState, curse: triggerCurseCheckbox.checked };
  sendClientEvent({ type: "triggers_toggle", payload: { curse: triggerCurseCheckbox.checked } });
});

triggerLightCheckbox.addEventListener("change", () => {
  currentTriggerState = { ...currentTriggerState, light: triggerLightCheckbox.checked };
  sendClientEvent({ type: "triggers_toggle", payload: { light: triggerLightCheckbox.checked } });
});

triggerFollowLeaderCheckbox.addEventListener("change", () => {
  currentTriggerState = { ...currentTriggerState, followLeader: triggerFollowLeaderCheckbox.checked };
  sendClientEvent({ type: "triggers_toggle", payload: { followLeader: triggerFollowLeaderCheckbox.checked } });
});

triggerAssistCheckbox.addEventListener("change", () => {
  currentTriggerState = { ...currentTriggerState, assist: triggerAssistCheckbox.checked };
  sendClientEvent({ type: "triggers_toggle", payload: { assist: triggerAssistCheckbox.checked } });
});

assistTankAddBtn.addEventListener("click", () => {
  const name = assistTankInput.value.trim();
  if (!name) return;
  if (currentTriggerState.assistTanks.includes(name)) return;
  const updated = [...currentTriggerState.assistTanks, name];
  currentTriggerState = { ...currentTriggerState, assistTanks: updated };
  sendClientEvent({ type: "triggers_toggle", payload: { assistTanks: updated } });
  renderAssistTanks(updated);
  assistTankInput.value = "";
});

assistTankInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") assistTankAddBtn.click();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !farmSettingsModal.classList.contains("farm-modal--hidden")) {
    closeFarmSettingsModal();
  }
  if (e.key === "Escape" && !survivalSettingsModal.classList.contains("farm-modal--hidden")) {
    closeSurvivalSettingsModal();
  }
  if (e.key === "Escape" && !triggersModal.classList.contains("farm-modal--hidden")) {
    closeTriggersModal();
  }
  if (e.key === "Escape" && !itemDbModal.classList.contains("farm-modal--hidden")) {
    closeItemDbModal();
  }
  if (e.key === "Escape" && !itemDetailModal.classList.contains("farm-modal--hidden")) {
    closeItemDetailModal();
  }
  if (e.key === "Escape" && !mapContextMenu.classList.contains("map-context-menu--hidden")) {
    closeMapContextMenu();
  }
  if (e.key === "Escape" && !autoCmdPopup.classList.contains("alias-popup--hidden")) {
    closeAutoCmdPopup();
  }
  if (e.key === "Escape" && !compareAdvisorPanel.classList.contains("compare-advisor-panel--hidden")) {
    closeCompareAdvisor();
  }
  if (e.key === "Escape" && !vorozheModal.classList.contains("farm-modal--hidden")) {
    closeVorozheModal();
  }
});

mapTabMap.addEventListener("click", () => switchMapTab("map"));

containerTabInventory.addEventListener("click", () => switchContainerTab("inventory"));
containerTabNav.addEventListener("click", () => switchContainerTab("nav"));
containerTabScript.addEventListener("click", () => switchContainerTab("script"));

scriptToggleBtn.addEventListener("click", () => {
  if (zoneScriptState?.payload.enabled) {
    sendClientEvent({ type: "zone_script_toggle", payload: { enabled: false } });
  } else {
    const script = trackerCurrentVnum !== null ? getScriptForVnum(trackerCurrentVnum) : undefined;
    if (script !== undefined) {
      sendClientEvent({ type: "zone_script_toggle", payload: { enabled: true, zoneId: script.zoneId } });
    }
  }
});



aliasPopupSave.addEventListener("click", () => {
  const alias = aliasPopupInput.value.trim();
  if (aliasPopupVnum !== null && alias) {
    sendClientEvent({ type: "alias_set", payload: { vnum: aliasPopupVnum, alias } });
    closeAliasPopup();
  }
});

aliasPopupDelete.addEventListener("click", () => {
  if (aliasPopupVnum !== null) {
    sendClientEvent({ type: "alias_delete", payload: { vnum: aliasPopupVnum } });
    closeAliasPopup();
  }
});

aliasPopupClose.addEventListener("click", closeAliasPopup);

aliasPopupInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") aliasPopupSave.click();
  if (e.key === "Escape") closeAliasPopup();
});

mapContextGo.addEventListener("click", () => {
  if (mapContextMenuVnum !== null) {
    sendClientEvent({ type: "navigate_to", payload: { vnums: [mapContextMenuVnum] } });
  }
  closeMapContextMenu();
});

mapContextAlias.addEventListener("click", () => {
  if (mapContextMenuVnum !== null) {
    const vnum = mapContextMenuVnum;
    const node = latestMapSnapshot.nodes.find((n) => n.vnum === vnum);
    openAliasPopup(vnum, currentAliases.find((a) => a.vnum === vnum)?.alias, node?.name ?? String(vnum));
  }
  closeMapContextMenu();
});

mapContextAliasDelete.addEventListener("click", () => {
  if (mapContextMenuVnum !== null) {
    sendClientEvent({ type: "alias_delete", payload: { vnum: mapContextMenuVnum } });
  }
  closeMapContextMenu();
});

mapContextAutoCmd.addEventListener("click", () => {
  if (mapContextMenuVnum !== null) {
    const vnum = mapContextMenuVnum;
    const node = latestMapSnapshot.nodes.find((n) => n.vnum === vnum);
    openAutoCmdPopup(vnum, currentRoomAutoCommands.get(vnum), node?.name ?? String(vnum));
  }
  closeMapContextMenu();
});

mapContextAutoCmdDelete.addEventListener("click", () => {
  if (mapContextMenuVnum !== null) {
    sendClientEvent({ type: "room_auto_command_delete", payload: { vnum: mapContextMenuVnum } });
  }
  closeMapContextMenu();
});

autoCmdPopupSave.addEventListener("click", () => {
  const command = autoCmdPopupInput.value.trim();
  if (autoCmdPopupVnum !== null && command) {
    sendClientEvent({ type: "room_auto_command_set", payload: { vnum: autoCmdPopupVnum, command } });
    closeAutoCmdPopup();
  }
});

autoCmdPopupDelete.addEventListener("click", () => {
  if (autoCmdPopupVnum !== null) {
    sendClientEvent({ type: "room_auto_command_delete", payload: { vnum: autoCmdPopupVnum } });
    closeAutoCmdPopup();
  }
});

autoCmdPopupClose.addEventListener("click", closeAutoCmdPopup);

autoCmdPopupInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) autoCmdPopupSave.click();
  if (e.key === "Escape") closeAutoCmdPopup();
});

document.addEventListener("click", (e) => {
  if (!mapContextMenu.classList.contains("map-context-menu--hidden")) {
    if (!mapContextMenu.contains(e.target as Node)) {
      closeMapContextMenu();
    }
  }
});

// ── Hotkey system ─────────────────────────────────────────────────────────────

const HOTKEYS_STORAGE_KEY = "mud_hotkeys";
const LAST_PROFILE_KEY = "mud_last_profile";

interface HotkeyEntry {
  key: string;            // e.g. "ArrowUp", "Ctrl+ArrowUp", "KeyW", "F1"
  command: string;        // MUD command to send (out of combat)
  combatCommand?: string; // MUD command to send when in combat (optional)
  label: string;          // Human-readable key label shown in UI
}

const DEFAULT_HOTKEYS: HotkeyEntry[] = [
  { key: "ArrowUp",        command: "север",   label: "↑" },
  { key: "ArrowDown",      command: "юг",      label: "↓" },
  { key: "ArrowLeft",      command: "запад",   label: "←" },
  { key: "ArrowRight",     command: "восток",  label: "→" },
  { key: "Opt+ArrowUp",    command: "#go с",   label: "Opt+↑" },
  { key: "Opt+ArrowDown",  command: "#go ю",   label: "Opt+↓" },
  { key: "Opt+ArrowLeft",  command: "#go з",   label: "Opt+←" },
  { key: "Opt+ArrowRight", command: "#go в",   label: "Opt+→" },
  { key: "KeyZ",           command: "карта",   label: "Я" },
  { key: "KeyX",           command: "огл",     label: "Ч" },
  { key: "KeyW",           command: "заколоть $target", label: "Ц" },
  { key: "KeyA",           command: "освеж тр", label: "Ф" },
  { key: "KeyQ",           command: "взя все.тр;;взя все все.тр;;бро все.тр", label: "Й" },
  { key: "Digit5",         command: "взя возвр склад1;;зачит возвр", label: "5" },
];

function loadHotkeys(): HotkeyEntry[] {
  try {
    const raw = localStorage.getItem(HOTKEYS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const saved = (parsed as HotkeyEntry[]).filter(
          (e) => typeof e.key === "string" && typeof e.command === "string" && typeof e.label === "string"
        );
        const savedKeys = new Set(saved.map((e) => e.key));
        const missing = DEFAULT_HOTKEYS.filter((e) => !savedKeys.has(e.key));
        return [...saved, ...missing];
      }
    }
  } catch {
    // ignore parse errors
  }
  return [...DEFAULT_HOTKEYS];
}

function saveHotkeys(entries: HotkeyEntry[]): void {
  localStorage.setItem(HOTKEYS_STORAGE_KEY, JSON.stringify(entries));
}

let hotkeys: HotkeyEntry[] = loadHotkeys();
let hotkeysInCombat = false;
let lastEnemy = "";

function isTextInputFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || (active as HTMLElement).isContentEditable;
}

document.addEventListener("keydown", (e) => {
  const modifier = e.metaKey ? "Cmd+" : e.altKey ? "Opt+" : e.ctrlKey ? "Ctrl+" : "";
  if (!modifier && isTextInputFocused()) return;

  const eventKey = modifier + (e.code || e.key);
  const entry = hotkeys.find((h) => h.key === eventKey || (!modifier && (h.key === e.code || h.key === e.key)));
  if (!entry) return;

  const rawCmd = (hotkeysInCombat && entry.combatCommand) ? entry.combatCommand : entry.command;
  const cmd = rawCmd.replaceAll("$target", lastEnemy);
  if (!cmd.trim()) return;

  e.preventDefault();

  for (const part of cmd.split(";;").map((s) => s.trim()).filter(Boolean)) {
    appendStyledText(`> ${part}\n`, { foreground: "bright-black", bold: false });
    sendClientEvent({ type: "send", payload: { command: part } });
  }
});

document.addEventListener("keydown", (e) => {
  if (isTextInputFocused()) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === "у" || e.key === "У") {
    e.preventDefault();
    sendClientEvent({ type: "attack_nearest" });
  }
});

// ── Hotkey modal ───────────────────────────────────────────────────────────────

const hotkeysButton = requireElement<HTMLButtonElement>("#hotkeys-button");
const hotkeysModal = requireElement<HTMLDivElement>("#hotkeys-modal");
const hotkeysModalBackdrop = requireElement<HTMLDivElement>("#hotkeys-modal .farm-modal__backdrop");
const hotkeysModalClose = requireElement<HTMLButtonElement>("#hotkeys-modal-close");
const hotkeysModalCancel = requireElement<HTMLButtonElement>("#hotkeys-modal-cancel");
const hotkeysModalSave = requireElement<HTMLButtonElement>("#hotkeys-modal-save");
const hotkeysModalAddRow = requireElement<HTMLButtonElement>("#hotkeys-modal-add-row");
const hotkeysTableBody = requireElement<HTMLTableSectionElement>("#hotkeys-table-body");

// Capture mode state
let capturingCell: { rowIndex: number; keyEl: HTMLInputElement } | null = null;

function renderHotkeysTable(entries: HotkeyEntry[]): void {
  hotkeysTableBody.innerHTML = "";

  entries.forEach((entry, idx) => {
    const tr = document.createElement("tr");
    tr.className = "hotkeys-modal__row";

    // Key cell
    const tdKey = document.createElement("td");
    tdKey.className = "hotkeys-modal__cell";
    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.className = "topbar__input hotkeys-modal__key-input";
    keyInput.value = entry.label;
    keyInput.readOnly = true;
    keyInput.placeholder = "Нажмите кнопку…";
    keyInput.dataset.rowIndex = String(idx);
    keyInput.title = `Код: ${entry.key}`;

    keyInput.addEventListener("click", () => {
      // Enter capture mode
      capturingCell = { rowIndex: idx, keyEl: keyInput };
      keyInput.value = "…";
      keyInput.classList.add("hotkeys-modal__key-input--capturing");
    });

    tdKey.appendChild(keyInput);
    tr.appendChild(tdKey);

    // Command cell
    const tdCmd = document.createElement("td");
    tdCmd.className = "hotkeys-modal__cell";
    const cmdInput = document.createElement("input");
    cmdInput.type = "text";
    cmdInput.className = "topbar__input hotkeys-modal__cmd-input";
    cmdInput.value = entry.command;
    cmdInput.placeholder = "команда";
    cmdInput.autocomplete = "off";
    cmdInput.dataset.rowIndex = String(idx);
    tdCmd.appendChild(cmdInput);
    tr.appendChild(tdCmd);

    // Delete button
    const tdDel = document.createElement("td");
    tdDel.className = "hotkeys-modal__cell hotkeys-modal__cell--delete";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "button-secondary button-small";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => {
      const currentEntries = readHotkeysFromTable();
      currentEntries.splice(idx, 1);
      renderHotkeysTable(currentEntries);
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    hotkeysTableBody.appendChild(tr);
  });
}

function readHotkeysFromTable(): HotkeyEntry[] {
  const entries: HotkeyEntry[] = [];
  const rows = hotkeysTableBody.querySelectorAll<HTMLTableRowElement>(".hotkeys-modal__row");
  rows.forEach((row) => {
    const keyInput = row.querySelector<HTMLInputElement>(".hotkeys-modal__key-input");
    const cmdInput = row.querySelector<HTMLInputElement>(".hotkeys-modal__cmd-input");
    if (!keyInput || !cmdInput) return;
    // key is stored in title as "Код: <key>"
    const keyCode = keyInput.title.replace(/^Код: /, "");
    const label = keyInput.value;
    const command = cmdInput.value.trim();
    if (keyCode) {
      entries.push({ key: keyCode, label, command });
    }
  });
  return entries;
}

// Capture keydown inside modal for key assignment
hotkeysModal.addEventListener("keydown", (e) => {
  if (!capturingCell) return;

  // Escape cancels capture
  if (e.key === "Escape") {
    const prev = hotkeys[capturingCell.rowIndex];
    capturingCell.keyEl.value = prev?.label ?? "";
    capturingCell.keyEl.title = `Код: ${prev?.key ?? ""}`;
    capturingCell.keyEl.classList.remove("hotkeys-modal__key-input--capturing");
    capturingCell = null;
    e.stopPropagation();
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  const label = keyToLabel(e);
  const modifier = e.metaKey ? "Cmd+" : e.altKey ? "Opt+" : e.ctrlKey ? "Ctrl+" : "";
  const keyCode = modifier + (e.code || e.key);
  capturingCell.keyEl.value = label;
  capturingCell.keyEl.title = `Код: ${keyCode}`;
  capturingCell.keyEl.classList.remove("hotkeys-modal__key-input--capturing");
  capturingCell = null;
});

function keyToLabel(e: KeyboardEvent): string {
  const labels: Record<string, string> = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Enter: "Enter", Escape: "Esc", Tab: "Tab", Backspace: "⌫",
    Delete: "Del", Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDn",
    Insert: "Ins", Space: "Пробел",
  };
  const base = labels[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : (/^F\d+$/.test(e.key) ? e.key : e.code || e.key));
  const prefix = e.metaKey ? "Cmd+" : e.altKey ? "Opt+" : e.ctrlKey ? "Ctrl+" : "";
  return prefix + base;
}

function openHotkeysModal(): void {
  capturingCell = null;
  renderHotkeysTable([...hotkeys]);
  hotkeysModal.classList.remove("farm-modal--hidden");
}

function closeHotkeysModal(): void {
  capturingCell = null;
  hotkeysModal.classList.add("farm-modal--hidden");
}

function commitHotkeys(): void {
  hotkeys = readHotkeysFromTable();
  saveHotkeys(hotkeys);
  closeHotkeysModal();
}

hotkeysButton.addEventListener("click", openHotkeysModal);
hotkeysModalClose.addEventListener("click", closeHotkeysModal);
hotkeysModalCancel.addEventListener("click", closeHotkeysModal);
hotkeysModalBackdrop.addEventListener("click", closeHotkeysModal);
hotkeysModalSave.addEventListener("click", commitHotkeys);

hotkeysModalAddRow.addEventListener("click", () => {
  const currentEntries = readHotkeysFromTable();
  currentEntries.push({ key: "", label: "", command: "" });
  renderHotkeysTable(currentEntries);
  const rows = hotkeysTableBody.querySelectorAll<HTMLTableRowElement>(".hotkeys-modal__row");
  const lastRow = rows[rows.length - 1];
  lastRow?.querySelector<HTMLInputElement>(".hotkeys-modal__key-input")?.click();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !hotkeysModal.classList.contains("farm-modal--hidden")) {
    if (capturingCell) return;
    closeHotkeysModal();
  }
});

initVorozheModal();

renderFarmButton();
updateActionBadges();
updateActionButtons();

const PANEL_SPLIT_KEY = "panel-split-map-fr";
const PANEL_SPLIT_MIN_FR = 0.15;
const PANEL_SPLIT_MAX_FR = 0.75;
const CONTAINER_SPLIT_KEY = "panel-split-container-px";
const CONTAINER_SPLIT_MIN_PX = 100;
const CONTAINER_SPLIT_MAX_PX = 500;
const CONTAINER_SPLIT_DEFAULT_PX = 160;

const shellEl = document.querySelector<HTMLElement>("main.shell");
const panelSplitterEl = document.getElementById("panel-splitter");
const containerSplitterEl = document.getElementById("container-splitter");

let currentContainerPx = CONTAINER_SPLIT_DEFAULT_PX;

function applyPanelSplit(mapFr: number): void {
  if (!shellEl) return;
  const clamped = Math.max(PANEL_SPLIT_MIN_FR, Math.min(PANEL_SPLIT_MAX_FR, mapFr));
  shellEl.style.gridTemplateColumns = `56px ${1 - clamped}fr 6px ${clamped}fr 6px ${currentContainerPx}px`;
}

function applyContainerSplit(px: number): void {
  if (!shellEl) return;
  const clamped = Math.max(CONTAINER_SPLIT_MIN_PX, Math.min(CONTAINER_SPLIT_MAX_PX, px));
  currentContainerPx = clamped;
  const match = shellEl.style.gridTemplateColumns.match(/^(56px\s+[\d.]+fr\s+6px\s+[\d.]+fr)\s+6px\s+[\d.]+px$/);
  const base = match ? match[1] : `56px ${1 - 0.35}fr 6px ${0.35}fr`;
  shellEl.style.gridTemplateColumns = `${base} 6px ${clamped}px`;
}

function loadPanelSplit(): void {
  const storedContainer = localStorage.getItem(CONTAINER_SPLIT_KEY);
  if (storedContainer !== null) {
    const px = parseFloat(storedContainer);
    if (!isNaN(px)) currentContainerPx = Math.max(CONTAINER_SPLIT_MIN_PX, Math.min(CONTAINER_SPLIT_MAX_PX, px));
  }

  const stored = localStorage.getItem(PANEL_SPLIT_KEY);
  if (stored !== null) {
    const fr = parseFloat(stored);
    if (!isNaN(fr)) {
      applyPanelSplit(fr);
      return;
    }
  }
  applyPanelSplit(0.35);
}

loadPanelSplit();

if (panelSplitterEl !== null && shellEl !== null) {
  let dragging = false;

  panelSplitterEl.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    dragging = true;
    panelSplitterEl.classList.add("panel-splitter--dragging");
    panelSplitterEl.setPointerCapture(e.pointerId);
  });

  panelSplitterEl.addEventListener("pointermove", (e: PointerEvent) => {
    if (!dragging) return;
    const shellRect = shellEl.getBoundingClientRect();
    const gaps = 5 * 8;
    const available = shellRect.width - 56 - currentContainerPx - gaps;
    const offsetX = e.clientX - shellRect.left - 56 - gaps / 2;
    applyPanelSplit(Math.max(0, 1 - offsetX / available));
  });

  function stopSplitterDrag(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    panelSplitterEl!.classList.remove("panel-splitter--dragging");
    panelSplitterEl!.releasePointerCapture(e.pointerId);
    const match = shellEl!.style.gridTemplateColumns.match(/56px\s+[\d.]+fr\s+6px\s+([\d.]+)fr/);
    if (match) localStorage.setItem(PANEL_SPLIT_KEY, match[1]);
  }

  panelSplitterEl.addEventListener("pointerup", stopSplitterDrag);
  panelSplitterEl.addEventListener("pointercancel", stopSplitterDrag);
}

if (containerSplitterEl !== null && shellEl !== null) {
  let dragging = false;

  containerSplitterEl.addEventListener("pointerdown", (e: PointerEvent) => {
    e.preventDefault();
    dragging = true;
    containerSplitterEl.classList.add("panel-splitter--dragging");
    containerSplitterEl.setPointerCapture(e.pointerId);
  });

  containerSplitterEl.addEventListener("pointermove", (e: PointerEvent) => {
    if (!dragging) return;
    const shellRect = shellEl.getBoundingClientRect();
    const px = shellRect.right - e.clientX - 8;
    applyContainerSplit(px);
  });

  function stopContainerDrag(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    containerSplitterEl!.classList.remove("panel-splitter--dragging");
    containerSplitterEl!.releasePointerCapture(e.pointerId);
    localStorage.setItem(CONTAINER_SPLIT_KEY, String(currentContainerPx));
  }

  containerSplitterEl.addEventListener("pointerup", stopContainerDrag);
  containerSplitterEl.addEventListener("pointercancel", stopContainerDrag);
}

void loadDefaults()
  .then(() => {
    reconnectEnabled = true;
    return ensureSocketOpen();
  })
  .catch((error) => {
    appendSystemLine(error instanceof Error ? error.message : "failed to initialize client defaults");
  });
