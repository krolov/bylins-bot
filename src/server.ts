import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runtimeConfig } from "./config.ts";
import { sql } from "./db.ts";
import { createCombatState } from "./combat-state.ts";
import { createFarm2Controller } from "./farm2/index.ts";
import { createSurvivalController, normalizeSurvivalConfig, resolveSurvivalCommands, parseInspectItems, parseInventoryItems } from "./survival-script.ts";
import { findPath } from "./map/pathfinder.ts";
import type { PathStep } from "./map/pathfinder.ts";
import { createParserState, feedText } from "./map/parser.ts";
import { createMapStore } from "./map/store.ts";
import { createTrackerState, processParsedEvents, trackOutgoingCommand } from "./map/tracker.ts";
import { createMover } from "./map/mover.ts";
import type { Direction } from "./map/types.ts";
import { createTriggers } from "./triggers.ts";
import { runCompareScan } from "./compare-scan/index.ts";
import { fetchWiki, parseSearchResults, parseGearItemCard, gearItemCardToData, parseWikiItemCard, parseMudIdentifyBlock, mergeItemSources, gearItemCardFromCache, searchAndCacheWikiItem } from "./wiki.ts";
import { createContainerTracker } from "./container-tracker.ts";
import { createItemIdentifier } from "./item-identify.ts";
import { createRepairController } from "./repair-script.ts";
import { createGatherController } from "./gather-script.ts";
import { createZoneScriptController } from "./zone-scripts/index.ts";
import type { WsData, ConnectPayload, ClientEvent, ServerEvent, FarmZoneSettings, SurvivalSettings, TriggerState, MapAlias, MapSnapshot, GameItem } from "./events.type.ts";
import { normalizeFarmZoneSettings, normalizeSurvivalSettings } from "./settings-normalizers.ts";
import { createMudConnection } from "./mud-connection.ts";
import type { Session } from "./mud-connection.ts";
import { findVorozheRoute } from "./vorozhe-graph.ts";

type BunServerWebSocket = Bun.ServerWebSocket<WsData>;
const LOG_DIR = "/var/log/bylins-bot";
const LOG_FILE = `${LOG_DIR}/mud-traffic.log`;
const DEBUG_LOG_FILE = `${LOG_DIR}/debug.log`;
const LAST_PROFILE_FILE = `${LOG_DIR}/last-profile.txt`;
const MAX_OUTPUT_CHUNKS = 200;
const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*m/g;
const NAVIGATION_STEP_TIMEOUT_MS = 3000;

function readLastProfileId(): string {
  try {
    return readFileSync(LAST_PROFILE_FILE, "utf8").trim();
  } catch {
    return runtimeConfig.defaultProfileId;
  }
}

function saveLastProfileId(profileId: string): void {
  try {
    writeFileSync(LAST_PROFILE_FILE, profileId, "utf8");
  } catch {
  }
}


const browserClients = new Set<BunServerWebSocket>();
const mudConnection = createMudConnection({
  logEvent: (ws, direction, message, details) => logEvent(ws, direction, message, details),
  sanitizeLogText: (text) => sanitizeLogText(text),
  updateSessionStatus: (state, message) => updateSessionStatus(state, message),
  onMudText: (text, ws) => {
    containerTracker.feedText(text);
    containerTracker.feedEquippedScan(text);
    containerTracker.feedPendingInspect(text);
    for (const handler of mudTextHandlers) handler(text);
    rememberOutput(text);
    broadcastServerEvent({ type: "output", payload: { text } });
    const chatLines = extractChatLines(text);
    if (chatLines.length > 0) {
      const now = Date.now();
      for (const line of chatLines) {
        const msg = { text: line.trim(), timestamp: now };
        broadcastServerEvent({ type: "chat_message", payload: msg });
        void mapStore.saveChatMessage(msg.text, msg.timestamp).catch((error: unknown) => {
          logEvent(ws, "error", error instanceof Error ? `Chat persist error: ${error.message}` : "Chat persist error.");
        });
      }
    }
    void persistParsedMapData(text, ws).catch((error: unknown) => {
      logEvent(ws, "error", error instanceof Error ? `Automapper error: ${error.message}` : "Automapper error.");
    });
  },
  onTcpError: (ws, message) => {
    broadcastServerEvent({ type: "error", payload: { message } });
  },
  onSessionTeardown: () => {
    combatState.reset();
    clearSurvivalTickTimer();
    survivalTickRunning = false;
    mudTextHandlers.clear();
    survivalController.reset();
    containerTracker.reset();
    for (const hook of sessionTeardownHooks) hook();
  },
  trackOutgoingCommand: (command) => trackOutgoingCommand(trackerState, command),
  lineEnding: runtimeConfig.lineEnding,
});
const sharedSession = mudConnection.session;
let activeProfileId: string = readLastProfileId();
const recentOutputChunks: string[] = [];

const CHAT_FILTER_NAMES = ["Незнакомец", "Ворожея", "Кузнец", "Хитрый лавочник", "Здоровый дядька", "Владелец двора", "Раненый воин", "Травник", "Старец", "Пленник", "Девка для утех", "Леха Небокоптитель", "Боярин Вейдеров", "Старик", "Варяг", "Вальгрим", "Седовласый старик", "Пастух", "Краснодеревщик", "Староста", "Полуслепой немощный колдун", "Голодный зверюга", "Дружинник", "Желтоглазый дух леса", "Наворопник", "Нарочный", "Отшельник", "Боевой конь", "Ослик Иа", "Полосатый пчел", "Молодой цыган", "Юрий, сын Антонов", "страж лагеря", "Старейшина"];

function isChatLine(text: string): boolean {
  if (CHAT_FILTER_NAMES.some((name) => text.includes(name))) return false;
  return (
    /сказал[аи]?\s+вам\s*[:'"]/.test(text) ||
    /сказал[аи]?\s*:\s*'/.test(text) ||
    /Вы сказали\s*:\s*'/.test(text) ||
    /Вы сказали\s+\S+\s*:\s*'/.test(text) ||
    /Услышали вы голос/.test(text) ||
    /шепнул[аи]?\s+вам/.test(text) ||
    /дружине\s*:\s*'/.test(text) ||
    /Вы дружине\s*:\s*'/.test(text) ||
    /сообщил[аи]? группе\s*:\s*'/.test(text) ||
    /Вы сообщили группе\s*:\s*'/.test(text) ||
    /союзникам\s*:\s*'/.test(text) ||
    /Вы союзникам\s*:\s*'/.test(text)
  );
}

function extractChatLines(mudText: string): string[] {
  const stripped = mudText.replace(ANSI_ESCAPE_RE, "").replace(/\r/g, "");
  const lines = stripped.split("\n");
  return lines.filter((line) => isChatLine(line.trim()));
}
const parserState = createParserState();
const trackerState = createTrackerState();
const mover = createMover({
  sendCommand: (command) => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, command, "mover");
  },
  onLog: (message) => {
    appendLogLine(`[${new Date().toISOString()}] session=system direction=session message=${JSON.stringify(message)}`);
    broadcastServerEvent({ type: "status", payload: { state: sharedSession.state, message } });
  },
});
let mapRecordingEnabled = true;
let debugLogEnabled = false;
const mapStore = createMapStore(sql);
const combatState = createCombatState();
const currentRoomMobs = new Map<string, string>();
const farm2Controller = createFarm2Controller({
  getCurrentRoomId: () => trackerState.currentRoomId,
  isConnected: () => sharedSession.connected && Boolean(sharedSession.tcpSocket),
  getSnapshot: (currentVnum) => mapStore.getSnapshot(currentVnum),
  combatState,
  sendCommand: (command) => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, command, "farm2-script");
  },
  move: (direction) => mover.move(direction, trackerState.currentRoomId),
  reinitRoom: () => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, "см", "farm2-script");
  },
  getZoneSettings: (zoneId) => mapStore.getFarmSettings(activeProfileId, zoneId),
  getMobCombatNamesByZone: (zoneId) => mapStore.getMobCombatNamesByZone(zoneId),
  getCombatNameByRoomName: (roomName) => mapStore.getCombatNameByRoomName(roomName),
  isRoomNameBlacklisted: (roomName) => mapStore.isRoomNameBlacklisted(roomName),
  linkMobRoomAndCombatName: (roomName, combatName, vnum) => mapStore.saveMobRoomName(roomName, vnum, combatName),
  onStateChange: (farm2State) => {
    broadcastServerEvent({ type: "farm2_state", payload: farm2State });
  },
  onLog: (message) => {
    logEvent(null, "session", message);
  },
  onDebugLog: (message) => {
    appendLogLine(`[${new Date().toISOString()}] session=system direction=session message=${JSON.stringify(message)}`);
  },
});
const survivalController = createSurvivalController({
  getCurrentRoomId: () => trackerState.currentRoomId,
  sendCommand: (command) => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, command, "survival-script");
  },
  resolveNearest: async (alias) => {
    const vnums = await mapStore.resolveAliasAll(alias);
    if (vnums.length === 0) return null;
    return vnums[0] ?? null;
  },
  navigateTo: (vnum) => startNavigation(null, vnum),
  isInCombat: () => combatState.getInCombat(),
  onLog: (message) => {
    appendLogLine(`[${new Date().toISOString()}] session=system direction=session message=${JSON.stringify(message)}`);
  },
  onDebugLog: (message) => {
    appendLogLine(`[${new Date().toISOString()}] session=system direction=session message=${JSON.stringify(message)}`);
  },
  onStatusChange: (status) => {
    broadcastServerEvent({
      type: "survival_status",
      payload: status,
    });
  },
});

const repairController = createRepairController({
  getCurrentRoomId: () => trackerState.currentRoomId,
  sendCommand: (command) => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, command, "repair-script");
  },
  resolveNearest: async (alias) => {
    const vnums = await mapStore.resolveAliasAll(alias);
    if (vnums.length === 0) return null;
    const currentVnum = trackerState.currentRoomId;
    if (currentVnum === null || vnums.length === 1) return vnums[0] ?? null;
    let bestVnum: number | null = null;
    let bestLen = Infinity;
    const snapshot = await mapStore.getSnapshot(currentVnum);
    for (const vnum of vnums) {
      const path = findPath(snapshot, currentVnum, vnum);
      if (path !== null && path.length < bestLen) {
        bestLen = path.length;
        bestVnum = vnum;
      }
    }
    return bestVnum ?? vnums[0] ?? null;
  },
  navigateTo: (vnum) => startNavigation(null, vnum),
  isInCombat: () => combatState.getInCombat(),
  isConnected: () => sharedSession.connected,
  registerTextHandler: (h) => mudTextHandlers.add(h),
  unregisterTextHandler: (h) => mudTextHandlers.delete(h),
  onStateChange: (state) => {
    broadcastServerEvent({ type: "repair_state", payload: state });
  },
  onLog: (message) => {
    appendLogLine(`[${new Date().toISOString()}] session=system direction=session message=${JSON.stringify(message)}`);
  },
});

const gatherController = createGatherController({
  sendCommand: (command) => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, command, "gather-script");
  },
  onLog: (message) => {
    logEvent(null, "session", message);
  },
});

const containerTracker = createContainerTracker({
  onContainerContents: (container, items) => {
    broadcastServerEvent({ type: "container_contents", payload: { container, items } });
  },
  onInventoryContents: (items) => {
    broadcastServerEvent({ type: "inventory_contents", payload: { items } });
  },
  onEquippedContents: (items) => {
    broadcastServerEvent({ type: "equipped_contents", payload: { items } });
  },
});

const itemIdentifier = createItemIdentifier({
  getItemByName: (name) => mapStore.getItemByName(name),
  upsertItem: (name, itemType, data, hasWikiData, hasGameData) =>
    mapStore.upsertItem(name, itemType, data, hasWikiData, hasGameData),
  wikiProxies: runtimeConfig.wikiProxies,
});

mkdirSync(LOG_DIR, { recursive: true });
appendFileSync(LOG_FILE, "");

const triggers = createTriggers({
  sendCommand: (command) => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, command, "triggers");
  },
  onStateChange: (state) => {
    broadcastServerEvent({ type: "triggers_state", payload: state });
  },
  onLog: (message) => {
    logEvent(null, "session", message);
  },
  isInCombat: () => combatState.getInCombat(),
  getCharacterName: () => {
    return runtimeConfig.profiles.find((p) => p.id === activeProfileId)?.name ?? "";
  },
  getCharLevel: () => statsLevel,
  getCharDsu: () => statsDsu,
  getCharRazb: () => statsRazb,
});

interface NavigationState {
  active: boolean;
  targetVnum: number | null;
  steps: PathStep[];
  currentStep: number;
  abortController: AbortController | null;
}

const navigationState: NavigationState = {
  active: false,
  targetVnum: null,
  steps: [],
  currentStep: 0,
  abortController: null,
};

type RoomChangedListener = (vnum: number) => void;
const roomChangedListeners = new Set<RoomChangedListener>();
type RoomRefreshListener = (vnum: number | null) => void;
const roomRefreshListeners = new Set<RoomRefreshListener>();
const mudTextHandlers = new Set<(text: string) => void>();
const sessionTeardownHooks = new Set<() => void>();

function onceMudText(pattern: RegExp, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      mudTextHandlers.delete(handler);
      reject(new Error(`wait_text timeout: ${pattern.source}`));
    }, timeoutMs);
    const handler = (text: string) => {
      if (done) return;
      if (pattern.test(text)) {
        done = true;
        clearTimeout(timer);
        mudTextHandlers.delete(handler);
        resolve();
      }
    };
    mudTextHandlers.add(handler);
  });
}

function refreshCurrentRoom(timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      roomRefreshListeners.delete(listener);
      resolve(null);
    }, timeoutMs);
    const listener: RoomRefreshListener = (vnum) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      roomRefreshListeners.delete(listener);
      resolve(vnum);
    };
    roomRefreshListeners.add(listener);
    if (!sharedSession.tcpSocket || !sharedSession.connected) {
      done = true;
      clearTimeout(timer);
      roomRefreshListeners.delete(listener);
      resolve(null);
      return;
    }
    mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, "см", "zone-script");
  });
}

const zoneScriptController = createZoneScriptController({
  getCurrentRoomId: () => trackerState.currentRoomId,
  isConnected: () => sharedSession.connected && Boolean(sharedSession.tcpSocket),
  navigateTo: (targetVnum) => startNavigation(null, targetVnum),
  sendCommand: (command) => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, command, "zone-script");
  },
  onMudTextOnce: (pattern, timeoutMs) => onceMudText(pattern, timeoutMs),
  onceRoomChanged: (timeoutMs) => onceRoomChanged(timeoutMs),
  refreshCurrentRoom: (timeoutMs) => refreshCurrentRoom(timeoutMs),
  onStateChange: (scriptState) => {
    broadcastServerEvent({ type: "zone_script_state", payload: scriptState });
  },
  onLog: (message) => {
    logEvent(null, "session", message);
  },
  getSnapshot: (currentVnum) => mapStore.getSnapshot(currentVnum),
  move: (direction) => mover.move(direction, trackerState.currentRoomId),
  stealthMove: (direction) => mover.stealthMove(direction, trackerState.currentRoomId),
  combatState,
  getVisibleTargets: () => new Map(currentRoomMobs),
  reinitRoom: () => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, "см", "zone-script");
  },
  isStealthProfile: () => {
    const profile = runtimeConfig.profiles.find((p) => p.id === activeProfileId);
    return profile?.stealthCombat === true;
  },
  mobResolver: {
    getMobCombatNamesByZone: (zoneId) => mapStore.getMobCombatNamesByZone(zoneId),
    getCombatNameByRoomName: (roomName) => mapStore.getCombatNameByRoomName(roomName),
    isRoomNameBlacklisted: (roomName) => mapStore.isRoomNameBlacklisted(roomName),
    linkMobRoomAndCombatName: (roomName, combatName, vnum) => mapStore.saveMobRoomName(roomName, vnum, combatName),
    onDebugLog: (message) => {
      appendLogLine(`[${new Date().toISOString()}] session=system direction=session message=${JSON.stringify(message)}`);
    },
  },
});
sessionTeardownHooks.add(() => zoneScriptController.handleSessionClosed());

function onceRoomChanged(timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      roomChangedListeners.delete(listener);
      resolve(null);
    }, timeoutMs);
    const listener: RoomChangedListener = (vnum) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      roomChangedListeners.delete(listener);
      resolve(vnum);
    };
    roomChangedListeners.add(listener);
  });
}

// ── Character stats ──────────────────────────────────────────────────────────
// Фраза максимумов: «Вы можете выдержать 50(50) единиц повреждения, и пройти 86(86) верст»
const MAX_STATS_REGEXP = /Вы можете выдержать \d+\((\d+)\) единиц[а-я]* повреждения.*?пройти \d+\((\d+)\) верст/i;
// Строка промпта после strip ANSI: «50H 86M 1421o Зауч:0 ОЗ:0 2L 5G Вых:СВЮЗ>»
// Захватывает: (1)HP (2)Energy (3)DSU (4)Level — между ОЗ:N и L могут быть [mob:state] или Зс:N
const PROMPT_STATS_REGEXP = /(\d+)H\s+(\d+)M\s+(\d+)o\s+Зауч:\d+\s+ОЗ:\d+.*?(\d+)L\s+\d+G/;
// Уровень отдельным regex как fallback (L всегда перед G)
const PROMPT_LEVEL_REGEXP = /(\d+)L\s+\d+G/;
const ANSI_ESCAPE_REGEXP = /\u001b\[[0-9;]*m/g;
const COMBAT_PROMPT_MOB_REGEXP = /\[([^\]:]+):[^\]]+\]/g;
// «вступить в группу с максимальной разницей в X уровней»
const RAZB_REGEXP = /максимальной разницей в (\d+) уровн/i;

let statsHp = 0;
let statsHpMax = 0;
let statsEnergy = 0;
let statsEnergyMax = 0;
let statsLevel = 0;
let statsDsu = 0;
let statsRazb = 5;

let survivalTickTimer: ReturnType<typeof setTimeout> | null = null;

let survivalTickRunning = false;

// ─────────────────────────────────────────────────────────────────────────────

function parseAndBroadcastStats(text: string): void {
  let changed = false;

  const maxMatch = MAX_STATS_REGEXP.exec(text);
  if (maxMatch) {
    const newHpMax = Number(maxMatch[1]);
    const newEnergyMax = Number(maxMatch[2]);
    if (newHpMax !== statsHpMax || newEnergyMax !== statsEnergyMax) {
      statsHpMax = newHpMax;
      statsEnergyMax = newEnergyMax;
      changed = true;
    }
  }

  const stripped = text.replace(ANSI_ESCAPE_REGEXP, "");
  const promptMatch = PROMPT_STATS_REGEXP.exec(stripped);
  if (promptMatch) {
    const newHp = Number(promptMatch[1]);
    const newEnergy = Number(promptMatch[2]);
    const newDsu = Number(promptMatch[3]);
    const newLevel = Number(promptMatch[4]);
    if (newHp !== statsHp || newEnergy !== statsEnergy) {
      statsHp = newHp;
      statsEnergy = newEnergy;
      changed = true;
    }
    if (newDsu !== statsDsu) statsDsu = newDsu;
    if (newLevel !== 0 && newLevel !== statsLevel) statsLevel = newLevel;
  } else {
    const levelMatch = PROMPT_LEVEL_REGEXP.exec(stripped);
    if (levelMatch) {
      const newLevel = Number(levelMatch[1]);
      if (newLevel !== 0 && newLevel !== statsLevel) statsLevel = newLevel;
    }
  }

  const razbMatch = RAZB_REGEXP.exec(stripped);
  if (razbMatch) {
    statsRazb = Number(razbMatch[1]);
  }

  if (changed) {
    broadcastServerEvent({
      type: "stats_update",
      payload: {
        hp: statsHp,
        hpMax: statsHpMax,
        energy: statsEnergy,
        energyMax: statsEnergyMax,
      },
    });

    farm2Controller.updateStats({
      hp: statsHp,
      hpMax: statsHpMax,
      energy: statsEnergy,
      energyMax: statsEnergyMax,
    });
  }
}

function sendServerEvent(ws: BunServerWebSocket, event: ServerEvent): void {
  ws.send(JSON.stringify(event));
}

function broadcastServerEvent(event: ServerEvent): void {
  for (const client of browserClients) {
    sendServerEvent(client, event);
  }
}

function rememberOutput(text: string): void {
  if (text.length === 0) {
    return;
  }

  recentOutputChunks.push(text);

  if (recentOutputChunks.length > MAX_OUTPUT_CHUNKS) {
    recentOutputChunks.splice(0, recentOutputChunks.length - MAX_OUTPUT_CHUNKS);
  }
}

async function sendSurvivalSettings(ws: BunServerWebSocket): Promise<void> {
  const survival = await mapStore.getSurvivalSettings();
  sendServerEvent(ws, { type: "survival_settings_data", payload: survival });
}

function sendDefaults(ws: BunServerWebSocket): void {
  sendServerEvent(ws, {
    type: "defaults",
    payload: {
      autoConnect: runtimeConfig.autoConnect,
      host: runtimeConfig.mudHost,
      port: runtimeConfig.mudPort,
      tls: runtimeConfig.mudTls,
      startupCommands: runtimeConfig.startupCommands,
      commandDelayMs: runtimeConfig.commandDelayMs,
    },
  });

  sendServerEvent(ws, {
    type: "farm2_state",
    payload: farm2Controller.getState(),
  });

  sendServerEvent(ws, {
    type: "triggers_state",
    payload: triggers.getState(),
  });

  sendServerEvent(ws, {
    type: "survival_status",
    payload: survivalController.getStatus(),
  });

  sendServerEvent(ws, {
    type: "repair_state",
    payload: { running: repairController.isRunning(), message: "" },
  });

  sendServerEvent(ws, {
    type: "map_recording_state",
    payload: { enabled: mapRecordingEnabled },
  });

  sendServerEvent(ws, {
    type: "gather_state",
    payload: gatherController.getState(),
  });

  sendServerEvent(ws, {
    type: "zone_script_state",
    payload: zoneScriptController.getState(),
  });

  sendServerEvent(ws, {
    type: "combat_state",
    payload: { inCombat: combatState.getInCombat() },
  });

  if (statsHpMax > 0 || statsEnergyMax > 0) {
    sendServerEvent(ws, {
      type: "stats_update",
      payload: {
        hp: statsHp,
        hpMax: statsHpMax,
        energy: statsEnergy,
        energyMax: statsEnergyMax,
      },
    });
  }
}

function updateSessionStatus(
  state: Session["state"],
  message: string,
): void {
  sharedSession.state = state;
  sharedSession.statusMessage = message;
  broadcastServerEvent({
    type: "status",
    payload: {
      state,
      message,
    },
  });
}

function sanitizeLogText(text: string): string {
  return text.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

function appendLogLine(line: string): void {
  appendFileSync(LOG_FILE, `${line}\n`, "utf8");
}

function appendDebugLog(line: string): void {
  appendFileSync(DEBUG_LOG_FILE, `${line}\n`, "utf8");
}

function logEvent(
  ws: BunServerWebSocket | null,
  direction: "session" | "mud-in" | "mud-out" | "browser-in" | "browser-out" | "error",
  message: string,
  details?: Record<string, string | number | boolean | null | undefined>,
): void {
  const timestamp = new Date().toISOString();
  const sessionId = ws?.data.sessionId ?? "system";
  const suffix = details
    ? Object.entries(details)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(" ")
    : "";

  appendLogLine(`[${timestamp}] session=${sessionId} direction=${direction} message=${JSON.stringify(message)}${suffix ? ` ${suffix}` : ""}`);

  if (debugLogEnabled && (direction === "mud-in" || direction === "mud-out")) {
    appendDebugLog(`[${timestamp}] direction=${direction} message=${JSON.stringify(message)}${suffix ? ` ${suffix}` : ""}`);
  }
}

function normalizeTextMessage(message: string | ArrayBuffer | Uint8Array): string {
  if (typeof message === "string") {
    return message;
  }

  return new TextDecoder().decode(message);
}

function handleSendCommand(ws: BunServerWebSocket, command: string | undefined): void {
  const session = sharedSession;

  if (!session?.tcpSocket || !session.connected) {
    sendServerEvent(ws, {
      type: "error",
      payload: { message: "You are not connected to a MUD yet." },
    });
    return;
  }

  const trimmedCommand = command?.trim();

  if (!trimmedCommand) {
    return;
  }

  if (trimmedCommand.startsWith("#go ")) {
    const dir = trimmedCommand.slice(4).trim();
    const mudCmd = combatState.getInCombat() ? `беж ${dir}` : `краст ${dir}`;
    mudConnection.writeAndLogMudCommand(ws, session.tcpSocket!, mudCmd, "browser");
    return;
  }

  mudConnection.writeAndLogMudCommand(ws, session.tcpSocket!, trimmedCommand, "browser");
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function getStaticFile(pathname: string): Bun.BunFile {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  return Bun.file(new URL(`../public${safePath}`, import.meta.url));
}

function resetMapState(): void {
  parserState.lineBuffer = "";
  parserState.pendingRoomHeader = null;
  trackerState.currentRoomId = null;
  trackerState.pendingMove = null;
  farm2Controller.setEnabled(false);
}

async function getCurrentMapSnapshot(): Promise<MapSnapshot> {
  return mapStore.getSnapshot(trackerState.currentRoomId);
}

async function sendMapSnapshot(ws: BunServerWebSocket): Promise<void> {
  sendServerEvent(ws, {
    type: "map_snapshot",
    payload: await getCurrentMapSnapshot(),
  });

  const aliases = await mapStore.getAliases();
  sendServerEvent(ws, {
    type: "aliases_snapshot",
    payload: { aliases },
  });

  const autoCommandEntries = await mapStore.getRoomAutoCommands();
  sendServerEvent(ws, {
    type: "room_auto_commands_snapshot",
    payload: { entries: autoCommandEntries },
  });

  sendServerEvent(ws, {
    type: "navigation_state",
    payload: {
      active: navigationState.active,
      targetVnum: navigationState.targetVnum,
      totalSteps: navigationState.steps.length,
      currentStep: navigationState.currentStep,
    },
  });
}

async function broadcastMapSnapshot(type: "map_snapshot" | "map_update"): Promise<void> {
  broadcastServerEvent({
    type,
    payload: await getCurrentMapSnapshot(),
  });
}

function broadcastNavigationState(): void {
  broadcastServerEvent({
    type: "navigation_state",
    payload: {
      active: navigationState.active,
      targetVnum: navigationState.targetVnum,
      totalSteps: navigationState.steps.length,
      currentStep: navigationState.currentStep,
    },
  });
}

async function broadcastAliasesSnapshot(): Promise<void> {
  const aliases = await mapStore.getAliases();
  broadcastServerEvent({
    type: "aliases_snapshot",
    payload: { aliases },
  });
}

async function broadcastRoomAutoCommandsSnapshot(): Promise<void> {
  const entries = await mapStore.getRoomAutoCommands();
  broadcastServerEvent({
    type: "room_auto_commands_snapshot",
    payload: { entries },
  });
}

function stopNavigation(): void {
  if (navigationState.abortController) {
    navigationState.abortController.abort();
    navigationState.abortController = null;
  }
  navigationState.active = false;
  navigationState.targetVnum = null;
  navigationState.steps = [];
  navigationState.currentStep = 0;
  broadcastNavigationState();
}

const DIRECTION_TO_COMMAND: Record<Direction, string> = {
  north: "с",
  south: "ю",
  east: "в",
  west: "з",
  up: "вв",
  down: "вн",
};

async function startNavigation(ws: BunServerWebSocket | null, targetVnum: number): Promise<void> {
  stopNavigation();

  const currentVnum = trackerState.currentRoomId;
  if (currentVnum === null) {
    broadcastServerEvent({
      type: "status",
      payload: { state: sharedSession.state, message: "Навигация: текущая комната неизвестна." },
    });
    return;
  }

  const snapshot = await mapStore.getSnapshot(currentVnum);
  const path = findPath(snapshot, currentVnum, targetVnum);

  if (!path || path.length === 0) {
    broadcastServerEvent({
      type: "status",
      payload: { state: sharedSession.state, message: "Навигация: путь не найден." },
    });
    return;
  }

  const abort = new AbortController();
  navigationState.active = true;
  navigationState.targetVnum = targetVnum;
  navigationState.steps = path;
  navigationState.currentStep = 0;
  navigationState.abortController = abort;
  broadcastNavigationState();

  for (let i = 0; i < path.length; i++) {
    if (abort.signal.aborted) return;

      const step = path[i]!;
      navigationState.currentStep = i;
      broadcastNavigationState();

      if (!sharedSession.tcpSocket || !sharedSession.connected) {
        stopNavigation();
        return;
      }

      mudConnection.writeAndLogMudCommand(ws, sharedSession.tcpSocket!, DIRECTION_TO_COMMAND[step.direction], "navigation");

      const arrived = await onceRoomChanged(NAVIGATION_STEP_TIMEOUT_MS);

      if (abort.signal.aborted) return;

      if (arrived === null) {
        stopNavigation();
        broadcastServerEvent({
          type: "status",
          payload: { state: sharedSession.state, message: "Навигация: нет ответа от сервера, остановлено." },
        });
        return;
      }

      if (arrived !== step.expectedVnum) {
        stopNavigation();
        broadcastServerEvent({
          type: "status",
          payload: {
            state: sharedSession.state,
            message: `Навигация: ожидалась комната ${step.expectedVnum}, оказались в ${arrived}. Остановлено.`,
          },
        });
        return;
      }
    }

    if (!abort.signal.aborted) {
      navigationState.currentStep = path.length;
      broadcastNavigationState();
      broadcastServerEvent({
        type: "status",
        payload: { state: sharedSession.state, message: "Навигация: цель достигнута." },
      });
      navigationState.active = false;
      navigationState.abortController = null;
      broadcastNavigationState();
    }
}

async function startNavigationToNearest(ws: BunServerWebSocket | null, targetVnums: number[]): Promise<void> {
  const currentVnum = trackerState.currentRoomId;
  if (currentVnum === null) {
    broadcastServerEvent({ type: "status", payload: { state: sharedSession.state, message: "Навигация: текущая комната неизвестна." } });
    return;
  }
  if (targetVnums.includes(currentVnum)) {
    broadcastServerEvent({ type: "status", payload: { state: sharedSession.state, message: "Навигация: уже в целевой комнате." } });
    return;
  }
  const snapshot = await mapStore.getSnapshot(currentVnum);
  let bestVnum: number | null = null;
  let bestLen = Infinity;
  for (const vnum of targetVnums) {
    const path = findPath(snapshot, currentVnum, vnum);
    if (path !== null && path.length < bestLen) {
      bestLen = path.length;
      bestVnum = vnum;
    }
  }
  if (bestVnum === null) {
    broadcastServerEvent({ type: "status", payload: { state: sharedSession.state, message: "Навигация: путь не найден." } });
    return;
  }
  await startNavigation(ws, bestVnum);
}

async function inspectContainer(ws: BunServerWebSocket | null, container: string): Promise<string> {
  if (!sharedSession.tcpSocket || !sharedSession.connected) {
    return "";
  }
  const result = containerTracker.waitForInspectResult(2000);
  mudConnection.writeAndLogMudCommand(ws, sharedSession.tcpSocket!, `осм ${container}`, "inspect-container");
  return result;
}

async function inspectInventory(ws: BunServerWebSocket | null): Promise<string> {
  if (!sharedSession.tcpSocket || !sharedSession.connected) {
    return "";
  }
  const result = containerTracker.waitForInspectResult(2000);
  mudConnection.writeAndLogMudCommand(ws, sharedSession.tcpSocket!, "инв", "inspect-inventory");
  return result;
}

function scheduleSurvivalTick(delayMs: number): void {
  if (survivalTickTimer !== null) return;
  survivalTickTimer = setTimeout(() => {
    survivalTickTimer = null;
    if (survivalTickRunning) return;
    survivalTickRunning = true;
    void survivalController.runTick((d) => scheduleSurvivalTick(d)).finally(() => {
      survivalTickRunning = false;
    });
  }, Math.max(0, delayMs));
}

function clearSurvivalTickTimer(): void {
  if (survivalTickTimer !== null) {
    clearTimeout(survivalTickTimer);
    survivalTickTimer = null;
  }
}

async function persistParsedMapData(text: string, ws: BunServerWebSocket | null): Promise<void> {
  parseAndBroadcastStats(text);

  combatState.handleMudText(text);
  triggers.handleMudText(text);
  survivalController.handleMudText(text);
  gatherController.handleMudText(text);

  const stripped = text.replace(ANSI_ESCAPE_REGEXP, "");
  const { enteredCombat, exitedCombat } = combatState.getTransition();

  if (enteredCombat) {
    triggers.onCombatStart();
    broadcastServerEvent({ type: "combat_state", payload: { inCombat: true } });
  } else if (exitedCombat) {
    triggers.onCombatEnd();
    broadcastServerEvent({ type: "combat_state", payload: { inCombat: false } });
  }

  if (exitedCombat) {
    scheduleSurvivalTick(50);
  } else if (!combatState.getInCombat()) {
    scheduleSurvivalTick(150);
  }

  void itemIdentifier.handleChunk(text).catch((error: unknown) => {
    logEvent(ws, "error", error instanceof Error ? `Item parser error: ${error.message}` : "Item parser error.");
  });
  const events = feedText(parserState, text);
  const previousRoomId = trackerState.currentRoomId;

  const mobsInRoom: string[] = [];
  let corpseCount = 0;
  for (const event of events) {
    if (event.kind === "mobs_in_room") {
      for (const name of event.mobs) {
        if (!mobsInRoom.includes(name)) mobsInRoom.push(name);
      }
    }
    if (event.kind === "corpses_in_room") {
      corpseCount += event.count;
    }
  }

  const roomEvent = events.find((event) => event.kind === "room");
  if (roomEvent?.kind === "room") {
    logEvent(null, "session", `[zone-debug] parsed room event vnum=${roomEvent.room.vnum} mobs=[${mobsInRoom.join(" | ")}]`);
  }

  if (events.some((e) => e.kind === "room")) {
    currentRoomMobs.clear();
    for (const name of mobsInRoom) {
      currentRoomMobs.set(name.toLowerCase(), name);
    }
    logEvent(
      null,
      "session",
      `[zone-debug] currentRoomMobs updated room=${trackerState.currentRoomId} values=[${[...currentRoomMobs.values()].join(" | ")}]`,
    );
    for (const listener of roomRefreshListeners) {
      listener(trackerState.currentRoomId);
    }
  }

  const strippedText = text.replace(ANSI_ESCAPE_REGEXP, "");
  const vnumAtCombatSave = trackerState.currentRoomId;
  const combatMobNames: string[] = [];
  for (const line of strippedText.split("\n")) {
    const blocks = [...line.matchAll(COMBAT_PROMPT_MOB_REGEXP)];
    if (blocks.length < 2) continue;
    for (const match of blocks.slice(1)) {
      const mobName = match[1].trim();
      if (mobName && !combatMobNames.includes(mobName)) {
        combatMobNames.push(mobName);
        void mapStore.saveMobCombatName(mobName, vnumAtCombatSave).catch((error: unknown) => {
          logEvent(ws, "error", error instanceof Error ? `Mob combat name save error: ${error.message}` : "Mob combat name save error.");
        });
      }
    }
  }

  if (events.length === 0) {
    farm2Controller.handleMudText(text, {
      roomChanged: false,
      roomDescriptionReceived: false,
      currentRoomId: trackerState.currentRoomId,
      mobsInRoom: [],
      combatMobNames,
      corpseCount: 0,
    });
    return;
  }

  const result = processParsedEvents(trackerState, events);

  if (mapRecordingEnabled) {
    for (const room of result.rooms) {
      await mapStore.upsertRoom(room.vnum, room.name, room.exits, room.closedExits);
    }

    for (const edge of result.edges) {
      await mapStore.upsertEdge(edge);
    }
  }

  await broadcastMapSnapshot("map_update");

  if (result.rooms.length > 0 || result.edges.length > 0) {
    logEvent(ws, "session", "Automapper updated.", {
      rooms: result.rooms.length,
      edges: result.edges.length,
      currentVnum: result.currentVnum,
    });
  }

  mover.onTrackerResult({
    currentVnum: trackerState.currentRoomId,
    previousVnum: previousRoomId,
    movementBlocked: result.movementBlocked,
    roomDescriptionReceived: result.rooms.length > 0,
    visibleMobNames: mobsInRoom,
  });

  if (result.rooms.length > 0) {
    logEvent(
      null,
      "session",
      `[zone-debug] mover feedback current=${trackerState.currentRoomId} previous=${previousRoomId} roomDescriptionReceived=${result.rooms.length > 0} visibleMobNames=[${mobsInRoom.join(" | ")}]`,
    );
  }

  farm2Controller.handleMudText(text, {
    roomChanged: previousRoomId !== trackerState.currentRoomId,
    roomDescriptionReceived: result.rooms.length > 0,
    currentRoomId: trackerState.currentRoomId,
    mobsInRoom,
    combatMobNames,
    corpseCount,
  });

  if (trackerState.currentRoomId !== null && trackerState.currentRoomId !== previousRoomId) {
    const vnum = trackerState.currentRoomId;
    for (const listener of roomChangedListeners) {
      listener(vnum);
    }
  }
}

await mapStore.initialize();

const savedSurvival = await mapStore.getSurvivalSettings();
if (savedSurvival) {
  const normalizedSavedSurvival = normalizeSurvivalSettings(savedSurvival);
  survivalController.updateConfig(normalizeSurvivalConfig({
    enabled: normalizedSavedSurvival.foodItems.trim().length > 0 || normalizedSavedSurvival.flaskItems.trim().length > 0,
    container: normalizedSavedSurvival.container,
    foodItems: normalizedSavedSurvival.foodItems.split("\n").map(s => s.trim()).filter(Boolean),
    flaskItems: normalizedSavedSurvival.flaskItems.split("\n").map(s => s.trim()).filter(Boolean),
    buyFoodItem: normalizedSavedSurvival.buyFoodItem,
    buyFoodMax: normalizedSavedSurvival.buyFoodMax,
    buyFoodAlias: normalizedSavedSurvival.buyFoodAlias,
    fillFlaskAlias: normalizedSavedSurvival.fillFlaskAlias,
    fillFlaskSource: normalizedSavedSurvival.fillFlaskSource,
  }));
}

const savedTriggers = await mapStore.getTriggerSettings(activeProfileId);
if (savedTriggers) {
  triggers.setEnabled(savedTriggers);
}

roomChangedListeners.add((vnum: number) => {
  void mapStore.getRoomAutoCommand(vnum).then((command) => {
    if (command && sharedSession.tcpSocket && sharedSession.connected) {
      const lines = command.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, line, "room-auto-cmd");
      }
    }
  });
});

const server = Bun.serve({
  hostname: runtimeConfig.host,
  port: runtimeConfig.port,
  async fetch(req, serverInstance) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      logEvent(null, "session", "WebSocket upgrade requested.", {
        path: url.pathname,
      });
      const upgraded = serverInstance.upgrade(req, {
        data: {
          sessionId: crypto.randomUUID(),
        } satisfies WsData,
      });

      if (upgraded) {
        return undefined;
      }

      return new Response("WebSocket upgrade failed.", { status: 500 });
    }

    if (url.pathname === "/api/config") {
      return jsonResponse({
        autoConnect: runtimeConfig.autoConnect,
        host: runtimeConfig.mudHost,
        port: runtimeConfig.mudPort,
        tls: runtimeConfig.mudTls,
        startupCommands: runtimeConfig.startupCommands,
        commandDelayMs: runtimeConfig.commandDelayMs,
      });
    }

    if (url.pathname === "/api/profiles") {
      return jsonResponse({
        profiles: runtimeConfig.profiles.map((p) => ({ id: p.id, name: p.name })),
        defaultProfileId: runtimeConfig.defaultProfileId,
      });
    }

    if (url.pathname === "/api/map/snapshot") {
      return jsonResponse(await getCurrentMapSnapshot());
    }

    if (url.pathname.includes("..")) {
      return new Response("Invalid path.", { status: 400 });
    }

    const file = getStaticFile(url.pathname);
    return file.exists().then((exists) => {
      if (!exists) {
        return new Response("Not found.", { status: 404 });
      }

      const response = new Response(file);
      response.headers.set("cache-control", "no-store");
      return response;
    });
  },
  websocket: {
    data: {} as WsData,
    open(ws) {
      browserClients.add(ws);
      logEvent(ws, "session", "Browser WebSocket opened.");
      sendDefaults(ws);
      sendServerEvent(ws, {
        type: "status",
        payload: {
          state: sharedSession.state,
          message: sharedSession.statusMessage,
        },
      });

      if (recentOutputChunks.length > 0) {
        sendServerEvent(ws, {
          type: "output",
          payload: {
            text: recentOutputChunks.join(""),
          },
        });
      }

      void mapStore.getRecentChatMessages().then((messages) => {
        if (messages.length > 0) {
          sendServerEvent(ws, { type: "chat_history", payload: { messages } });
        }
      }).catch((error: unknown) => {
        logEvent(ws, "error", error instanceof Error ? `Chat history error: ${error.message}` : "Chat history error.");
      });

      void sendMapSnapshot(ws);
      void sendSurvivalSettings(ws);
    },
    async message(ws, message) {
      let event: ClientEvent;

      try {
        event = JSON.parse(normalizeTextMessage(message)) as ClientEvent;
      } catch {
        logEvent(ws, "error", "Invalid browser message payload.");
        sendServerEvent(ws, {
          type: "error",
          payload: { message: "Invalid message payload." },
        });
        return;
      }

      switch (event.type) {
        case "connect":
          logEvent(ws, "browser-in", "connect");
          if (event.payload?.profileId) {
            activeProfileId = event.payload.profileId;
            saveLastProfileId(event.payload.profileId);
          }
          await mudConnection.connectToMud(ws, event.payload);
          void mapStore.getTriggerSettings(activeProfileId).then((saved) => {
            if (saved) triggers.setEnabled(saved);
          }).catch((error: unknown) => {
            logEvent(ws, "error", error instanceof Error ? error.message : "Unknown error loading trigger settings");
          });
          break;
        case "send":
          logEvent(ws, "browser-in", sanitizeLogText(event.payload?.command?.trim() || ""), {
            type: "send",
          });
          handleSendCommand(ws, event.payload?.command);
          break;
        case "disconnect":
          logEvent(ws, "browser-in", "disconnect");
          mudConnection.teardownSession(ws, "Disconnected by user.");
          break;
        case "map_reset":
          logEvent(ws, "browser-in", "map_reset");
          resetMapState();
          await mapStore.reset();
          await broadcastMapSnapshot("map_snapshot");
          break;
        case "map_reset_area": {
          logEvent(ws, "browser-in", "map_reset_area");
          const currentVnum = trackerState.currentRoomId;
          if (currentVnum !== null) {
            const zoneId = Math.floor(currentVnum / 100);
            await mapStore.deleteZone(zoneId);
            trackerState.currentRoomId = null;
            await broadcastMapSnapshot("map_snapshot");
          }
          break;
        }
        case "map_recording_toggle": {
          mapRecordingEnabled = event.payload?.enabled ?? !mapRecordingEnabled;
          logEvent(ws, "browser-in", "map_recording_toggle", { enabled: mapRecordingEnabled });
          broadcastServerEvent({ type: "map_recording_state", payload: { enabled: mapRecordingEnabled } });
          break;
        }
        case "debug_log_toggle": {
          debugLogEnabled = event.payload?.enabled ?? !debugLogEnabled;
          logEvent(ws, "browser-in", "debug_log_toggle", { enabled: debugLogEnabled });
          broadcastServerEvent({ type: "debug_log_state", payload: { enabled: debugLogEnabled } });
          break;
        }
        case "farm2_toggle": {
          const enabled = event.payload?.enabled === true;
          logEvent(ws, "browser-in", "farm2_toggle", { enabled });
          farm2Controller.setEnabled(enabled);
          break;
        }
        case "attack_nearest": {
          logEvent(ws, "browser-in", "attack_nearest");
          const currentRoomId = trackerState.currentRoomId;
          if (currentRoomId !== null && sharedSession.tcpSocket && sharedSession.connected) {
            const target = await farm2Controller.resolveAttackTarget(currentRoomId);
            if (target !== null) {
              mudConnection.writeAndLogMudCommand(ws, sharedSession.tcpSocket, `заколоть ${target}`, "attack-nearest");
            }
          }
          break;
        }
        case "zone_script_toggle": {
          const enabled = event.payload?.enabled === true;
          const zoneId = typeof event.payload?.zoneId === "number" ? event.payload.zoneId : undefined;
          logEvent(ws, "browser-in", "zone_script_toggle", { enabled, zoneId });
          zoneScriptController.setEnabled(enabled, zoneId);
          break;
        }
        case "farming_toggle": {
          const enabled = event.payload?.enabled === true;
          const zoneId = typeof event.payload?.zoneId === "number" ? event.payload.zoneId : 280;
          logEvent(ws, "browser-in", "farming_toggle", { enabled, zoneId });
          zoneScriptController.setEnabled(enabled, zoneId);
          break;
        }
        case "alias_set": {
          const vnum = event.payload?.vnum;
          const alias = event.payload?.alias?.trim();
          if (typeof vnum === "number" && alias) {
            logEvent(ws, "browser-in", "alias_set", { vnum, alias });
            await mapStore.setAlias(vnum, alias);
            await broadcastAliasesSnapshot();
          }
          break;
        }
        case "alias_delete": {
          const vnum = event.payload?.vnum;
          if (typeof vnum === "number") {
            logEvent(ws, "browser-in", "alias_delete", { vnum });
            await mapStore.deleteAlias(vnum);
            await broadcastAliasesSnapshot();
          }
          break;
        }
        case "navigate_to": {
          const vnums = event.payload?.vnums;
          if (Array.isArray(vnums) && vnums.length > 0) {
            logEvent(ws, "browser-in", "navigate_to", { vnums: vnums.join(",") });
            await startNavigationToNearest(ws, vnums);
          }
          break;
        }
        case "goto_and_run": {
          const vnums = event.payload?.vnums;
          const commands = event.payload?.commands;
          if (Array.isArray(vnums) && vnums.length > 0) {
            logEvent(ws, "browser-in", "goto_and_run", { vnums: vnums.join(","), commands: (commands ?? []).join(";") });
            let resolvedCommands: string[] = Array.isArray(commands) ? commands : [];
            const action = event.payload?.action;
            if (action === "buy_food" || action === "fill_flask") {
              const survival = await mapStore.getSurvivalSettings();
              const ss = normalizeSurvivalSettings(survival ?? {});
              const survivalConfig = normalizeSurvivalConfig({
                enabled: true,
                container: ss.container,
                foodItems: ss.foodItems.split("\n").map((s) => s.trim()).filter(Boolean),
                flaskItems: ss.flaskItems.split("\n").map((s) => s.trim()).filter(Boolean),
                buyFoodItem: ss.buyFoodItem,
                buyFoodMax: ss.buyFoodMax,
                buyFoodAlias: ss.buyFoodAlias,
                fillFlaskAlias: ss.fillFlaskAlias,
                fillFlaskSource: ss.fillFlaskSource,
              });
              const result = await resolveSurvivalCommands(
                action,
                survivalConfig,
                (container) => inspectContainer(ws, container),
              );
              if (result === null) {
                const currentCount = "достаточно";
                broadcastServerEvent({
                  type: "status",
                  payload: { state: sharedSession.state, message: `[survival] уже ${currentCount} еды` },
                });
                break;
              }
              resolvedCommands = result;
            }
            await startNavigationToNearest(ws, vnums);
            for (const cmd of resolvedCommands) {
              if (sharedSession.tcpSocket && sharedSession.connected) {
                mudConnection.writeAndLogMudCommand(ws, sharedSession.tcpSocket!, cmd, "goto_and_run");
                await new Promise<void>((resolve) => setTimeout(resolve, runtimeConfig.commandDelayMs));
              }
            }
          }
          break;
        }
        case "navigate_stop": {
          logEvent(ws, "browser-in", "navigate_stop");
          stopNavigation();
          break;
        }
        case "farm_settings_get": {
          const zoneId = event.payload?.zoneId;
          if (typeof zoneId === "number") {
            logEvent(ws, "browser-in", "farm_settings_get", { zoneId });
            const settings = await mapStore.getFarmSettings(activeProfileId, zoneId);
            sendServerEvent(ws, {
              type: "farm_settings_data",
              payload: { zoneId, settings },
            });
          }
          break;
        }
        case "farm_settings_save": {
          const zoneId = event.payload?.zoneId;
          const raw = event.payload?.settings;
          if (typeof zoneId === "number" && raw) {
            const settings = normalizeFarmZoneSettings(raw);
            logEvent(ws, "browser-in", "farm_settings_save", { zoneId });
            await mapStore.setFarmSettings(activeProfileId, zoneId, settings);
          }
          break;
        }
        case "survival_settings_get": {
          logEvent(ws, "browser-in", "survival_settings_get");
          await sendSurvivalSettings(ws);
          break;
        }
        case "survival_settings_save": {
          const raw = event.payload;
          if (raw) {
            const settings = normalizeSurvivalSettings(raw);
            logEvent(ws, "browser-in", "survival_settings_save");
            await mapStore.setSurvivalSettings(settings);
            survivalController.updateConfig(normalizeSurvivalConfig({
              enabled: settings.foodItems.trim().length > 0 || settings.flaskItems.trim().length > 0,
              container: settings.container,
              foodItems: settings.foodItems.split("\n").map(s => s.trim()).filter(Boolean),
              flaskItems: settings.flaskItems.split("\n").map(s => s.trim()).filter(Boolean),
              buyFoodItem: settings.buyFoodItem,
              buyFoodMax: settings.buyFoodMax,
              buyFoodAlias: settings.buyFoodAlias,
              fillFlaskAlias: settings.fillFlaskAlias,
              fillFlaskSource: settings.fillFlaskSource,
            }));
          }
          break;
        }
        case "triggers_toggle": {
          triggers.setEnabled(event.payload ?? {});
          void mapStore.setTriggerSettings(activeProfileId, triggers.getState()).catch((error: unknown) => {
            logEvent(ws, "error", error instanceof Error ? error.message : "Unknown error saving trigger settings");
          });
          break;
        }
        case "gather_toggle": {
          const newEnabled = typeof event.payload?.enabled === "boolean"
            ? event.payload.enabled
            : !gatherController.getState().enabled;
          gatherController.setEnabled(newEnabled);
          logEvent(ws, "browser-in", `gather_toggle enabled=${String(newEnabled)}`);
          broadcastServerEvent({ type: "gather_state", payload: gatherController.getState() });
          break;
        }
        case "gather_sell_bag": {
          logEvent(ws, "browser-in", "gather_sell_bag");
          const { bag } = gatherController.getState();
          if (sharedSession.tcpSocket && sharedSession.connected) {
            mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket, `выставить все ${bag}`, "gather-script");
          }
          break;
        }
        case "inspect_container": {
          const containerKey = event.payload?.container;
          if (containerKey !== "bag" && containerKey !== "chest") break;
          logEvent(ws, "browser-in", `inspect_container: ${containerKey}`);
          if (sharedSession.tcpSocket && sharedSession.connected) {
            const keyword = containerKey === "bag" ? "торб" : "сунду";
            mudConnection.writeAndLogMudCommand(ws, sharedSession.tcpSocket, `осм ${keyword}`, "inspect-container");
          }
          break;
        }
        case "inspect_inventory": {
          logEvent(ws, "browser-in", "inspect_inventory");
          if (sharedSession.tcpSocket && sharedSession.connected) {
            mudConnection.writeAndLogMudCommand(ws, sharedSession.tcpSocket, "инв", "inspect-inventory");
          }
          break;
        }
        case "equipped_scan": {
          logEvent(ws, "browser-in", "equipped_scan");
          if (sharedSession.tcpSocket && sharedSession.connected) {
            containerTracker.startEquippedScan();
            mudConnection.writeAndLogMudCommand(ws, sharedSession.tcpSocket, "equipment", "equipped-scan");
          }
          break;
        }
        case "zone_name_set": {
          const { zoneId, name } = event.payload;
          if (name === null || name === "") {
            await mapStore.deleteZoneName(zoneId);
            logEvent(ws, "browser-in", "zone_name_delete", { zoneId });
          } else {
            await mapStore.setZoneName(zoneId, name);
            logEvent(ws, "browser-in", "zone_name_set", { zoneId, name });
          }
          break;
        }
        case "item_db_get": {
          logEvent(ws, "browser-in", "item_db_get");
          const items = await mapStore.getItems();
          sendServerEvent(ws, { type: "items_data", payload: { items } });
          break;
        }
        case "wiki_item_search": {
          const query = event.payload?.query?.trim() ?? "";
          logEvent(ws, "browser-in", `wiki_item_search: ${query}`);
          if (!query) break;
          try {
            const result = await searchAndCacheWikiItem(query, mapStore, runtimeConfig.wikiProxies);
            sendServerEvent(ws, { type: "wiki_item_search_result", payload: { query, ...result } });
          } catch (err: unknown) {
            sendServerEvent(ws, {
              type: "wiki_item_search_result",
              payload: { query, found: false, error: err instanceof Error ? err.message : "Ошибка поиска" },
            });
          }
          break;
        }
        case "vorozhe_route_find": {
          const from = event.payload?.from?.trim() ?? "";
          const to = event.payload?.to?.trim() ?? "";
          logEvent(ws, "browser-in", `vorozhe_route_find: ${from} → ${to}`);
          if (!from || !to) break;
          const result = findVorozheRoute(from, to);
          sendServerEvent(ws, {
            type: "vorozhe_route_result",
            payload: {
              from,
              to,
              found: result.found,
              steps: result.steps,
              totalItems: result.totalItems as Record<string, number>,
            },
          });
          break;
        }
        case "room_auto_command_set": {
          const vnum = event.payload?.vnum;
          const command = event.payload?.command?.trim();
          if (typeof vnum === "number" && command) {
            logEvent(ws, "browser-in", "room_auto_command_set", { vnum, command });
            await mapStore.setRoomAutoCommand(vnum, command);
            await broadcastRoomAutoCommandsSnapshot();
          }
          break;
        }
        case "room_auto_command_delete": {
          const vnum = event.payload?.vnum;
          if (typeof vnum === "number") {
            logEvent(ws, "browser-in", "room_auto_command_delete", { vnum });
            await mapStore.deleteRoomAutoCommand(vnum);
            await broadcastRoomAutoCommandsSnapshot();
          }
          break;
        }
        case "room_auto_commands_get": {
          logEvent(ws, "browser-in", "room_auto_commands_get");
          const entries = await mapStore.getRoomAutoCommands();
          sendServerEvent(ws, { type: "room_auto_commands_snapshot", payload: { entries } });
          break;
        }
        case "compare_scan_start": {
          logEvent(ws, "browser-in", "compare_scan_start");
          if (!sharedSession.tcpSocket || !sharedSession.connected) {
            sendServerEvent(ws, { type: "error", payload: { message: "Не подключены к MUD." } });
            break;
          }
          void runCompareScan({
            sendCommand: (cmd) => mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, cmd, "compare-scan"),
            registerTextHandler: (h) => mudTextHandlers.add(h),
            unregisterTextHandler: (h) => mudTextHandlers.delete(h),
            onProgress: (msg) => { logEvent(ws, "browser-out", `[compare-scan] ${msg}`); broadcastServerEvent({ type: "compare_scan_progress", payload: { message: msg } }); },
            waitForOutput: (_ms) => Promise.resolve(""),
            cancelWait: () => {},
            getItemByName: (name) => mapStore.getItemByName(name),
            upsertItem: (name, itemType, data, hasWikiData, hasGameData) => mapStore.upsertItem(name, itemType, data, hasWikiData, hasGameData),
            wikiProxies: runtimeConfig.wikiProxies,
          }).then((result) => {
            broadcastServerEvent({ type: "compare_scan_result", payload: result });
          }).catch((err: unknown) => {
            broadcastServerEvent({ type: "error", payload: { message: err instanceof Error ? err.message : "Ошибка сравнятора." } });
          });
          break;
        }
        case "compare_apply": {
          logEvent(ws, "browser-in", `compare_apply: ${event.payload.commands.join(" ; ")}`);
          if (!sharedSession.tcpSocket || !sharedSession.connected) {
            sendServerEvent(ws, { type: "error", payload: { message: "Не подключены к MUD." } });
            break;
          }
          const compareSocket = sharedSession.tcpSocket;
          for (const cmd of event.payload.commands) {
            mudConnection.writeAndLogMudCommand(null, compareSocket, cmd, "compare-apply");
          }
          break;
        }
        case "repair_start": {
          logEvent(ws, "browser-in", "repair_start");
          void repairController.run();
          break;
        }
      }
    },
    close(ws) {
      logEvent(ws, "session", "Browser WebSocket closed.");
      browserClients.delete(ws);
    },
  },
});

logEvent(null, "session", `MUD client server listening on http://${server.hostname}:${server.port}`);
console.log(`MUD client server listening on http://${server.hostname}:${server.port}`);

if (runtimeConfig.autoConnect) {
  void mudConnection.connectToMud(null, { profileId: readLastProfileId() });
}
