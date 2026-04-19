import type { SurvivalSettings, ZoneScriptSettings } from "../events.type.ts";
import type {
  ConnectDefaults,
  ProfilesResponse,
  AliasPayload,
  NavigationStatePayload,
  FarmRuntimeStats,
  HotkeyEntry,
  ServerEvent,
  ClientEvent,
} from "./types.ts";
import {
  AVAILABLE_ZONE_SCRIPTS,
  SCRIPT_STEP_ICONS,
  DEFAULT_HOTKEYS,
} from "./constants.ts";
import * as bus from "./bus.ts";
import { createTerminal } from "./terminal.ts";
import { renderContainerList, renderInventoryList } from "./inventory.ts";
import { initSplitters } from "./splitters.ts";
import { createPopups } from "./popups.ts";
import { createNavPanel } from "./nav-panel.ts";
import { createMapGrid } from "./map-grid.ts";
import { createNet } from "./net.ts";
import { initQuestsPanel } from "./quests.ts";

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
const containerTabQuests = requireElement<HTMLButtonElement>("#container-tab-quests");
const containerPanelInventory = requireElement<HTMLDivElement>("#container-panel-inventory");
const containerPanelNav = requireElement<HTMLDivElement>("#container-panel-nav");
const containerPanelScript = requireElement<HTMLDivElement>("#container-panel-script");
const containerPanelQuests = requireElement<HTMLDivElement>("#container-panel-quests");
const scriptStepsList = requireElement<HTMLUListElement>("#script-steps-list");
const scriptPanelTitle = requireElement<HTMLSpanElement>("#script-panel-title");
const scriptStatusLine = requireElement<HTMLDivElement>("#script-status-line");
const scriptToggleBtn = requireElement<HTMLButtonElement>("#script-toggle-btn");
const scriptSelect = requireElement<HTMLSelectElement>("#script-select");
const scriptLoopEnabled = requireElement<HTMLInputElement>("#script-loop-enabled");
const scriptLoopDelay = requireElement<HTMLInputElement>("#script-loop-delay");
const zoneScriptAssistTargetInput = requireElement<HTMLInputElement>("#zone-script-assist-target");
const survivalSettingsButton = requireElement<HTMLButtonElement>("#survival-settings-button");

const repairBtn = requireElement<HTMLButtonElement>("#repair-btn");

const triggersButton = requireElement<HTMLButtonElement>("#triggers-button");

const itemDbButton = requireElement<HTMLButtonElement>("#item-db-button");

const mapRecordingButton = requireElement<HTMLButtonElement>("#map-recording-button");
const globalMapButton = requireElement<HTMLButtonElement>("#global-map-button");

const compareButton = requireElement<HTMLButtonElement>("#compare-button");

const vorozheButton = requireElement<HTMLButtonElement>("#vorozhe-button");

const gatherToggleButton = requireElement<HTMLButtonElement>("#gather-toggle-button");
const gatherSellButton = requireElement<HTMLButtonElement>("#gather-sell-button");
const scratchClanBtn = requireElement<HTMLButtonElement>("#scratch-clan-btn");
const equipAllBtn = requireElement<HTMLButtonElement>("#equip-all-btn");
const debugLogButton = requireElement<HTMLButtonElement>("#debug-log-button");
const inventoryAutoSortBtn = requireElement<HTMLButtonElement>("#inventory-auto-sort-btn");

const storagePanelList = requireElement<HTMLTableSectionElement>("#storage-panel-list");
const расходPanelList = requireElement<HTMLTableSectionElement>("#расход-panel-list");
const bazaarPanelList = requireElement<HTMLTableSectionElement>("#bazaar-panel-list");
const junkPanelList = requireElement<HTMLTableSectionElement>("#junk-panel-list");
const junkSellAllBtn = requireElement<HTMLButtonElement>("#junk-sell-all-btn");
const inventoryPanelList = requireElement<HTMLTableSectionElement>("#inventory-panel-list");



let currentSurvivalSettings: SurvivalSettings = defaultSurvivalSettings();
let currentZoneScriptSettings: ZoneScriptSettings = defaultZoneScriptSettings();

function defaultSurvivalSettings(): SurvivalSettings {
  return { container: "", foodItem: "", eatCommand: "" };
}

function normalizeSurvivalSettings(raw: Partial<SurvivalSettings>): SurvivalSettings {
  const def = defaultSurvivalSettings();
  return {
    container: typeof raw.container === "string" ? raw.container : def.container,
    foodItem: typeof raw.foodItem === "string" ? raw.foodItem : def.foodItem,
    eatCommand: typeof raw.eatCommand === "string" ? raw.eatCommand : def.eatCommand,
  };
}

function defaultZoneScriptSettings(): ZoneScriptSettings {
  return { assistTarget: undefined };
}

function fillZoneScriptSettings(settings: ZoneScriptSettings): void {
  zoneScriptAssistTargetInput.value = settings.assistTarget ?? "";
}

function commitZoneScriptSettings(): void {
  const assistTarget = zoneScriptAssistTargetInput.value.trim();
  currentZoneScriptSettings = {
    assistTarget: assistTarget.length > 0 ? assistTarget : undefined,
  };
  sendClientEvent({
    type: "zone_script_settings_save",
    payload: currentZoneScriptSettings,
  });
}

function updateActionButtons(): void {}

function updateActionBadges(): void {}

function switchMapTab(tab: "map"): void {
  mapTabMap.classList.toggle("map-tab--active", tab === "map");
  mapPanelMap.classList.toggle("map-tab-panel--hidden", tab !== "map");
}

function switchContainerTab(tab: "inventory" | "nav" | "script" | "quests"): void {
  containerTabInventory.classList.toggle("map-tab--active", tab === "inventory");
  containerTabNav.classList.toggle("map-tab--active", tab === "nav");
  containerTabScript.classList.toggle("map-tab--active", tab === "script");
  containerTabQuests.classList.toggle("map-tab--active", tab === "quests");
  containerPanelInventory.classList.toggle("container-panels__panel--hidden", tab !== "inventory");
  containerPanelNav.classList.toggle("container-panels__panel--hidden", tab !== "nav");
  containerPanelScript.classList.toggle("container-panels__panel--hidden", tab !== "script");
  containerPanelQuests.classList.toggle("container-panels__panel--hidden", tab !== "quests");
}

let openAliasPopup: (vnum: number, alias: string | undefined, name: string) => void;
let openMapContextMenu: (vnum: number, x: number, y: number) => void;
let renderNavPanel: () => void;
let renderNavStatus: (state: NavigationStatePayload) => void;

const mapGrid = createMapGrid({
  mapCanvasElement,
  zLevelLabel,
  zLevelDownButton,
  zLevelUpButton,
  getAliases: () => currentAliases,
  onAliasPopup: (vnum, alias, name) => openAliasPopup(vnum, alias, name),
  onMapContextMenu: (vnum, x, y) => openMapContextMenu(vnum, x, y),
  onMapUpdated: () => renderNavPanel(),
});

({ openAliasPopup, openMapContextMenu } = createPopups({
  getAliases: () => currentAliases,
  getRoomAutoCommands: () => currentRoomAutoCommands,
  getNodeName: (vnum) => mapGrid.getLatestSnapshot().nodes.find((n) => n.vnum === vnum)?.name,
}));

({ render: renderNavPanel, renderStatus: renderNavStatus } = createNavPanel({
  getSnapshot: () => mapGrid.getLatestSnapshot(),
  getFullSnapshot: () => mapGrid.getLatestFullSnapshot(),
  getZoneNames: () => mapGrid.getZoneNames(),
  getAliases: () => currentAliases,
}));

function updateStatsBar(hp: number, hpMax: number, energy: number, energyMax: number): void {
  const hpPct = hpMax > 0 ? Math.min(100, Math.round((hp / hpMax) * 100)) : 0;
  const energyPct = energyMax > 0 ? Math.min(100, Math.round((energy / energyMax) * 100)) : 0;
  hpBarFill.style.setProperty("--pct", `${hpPct}%`);
  hpBarLabel.textContent = `${hp}/${hpMax}`;
  energyBarFill.style.setProperty("--pct", `${energyPct}%`);
  energyBarLabel.textContent = `${energy}/${energyMax}`;
}

let autoConnectEnabled = false;
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
let currentNavState: NavigationStatePayload = {
  active: false,
  targetVnum: null,
  totalSteps: 0,
  currentStep: 0,
};


// Terminal instance (ANSI parser + output/chat renderer). `onRawText` receives
// every chunk passed to `appendOutput` so the hotkey combat-target extraction
// below can update `lastEnemy` for `$target` substitution.
const { appendOutput, appendSystemLine, appendChatMessage, appendStyledText, resetAnsiState } =
  createTerminal({
    outputElement,
    chatOutputElement,
    onRawText: (text: string) => {
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
    },
  });

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


function refreshScriptToggleBtn(): void {
  if (zoneScriptState?.payload.enabled || zoneScriptState?.payload.loopWaitingUntil != null) {
    scriptToggleBtn.textContent = "Стоп";
    scriptToggleBtn.disabled = false;
    return;
  }
  const selectedId = scriptSelect.value !== "" ? Number(scriptSelect.value) : null;
  const selectedScript = selectedId !== null ? AVAILABLE_ZONE_SCRIPTS.find((s) => s.zoneId === selectedId) : undefined;
  const autoScript = trackerCurrentVnum !== null ? getScriptForVnum(trackerCurrentVnum) : undefined;
  const effective = selectedScript ?? autoScript;
  if (effective !== undefined) {
    scriptToggleBtn.textContent = effective.name;
    scriptToggleBtn.disabled = false;
  } else {
    scriptToggleBtn.textContent = "Нет скрипта";
    scriptToggleBtn.disabled = true;
  }
}

function renderScriptSteps(state: { enabled: boolean; zoneName: string | null; steps: Array<{ index: number; label: string; status: string; error?: string }>; errorMessage: string | null; loopWaitingUntil?: number | null; playlistId?: number | null; playlistZoneIndex?: number; playlistZoneCount?: number }): void {
  let titleText = state.zoneName ? `Скрипт: ${state.zoneName}` : "Скрипт";
  if (state.playlistId != null && (state.playlistZoneCount ?? 0) > 0) {
    titleText += ` [${(state.playlistZoneIndex ?? 0) + 1}/${state.playlistZoneCount}]`;
  }
  scriptPanelTitle.textContent = titleText;

  if (state.errorMessage) {
    scriptStatusLine.textContent = state.errorMessage;
    scriptStatusLine.classList.remove("script-status-line--hidden");
  } else if (state.loopWaitingUntil != null) {
    const secsLeft = Math.max(0, Math.round((state.loopWaitingUntil - Date.now()) / 1000));
    const mins = Math.floor(secsLeft / 60);
    const secs = secsLeft % 60;
    scriptStatusLine.textContent = `Следующий запуск через ${mins}:${String(secs).padStart(2, "0")}`;
    scriptStatusLine.classList.remove("script-status-line--hidden");
  } else {
    scriptStatusLine.classList.add("script-status-line--hidden");
  }

  refreshScriptToggleBtn();

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

function handleServerEvent(message: ServerEvent): void {
  switch (message.type) {
    case "defaults":
      autoConnectEnabled = message.payload.autoConnect;
      hostInput.value = message.payload.host;
      portInput.value = String(message.payload.port);
      tlsInput.checked = message.payload.tls;
      startupCommandsInput.value = message.payload.startupCommands.join("\n");
      commandDelayInput.value = String(message.payload.commandDelayMs);
      sendScriptLoopConfig();
      break;
    case "status":
      appendSystemLine(message.payload.message);
      updateConnectButton(message.payload.state);
      break;
    case "output":
      appendOutput(message.payload.text);
      break;
    case "error":
      appendSystemLine(`error: ${message.payload.message}`);
      break;
    case "quests_data":
      bus.emit("quests_data", message.payload);
      break;
    case "map_snapshot":
      trackerCurrentVnum = message.payload.currentVnum;
      mapGrid.updateMap(message.payload, true);
      if (zoneScriptState && !zoneScriptState.payload.enabled) {
        renderScriptSteps(zoneScriptState.payload);
      } else {
        refreshScriptToggleBtn();
      }
      break;
    case "map_update":
      trackerCurrentVnum = message.payload.currentVnum;
      mapGrid.updateMap(message.payload, false);
      if (zoneScriptState && !zoneScriptState.payload.enabled) {
        renderScriptSteps(zoneScriptState.payload);
      } else {
        refreshScriptToggleBtn();
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
    case "zone_script_settings":
      currentZoneScriptSettings = {
        ...defaultZoneScriptSettings(),
        ...message.payload,
      };
      fillZoneScriptSettings(currentZoneScriptSettings);
      break;
    case "stats_update":
      currentStats = message.payload;
      updateStatsBar(message.payload.hp, message.payload.hpMax, message.payload.energy, message.payload.energyMax);
      break;
    case "aliases_snapshot":
      currentAliases = message.payload.aliases;
      renderNavPanel();
      mapGrid.forceFullRerender();
      break;
    case "navigation_state":
      currentNavState = message.payload;
      renderNavStatus(message.payload);
      break;
    case "survival_status":
      currentSurvivalStatus = message.payload;
      updateActionBadges();
      break;
    case "farm_settings_data":
      bus.emit("farm_settings_data", message.payload);
      break;
    case "survival_settings_data": {
      const raw = message.payload;
      if (raw !== null) {
        currentSurvivalSettings = normalizeSurvivalSettings(raw);
        updateActionButtons();
      }
      bus.emit("survival_settings_data", message.payload);
      break;
    }
    case "triggers_state":
      bus.emit("triggers_state", message.payload);
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
      bus.emit("items_data", message.payload);
      break;
    case "room_auto_commands_snapshot":
      currentRoomAutoCommands = new Map(message.payload.entries.map((e) => [e.vnum, e.command]));
      break;
    case "compare_scan_progress":
      bus.emit("compare_scan_progress", message.payload);
      break;
    case "compare_scan_result":
      bus.emit("compare_scan_result", message.payload);
      break;
    case "repair_state":
      repairBtn.disabled = message.payload.running;
      repairBtn.title = message.payload.running
        ? `Починка: ${message.payload.message}`
        : "Починить снаряжение";
      break;
    case "wiki_item_search_result":
      bus.emit("wiki_item_search_result", message.payload);
      break;
    case "vorozhe_route_result": {
      bus.emit("vorozhe_route_result", message.payload);
      break;
    }
    case "container_contents": {
      const containerPanelMap = {
        склад: storagePanelList,
        расход: расходPanelList,
        базар: bazaarPanelList,
        хлам: junkPanelList,
      };
      const panelList = containerPanelMap[message.payload.container];
      if (panelList) {
        renderContainerList(panelList, message.payload.items, message.payload.container);
      }
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
          if (item.correctlyMarked) continue;
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
    case "inventory_sort_result": {
      for (const { command } of message.payload.commands) {
        sendClientEvent({ type: "send", payload: { command } });
      }
      break;
    }
    case "bazaar_max_price_response": {
      const { itemName, maxPrice } = message.payload;
      if (maxPrice === null) break;
      const selector = `tr[data-item-name="${CSS.escape(itemName)}"]`;
      const panelSources = [bazaarPanelList, расходPanelList];
      for (const panel of panelSources) {
        panel.querySelectorAll<HTMLTableRowElement>(selector).forEach((row) => {
          const sellBtn = row.querySelector<HTMLButtonElement>(".container-panel__sell-btn");
          if (sellBtn) {
            sellBtn.dataset["sellPrice"] = String(maxPrice);
            sellBtn.title = `Продать за ${maxPrice} кун`;
          }
        });
      }
      break;
    }
  }
}

// Socket + reconnect + outbound queue live in net.ts. handleServerEvent is
// hoisted (function declaration), so we can pass it to createNet even though
// it references `sendClientEvent` below — by the time a WS message arrives,
// destructuring has run.
const net = createNet({ onMessage: handleServerEvent });
const { sendClientEvent, ensureSocketOpen } = net;
initQuestsPanel(sendClientEvent);

// Modal chunks emit outbound messages via the bus to avoid importing main.ts
// (which would force the bundler to keep them on the critical path).
bus.on("client_send", (ev) => sendClientEvent(ev as ClientEvent));

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
  resetAnsiState();
});

chatClearButton.addEventListener("click", () => {
  chatOutputElement.replaceChildren();
});

resetMapButton.addEventListener("click", () => {
  sendClientEvent({ type: "map_reset_area" });
});

farmToggleButton.addEventListener("click", () => {
  sendClientEvent({
    type: "farm2_toggle",
    payload: { enabled: !farm2Enabled },
  });
});

farmSettingsButton.addEventListener("click", () => {
  const zoneId = farm2ZoneId ?? Math.floor((trackerCurrentVnum ?? 0) / 100);
  void import("./modals/farm-settings.ts").then((m) => m.openFarmSettingsModal(zoneId));
});

globalMapButton.addEventListener("click", () => {
  bus.emit("map_full_snapshot", mapGrid.getLatestFullSnapshot());
  bus.emit("zone_names", mapGrid.getZoneNames());
  void import("./modals/global-map.ts").then((m) => m.openGlobalMap());
});

bus.on<{ zoneId: number; name: string | null }>("zone_name_set_local", ({ zoneId, name }) => {
  mapGrid.setZoneName(zoneId, name);
});

survivalSettingsButton.addEventListener("click", () => {
  void import("./modals/survival.ts").then((m) => m.openSurvivalSettingsModal(currentSurvivalSettings));
});

bus.on<SurvivalSettings>("survival_settings_commit", (payload) => {
  currentSurvivalSettings = payload;
  updateActionButtons();
});

repairBtn.addEventListener("click", () => {
  sendClientEvent({ type: "repair_start" });
});

triggersButton.addEventListener("click", () => {
  void import("./modals/triggers.ts").then((m) => m.openTriggersModal());
});

itemDbButton.addEventListener("click", () => {
  void import("./modals/item-db.ts").then((m) => m.openItemDbModal());
});

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

junkSellAllBtn.addEventListener("click", () => {
  const rows = junkPanelList.querySelectorAll<HTMLTableRowElement>("tr");
  rows.forEach((row) => {
    const nameCell = row.querySelector(".container-panel__name");
    const countCell = row.querySelector(".container-panel__count");
    const name = nameCell?.textContent?.trim() ?? "";
    if (!name) return;
    const kw = name.split(/\s+/)[0] ?? name;
    const countText = countCell?.textContent?.replace("×", "").trim() ?? "";
    const count = countText ? parseInt(countText, 10) : 1;
    for (let i = 0; i < count; i++) {
      sendClientEvent({ type: "send", payload: { command: `взя ${kw} хлам` } });
      sendClientEvent({ type: "send", payload: { command: `прод ${kw}` } });
    }
  });
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

inventoryAutoSortBtn.addEventListener("click", () => {
  const rows = inventoryPanelList.querySelectorAll<HTMLTableRowElement>("tr");
  const items: Array<{ name: string; count: number }> = [];
  rows.forEach((row) => {
    const countCell = row.querySelector(".container-panel__count");
    const nameCell = row.querySelector(".container-panel__name");
    const name = nameCell?.textContent?.trim() ?? "";
    const countText = countCell?.textContent?.replace("×", "").trim() ?? "";
    const count = countText ? parseInt(countText, 10) : 1;
    if (name) items.push({ name, count });
  });
  if (items.length > 0) {
    sendClientEvent({ type: "inventory_auto_sort", payload: { items } });
  }
});

document.querySelectorAll<HTMLButtonElement>(".container-panel__refresh").forEach((btn) => {
  btn.addEventListener("click", () => {
    const container = btn.dataset["container"] as "склад" | "расход" | "базар" | "хлам" | undefined;
    if (container === "склад" || container === "расход" || container === "базар" || container === "хлам") {
      sendClientEvent({ type: "send", payload: { command: `осм ${container}` } });
    } else {
      sendClientEvent({ type: "send", payload: { command: "инв" } });
    }
  });
});

requireElement<HTMLButtonElement>("#refresh-all-containers-btn").addEventListener("click", () => {
  for (const container of ["склад", "расход", "базар", "хлам"] as const) {
    sendClientEvent({ type: "send", payload: { command: `осм ${container}` } });
  }
  sendClientEvent({ type: "send", payload: { command: "инв" } });
});

compareButton.addEventListener("click", () => {
  void import("./modals/compare.ts").then((m) => m.openCompareAdvisor());
});

vorozheButton.addEventListener("click", () => {
  void import("./modals/vorozhe.ts").then((m) => m.openVorozheModal());
});

mapTabMap.addEventListener("click", () => switchMapTab("map"));

containerTabInventory.addEventListener("click", () => switchContainerTab("inventory"));
containerTabNav.addEventListener("click", () => switchContainerTab("nav"));
containerTabScript.addEventListener("click", () => switchContainerTab("script"));
containerTabQuests.addEventListener("click", () => { switchContainerTab("quests"); bus.emit("quests_tab_activated", {}); });

(function populateScriptSelect() {
  const autoOpt = document.createElement("option");
  autoOpt.value = "";
  autoOpt.textContent = "— авто —";
  scriptSelect.appendChild(autoOpt);
  for (const s of AVAILABLE_ZONE_SCRIPTS) {
    const opt = document.createElement("option");
    opt.value = String(s.zoneId);
    opt.textContent = s.name;
    scriptSelect.appendChild(opt);
  }
  const saved = localStorage.getItem("scriptSelectId");
  if (saved) scriptSelect.value = saved;
  refreshScriptToggleBtn();
})();

scriptSelect.addEventListener("change", () => {
  localStorage.setItem("scriptSelectId", scriptSelect.value);
  refreshScriptToggleBtn();
});

scriptToggleBtn.addEventListener("click", () => {
  if (zoneScriptState?.payload.enabled || zoneScriptState?.payload.loopWaitingUntil != null) {
    sendClientEvent({ type: "zone_script_toggle", payload: { enabled: false } });
  } else {
    const selectedId = scriptSelect.value !== "" ? Number(scriptSelect.value) : null;
    const autoScript = trackerCurrentVnum !== null ? getScriptForVnum(trackerCurrentVnum) : undefined;
    const zoneId = selectedId ?? autoScript?.zoneId;
    if (zoneId !== undefined) {
      sendClientEvent({ type: "zone_script_toggle", payload: { enabled: true, zoneId } });
    }
  }
});

function sendScriptLoopConfig(): void {
  const enabled = scriptLoopEnabled.checked;
  const delayMinutes = Math.max(1, parseInt(scriptLoopDelay.value, 10) || 5);
  localStorage.setItem("scriptLoopEnabled", String(enabled));
  localStorage.setItem("scriptLoopDelay", String(delayMinutes));
  sendClientEvent({ type: "zone_script_loop_set", payload: { enabled, delayMinutes } });
}

scriptLoopEnabled.checked = localStorage.getItem("scriptLoopEnabled") === "true";
scriptLoopDelay.value = localStorage.getItem("scriptLoopDelay") ?? "5";
scriptLoopEnabled.addEventListener("change", sendScriptLoopConfig);
scriptLoopDelay.addEventListener("change", sendScriptLoopConfig);
zoneScriptAssistTargetInput.addEventListener("change", commitZoneScriptSettings);
zoneScriptAssistTargetInput.addEventListener("blur", commitZoneScriptSettings);

setInterval(() => {
  if (zoneScriptState?.payload.loopWaitingUntil != null) {
    renderScriptSteps(zoneScriptState.payload);
  }
}, 1000);

// ── Hotkey system ─────────────────────────────────────────────────────────────

const HOTKEYS_STORAGE_KEY = "mud_hotkeys";
const LAST_PROFILE_KEY = "mud_last_profile";


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

// ── Hotkey modal (lazy-loaded) ────────────────────────────────────────────────

const hotkeysButton = requireElement<HTMLButtonElement>("#hotkeys-button");

bus.on("hotkeys_request", () => {
  bus.emit("hotkeys_state", hotkeys);
});

bus.on("hotkeys_save", (entries) => {
  hotkeys = entries as HotkeyEntry[];
  saveHotkeys(hotkeys);
});

hotkeysButton.addEventListener("click", () => {
  void import("./modals/hotkeys.ts").then((m) => m.openHotkeysModal());
});

renderFarmButton();
updateActionBadges();
updateActionButtons();

initSplitters();

void loadDefaults()
  .then(() => {
    net.enableReconnect();
    return ensureSocketOpen();
  })
  .catch((error) => {
    appendSystemLine(error instanceof Error ? error.message : "failed to initialize client defaults");
  });
