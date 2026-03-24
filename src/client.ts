interface PeriodicActionConfig {
  enabled: boolean;
  gotoAlias1: string;
  commands: string[];
  gotoAlias2: string;
  intervalMs: number;
}

interface ConnectDefaults {
  autoConnect: boolean;
  host: string;
  port: number;
  tls: boolean;
  startupCommands: string[];
  commandDelayMs: number;
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
      type: "farm_state";
      payload: {
        enabled: boolean;
        zoneId: number | null;
        pendingActivation: boolean;
        targetValues: string[];
        healCommands: string[];
        healThresholdPercent: number;
        lootValues: string[];
        periodicAction: PeriodicActionConfig;
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
      payload: { dodge: boolean };
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
    };

type ClientEvent =
  | {
      type: "connect";
      payload: Omit<ConnectDefaults, "autoConnect">;
    }
  | { type: "send"; payload: { command: string } }
  | { type: "disconnect" }
  | { type: "map_reset" }
   | {
       type: "farm_toggle";
       payload: {
         enabled: boolean;
         targetValues: string[];
         healCommands: string[];
         healThresholdPercent: number;
         lootValues: string[];
         periodicAction: PeriodicActionConfig;
       };
     }
  | { type: "alias_set"; payload: { vnum: number; alias: string } }
  | { type: "alias_delete"; payload: { vnum: number } }
  | { type: "navigate_to"; payload: { vnums: number[] } }
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
      payload: { dodge?: boolean };
    }
  | { type: "item_db_get" }
  | { type: "room_auto_command_set"; payload: { vnum: number; command: string } }
  | { type: "room_auto_command_delete"; payload: { vnum: number } }
  | { type: "room_auto_commands_get" }
  | { type: "survival_settings_get" }
  | { type: "survival_settings_save"; payload: SurvivalSettings };

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
const startupCommandsInput = requireElement<HTMLTextAreaElement>("#startup-commands");
const commandDelayInput = requireElement<HTMLInputElement>("#command-delay-ms");
const commandInput = requireElement<HTMLInputElement>("#command-input");
const statusElement = requireElement<HTMLElement>("#status");
const outputElement = requireElement<HTMLElement>("#output");
const disconnectButton = requireElement<HTMLButtonElement>("#disconnect-button");
const clearOutputButton = requireElement<HTMLButtonElement>("#clear-output-button");
const resetMapButton = requireElement<HTMLButtonElement>("#reset-map-button");
const zLevelDownButton = requireElement<HTMLButtonElement>("#z-level-down");
const zLevelUpButton = requireElement<HTMLButtonElement>("#z-level-up");
const zLevelLabel = requireElement<HTMLSpanElement>("#z-level-label");
const farmToggleButton = requireElement<HTMLButtonElement>("#farm-toggle-button");
const farmTargetsInput = requireElement<HTMLInputElement>("#farm-targets-input");
const mapCanvasElement = requireElement<HTMLDivElement>("#map-canvas");
const hpBarFill = requireElement<HTMLElement>("#hp-bar-fill");
const hpBarLabel = requireElement<HTMLElement>("#hp-bar-label");
const energyBarFill = requireElement<HTMLElement>("#energy-bar-fill");
const energyBarLabel = requireElement<HTMLElement>("#energy-bar-label");
const mapTabMap = requireElement<HTMLButtonElement>("#map-tab-map");
const mapTabNav = requireElement<HTMLButtonElement>("#map-tab-nav");
const mapPanelMap = requireElement<HTMLDivElement>("#map-panel-map");
const mapPanelNav = requireElement<HTMLDivElement>("#map-panel-nav");
const aliasList = requireElement<HTMLUListElement>("#alias-list");
const aliasListEmpty = requireElement<HTMLParagraphElement>("#alias-list-empty");
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
const autoCmdPopupInput = requireElement<HTMLInputElement>("#auto-cmd-popup-input");
const autoCmdPopupSave = requireElement<HTMLButtonElement>("#auto-cmd-popup-save");
const autoCmdPopupDelete = requireElement<HTMLButtonElement>("#auto-cmd-popup-delete");
const autoCmdPopupClose = requireElement<HTMLButtonElement>("#auto-cmd-popup-close");

const farmSettingsModal = requireElement<HTMLDivElement>("#farm-settings-modal");
const farmModalBackdrop = requireElement<HTMLDivElement>("#farm-settings-modal .farm-modal__backdrop");
const farmModalTargets = requireElement<HTMLTextAreaElement>("#farm-modal-targets");
const farmModalHeal = requireElement<HTMLTextAreaElement>("#farm-modal-heal");
const farmModalHealThreshold = requireElement<HTMLInputElement>("#farm-modal-heal-threshold");
const farmModalLoot = requireElement<HTMLTextAreaElement>("#farm-modal-loot");
const farmModalClose = requireElement<HTMLButtonElement>("#farm-modal-close");
const farmModalCancel = requireElement<HTMLButtonElement>("#farm-modal-cancel");
const farmModalStart = requireElement<HTMLButtonElement>("#farm-modal-start");
const farmModalPeriodicEnabled = requireElement<HTMLInputElement>("#farm-modal-periodic-enabled");
const farmModalPeriodicAlias1 = requireElement<HTMLInputElement>("#farm-modal-periodic-alias1");
const farmModalPeriodicCommand = requireElement<HTMLTextAreaElement>("#farm-modal-periodic-command");
const farmModalPeriodicAlias2 = requireElement<HTMLInputElement>("#farm-modal-periodic-alias2");
const farmModalPeriodicInterval = requireElement<HTMLInputElement>("#farm-modal-periodic-interval");
const farmModalSurvivalEnabled = requireElement<HTMLInputElement>("#farm-modal-survival-enabled");

const survivalSettingsButton = requireElement<HTMLButtonElement>("#survival-settings-button");
const survivalSettingsModal = requireElement<HTMLDivElement>("#survival-settings-modal");
const survivalModalBackdrop = requireElement<HTMLDivElement>("#survival-settings-modal .farm-modal__backdrop");
const survivalModalContainer = requireElement<HTMLInputElement>("#survival-modal-container");
const survivalModalFoodItems = requireElement<HTMLTextAreaElement>("#survival-modal-food-items");
const survivalModalFlaskItems = requireElement<HTMLTextAreaElement>("#survival-modal-flask-items");
const survivalModalBuyFoodAlias = requireElement<HTMLInputElement>("#survival-modal-buy-food-alias");
const survivalModalBuyFoodCommands = requireElement<HTMLTextAreaElement>("#survival-modal-buy-food-commands");
const survivalModalFillFlaskAlias = requireElement<HTMLInputElement>("#survival-modal-fill-flask-alias");
const survivalModalFillFlaskCommands = requireElement<HTMLTextAreaElement>("#survival-modal-fill-flask-commands");
const survivalModalClose = requireElement<HTMLButtonElement>("#survival-modal-close");
const survivalModalCancel = requireElement<HTMLButtonElement>("#survival-modal-cancel");
const survivalModalSave = requireElement<HTMLButtonElement>("#survival-modal-save");

const buyFoodBtn = requireElement<HTMLButtonElement>("#buy-food-btn");
const fillFlaskBtn = requireElement<HTMLButtonElement>("#fill-flask-btn");

const triggersButton = requireElement<HTMLButtonElement>("#triggers-button");
const triggersModal = requireElement<HTMLDivElement>("#triggers-modal");
const triggersModalBackdrop = requireElement<HTMLDivElement>("#triggers-modal .farm-modal__backdrop");
const triggersModalClose = requireElement<HTMLButtonElement>("#triggers-modal-close");
const triggersModalCancel = requireElement<HTMLButtonElement>("#triggers-modal-cancel");
const triggerDodgeCheckbox = requireElement<HTMLInputElement>("#trigger-dodge");

const itemDbButton = requireElement<HTMLButtonElement>("#item-db-button");
const itemDbModal = requireElement<HTMLDivElement>("#item-db-modal");
const itemDbModalBackdrop = requireElement<HTMLDivElement>("#item-db-modal .farm-modal__backdrop");
const itemDbModalClose = requireElement<HTMLButtonElement>("#item-db-modal-close");
const itemDbTableBody = requireElement<HTMLTableSectionElement>("#item-db-table-body");
const itemDbThead = requireElement<HTMLTableSectionElement>("#item-db-thead");
const itemDbEmpty = requireElement<HTMLParagraphElement>("#item-db-empty");
const itemDbTabs = requireElement<HTMLDivElement>("#item-db-tabs");
const itemDbSearch = requireElement<HTMLInputElement>("#item-db-search");
const itemDbCount = requireElement<HTMLSpanElement>("#item-db-count");

let farmModalZoneId: number | null = null;
let currentSurvivalSettings: SurvivalSettings = defaultSurvivalSettings();

interface FarmSettings {
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

interface SurvivalSettings {
  container: string;
  foodItems: string;
  flaskItems: string;
  buyFoodAlias: string;
  buyFoodCommands: string;
  fillFlaskAlias: string;
  fillFlaskCommands: string;
}

interface FarmRuntimeStats {
  hp: number;
  hpMax: number;
  energy: number;
  energyMax: number;
}

function defaultFarmSettings(): FarmSettings {
  return { targets: "", healCommands: "", healThreshold: 50, loot: "", periodicActionEnabled: false, periodicActionGotoAlias1: "", periodicActionCommand: "", periodicActionGotoAlias2: "", periodicActionIntervalMin: 30, survivalEnabled: false };
}

function defaultSurvivalSettings(): SurvivalSettings {
  return { container: "", foodItems: "", flaskItems: "", buyFoodAlias: "", buyFoodCommands: "", fillFlaskAlias: "", fillFlaskCommands: "" };
}

function normalizeFarmSettings(raw: Partial<FarmSettings>): FarmSettings {
  const def = defaultFarmSettings();
  return {
    targets: typeof raw.targets === "string" ? raw.targets : def.targets,
    healCommands: typeof raw.healCommands === "string" ? raw.healCommands : def.healCommands,
    healThreshold: typeof raw.healThreshold === "number" && Number.isFinite(raw.healThreshold) ? raw.healThreshold : def.healThreshold,
    loot: typeof raw.loot === "string" ? raw.loot : def.loot,
    periodicActionEnabled: raw.periodicActionEnabled === true,
    periodicActionGotoAlias1: typeof raw.periodicActionGotoAlias1 === "string" ? raw.periodicActionGotoAlias1 : def.periodicActionGotoAlias1,
    periodicActionCommand: typeof raw.periodicActionCommand === "string" ? raw.periodicActionCommand : def.periodicActionCommand,
    periodicActionGotoAlias2: typeof raw.periodicActionGotoAlias2 === "string" ? raw.periodicActionGotoAlias2 : def.periodicActionGotoAlias2,
    periodicActionIntervalMin: typeof raw.periodicActionIntervalMin === "number" && Number.isFinite(raw.periodicActionIntervalMin) ? raw.periodicActionIntervalMin : def.periodicActionIntervalMin,
    survivalEnabled: raw.survivalEnabled === true,
  };
}

function normalizeSurvivalSettings(raw: Partial<SurvivalSettings>): SurvivalSettings {
  const def = defaultSurvivalSettings();
  return {
    container: typeof raw.container === "string" ? raw.container : def.container,
    foodItems: typeof raw.foodItems === "string" ? raw.foodItems : def.foodItems,
    flaskItems: typeof raw.flaskItems === "string" ? raw.flaskItems : def.flaskItems,
    buyFoodAlias: typeof raw.buyFoodAlias === "string" ? raw.buyFoodAlias : def.buyFoodAlias,
    buyFoodCommands: typeof raw.buyFoodCommands === "string" ? raw.buyFoodCommands : def.buyFoodCommands,
    fillFlaskAlias: typeof raw.fillFlaskAlias === "string" ? raw.fillFlaskAlias : def.fillFlaskAlias,
    fillFlaskCommands: typeof raw.fillFlaskCommands === "string" ? raw.fillFlaskCommands : def.fillFlaskCommands,
  };
}
function fillFarmModal(settings: FarmSettings): void {
  farmModalTargets.value = settings.targets;
  farmModalHeal.value = settings.healCommands;
  farmModalHealThreshold.value = String(settings.healThreshold);
  farmModalLoot.value = settings.loot;
  farmModalPeriodicEnabled.checked = settings.periodicActionEnabled;
  farmModalPeriodicAlias1.value = settings.periodicActionGotoAlias1;
  farmModalPeriodicCommand.value = settings.periodicActionCommand;
  farmModalPeriodicAlias2.value = settings.periodicActionGotoAlias2;
  farmModalPeriodicInterval.value = String(settings.periodicActionIntervalMin);
  farmModalSurvivalEnabled.checked = settings.survivalEnabled;
}

function fillSurvivalModal(settings: SurvivalSettings): void {
  survivalModalContainer.value = settings.container;
  survivalModalFoodItems.value = settings.foodItems;
  survivalModalFlaskItems.value = settings.flaskItems;
  survivalModalBuyFoodAlias.value = settings.buyFoodAlias;
  survivalModalBuyFoodCommands.value = settings.buyFoodCommands;
  survivalModalFillFlaskAlias.value = settings.fillFlaskAlias;
  survivalModalFillFlaskCommands.value = settings.fillFlaskCommands;
}

function parseFarmCommandValues(rawValue: string): string[] {
  return rawValue
    .split(/\r?\n/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function openFarmSettingsModal(): void {
  const zoneId = farmZoneId ?? getZoneId(trackerCurrentVnum ?? 0);
  farmModalZoneId = zoneId;

  fillFarmModal(defaultFarmSettings());
  farmSettingsModal.classList.remove("farm-modal--hidden");
  farmModalTargets.focus();

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

let currentTriggerState: { dodge: boolean } = { dodge: true };

function openTriggersModal(): void {
  triggerDodgeCheckbox.checked = currentTriggerState.dodge;
  triggersModal.classList.remove("farm-modal--hidden");
}

function closeTriggersModal(): void {
  triggersModal.classList.add("farm-modal--hidden");
}

let itemDbAllItems: GameItemPayload[] = [];
let itemDbActiveTab = "all";

type ColumnDef = { label: string; render: (data: Record<string, unknown>) => string; cls?: string };

const WEAPON_COLUMNS: ColumnDef[] = [
  { label: "Класс",     render: d => String(d.class ?? "—"),          cls: "items-modal__cell--muted" },
  { label: "Кубики",    render: d => String(d.damage_dice ?? "—"),     cls: "items-modal__cell--mono" },
  { label: "Avg",       render: d => d.damage_avg != null ? String(d.damage_avg) : "—", cls: "items-modal__cell--mono" },
  { label: "Материал",  render: d => String(d.material ?? "—"),        cls: "items-modal__cell--muted" },
  { label: "Прочность", render: d => d.durability_cur != null ? `${d.durability_cur}/${d.durability_max}` : "—" },
  { label: "Аффекты",   render: d => String(d.affects ?? "—"),         cls: "items-modal__cell--tag" },
  { label: "Флаги",     render: d => String(d.extra_flags ?? "—"),     cls: "items-modal__cell--tag" },
  { label: "Свойства",  render: d => String(d.extra_props ?? "—"),     cls: "items-modal__cell--tag" },
];

const ARMOR_COLUMNS: ColumnDef[] = [
  { label: "Слот",      render: d => String(d.wear_slot ?? d.slot ?? "—"), cls: "items-modal__cell--muted" },
  { label: "Материал",  render: d => String(d.material ?? "—"),            cls: "items-modal__cell--muted" },
  { label: "Прочность", render: d => d.durability_cur != null ? `${d.durability_cur}/${d.durability_max}` : "—" },
  { label: "AC",        render: d => String(d.ac ?? d.armor ?? "—"),       cls: "items-modal__cell--mono" },
  { label: "Аффекты",   render: d => String(d.affects ?? "—"),             cls: "items-modal__cell--tag" },
  { label: "Флаги",     render: d => String(d.extra_flags ?? "—"),         cls: "items-modal__cell--tag" },
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
    tr.className = "items-modal__row";

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

function commitSurvivalSettings(): void {
  currentSurvivalSettings = normalizeSurvivalSettings({
    container: survivalModalContainer.value.trim(),
    foodItems: survivalModalFoodItems.value.trim(),
    flaskItems: survivalModalFlaskItems.value.trim(),
    buyFoodAlias: survivalModalBuyFoodAlias.value.trim(),
    buyFoodCommands: survivalModalBuyFoodCommands.value.trim(),
    fillFlaskAlias: survivalModalFillFlaskAlias.value.trim(),
    fillFlaskCommands: survivalModalFillFlaskCommands.value.trim(),
  });

  sendClientEvent({
    type: "survival_settings_save",
    payload: currentSurvivalSettings,
  });

  updateActionButtons();
  closeSurvivalSettingsModal();
}

function updateActionButtons(): void {
  buyFoodBtn.disabled = !currentSurvivalSettings.buyFoodCommands.trim();
  fillFlaskBtn.disabled = !currentSurvivalSettings.fillFlaskCommands.trim();
}

function commitFarmSettings(): void {
  const settings: FarmSettings = {
    targets: farmModalTargets.value.trim(),
    healCommands: farmModalHeal.value.trim(),
    healThreshold: Number(farmModalHealThreshold.value) || 50,
    loot: farmModalLoot.value.trim(),
    periodicActionEnabled: farmModalPeriodicEnabled.checked,
    periodicActionGotoAlias1: farmModalPeriodicAlias1.value.trim(),
    periodicActionCommand: farmModalPeriodicCommand.value.trim(),
    periodicActionGotoAlias2: farmModalPeriodicAlias2.value.trim(),
    periodicActionIntervalMin: Number(farmModalPeriodicInterval.value) || 30,
    survivalEnabled: farmModalSurvivalEnabled.checked,
  };

  if (farmModalZoneId !== null) {
    sendClientEvent({
      type: "farm_settings_save",
      payload: { zoneId: farmModalZoneId, settings },
    });
  }

  // survivalEnabled is part of FarmSettings (zone-specific toggle), survival details are global

  const targetValues = parseFarmTargetValues(settings.targets);
  farmTargetsInput.value = targetValues.join(", ");

  sendClientEvent({
    type: "farm_toggle",
    payload: {
      enabled: true,
      targetValues,
      healCommands: parseFarmCommandValues(settings.healCommands),
      healThresholdPercent: settings.healThreshold,
      lootValues: parseFarmCommandValues(settings.loot),
      periodicAction: {
        enabled: settings.periodicActionEnabled,
        gotoAlias1: settings.periodicActionGotoAlias1,
        commands: parseFarmCommandValues(settings.periodicActionCommand),
        gotoAlias2: settings.periodicActionGotoAlias2,
        intervalMs: settings.periodicActionIntervalMin * 60 * 1000,
      },
    },
  });
  closeFarmSettingsModal();
}

function switchMapTab(tab: "map" | "nav"): void {
  mapTabMap.classList.toggle("map-tab--active", tab === "map");
  mapTabNav.classList.toggle("map-tab--active", tab === "nav");
  mapPanelMap.classList.toggle("map-tab-panel--hidden", tab !== "map");
  mapPanelNav.classList.toggle("map-tab-panel--hidden", tab !== "nav");
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

function renderAliasList(): void {
  aliasList.innerHTML = "";
  aliasListEmpty.classList.toggle("alias-list-empty--hidden", currentAliases.length > 0);

  for (const entry of currentAliases) {
    const li = document.createElement("li");
    li.className = "alias-list__item";

    const label = document.createElement("span");
    label.className = "alias-list__label";
    label.textContent = entry.alias;

    const vnum = document.createElement("span");
    vnum.className = "alias-list__vnum";
    vnum.textContent = String(entry.vnum);

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
    li.appendChild(vnum);
    li.appendChild(goBtn);
    aliasList.appendChild(li);
  }
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
};
let farmEnabled = false;
let farmZoneId: number | null = null;
let farmPendingActivation = false;
let farmTargetValues: string[] = [];
let farmHealCommands: string[] = [];
let farmHealThresholdPercent = 50;
let farmLootValues: string[] = [];
let farmPeriodicAction: PeriodicActionConfig = {
  enabled: false,
  gotoAlias1: "",
  commands: [],
  gotoAlias2: "",
  intervalMs: 0,
};
let trackerCurrentVnum: number | null = null;
let currentStats: FarmRuntimeStats = {
  hp: 0,
  hpMax: 0,
  energy: 0,
  energyMax: 0,
};

let currentAliases: AliasPayload[] = [];
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

const DIRECTION_PRIORITY: Record<string, number> = {
  north: 0,
  east: 1,
  south: 2,
  west: 3,
  up: 4,
  down: 5,
};

const CELL = 72;
const TILE = 60;
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
    const unplaced = new Set(zoneNodes);
    let componentOriginX = 0;
    let localMinX = 0;
    let localMaxX = 0;
    let localMinY = 0;
    let localMaxY = 0;
    let isFirstComponent = true;

    while (unplaced.size > 0) {
      const componentRoot = isFirstComponent && zoneId === rootZoneId && unplaced.has(rootVnum)
        ? rootVnum
        : Math.min(...unplaced);

      localCoords.set(componentRoot, { x: componentOriginX, y: 0 });
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

          const nextCoord = {
            x: currentCoord.x + delta[0],
            y: currentCoord.y + delta[1],
          };

          localCoords.set(neighbor.toVnum, nextCoord);
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
  const zRoots = Array.from(gridLayout.keys());
  const zQueue: number[] = [];

  const zSeed = snapshot.currentVnum != null && gridLayout.has(snapshot.currentVnum)
    ? snapshot.currentVnum
    : (zRoots[0] ?? null);
  if (zSeed != null) {
    zLevelMap.set(zSeed, 0);
    zQueue.push(zSeed);
  }
  while (zQueue.length > 0) {
    const cur = zQueue.shift()!;
    const curZ = zLevelMap.get(cur)!;
    for (const { toVnum, delta } of zLevelAdj.get(cur) ?? []) {
      if (!zLevelMap.has(toVnum) && gridLayout.has(toVnum)) {
        zLevelMap.set(toVnum, curZ + delta);
        zQueue.push(toVnum);
      }
    }
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
  const levelCells = new Map(
    Array.from(gridLayout.entries()).filter(([, cell]) => cell.zLevel === currentZLevel)
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

  const portalRooms = new Set<number>();
  const drawnEdges = new Set<string>();
  for (const edge of snapshot.edges) {
    const fromCell = levelCells.get(edge.fromVnum);
    const toCell = levelCells.get(edge.toVnum);
    if (!fromCell || !toCell) continue;
    if (!visibleVnums.has(edge.fromVnum) || !visibleVnums.has(edge.toVnum)) continue;

    if (edge.isPortal) {
      portalRooms.add(edge.fromVnum);
      continue;
    }

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

    if (portalRooms.has(cell.vnum)) {
      const badge = document.createElement("div");
      badge.className = "map-portal-badge";
      badge.setAttribute("title", "Portal exit");
      badge.textContent = "⬡";
      tile.appendChild(badge);
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

  const STUB = 20;

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
  resetGridLayout();
  integrateSnapshot(snapshot);
  renderGridMap(snapshot);
}

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

function appendOutput(text: string): void {
  const shouldAutoScroll = isScrolledToBottom();
  const segments = parseAnsiSegments(text);

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
  farmToggleButton.textContent = farmEnabled
    ? farmPendingActivation
      ? "Фарм: запуск..."
      : `Фарм: вкл${farmZoneId !== null ? ` (${farmZoneId})` : ""}`
    : "Фарм: выкл";
  farmToggleButton.classList.toggle("button-toggle-active", farmEnabled);
}

function parseFarmTargetValues(rawValue: string): string[] {
  return rawValue
    .split(/[\n,;]/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
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
        break;
      case "map_update":
        trackerCurrentVnum = message.payload.currentVnum;
        updateMap(message.payload, false);
        break;
      case "farm_state":
        farmEnabled = message.payload.enabled;
        farmZoneId = message.payload.zoneId;
        farmPendingActivation = message.payload.pendingActivation;
        farmTargetValues = message.payload.targetValues;
        farmHealCommands = message.payload.healCommands;
        farmHealThresholdPercent = message.payload.healThresholdPercent;
        farmLootValues = message.payload.lootValues;
        farmPeriodicAction = message.payload.periodicAction;
        farmTargetsInput.value = farmTargetValues.join(", ");
        renderFarmButton();
        break;
      case "stats_update":
        currentStats = message.payload;
        updateStatsBar(message.payload.hp, message.payload.hpMax, message.payload.energy, message.payload.energyMax);
        break;
      case "aliases_snapshot":
        currentAliases = message.payload.aliases;
        renderAliasList();
        renderGridMap(latestMapSnapshot);
        break;
      case "navigation_state":
        currentNavState = message.payload;
        renderNavStatus(message.payload);
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
        break;
      case "items_data":
        renderItemDbTable(message.payload.items);
        break;
      case "room_auto_commands_snapshot":
        currentRoomAutoCommands = new Map(message.payload.entries.map((e) => [e.vnum, e.command]));
        break;
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
  const response = await fetch("/api/config", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to load defaults: ${response.status}`);
  }

  const defaults = (await response.json()) as ConnectDefaults;
  autoConnectEnabled = defaults.autoConnect;
  hostInput.value = defaults.host;
  portInput.value = String(defaults.port);
  tlsInput.checked = defaults.tls;
  startupCommandsInput.value = defaults.startupCommands.join("\n");
  commandDelayInput.value = String(defaults.commandDelayMs);
}

connectForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await ensureSocketOpen();
  } catch (error) {
    appendSystemLine(error instanceof Error ? error.message : "failed to open control socket");
    return;
  }

  sendClientEvent({
    type: "connect",
    payload: {
      host: hostInput.value.trim(),
      port: Number(portInput.value),
      tls: tlsInput.checked,
      startupCommands: readStartupCommands(),
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
  const command = commandInput.value.trim();

  if (!command) {
    return;
  }

  if (commandHistory[commandHistory.length - 1] !== command) {
    commandHistory.push(command);
  }
  historyIndex = -1;
  historySavedInput = "";

  sendClientEvent({
    type: "send",
    payload: { command },
  });
  commandInput.value = "";
});

clearOutputButton.addEventListener("click", () => {
  outputElement.replaceChildren();
  ansiState.pendingEscape = "";
  ansiState.style = createDefaultTerminalStyle();
});

resetMapButton.addEventListener("click", () => {
  latestMapSnapshot = {
    currentVnum: null,
    nodes: [],
    edges: [],
  };
  updateMap(latestMapSnapshot, true);
  sendClientEvent({ type: "map_reset" });
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
  if (!farmEnabled) {
    openFarmSettingsModal();
  } else {
    sendClientEvent({
      type: "farm_toggle",
      payload: {
        enabled: false,
        targetValues: parseFarmTargetValues(farmTargetsInput.value),
        healCommands: farmHealCommands,
        healThresholdPercent: farmHealThresholdPercent,
        lootValues: farmLootValues,
        periodicAction: farmPeriodicAction,
      },
    });
  }
});

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
      sendClientEvent({ type: "navigate_to", payload: { vnums: allVnums } });
    }
  }
  const commands = currentSurvivalSettings.buyFoodCommands
    .split(/\r?\n/g)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  for (const command of commands) {
    sendClientEvent({ type: "send", payload: { command } });
  }
});

fillFlaskBtn.addEventListener("click", () => {
  const alias = currentSurvivalSettings.fillFlaskAlias.trim();
  if (alias) {
    const aliasName = alias.toLowerCase();
    const allVnums = currentAliases
      .filter(a => a.alias.toLowerCase() === aliasName)
      .map(a => a.vnum);
    if (allVnums.length > 0) {
      sendClientEvent({ type: "navigate_to", payload: { vnums: allVnums } });
    }
  }
  const commands = currentSurvivalSettings.fillFlaskCommands
    .split(/\r?\n/g)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  for (const command of commands) {
    sendClientEvent({ type: "send", payload: { command } });
  }
});

triggersButton.addEventListener("click", openTriggersModal);
triggersModalClose.addEventListener("click", closeTriggersModal);
triggersModalCancel.addEventListener("click", closeTriggersModal);
triggersModalBackdrop.addEventListener("click", closeTriggersModal);

itemDbButton.addEventListener("click", openItemDbModal);
itemDbModalClose.addEventListener("click", closeItemDbModal);
itemDbModalBackdrop.addEventListener("click", closeItemDbModal);

itemDbTabs.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-tab]");
  if (!btn) return;
  itemDbActiveTab = btn.dataset.tab!;
  itemDbTabs.querySelectorAll(".items-modal__tab").forEach(b => b.classList.remove("items-modal__tab--active"));
  btn.classList.add("items-modal__tab--active");
  applyItemDbFilter();
});

itemDbSearch.addEventListener("input", applyItemDbFilter);

triggerDodgeCheckbox.addEventListener("change", () => {
  currentTriggerState = { ...currentTriggerState, dodge: triggerDodgeCheckbox.checked };
  sendClientEvent({ type: "triggers_toggle", payload: { dodge: triggerDodgeCheckbox.checked } });
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
  if (e.key === "Escape" && !mapContextMenu.classList.contains("map-context-menu--hidden")) {
    closeMapContextMenu();
  }
  if (e.key === "Escape" && !autoCmdPopup.classList.contains("alias-popup--hidden")) {
    closeAutoCmdPopup();
  }
});

mapTabMap.addEventListener("click", () => switchMapTab("map"));
mapTabNav.addEventListener("click", () => switchMapTab("nav"));

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
  if (e.key === "Enter") autoCmdPopupSave.click();
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

interface HotkeyEntry {
  key: string;       // e.g. "ArrowUp", "KeyW", "F1"
  command: string;   // MUD command to send
  label: string;     // Human-readable key label shown in UI
}

const DEFAULT_HOTKEYS: HotkeyEntry[] = [
  { key: "ArrowUp",    command: "север",  label: "↑" },
  { key: "ArrowDown",  command: "юг",     label: "↓" },
  { key: "ArrowLeft",  command: "запад",  label: "←" },
  { key: "ArrowRight", command: "восток", label: "→" },
];

function loadHotkeys(): HotkeyEntry[] {
  try {
    const raw = localStorage.getItem(HOTKEYS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return (parsed as HotkeyEntry[]).filter(
          (e) => typeof e.key === "string" && typeof e.command === "string" && typeof e.label === "string"
        );
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

function isTextInputFocused(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || (active as HTMLElement).isContentEditable;
}

document.addEventListener("keydown", (e) => {
  // Don't fire hotkeys when typing in any input/textarea
  if (isTextInputFocused()) return;
  // Don't fire if a modifier key combo (Ctrl/Meta) is pressed
  if (e.ctrlKey || e.metaKey) return;

  const entry = hotkeys.find((h) => h.key === e.code || h.key === e.key);
  if (!entry || !entry.command.trim()) return;

  // Prevent default browser behavior for matched keys (e.g. page scroll on arrows)
  e.preventDefault();

  sendClientEvent({ type: "send", payload: { command: entry.command.trim() } });
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
  capturingCell.keyEl.value = label;
  capturingCell.keyEl.title = `Код: ${e.code || e.key}`;
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
  if (labels[e.key]) return labels[e.key]!;
  if (e.key.length === 1) return e.key.toUpperCase();
  // Function keys
  if (/^F\d+$/.test(e.key)) return e.key;
  return e.code || e.key;
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
  // Focus the new row's key input
  const rows = hotkeysTableBody.querySelectorAll<HTMLTableRowElement>(".hotkeys-modal__row");
  const lastRow = rows[rows.length - 1];
  lastRow?.querySelector<HTMLInputElement>(".hotkeys-modal__key-input")?.click();
});

// Escape in hotkeys modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !hotkeysModal.classList.contains("farm-modal--hidden")) {
    if (capturingCell) return; // handled inside modal keydown
    closeHotkeysModal();
  }
});

renderFarmButton();

void loadDefaults()
  .then(() => {
    reconnectEnabled = true;
    return ensureSocketOpen();
  })
  .catch((error) => {
    appendSystemLine(error instanceof Error ? error.message : "failed to initialize client defaults");
  });
