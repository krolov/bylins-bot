import type { SurvivalSettings } from "../events.type.ts";
import type {
  ConnectDefaults,
  ProfileInfo,
  ProfilesResponse,
  TerminalStyle,
  MapNodePayload,
  MapEdgePayload,
  MapSnapshotPayload,
  AliasPayload,
  NavigationStatePayload,
  GameItemPayload,
  FarmRuntimeStats,
  GridCell,
  ColumnDef,
  HotkeyEntry,
  ServerEvent,
  ClientEvent,
} from "./types.ts";
import {
  WEAPON_COLUMNS,
  ARMOR_COLUMNS,
  AVAILABLE_ZONE_SCRIPTS,
  DIR_DELTA,
  OPPOSITE_DIR,
  DIRECTION_PRIORITY,
  SCRIPT_STEP_ICONS,
  DEFAULT_HOTKEYS,
} from "./constants.ts";
import * as bus from "./bus.ts";
import { createTerminal } from "./terminal.ts";
import { renderContainerList, renderInventoryList } from "./inventory.ts";
import { initSplitters } from "./splitters.ts";
import { createPopups } from "./popups.ts";
import { createNavPanel } from "./nav-panel.ts";

// Modal chunks emit outbound messages via the bus to avoid importing main.ts
// (which would force the bundler to keep them on the critical path).
bus.on("client_send", (ev) => sendClientEvent(ev as ClientEvent));

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
const containerPanelInventory = requireElement<HTMLDivElement>("#container-panel-inventory");
const containerPanelNav = requireElement<HTMLDivElement>("#container-panel-nav");
const containerPanelScript = requireElement<HTMLDivElement>("#container-panel-script");
const scriptStepsList = requireElement<HTMLUListElement>("#script-steps-list");
const scriptPanelTitle = requireElement<HTMLSpanElement>("#script-panel-title");
const scriptStatusLine = requireElement<HTMLDivElement>("#script-status-line");
const scriptToggleBtn = requireElement<HTMLButtonElement>("#script-toggle-btn");
const survivalSettingsButton = requireElement<HTMLButtonElement>("#survival-settings-button");

const buyFoodBtn = requireElement<HTMLButtonElement>("#buy-food-btn");
const fillFlaskBtn = requireElement<HTMLButtonElement>("#fill-flask-btn");
const repairBtn = requireElement<HTMLButtonElement>("#repair-btn");
const buyFoodBadge = requireElement<HTMLSpanElement>("#buy-food-badge");
const fillFlaskBadge = requireElement<HTMLSpanElement>("#fill-flask-badge");

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

function defaultSurvivalSettings(): SurvivalSettings {
  return { container: "", foodItems: "", flaskItems: "", buyFoodItem: "", buyFoodMax: 20, buyFoodAlias: "", fillFlaskAlias: "", fillFlaskSource: "" };
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
function updateActionButtons(): void {
  buyFoodBtn.disabled = !currentSurvivalSettings.buyFoodAlias.trim() || !currentSurvivalSettings.buyFoodItem.trim();
  fillFlaskBtn.disabled = !currentSurvivalSettings.fillFlaskAlias.trim();
}

function updateActionBadges(): void {
  buyFoodBadge.classList.toggle("action-btn__badge--hidden", !currentSurvivalStatus.foodEmpty);
  fillFlaskBadge.classList.toggle("action-btn__badge--hidden", !currentSurvivalStatus.flaskEmpty);
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

const { openAliasPopup, openMapContextMenu } = createPopups({
  getAliases: () => currentAliases,
  getRoomAutoCommands: () => currentRoomAutoCommands,
  getNodeName: (vnum) => latestMapSnapshot.nodes.find((n) => n.vnum === vnum)?.name,
});

const { render: renderNavPanel, renderStatus: renderNavStatus } = createNavPanel({
  getSnapshot: () => latestMapSnapshot,
  getFullSnapshot: () => latestFullSnapshot,
  getZoneNames: () => zoneNames,
  getAliases: () => currentAliases,
});

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
let latestFullSnapshot: MapSnapshotPayload = latestMapSnapshot;
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

// ── Grid map renderer ────────────────────────────────────────────────────────


const CELL = 56;
const TILE = 40;
const PAD = 2;

const gridLayout = new Map<number, GridCell>();
const collisionDisplacedVnums = new Set<number>();
const ZONE_GAP = 8;
const COMPONENT_GAP = 4;

let currentZLevel = 0;
let availableZLevels: number[] = [0];

// P2: DOM cache — room tiles keyed by vnum, valid for the current rendered layout
const mapRoomElements = new Map<number, HTMLDivElement>();
// P1: snapshot fingerprint — if nodes+edges count unchanged and only currentVnum moved,
// skip full integrateSnapshot and only patch the current-room CSS class
let lastLayoutNodeCount = -1;
let lastLayoutEdgeCount = -1;
let lastRenderedZone: number | null = null;
let lastRenderedZLevel = -999;
let lastRenderedMinX = 0;
let lastRenderedMaxY = 0;

function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function placeRoom(vnum: number, x: number, y: number, zLevel: number): void {
  gridLayout.set(vnum, { vnum, gridX: x, gridY: y, zoneId: getZoneId(vnum), zLevel });
}

function resetGridLayout(): void {
  gridLayout.clear();
  collisionDisplacedVnums.clear();
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

    const reverseDir = OPPOSITE_DIR[edge.direction];
    if (reverseDir && adj.has(edge.toVnum)) {
      const toNeighbors = adj.get(edge.toVnum)!;
      if (!toNeighbors.some((n) => n.toVnum === edge.fromVnum)) {
        toNeighbors.push({ toVnum: edge.fromVnum, direction: reverseDir });
      }
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

    // Pre-compute zLevel for each horizontal component using up/down edges
    // so that components on different levels don't compete for grid cells
    const zoneUpDownEdges = edges.filter(
      (e) => (e.direction === "up" || e.direction === "down") &&
        !e.isPortal &&
        getZoneId(e.fromVnum) === zoneId &&
        getZoneId(e.toVnum) === zoneId,
    );
    const preHorizAdj = new Map<number, number[]>();
    for (const e of edges) {
      if (!DIR_DELTA[e.direction] || e.isPortal || getZoneId(e.fromVnum) !== zoneId || getZoneId(e.toVnum) !== zoneId) continue;
      const fa = preHorizAdj.get(e.fromVnum) ?? []; fa.push(e.toVnum); preHorizAdj.set(e.fromVnum, fa);
      const ta = preHorizAdj.get(e.toVnum) ?? []; ta.push(e.fromVnum); preHorizAdj.set(e.toVnum, ta);
    }
    const preCompOf = new Map<number, number>();
    for (const v of zoneNodes) {
      if (preCompOf.has(v)) continue;
      const q = [v]; preCompOf.set(v, v);
      while (q.length > 0) {
        const c = q.shift()!;
        for (const nb of preHorizAdj.get(c) ?? []) {
          if (!preCompOf.has(nb)) { preCompOf.set(nb, v); q.push(nb); }
        }
      }
    }
    const preUpDownAdj = new Map<number, { toVnum: number; delta: number }[]>();
    for (const e of zoneUpDownEdges) {
      const delta = e.direction === "up" ? 1 : -1;
      const fa = preUpDownAdj.get(e.fromVnum) ?? []; fa.push({ toVnum: e.toVnum, delta }); preUpDownAdj.set(e.fromVnum, fa);
      const ta = preUpDownAdj.get(e.toVnum) ?? []; ta.push({ toVnum: e.fromVnum, delta: -delta }); preUpDownAdj.set(e.toVnum, ta);
    }
    const preCompZLevel = new Map<number, number>();
    for (const v of [...zoneNodes].sort((a, b) => a - b)) {
      const compId = preCompOf.get(v)!;
      if (preCompZLevel.has(compId)) continue;
      let inferredZ = 0;
      outer: for (const vv of zoneNodes) {
        if (preCompOf.get(vv) !== compId) continue;
        for (const { toVnum, delta } of preUpDownAdj.get(vv) ?? []) {
          const toComp = preCompOf.get(toVnum);
          if (toComp !== undefined && toComp !== compId && preCompZLevel.has(toComp)) {
            inferredZ = preCompZLevel.get(toComp)! - delta;
            break outer;
          }
        }
      }
      preCompZLevel.set(compId, inferredZ);
    }
    const preVnumZLevel = new Map<number, number>();
    for (const v of zoneNodes) {
      preVnumZLevel.set(v, preCompZLevel.get(preCompOf.get(v)!) ?? 0);
    }

    const occupiedByLevel = new Map<number, Map<string, number>>();
    const getOccupied = (zl: number): Map<string, number> => {
      if (!occupiedByLevel.has(zl)) occupiedByLevel.set(zl, new Map());
      return occupiedByLevel.get(zl)!;
    };

    const unplaced = new Set(zoneNodes);
    let componentOriginX = 0;
    let localMinX = 0;
    let localMaxX = 0;
    let localMinY = 0;
    let localMaxY = 0;

    const findFreeCell = (
      preferredX: number,
      preferredY: number,
      dx: number,
      dy: number,
      zl: number,
    ): { x: number; y: number } => {
      const perpStep = 2;
      const isHorizontal = dx !== 0;
      const occ = getOccupied(zl);
      for (let offset = perpStep; offset <= 8; offset += perpStep) {
        for (const sign of [1, -1]) {
          const cx = preferredX + (isHorizontal ? 0 : sign * offset);
          const cy = preferredY + (isHorizontal ? sign * offset : 0);
          if (!occ.has(cellKey(cx, cy))) return { x: cx, y: cy };
        }
      }
      for (let radius = 1; radius <= 20; radius++) {
        for (let sx = -radius; sx <= radius; sx++) {
          for (let sy = -radius; sy <= radius; sy++) {
            if (Math.abs(sx) !== radius && Math.abs(sy) !== radius) continue;
            const cx = preferredX + sx * 2;
            const cy = preferredY + sy * 2;
            if (!occ.has(cellKey(cx, cy))) return { x: cx, y: cy };
          }
        }
      }
      return { x: preferredX, y: preferredY };
    };

    const componentOriginByLevel = new Map<number, number>();

    const dbOnlyAdj = new Map<number, { toVnum: number; direction: string }[]>();
    for (const vnum of zoneNodes) dbOnlyAdj.set(vnum, []);
    for (const edge of edges) {
      if (!DIR_DELTA[edge.direction] || edge.isPortal) continue;
      if (getZoneId(edge.fromVnum) !== zoneId || getZoneId(edge.toVnum) !== zoneId) continue;
      dbOnlyAdj.get(edge.fromVnum)?.push({ toVnum: edge.toVnum, direction: edge.direction });
    }

    const doubleStepPairs = new Set<string>();
    for (const [vnum, neighbors] of adj) {
      for (const { toVnum, direction } of neighbors) {
        const reverseDir = OPPOSITE_DIR[direction];
        if (!reverseDir) continue;
        const toNeighbors = adj.get(toVnum) ?? [];
        const dbNeighbors = dbOnlyAdj.get(vnum) ?? [];
        for (const { toVnum: middleVnum } of toNeighbors) {
          if (middleVnum === vnum) continue;
          if (dbNeighbors.some((n) => n.toVnum === middleVnum)) continue;
          const middleNeighbors = adj.get(middleVnum) ?? [];
          const linksBack = middleNeighbors.some((n) => n.toVnum === vnum && n.direction === reverseDir);
          const linksForward = middleNeighbors.some((n) => n.toVnum === toVnum);
          if (linksBack && linksForward) {
            doubleStepPairs.add(`${vnum}:${direction}:${toVnum}`);
            doubleStepPairs.add(`${toVnum}:${reverseDir}:${vnum}`);
          }
        }
      }
    }

    while (unplaced.size > 0) {
      const componentRoot = Math.min(...unplaced);
      const rootZL = preVnumZLevel.get(componentRoot) ?? 0;
      const occ = getOccupied(rootZL);
      const originX = componentOriginByLevel.get(rootZL) ?? 0;

      localCoords.set(componentRoot, { x: originX, y: 0 });
      occ.set(cellKey(originX, 0), componentRoot);
      unplaced.delete(componentRoot);

      const queue = [componentRoot];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const currentCoord = localCoords.get(current);
        if (!currentCoord) continue;
        const currentZL = preVnumZLevel.get(current) ?? 0;
        const currentOcc = getOccupied(currentZL);

        for (const neighbor of adj.get(current) ?? []) {
          if (localCoords.has(neighbor.toVnum)) continue;
          const delta = DIR_DELTA[neighbor.direction];
          if (!delta) continue;

          const step = doubleStepPairs.has(`${current}:${neighbor.direction}:${neighbor.toVnum}`) ? 2 : 1;
          const preferredX = currentCoord.x + delta[0] * step;
          const preferredY = currentCoord.y + delta[1] * step;

          let nextCoord: { x: number; y: number };
          const existingOccupant = currentOcc.get(cellKey(preferredX, preferredY));
          if (existingOccupant !== undefined && existingOccupant !== neighbor.toVnum) {
            nextCoord = findFreeCell(preferredX, preferredY, delta[0], delta[1], currentZL);
            collisionDisplacedVnums.add(neighbor.toVnum);
          } else {
            nextCoord = { x: preferredX, y: preferredY };
          }

          localCoords.set(neighbor.toVnum, nextCoord);
          currentOcc.set(cellKey(nextCoord.x, nextCoord.y), neighbor.toVnum);
          unplaced.delete(neighbor.toVnum);
          queue.push(neighbor.toVnum);

          if (nextCoord.x < localMinX) localMinX = nextCoord.x;
          if (nextCoord.x > localMaxX) localMaxX = nextCoord.x;
          if (nextCoord.y < localMinY) localMinY = nextCoord.y;
          if (nextCoord.y > localMaxY) localMaxY = nextCoord.y;
        }
      }

      const levelMaxX = Math.max(
        ...[...localCoords.entries()]
          .filter(([v]) => (preVnumZLevel.get(v) ?? 0) === rootZL)
          .map(([, c]) => c.x),
        componentOriginByLevel.get(rootZL) ?? 0,
      );
      componentOriginByLevel.set(rootZL, levelMaxX + COMPONENT_GAP);
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

function renderGridMap(snapshot: MapSnapshotPayload, onlyCurrentChanged = false): void {
  if (onlyCurrentChanged && mapRoomElements.size > 0) {
    const nodeColorByVnum = new Map(snapshot.nodes.map((n) => [n.vnum, n.color ?? null]));
    for (const [vnum, el] of mapRoomElements) {
      const isCurrent = vnum === snapshot.currentVnum;
      el.className = isCurrent ? "map-room map-room--current" : "map-room";
      if (!isCurrent) {
        const color = nodeColorByVnum.get(vnum);
        el.style.background = color ?? "";
      } else {
        el.style.background = "";
      }
    }
    if (snapshot.currentVnum != null) {
      const cell = gridLayout.get(snapshot.currentVnum);
      if (cell) {
        requestAnimationFrame(() => {
          const cx = (cell.gridX - lastRenderedMinX + PAD) * CELL + TILE / 2;
          const cy = (lastRenderedMaxY - cell.gridY + PAD) * CELL + TILE / 2;
          const targetScrollLeft = cx - mapCanvasElement.clientWidth / 2;
          const targetScrollTop = cy - mapCanvasElement.clientHeight / 2;
          console.log("[scroll-fast] vnum=" + snapshot.currentVnum + " gridX=" + cell.gridX + " gridY=" + cell.gridY + " minX=" + lastRenderedMinX + " maxY=" + lastRenderedMaxY + " cx=" + cx + " cy=" + cy + " clientW=" + mapCanvasElement.clientWidth + " clientH=" + mapCanvasElement.clientHeight + " canvasH=" + mapCanvasElement.scrollHeight + " targetL=" + targetScrollLeft + " targetT=" + targetScrollTop);
          mapCanvasElement.scrollLeft = targetScrollLeft;
          mapCanvasElement.scrollTop = targetScrollTop;
          console.log("[scroll-fast-after] actualL=" + mapCanvasElement.scrollLeft + " actualT=" + mapCanvasElement.scrollTop);
        });
      } else {
        console.log("[scroll-fast] cell NOT FOUND for vnum=" + snapshot.currentVnum + " gridLayout.size=" + gridLayout.size);
      }
    }
    return;
  }

  mapRoomElements.clear();
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

  // P0: O(1) position lookup — replaces O(n) Array.from().some/find scans inside loops
  const cellByPos = new Map<string, GridCell>();
  for (const cell of levelCells.values()) {
    cellByPos.set(cellKey(cell.gridX, cell.gridY), cell);
  }

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
      const neighbor = cellByPos.get(cellKey(nx, ny));
      const matchingNeighbor = neighbor !== undefined && neighbor.vnum !== cell.vnum && visibleVnums.has(neighbor.vnum);
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

  lastRenderedMinX = minX;
  lastRenderedMaxY = maxY;

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
  const edgeDirectionsByVnum = new Map<number, Set<string>>();
  for (const edge of snapshot.edges) {
    confirmedEdgeKeys.add(`${edge.fromVnum}:${edge.direction}`);
    if (levelCells.has(edge.fromVnum)) {
      let dirs = edgeDirectionsByVnum.get(edge.fromVnum);
      if (!dirs) { dirs = new Set(); edgeDirectionsByVnum.set(edge.fromVnum, dirs); }
      dirs.add(edge.direction);
    }
  }

  const componentIdOf = new Map<number, number>();
  {
    const horizAdj = new Map<number, number[]>();
    for (const edge of snapshot.edges) {
      if (edge.isPortal || !DIR_DELTA[edge.direction]) continue;
      if (!levelCells.has(edge.fromVnum) || !levelCells.has(edge.toVnum)) continue;
      const fz = getZoneId(edge.fromVnum), tz = getZoneId(edge.toVnum);
      if (fz !== tz) continue;
      const fa = horizAdj.get(edge.fromVnum) ?? []; fa.push(edge.toVnum); horizAdj.set(edge.fromVnum, fa);
      const ta = horizAdj.get(edge.toVnum) ?? []; ta.push(edge.fromVnum); horizAdj.set(edge.toVnum, ta);
    }
    for (const vnum of levelCells.keys()) {
      if (componentIdOf.has(vnum)) continue;
      const q = [vnum];
      componentIdOf.set(vnum, vnum);
      while (q.length > 0) {
        const cur = q.shift()!;
        for (const nb of horizAdj.get(cur) ?? []) {
          if (!componentIdOf.has(nb) && levelCells.has(nb)) {
            componentIdOf.set(nb, vnum);
            q.push(nb);
          }
        }
      }
    }
  }

  const portalVnums = new Set<number>();
  const REVERSE_DIR: Record<string, string> = { north: "south", south: "north", east: "west", west: "east" };
  const drawIntraPortal = (cellA: { gridX: number; gridY: number }, dir: string): void => {
    const dirDelta = DIR_DELTA[dir];
    if (!dirDelta) return;
    const [cx, cy] = tileCenter(cellA.gridX, cellA.gridY);
    const reach = TILE / 2 + (CELL - TILE) / 2 + 10;
    const ex = cx + dirDelta[0] * reach;
    const ey = cy - dirDelta[1] * reach;
    const stem = document.createElementNS("http://www.w3.org/2000/svg", "line");
    stem.setAttribute("x1", String(cx));
    stem.setAttribute("y1", String(cy));
    stem.setAttribute("x2", String(ex));
    stem.setAttribute("y2", String(ey));
    stem.setAttribute("class", "map-edge map-edge--intra-portal-stem");
    svg.appendChild(stem);
    const crossHalf = 6;
    const [ppx, ppy] = dirDelta[0] !== 0 ? [0, crossHalf] : [crossHalf, 0];
    const cross = document.createElementNS("http://www.w3.org/2000/svg", "line");
    cross.setAttribute("x1", String(ex - ppx));
    cross.setAttribute("y1", String(ey - ppy));
    cross.setAttribute("x2", String(ex + ppx));
    cross.setAttribute("y2", String(ey + ppy));
    cross.setAttribute("class", "map-edge--intra-portal-cross");
    svg.appendChild(cross);
  };

  const drawnEdges = new Set<string>();
  for (const edge of snapshot.edges) {
    const fromCell = levelCells.get(edge.fromVnum);
    if (!fromCell) continue;
    const toCell = levelCells.get(edge.toVnum);

    if (edge.isPortal) {
      portalVnums.add(edge.fromVnum);
      if (!toCell) {
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
    }

    if (!toCell) continue;
    if (!visibleVnums.has(edge.fromVnum) || !visibleVnums.has(edge.toVnum)) continue;

    const edgeKey = [edge.fromVnum, edge.toVnum].sort().join("-");
    if (drawnEdges.has(edgeKey)) continue;
    drawnEdges.add(edgeKey);

    const isCrossComponent =
      getZoneId(edge.fromVnum) === getZoneId(edge.toVnum) &&
      componentIdOf.get(edge.fromVnum) !== componentIdOf.get(edge.toVnum);

    const isCollisionEdge =
      collisionDisplacedVnums.has(edge.fromVnum) || collisionDisplacedVnums.has(edge.toVnum);

    const gridDist = Math.abs(fromCell.gridX - toCell.gridX) + Math.abs(fromCell.gridY - toCell.gridY);
    const isPhysicallyAdjacent = gridDist <= 2;

    if ((isCrossComponent || isCollisionEdge) && !isPhysicallyAdjacent) {
      drawIntraPortal(fromCell, edge.direction);
      if (toCell && REVERSE_DIR[edge.direction]) {
        drawIntraPortal(toCell, REVERSE_DIR[edge.direction]);
      }
      continue;
    }

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
      const edgeDirections = edgeDirectionsByVnum.get(cell.vnum) ?? new Set<string>();
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
    mapRoomElements.set(cell.vnum, tile);
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
      const candidate = cellByPos.get(cellKey(nx, ny));
      const neighborCell = (candidate !== undefined && candidate.vnum !== cell.vnum && visibleVnums.has(candidate.vnum))
        ? candidate
        : undefined;

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
      console.log("[scroll-full] vnum=" + snapshot.currentVnum + " gridX=" + snapCell.gridX + " gridY=" + snapCell.gridY + " cx=" + cx + " cy=" + cy + " clientW=" + mapCanvasElement.clientWidth + " clientH=" + mapCanvasElement.clientHeight + " canvasH=" + mapCanvasElement.scrollHeight);
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

function updateMap(snapshot: MapSnapshotPayload, fullReset: boolean): void {
  latestMapSnapshot = snapshot;
  if (fullReset) {
    latestFullSnapshot = snapshot;
  } else {
    latestFullSnapshot = {
      ...latestFullSnapshot,
      currentVnum: snapshot.currentVnum,
      zoneNames: snapshot.zoneNames.length > 0 ? snapshot.zoneNames : latestFullSnapshot.zoneNames,
    };
  }
  let zoneNamesChanged = false;
  for (const [zoneId, name] of snapshot.zoneNames) {
    if (zoneNames.get(zoneId) !== name) {
      zoneNames.set(zoneId, name);
      zoneNamesChanged = true;
    }
  }
  if (zoneNamesChanged) {
    saveZoneNames(zoneNames);
    bus.emit("zone_names", zoneNames);
  }
  bus.emit("map_full_snapshot", latestFullSnapshot);

  const currentZoneId = snapshot.currentVnum != null ? getZoneId(snapshot.currentVnum) : null;
  const expectedZLevel =
    snapshot.currentVnum != null && gridLayout.has(snapshot.currentVnum)
      ? gridLayout.get(snapshot.currentVnum)!.zLevel
      : currentZLevel;
  const graphUnchanged =
    !fullReset &&
    snapshot.nodes.length === lastLayoutNodeCount &&
    snapshot.edges.length === lastLayoutEdgeCount &&
    currentZoneId === lastRenderedZone &&
    expectedZLevel === lastRenderedZLevel;

  if (graphUnchanged) {
    renderGridMap(snapshot, true);
    renderNavPanel();
    return;
  }

  lastLayoutNodeCount = snapshot.nodes.length;
  lastLayoutEdgeCount = snapshot.edges.length;

  resetGridLayout();
  integrateSnapshot(snapshot);
  lastRenderedZone = currentZoneId;
  lastRenderedZLevel = currentZLevel;
  renderGridMap(snapshot, false);
  renderNavPanel();
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
        appendSystemLine(message.payload.message);
        updateConnectButton(message.payload.state);
        break;
      case "output":
        appendOutput(message.payload.text);
        break;
      case "error":
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
        lastLayoutNodeCount = -1;
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
  });

  nextSocket.addEventListener("close", () => {
    socket = null;
    pendingOpenPromise = null;
    scheduleReconnect();
  });

  nextSocket.addEventListener("error", () => {
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
  resetAnsiState();
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
    lastRenderedZLevel = currentZLevel;
    updateZLevelControls();
    renderGridMap(latestMapSnapshot);
  }
});

zLevelUpButton.addEventListener("click", () => {
  const idx = availableZLevels.indexOf(currentZLevel);
  if (idx < availableZLevels.length - 1) {
    currentZLevel = availableZLevels[idx + 1]!;
    lastRenderedZLevel = currentZLevel;
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

farmSettingsButton.addEventListener("click", () => {
  const zoneId = farm2ZoneId ?? getZoneId(trackerCurrentVnum ?? 0);
  void import("./modals/farm-settings.ts").then((m) => m.openFarmSettingsModal(zoneId));
});

globalMapButton.addEventListener("click", () => {
  bus.emit("map_full_snapshot", latestFullSnapshot);
  bus.emit("zone_names", zoneNames);
  void import("./modals/global-map.ts").then((m) => m.openGlobalMap());
});

bus.on<{ zoneId: number; name: string | null }>("zone_name_set_local", ({ zoneId, name }) => {
  if (name) zoneNames.set(zoneId, name);
  else zoneNames.delete(zoneId);
  saveZoneNames(zoneNames);
});

survivalSettingsButton.addEventListener("click", () => {
  void import("./modals/survival.ts").then((m) => m.openSurvivalSettingsModal(currentSurvivalSettings));
});

bus.on<SurvivalSettings>("survival_settings_commit", (payload) => {
  currentSurvivalSettings = payload;
  updateActionButtons();
});

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
    reconnectEnabled = true;
    return ensureSocketOpen();
  })
  .catch((error) => {
    appendSystemLine(error instanceof Error ? error.message : "failed to initialize client defaults");
  });
