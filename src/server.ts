import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runtimeConfig } from "./config";
import { profiles } from "./profiles";
import { sql } from "./db";
import { createCombatState } from "./combat-state";
import { createFarmController } from "./farm-script";
import { createSurvivalController, normalizeSurvivalConfig, parseInspectItems } from "./survival-script";
import { findPath } from "./map/pathfinder";
import type { PathStep } from "./map/pathfinder";
import { createParserState, feedText } from "./map/parser";
import { createMapStore } from "./map/store";
import { createTrackerState, processParsedEvents, trackOutgoingCommand } from "./map/tracker";
import type { Direction } from "./map/types";
import { createTriggers } from "./triggers";
import { runGearScan } from "./gear-scan";
import { runBazaarScan } from "./bazaar-scan";
import { fetchWiki, parseSearchResults, parseGearItemCard, gearItemCardToData, parseWikiItemCard, parseMudIdentifyBlock, mergeItemSources, gearItemCardFromCache } from "./wiki";
import { createRepairController } from "./repair-script";
import { createSpellController } from "./spell-script";
import { createSneakController } from "./sneak-script";
import type { WsData, ConnectPayload, ClientEvent, ServerEvent, FarmZoneSettings, SurvivalSettings, AutoSpellsSettings, SneakSettings, TriggerState, MapAlias, MapSnapshot, PeriodicActionConfig, GearScanRow, SellItem, GameItem } from "./events.type.ts";
import { normalizeFarmZoneSettings, normalizeSurvivalSettings, normalizeAutoSpellsSettings, normalizeSneakSettings } from "./settings-normalizers.ts";

type MudSocket = Awaited<ReturnType<typeof Bun.connect>>;
type BunServerWebSocket = Bun.ServerWebSocket<WsData>;

const IAC = 255;

const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;
const STARTUP_COMMAND_FALLBACK_MS = 1200;
const LOG_DIR = "/var/log/bylins-bot";
const LOG_FILE = `${LOG_DIR}/mud-traffic.log`;
const LAST_PROFILE_FILE = `${LOG_DIR}/last-profile.txt`;
const MAX_OUTPUT_CHUNKS = 200;
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

interface Session {
  decoder: TextDecoder;
  tcpSocket?: MudSocket;
  connected: boolean;
  state: "idle" | "connecting" | "connected" | "disconnected" | "error";
  statusMessage: string;
  connectAttemptId: number;
  startupPlan?: StartupPlan;
  telnetState: TelnetState;
  mudTarget?: string;
}

interface StartupPlan {
  commands: string[];
  delayMs: number;
  sent: boolean;
  fallbackTimer?: ReturnType<typeof setTimeout>;
}

interface TelnetState {
  mode: "data" | "iac" | "iac_option" | "subnegotiation" | "subnegotiation_iac";
  negotiationCommand?: number;
}

const browserClients = new Set<BunServerWebSocket>();
const sharedSession = createSession();
let activeProfileId: string = readLastProfileId();
const recentOutputChunks: string[] = [];
const parserState = createParserState();
const trackerState = createTrackerState();
let mapRecordingEnabled = true;
const mapStore = createMapStore(sql);
const combatState = createCombatState();
const farmController = createFarmController({
  getCurrentRoomId: () => trackerState.currentRoomId,
  isConnected: () => sharedSession.connected && Boolean(sharedSession.tcpSocket),
  getSnapshot: (currentVnum) => mapStore.getSnapshot(currentVnum),
  combatState,
  sendCommand: (command) => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) {
      return;
    }

    writeAndLogMudCommand(null, sharedSession, sharedSession.tcpSocket, command, "farm-script");
  },
  requestRoomScan: () => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) {
      return;
    }

    writeAndLogMudCommand(null, sharedSession, sharedSession.tcpSocket, "см", "farm-script");
  },
  resolveAlias: async (alias) => {
    const aliases = await mapStore.getAliases();
    const entry = aliases.find((a) => a.alias.toLowerCase() === alias.toLowerCase());
    return entry?.vnum ?? null;
  },
  resolveAliasAll: (alias) => mapStore.resolveAliasAll(alias),
  navigateTo: (vnum) => startNavigation(null, vnum),
  onStateChange: (farmState) => {
    broadcastServerEvent({
      type: "farm_state",
      payload: farmState,
    });
  },
  onLog: (message) => {
    appendLogLine(`[${new Date().toISOString()}] session=system direction=session message=${JSON.stringify(message)}`);
    broadcastServerEvent({
      type: "status",
      payload: {
        state: sharedSession.state,
        message,
      },
    });
  },
});
const survivalController = createSurvivalController({
  getCurrentRoomId: () => trackerState.currentRoomId,
  sendCommand: (command) => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    writeAndLogMudCommand(null, sharedSession, sharedSession.tcpSocket, command, "survival-script");
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
    writeAndLogMudCommand(null, sharedSession, sharedSession.tcpSocket, command, "repair-script");
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

const spellController = createSpellController({
  sendCommand: (command) => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    writeAndLogMudCommand(null, sharedSession, sharedSession.tcpSocket, command, "spell-script");
  },
  isInCombat: () => combatState.getInCombat(),
  onLog: (message) => {
    appendLogLine(`[${new Date().toISOString()}] session=system direction=session message=${JSON.stringify(message)}`);
    broadcastServerEvent({
      type: "status",
      payload: { state: sharedSession.state, message },
    });
  },
});

const sneakController = createSneakController({
  sendCommand: (command) => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    writeAndLogMudCommand(null, sharedSession, sharedSession.tcpSocket, command, "sneak-script");
  },
  onLog: (message) => {
    appendLogLine(`[${new Date().toISOString()}] session=system direction=session message=${JSON.stringify(message)}`);
    broadcastServerEvent({
      type: "status",
      payload: { state: sharedSession.state, message },
    });
  },
  isInCombat: () => combatState.getInCombat(),
});

mkdirSync(LOG_DIR, { recursive: true });
appendFileSync(LOG_FILE, "");

const triggers = createTriggers({
  sendCommand: (command) => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    writeAndLogMudCommand(null, sharedSession, sharedSession.tcpSocket, command, "triggers");
  },
  onStateChange: (state) => {
    broadcastServerEvent({ type: "triggers_state", payload: state });
  },
  onLog: (message) => {
    logEvent(null, "session", message);
  },
  isInCombat: () => combatState.getInCombat(),
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
const mudTextHandlers = new Set<(text: string) => void>();

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
const PROMPT_STATS_REGEXP = /(\d+)H\s+(\d+)M\s+\d+o\s+Зауч:\d+/;
const ANSI_ESCAPE_REGEXP = /\u001b\[[0-9;]*m/g;

let statsHp = 0;
let statsHpMax = 0;
let statsEnergy = 0;
let statsEnergyMax = 0;

let pendingContainerInspectResolve: ((text: string) => void) | null = null;
let pendingContainerInspectTimer: ReturnType<typeof setTimeout> | null = null;
let pendingContainerInspectBuffer = "";

let survivalTickTimer: ReturnType<typeof setTimeout> | null = null;
let survivalPreviousInCombat = false;
let survivalTickRunning = false;

function clearPendingContainerInspect(): void {
  if (pendingContainerInspectTimer !== null) {
    clearTimeout(pendingContainerInspectTimer);
    pendingContainerInspectTimer = null;
  }
  pendingContainerInspectResolve = null;
  pendingContainerInspectBuffer = "";
}

function resolvePendingContainerInspect(text: string): void {
  if (pendingContainerInspectResolve === null) return;
  pendingContainerInspectBuffer += text;
  const stripped = pendingContainerInspectBuffer.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");
  if (!/\d+H\s+\d+M\b/i.test(stripped)) return;
  const resolve = pendingContainerInspectResolve;
  clearPendingContainerInspect();
  resolve(stripped);
}

function waitForContainerInspectResult(timeoutMs = 3000): Promise<string> {
  clearPendingContainerInspect();
  return new Promise((resolve) => {
    pendingContainerInspectResolve = resolve;
    pendingContainerInspectTimer = setTimeout(() => {
      const buf = pendingContainerInspectBuffer;
      clearPendingContainerInspect();
      resolve(buf);
    }, timeoutMs);
  });
}

// ── Item identify parser ──────────────────────────────────────────────────────
// Collects MUD text chunks into a rolling buffer to detect multi-line identify
// blocks ("Вы узнали следующее:") and persist them to game_items.
const ITEM_IDENTIFY_START = /Вы узнали следующее:/;
const ITEM_BUFFER_MAX = 4096;
let itemBuffer = "";

async function handleItemIdentifyBuffer(chunk: string): Promise<void> {
  itemBuffer += chunk;
  if (itemBuffer.length > ITEM_BUFFER_MAX) {
    itemBuffer = itemBuffer.slice(-ITEM_BUFFER_MAX);
  }

  if (!ITEM_IDENTIFY_START.test(itemBuffer)) return;

  const startIdx = itemBuffer.search(ITEM_IDENTIFY_START);
  const afterStart = itemBuffer.slice(startIdx);

  const endMatch = /\n(?=\S*\d+H\s|\S*Вых:|\s*$)/.exec(afterStart.slice(afterStart.indexOf("\n") + 1));
  if (!endMatch && itemBuffer.length < ITEM_BUFFER_MAX) return;

  const block = endMatch
    ? afterStart.slice(0, afterStart.indexOf("\n") + 1 + endMatch.index + 1)
    : afterStart;

  itemBuffer = itemBuffer.slice(startIdx + block.length);

  const mudParsed = parseMudIdentifyBlock(block);
  if (!mudParsed) return;

  const nameLower = mudParsed.name.toLowerCase();

  const existing = await mapStore.getItemByName(nameLower);
  const baseCard = existing
    ? gearItemCardFromCache(existing.name, existing.itemType, existing.data as Record<string, unknown>)
    : null;

  let wikiCard = null;
  try {
    const proxy = runtimeConfig.wikiProxies[0];
    const searchHtml = await fetchWiki({ q: mudParsed.name }, proxy);
    const results = parseSearchResults(searchHtml);
    const hit = results.find(r => r.name.toLowerCase() === nameLower) ?? results[0] ?? null;
    if (hit) {
      const cardHtml = await fetchWiki({ id: String(hit.id) }, proxy);
      wikiCard = parseGearItemCard(cardHtml, hit.id);
    }
  } catch {
  }

  const merged = mergeItemSources(baseCard, wikiCard, mudParsed.partial);
  if (!merged) return;

  await mapStore.upsertItem(nameLower, mudParsed.itemType, gearItemCardToData(merged));
}
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
    if (newHp !== statsHp || newEnergy !== statsEnergy) {
      statsHp = newHp;
      statsEnergy = newEnergy;
      changed = true;
    }
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

    farmController.updateStats({
      hp: statsHp,
      hpMax: statsHpMax,
      energy: statsEnergy,
      energyMax: statsEnergyMax,
    });
  }
}

function createSession(): Session {
  return {
    decoder: new TextDecoder(),
    connected: false,
    state: "idle",
    statusMessage: runtimeConfig.autoConnect ? "Auto-connect is enabled. Waiting for MUD connection." : "Ready to connect.",
    connectAttemptId: 0,
    telnetState: createTelnetState(),
  };
}

function createTelnetState(): TelnetState {
  return {
    mode: "data",
  };
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

async function sendAutoSpellsSettings(ws: BunServerWebSocket): Promise<void> {
  const settings = await mapStore.getAutoSpellsSettings(activeProfileId);
  sendServerEvent(ws, { type: "auto_spells_settings_data", payload: settings });
}

async function sendSneakSettings(ws: BunServerWebSocket): Promise<void> {
  const settings = await mapStore.getSneakSettings(activeProfileId);
  sendServerEvent(ws, { type: "sneak_settings_data", payload: settings });
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
    type: "farm_state",
    payload: farmController.getState(),
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
}

function normalizeTextMessage(message: string | ArrayBuffer | Uint8Array): string {
  if (typeof message === "string") {
    return message;
  }

  return new TextDecoder().decode(message);
}

function normalizeConnectPayload(payload: ConnectPayload | undefined) {
  const profile = payload?.profileId
    ? (profiles.find((p) => p.id === payload.profileId) ?? null)
    : null;

  const defaultStartupCommands = profile?.startupCommands ?? runtimeConfig.startupCommands;
  const defaultCommandDelayMs = profile?.commandDelayMs ?? runtimeConfig.commandDelayMs;

  return {
    host: payload?.host?.trim() || runtimeConfig.mudHost,
    port: Number.isFinite(payload?.port) ? Number(payload?.port) : runtimeConfig.mudPort,
    tls: payload?.tls ?? runtimeConfig.mudTls,
    startupCommands:
      payload?.startupCommands
        ?.map((command) => command.trim())
        .filter((command) => command.length > 0) ?? defaultStartupCommands,
    commandDelayMs:
      typeof payload?.commandDelayMs === "number" && payload.commandDelayMs >= 0
        ? payload.commandDelayMs
        : defaultCommandDelayMs,
  };
}

function writeMudCommand(socket: MudSocket, command: string): void {
  socket.write(`${command}${runtimeConfig.lineEnding}`);
}

function writeAndLogMudCommand(ws: BunServerWebSocket | null, session: Session, socket: MudSocket, command: string, source: string): void {
  trackOutgoingCommand(trackerState, command);
  writeMudCommand(socket, command);
  logEvent(ws, "mud-out", sanitizeLogText(command), {
    source,
    target: session.mudTarget ?? null,
  });
}

function clearStartupFallback(session: Session): void {
  if (session.startupPlan?.fallbackTimer) {
    clearTimeout(session.startupPlan.fallbackTimer);
    session.startupPlan.fallbackTimer = undefined;
  }
}

function isCurrentAttempt(session: Session, attemptId: number): boolean {
  return session.connectAttemptId === attemptId;
}

function respondToTelnetNegotiation(socket: MudSocket, command: number, option: number): void {
  const responseCommand = command === DO || command === DONT ? WONT : DONT;
  socket.write(Uint8Array.of(IAC, responseCommand, option));
}

function decodeMudData(session: Session, socket: MudSocket, data: string | ArrayBuffer | Uint8Array): string {
  const source = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const decodedBytes: number[] = [];

  for (const byte of source) {
    switch (session.telnetState.mode) {
      case "data": {
        if (byte === IAC) {
          session.telnetState.mode = "iac";
        } else {
          decodedBytes.push(byte);
        }
        break;
      }
      case "iac": {
        if (byte === IAC) {
          decodedBytes.push(byte);
          session.telnetState.mode = "data";
        } else if (byte === DO || byte === DONT || byte === WILL || byte === WONT) {
          session.telnetState.negotiationCommand = byte;
          session.telnetState.mode = "iac_option";
        } else if (byte === SB) {
          session.telnetState.mode = "subnegotiation";
        } else {
          session.telnetState.mode = "data";
        }
        break;
      }
      case "iac_option": {
        if (session.telnetState.negotiationCommand !== undefined) {
          respondToTelnetNegotiation(socket, session.telnetState.negotiationCommand, byte);
        }

        session.telnetState.negotiationCommand = undefined;
        session.telnetState.mode = "data";
        break;
      }
      case "subnegotiation": {
        if (byte === IAC) {
          session.telnetState.mode = "subnegotiation_iac";
        }
        break;
      }
      case "subnegotiation_iac": {
        session.telnetState.mode = byte === SE ? "data" : "subnegotiation";
        break;
      }
    }
  }

  if (decodedBytes.length === 0) {
    return "";
  }

  return session.decoder.decode(Uint8Array.from(decodedBytes), { stream: true });
}

function beginAttempt(session: Session, commands: string[], delayMs: number): number {
  session.connectAttemptId += 1;
  session.connected = false;
  session.state = "connecting";
  session.statusMessage = session.mudTarget ? `Connecting to ${session.mudTarget}...` : "Connecting to MUD...";
  session.decoder = new TextDecoder();
  session.telnetState = createTelnetState();
  clearStartupFallback(session);
  session.startupPlan = {
    commands,
    delayMs,
    sent: false,
  };
  return session.connectAttemptId;
}

async function flushStartupCommands(
  ws: BunServerWebSocket | null,
  session: Session,
  attemptId: number,
  reason?: string,
): Promise<void> {
  if (!isCurrentAttempt(session, attemptId) || !session.connected || !session.tcpSocket || !session.startupPlan || session.startupPlan.sent) {
    return;
  }

  clearStartupFallback(session);
  session.startupPlan.sent = true;

  if (reason) {
    updateSessionStatus("connected", reason);
  }

  for (const command of session.startupPlan.commands) {
    if (!isCurrentAttempt(session, attemptId) || !session.connected || !session.tcpSocket) {
      return;
    }

    writeAndLogMudCommand(ws, session, session.tcpSocket, command, "startup");
    updateSessionStatus("connected", `Startup command sent: ${command}`);

    if (session.startupPlan.delayMs > 0) {
      await Bun.sleep(session.startupPlan.delayMs);
    }
  }
}

function scheduleStartupFallback(ws: BunServerWebSocket | null, session: Session, attemptId: number): void {
  if (!session.startupPlan || session.startupPlan.commands.length === 0) {
    return;
  }

  clearStartupFallback(session);
  session.startupPlan.fallbackTimer = setTimeout(() => {
    void flushStartupCommands(ws, session, attemptId, "No banner received yet; sending startup commands.");
  }, STARTUP_COMMAND_FALLBACK_MS);
}

function teardownSession(
  ws: BunServerWebSocket | null,
  reason: string,
  options: { closeSocket?: boolean; state?: "disconnected" | "error" } = {},
): void {
  const session = sharedSession;

  const tcpSocket = session.tcpSocket;
  session.connectAttemptId += 1;
  session.tcpSocket = undefined;
  session.connected = false;
  session.state = options.state ?? "disconnected";
  session.statusMessage = reason;
  session.decoder = new TextDecoder();
  session.telnetState = createTelnetState();
  clearStartupFallback(session);
  session.startupPlan = undefined;
  session.mudTarget = undefined;

  if (options.closeSocket !== false && tcpSocket) {
    tcpSocket.close();
  }

  combatState.reset();
  clearSurvivalTickTimer();
  survivalTickRunning = false;
  clearPendingContainerInspect();
  mudTextHandlers.clear();
  survivalController.reset();
  spellController.reset();
  sneakController.reset();

  logEvent(ws, options.state === "error" ? "error" : "session", reason, {
    state: options.state ?? "disconnected",
  });

  updateSessionStatus(options.state ?? "disconnected", reason);
}

async function connectToMud(ws: BunServerWebSocket | null, payload: ConnectPayload | undefined): Promise<void> {
  const session = sharedSession;
  const config = normalizeConnectPayload(payload);
  session.mudTarget = `${config.host}:${config.port}${config.tls ? " (tls)" : ""}`;
  const existingSocket = session.tcpSocket;
  const attemptId = beginAttempt(session, config.startupCommands, config.commandDelayMs);

  if (existingSocket) {
    existingSocket.close();
  }

  logEvent(ws, "session", "Connect requested.", {
    target: session.mudTarget,
    startupCommands: config.startupCommands.length,
    commandDelayMs: config.commandDelayMs,
  });

  updateSessionStatus("connecting", `Connecting to ${config.host}:${config.port}${config.tls ? " with TLS" : ""}...`);

  try {
    const tcpSocket = await Bun.connect({
      hostname: config.host,
      port: config.port,
      tls: config.tls,
      socket: {
        open(socket) {
          if (!isCurrentAttempt(session, attemptId)) {
            socket.close();
            return;
          }

          session.tcpSocket = socket;
          session.connected = true;
          scheduleStartupFallback(ws, session, attemptId);
          session.state = "connected";
          session.statusMessage = `Connected to ${config.host}:${config.port}.`;
          logEvent(ws, "session", "Connected to MUD.", {
            target: session.mudTarget,
          });
          updateSessionStatus("connected", `Connected to ${config.host}:${config.port}.`);
        },
        data(socket, data) {
          if (!isCurrentAttempt(session, attemptId)) {
            return;
          }

          const text = decodeMudData(session, socket, data);
          const byteLength = typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;

          logEvent(ws, "mud-in", sanitizeLogText(text.length > 0 ? text : `[control-bytes:${byteLength}]`), {
            bytes: byteLength,
            target: session.mudTarget ?? null,
          });

          if (text.length > 0) {
            if (/(Заполнен|Пуст)/i.test(text)) {
              resolvePendingContainerInspect(text);
            } else if (pendingContainerInspectResolve !== null) {
              resolvePendingContainerInspect(text);
            }
            for (const handler of mudTextHandlers) handler(text);
            rememberOutput(text);
            broadcastServerEvent({
              type: "output",
              payload: { text },
            });

            void persistParsedMapData(text, ws).catch((error: unknown) => {
              logEvent(ws, "error", error instanceof Error ? `Automapper error: ${error.message}` : "Automapper error.");
            });
            void flushStartupCommands(ws, session, attemptId);
          }
        },
        end() {
          if (!isCurrentAttempt(session, attemptId)) {
            return;
          }

          teardownSession(ws, "MUD server closed the connection.", { closeSocket: false });
        },
        close(_socket, error) {
          if (!isCurrentAttempt(session, attemptId)) {
            return;
          }

          teardownSession(ws, error ? "MUD connection closed with an error." : "MUD connection closed.", {
            closeSocket: false,
            state: error ? "error" : "disconnected",
          });
        },
        error(_socket, error) {
          if (!isCurrentAttempt(session, attemptId)) {
            return;
          }

          logEvent(ws, "error", `TCP error: ${error.message}`, {
            target: session.mudTarget ?? null,
          });

          broadcastServerEvent({
            type: "error",
            payload: { message: `TCP error: ${error.message}` },
          });
        },
        connectError(_socket, error) {
          if (!isCurrentAttempt(session, attemptId)) {
            return;
          }

          teardownSession(ws, `Connect error: ${error.message}`, { state: "error", closeSocket: false });
        },
        timeout() {
          if (!isCurrentAttempt(session, attemptId)) {
            return;
          }

          teardownSession(ws, "Connection to the MUD timed out.", { state: "error" });
        },
      },
    });

    if (!isCurrentAttempt(session, attemptId)) {
      tcpSocket.close();
      return;
    }

    session.tcpSocket = tcpSocket;
  } catch (error) {
    if (!isCurrentAttempt(session, attemptId)) {
      return;
    }

    teardownSession(
      ws,
      error instanceof Error ? `Unable to connect: ${error.message}` : "Unable to connect to the MUD.",
      { state: "error" },
    );
  }
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

  writeAndLogMudCommand(ws, session, session.tcpSocket, trimmedCommand, "browser");
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
  farmController.setEnabled(false);
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

      writeAndLogMudCommand(ws, sharedSession, sharedSession.tcpSocket, DIRECTION_TO_COMMAND[step.direction], "navigation");

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
  writeAndLogMudCommand(ws, sharedSession, sharedSession.tcpSocket, `осм ${container}`, "inspect-container");
  return waitForContainerInspectResult(2000);
}

function countItemsByKeyword(inspectText: string, keyword: string): number {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return 0;
  let total = 0;
  for (const item of parseInspectItems(inspectText)) {
    if (item.name.toLowerCase().includes(normalizedKeyword)) {
      total += item.count;
    }
  }
  return total;
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

  const wasInCombat = survivalPreviousInCombat;
  combatState.handleMudText(text);
  triggers.handleMudText(text);
  survivalController.handleMudText(text);
  spellController.handleMudText(text);
  sneakController.handleMudText(text);
  const nowInCombat = combatState.getInCombat();
  survivalPreviousInCombat = nowInCombat;

  if (!wasInCombat && nowInCombat) {
    triggers.onCombatStart();
  } else if (wasInCombat && !nowInCombat) {
    triggers.onCombatEnd();
  }

  if (wasInCombat && !nowInCombat) {
    scheduleSurvivalTick(50);
    sneakController.onCombatEnd();
  } else if (!nowInCombat) {
    scheduleSurvivalTick(150);
  }

  void handleItemIdentifyBuffer(text).catch((error: unknown) => {
    logEvent(ws, "error", error instanceof Error ? `Item parser error: ${error.message}` : "Item parser error.");
  });
  const events = feedText(parserState, text);
  const previousRoomId = trackerState.currentRoomId;

  if (events.length === 0) {
    farmController.handleMudText(text, {
      roomChanged: false,
      roomDescriptionReceived: false,
      currentRoomId: trackerState.currentRoomId,
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

  farmController.handleMudText(text, {
    roomChanged: previousRoomId !== trackerState.currentRoomId,
    roomDescriptionReceived: result.rooms.length > 0,
    currentRoomId: trackerState.currentRoomId,
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

const savedAutoSpells = await mapStore.getAutoSpellsSettings(activeProfileId);
if (savedAutoSpells) {
  spellController.updateConfig(normalizeAutoSpellsSettings(savedAutoSpells));
}

const savedSneak = await mapStore.getSneakSettings(activeProfileId);
if (savedSneak) {
  sneakController.updateConfig(normalizeSneakSettings(savedSneak));
}

roomChangedListeners.add((vnum: number) => {
  void mapStore.getRoomAutoCommand(vnum).then((command) => {
    if (command && sharedSession.tcpSocket && sharedSession.connected) {
      const lines = command.split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        writeAndLogMudCommand(null, sharedSession, sharedSession.tcpSocket, line, "room-auto-cmd");
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

      void sendMapSnapshot(ws);
      void sendSurvivalSettings(ws);
      void sendAutoSpellsSettings(ws);
      void sendSneakSettings(ws);
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
          await connectToMud(ws, event.payload);
          void mapStore.getTriggerSettings(activeProfileId).then((saved) => {
            if (saved) triggers.setEnabled(saved);
          }).catch((error: unknown) => {
            logEvent(ws, "error", error instanceof Error ? error.message : "Unknown error loading trigger settings");
          });
          void mapStore.getAutoSpellsSettings(activeProfileId).then((saved) => {
            if (saved) spellController.updateConfig(normalizeAutoSpellsSettings(saved));
          }).catch((error: unknown) => {
            logEvent(ws, "error", error instanceof Error ? error.message : "Unknown error loading auto spells settings");
          });
          void mapStore.getSneakSettings(activeProfileId).then((saved) => {
            if (saved) sneakController.updateConfig(normalizeSneakSettings(saved));
          }).catch((error: unknown) => {
            logEvent(ws, "error", error instanceof Error ? error.message : "Unknown error loading sneak settings");
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
          teardownSession(ws, "Disconnected by user.");
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
        case "farm_toggle": {
          const enabled = event.payload?.enabled === true;
          const pa = event.payload?.periodicAction;
          farmController.updateConfig({
            targetValues: event.payload?.targetValues ?? [],
            healCommands: event.payload?.healCommands ?? [],
            healThresholdPercent: event.payload?.healThresholdPercent ?? 50,
            fleeCommand: event.payload?.fleeCommand ?? "",
            fleeThresholdPercent: event.payload?.fleeThresholdPercent ?? 0,
            lootValues: event.payload?.lootValues ?? [],
            periodicAction: {
              enabled: pa?.enabled === true,
              gotoAlias1: pa?.gotoAlias1 ?? "",
              commands: pa?.commands ?? [],
              commandDelayMs: pa?.commandDelayMs ?? 0,
              gotoAlias2: pa?.gotoAlias2 ?? "",
              intervalMs: pa?.intervalMs ?? 0,
            },
            useStab: event.payload?.useStab !== false,
          });
          logEvent(ws, "browser-in", "farm_toggle", { enabled });
          farmController.setEnabled(enabled);
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
            if (event.payload?.action === "buy_food") {
              const survival = await mapStore.getSurvivalSettings();
              const normalized = normalizeSurvivalSettings(survival ?? {});
              const buyFoodItem = normalized.buyFoodItem.trim();
              const buyFoodMax = normalized.buyFoodMax;
              const container = normalized.container.trim();

              if (buyFoodItem.length > 0 && container.length > 0 && buyFoodMax > 0) {
                const inspectText = await inspectContainer(ws, container);
                const count = countItemsByKeyword(inspectText, buyFoodItem);
                if (count >= buyFoodMax) {
                  broadcastServerEvent({
                    type: "status",
                    payload: {
                      state: sharedSession.state,
                      message: `[survival] уже достаточно еды (${count}/${buyFoodMax})`,
                    },
                  });
                  break;
                }
                const needed = buyFoodMax - count;
                resolvedCommands = [
                  `купи ${needed} ${buyFoodItem}`,
                  `положи ${needed} ${buyFoodItem} ${container}`,
                ];
              }
            }
            if (event.payload?.action === "fill_flask") {
              const survival = await mapStore.getSurvivalSettings();
              const normalized = normalizeSurvivalSettings(survival ?? {});
              const container = normalized.container.trim();
              const flaskKeyword = normalized.flaskItems.split("\n").map(s => s.trim()).filter(Boolean)[0] ?? "";

              if (flaskKeyword.length > 0 && container.length > 0) {
                const source = normalized.fillFlaskSource.trim();
                resolvedCommands = [
                  `взять ${flaskKeyword} ${container}`,
                  ...(source.length > 0 ? [`налить ${flaskKeyword} ${source}`] : []),
                  `положить ${flaskKeyword} ${container}`,
                ];
              }
            }
            await startNavigationToNearest(ws, vnums);
            for (const cmd of resolvedCommands) {
              if (sharedSession.tcpSocket && sharedSession.connected) {
                writeAndLogMudCommand(ws, sharedSession, sharedSession.tcpSocket, cmd, "goto_and_run");
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
            const settings = await mapStore.getFarmSettings(zoneId);
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
            await mapStore.setFarmSettings(zoneId, settings);
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
        case "auto_spells_settings_get": {
          logEvent(ws, "browser-in", "auto_spells_settings_get");
          await sendAutoSpellsSettings(ws);
          break;
        }
        case "auto_spells_settings_save": {
          const raw = event.payload;
          if (raw) {
            const settings: AutoSpellsSettings = {
              spells: Array.isArray(raw.spells) ? raw.spells : [],
              checkIntervalMs: typeof raw.checkIntervalMs === "number" ? raw.checkIntervalMs : 60_000,
            };
            logEvent(ws, "browser-in", "auto_spells_settings_save");
            await mapStore.setAutoSpellsSettings(activeProfileId, settings);
            spellController.updateConfig(normalizeAutoSpellsSettings(settings));
          }
          break;
        }
        case "sneak_settings_get": {
          logEvent(ws, "browser-in", "sneak_settings_get");
          await sendSneakSettings(ws);
          break;
        }
        case "sneak_settings_save": {
          const raw = event.payload;
          if (raw) {
            const settings: SneakSettings = {
              spells: Array.isArray(raw.spells) ? raw.spells : [],
              checkIntervalMs: typeof raw.checkIntervalMs === "number" ? raw.checkIntervalMs : 20_000,
            };
            logEvent(ws, "browser-in", "sneak_settings_save");
            await mapStore.setSneakSettings(activeProfileId, settings);
            sneakController.updateConfig(normalizeSneakSettings(settings));
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
            const proxy = runtimeConfig.wikiProxies[0] as string | undefined;
            const searchHtml = await fetchWiki({ q: query }, proxy);
            const results = parseSearchResults(searchHtml);
            if (results.length === 0) {
              sendServerEvent(ws, { type: "wiki_item_search_result", payload: { query, found: false } });
              break;
            }
            const first = results[0];
            const html = await fetchWiki({ id: String(first.id) }, runtimeConfig.wikiProxies[0]);
            const gear = parseGearItemCard(html, first.id);
            const wiki = parseWikiItemCard(html, first.id);
            if (gear) {
              await mapStore.upsertItem(gear.name, gear.itemType, gearItemCardToData(gear));
            } else if (wiki) {
              await mapStore.upsertItem(wiki.name, wiki.itemType, { id: wiki.id, name: wiki.name });
            }
            sendServerEvent(ws, {
              type: "wiki_item_search_result",
              payload: {
                query,
                found: true,
                name: wiki?.name ?? gear?.name ?? first.name,
                itemType: wiki?.itemType ?? gear?.itemType,
                text: wiki?.text,
                loadLocation: wiki?.loadLocation,
              },
            });
          } catch (err: unknown) {
            sendServerEvent(ws, {
              type: "wiki_item_search_result",
              payload: { query, found: false, error: err instanceof Error ? err.message : "Ошибка поиска" },
            });
          }
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
        case "gear_sell": {
          logEvent(ws, "browser-in", `gear_sell: ${event.payload.sellCommand}`);
          if (!sharedSession.tcpSocket || !sharedSession.connected) {
            sendServerEvent(ws, { type: "error", payload: { message: "Не подключены к MUD." } });
            break;
          }
          writeAndLogMudCommand(null, sharedSession, sharedSession.tcpSocket, event.payload.sellCommand, "gear-sell");
          break;
        }
        case "gear_drop": {
          logEvent(ws, "browser-in", `gear_drop: ${event.payload.dropCommand}`);
          if (!sharedSession.tcpSocket || !sharedSession.connected) {
            sendServerEvent(ws, { type: "error", payload: { message: "Не подключены к MUD." } });
            break;
          }
          writeAndLogMudCommand(null, sharedSession, sharedSession.tcpSocket, event.payload.dropCommand, "gear-drop");
          break;
        }
        case "gear_apply": {
          logEvent(ws, "browser-in", `gear_apply: ${event.payload.commands.join(" ; ")}`);
          if (!sharedSession.tcpSocket || !sharedSession.connected) {
            sendServerEvent(ws, { type: "error", payload: { message: "Не подключены к MUD." } });
            break;
          }
          const applySocket = sharedSession.tcpSocket;
          const applyCommands = event.payload.commands;
          for (const cmd of applyCommands) {
            writeAndLogMudCommand(null, sharedSession, applySocket, cmd, "gear-apply");
          }
          broadcastServerEvent({ type: "gear_scan_progress", payload: { message: "Применяю... перезапускаю анализ." } });
          void new Promise<void>((resolve) => setTimeout(resolve, 1500)).then(() => runGearScan({
            sendCommand: (cmd) => writeAndLogMudCommand(null, sharedSession, applySocket, cmd, "gear-scan"),
            registerTextHandler: (h) => mudTextHandlers.add(h),
            unregisterTextHandler: (h) => mudTextHandlers.delete(h),
            onProgress: (msg) => { logEvent(ws, "browser-out", `[gear-scan] ${msg}`); broadcastServerEvent({ type: "gear_scan_progress", payload: { message: msg } }); },
            waitForOutput: (_ms) => Promise.resolve(""),
            cancelWait: () => {},
            getItemByName: (name) => mapStore.getItemByName(name),
            upsertItem: (name, itemType, data) => mapStore.upsertItem(name, itemType, data),
            wikiProxies: runtimeConfig.wikiProxies,
          })).then((result) => {
            broadcastServerEvent({ type: "gear_scan_result", payload: result });
          }).catch((err: unknown) => {
            broadcastServerEvent({ type: "error", payload: { message: err instanceof Error ? err.message : "Ошибка советника." } });
          });
          break;
        }
        case "gear_scan_start": {          logEvent(ws, "browser-in", "gear_scan_start");
          if (!sharedSession.tcpSocket || !sharedSession.connected) {
            sendServerEvent(ws, { type: "error", payload: { message: "Не подключены к MUD." } });
            break;
          }
          void runGearScan({
            sendCommand: (cmd) => writeAndLogMudCommand(null, sharedSession, sharedSession.tcpSocket!, cmd, "gear-scan"),
            registerTextHandler: (h) => mudTextHandlers.add(h),
            unregisterTextHandler: (h) => mudTextHandlers.delete(h),
            onProgress: (msg) => { logEvent(ws, "browser-out", `[gear-scan] ${msg}`); broadcastServerEvent({ type: "gear_scan_progress", payload: { message: msg } }); },
            waitForOutput: (_ms) => Promise.resolve(""),
            cancelWait: () => {},
            getItemByName: (name) => mapStore.getItemByName(name),
            upsertItem: (name, itemType, data) => mapStore.upsertItem(name, itemType, data),
            wikiProxies: runtimeConfig.wikiProxies,
          }).then((result) => {
            broadcastServerEvent({ type: "gear_scan_result", payload: result });
          }).catch((err: unknown) => {
            broadcastServerEvent({ type: "error", payload: { message: err instanceof Error ? err.message : "Ошибка советника." } });
          });
          break;
        }
        case "bazaar_scan_start": {
          logEvent(ws, "browser-in", "bazaar_scan_start");
          if (!sharedSession.tcpSocket || !sharedSession.connected) {
            sendServerEvent(ws, { type: "error", payload: { message: "Не подключены к MUD." } });
            break;
          }
          void runBazaarScan({
            sendCommand: (cmd) => writeAndLogMudCommand(null, sharedSession, sharedSession.tcpSocket!, cmd, "bazaar-scan"),
            registerTextHandler: (h) => mudTextHandlers.add(h),
            unregisterTextHandler: (h) => mudTextHandlers.delete(h),
            onProgress: (msg) => { logEvent(ws, "browser-out", `[bazaar-scan] ${msg}`); broadcastServerEvent({ type: "bazaar_scan_progress", payload: { message: msg } }); },
            waitForOutput: (_ms) => Promise.resolve(""),
            cancelWait: () => {},
            getItemByName: (name) => mapStore.getItemByName(name),
            upsertItem: (name, itemType, data) => mapStore.upsertItem(name, itemType, data),
            wikiProxies: runtimeConfig.wikiProxies,
          }).then((result) => {
            broadcastServerEvent({ type: "bazaar_scan_result", payload: result });
          }).catch((err: unknown) => {
            broadcastServerEvent({ type: "error", payload: { message: err instanceof Error ? err.message : "Ошибка советника по базару." } });
          });
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
  void connectToMud(null, { profileId: readLastProfileId() });
}
