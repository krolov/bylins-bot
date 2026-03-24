import { appendFileSync, mkdirSync } from "node:fs";
import { runtimeConfig } from "./config";
import { sql } from "./db";
import { createCombatState } from "./combat-state";
import { createFarmController } from "./farm-script";
import type { PeriodicActionConfig } from "./farm-script";
import { createSurvivalController, normalizeSurvivalConfig } from "./survival-script";
import { findPath } from "./map/pathfinder";
import type { PathStep } from "./map/pathfinder";
import { createParserState, feedText } from "./map/parser";
import { createMapStore } from "./map/store";
import type { FarmZoneSettings, SurvivalSettings, GameItem } from "./map/store";
import { createTrackerState, processParsedEvents, trackOutgoingCommand } from "./map/tracker";
import type { Direction, MapAlias, MapSnapshot } from "./map/types";
import { createTriggers } from "./triggers";
import type { TriggerState } from "./triggers";

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
const MAX_OUTPUT_CHUNKS = 200;
const NAVIGATION_STEP_TIMEOUT_MS = 3000;

interface WsData {
  sessionId: string;
}

interface ConnectPayload {
  host?: string;
  port?: number;
  tls?: boolean;
  startupCommands?: string[];
  commandDelayMs?: number;
}

type ClientEvent =
  | { type: "connect"; payload?: ConnectPayload }
  | { type: "send"; payload?: { command?: string } }
  | { type: "disconnect" }
  | { type: "map_reset" }
   | {
      type: "farm_toggle";
      payload?: {
        enabled?: boolean;
        targetValues?: string[];
        healCommands?: string[];
        healThresholdPercent?: number;
        lootValues?: string[];
        periodicAction?: {
          enabled?: boolean;
          gotoAlias1?: string;
          commands?: string[];
          gotoAlias2?: string;
          intervalMs?: number;
        };
      };
    }
  | { type: "alias_set"; payload?: { vnum?: number; alias?: string } }
  | { type: "alias_delete"; payload?: { vnum?: number } }
  | { type: "navigate_to"; payload?: { vnums?: number[] } }
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
  | {
      type: "survival_settings_save";
      payload?: Partial<SurvivalSettings>;
    }
  | { type: "triggers_toggle"; payload?: Partial<TriggerState> }
  | { type: "item_db_get" }
  | { type: "room_auto_command_set"; payload?: { vnum?: number; command?: string } }
  | { type: "room_auto_command_delete"; payload?: { vnum?: number } }
  | { type: "room_auto_commands_get" };

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
    };

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
const recentOutputChunks: string[] = [];
const parserState = createParserState();
const trackerState = createTrackerState();
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
    broadcastServerEvent({
      type: "status",
      payload: { state: sharedSession.state, message },
    });
  },
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

let survivalTickTimer: ReturnType<typeof setTimeout> | null = null;
let survivalPreviousInCombat = false;

// ── Item identify parser ──────────────────────────────────────────────────────
// Collects MUD text chunks into a rolling buffer to detect multi-line identify
// blocks ("Вы узнали следующее:") and persist them to game_items.
const ITEM_IDENTIFY_START = /Вы узнали следующее:/;
const ITEM_BUFFER_MAX = 4096;
let itemBuffer = "";

function parseItemIdentifyBlock(block: string): { name: string; itemType: string; data: Record<string, unknown> } | null {
  const stripped = block.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "");
  const nameMatch = /Предмет\s+"([^"]+)",\s+тип\s*:\s*(\S+)/.exec(stripped);
  if (!nameMatch) return null;

  const name = nameMatch[1].trim();
  const itemType = nameMatch[2].trim();
  const data: Record<string, unknown> = {};

  // Класс
  const classMatch = /Принадлежит к классу\s+"([^"]+)"/.exec(stripped);
  if (classMatch) data["class"] = classMatch[1].trim();

  // Вес, цена, рента: «Вес: 5, Цена: 50, Рента: 50(5)»
  const weightMatch = /Вес:\s*(\d+)/.exec(stripped);
  if (weightMatch) data["weight"] = Number(weightMatch[1]);
  const priceMatch = /Цена:\s*(\d+)/.exec(stripped);
  if (priceMatch) data["price"] = Number(priceMatch[1]);
  const rentMatch = /Рента:\s*(\d+)(?:\((\d+)\))?/.exec(stripped);
  if (rentMatch) {
    data["rent"] = Number(rentMatch[1]);
    if (rentMatch[2]) data["rent_day"] = Number(rentMatch[2]);
  }

  // Материал, прочность: «Материал : КОСТЬ, макс.прочность : 50, тек.прочность : 49»
  const matMatch = /Материал\s*:\s*(\S+)/.exec(stripped);
  if (matMatch) data["material"] = matMatch[1].replace(/,.*/, "").trim();
  const maxDurMatch = /макс\.прочность\s*:\s*(\d+)/.exec(stripped);
  if (maxDurMatch) data["durability_max"] = Number(maxDurMatch[1]);
  const curDurMatch = /тек\.прочность\s*:\s*(\d+)/.exec(stripped);
  if (curDurMatch) data["durability_cur"] = Number(curDurMatch[1]);

  // Экстрафлаги
  const extraFlagsMatch = /Имеет экстрафлаги:\s*(.+)/.exec(stripped);
  if (extraFlagsMatch) data["extra_flags"] = extraFlagsMatch[1].trim();

  // Повреждения: «Наносимые повреждения '2D4' среднее 5.0»
  const damMatch = /Наносимые повреждения\s+'([^']+)'\s+среднее\s+([\d]+(?:\.[\d]+)?)/.exec(stripped);
  if (damMatch) {
    data["damage_dice"] = damMatch[1].trim();
    data["damage_avg"] = Number(damMatch[2]);
  }

  // Требования к силе (правая/левая/обе руки)
  const hands: Array<{ hand: string; str: number }> = [];
  for (const m of stripped.matchAll(/Можно взять в ([^\(]+)\(требуется (\d+) силы\)/g)) {
    hands.push({ hand: m[1].trim(), str: Number(m[2]) });
  }
  if (hands.length > 0) data["wield_requirements"] = hands;

  // Место одевания (броня)
  const wearMatches = [...stripped.matchAll(/Можно одеть:\s*(.+)/g)];
  if (wearMatches.length > 0) data["wear_locations"] = wearMatches.map((m) => m[1].trim());

  // Аффекты
  const affectMatch = /Накладывает на вас аффекты:\s*(.+)/.exec(stripped);
  if (affectMatch) data["affects"] = affectMatch[1].trim();

  // Дополнительные свойства (попадание/повреждение улучшает на N)
  const extraPropsIdx = stripped.indexOf("Дополнительные свойства");
  if (extraPropsIdx !== -1) {
    const extraSection = stripped.slice(extraPropsIdx);
    const extraLines = extraSection.split("\n").slice(1).map(l => l.trim()).filter(l => l.length > 0);
    if (extraLines.length > 0) data["extra_props"] = extraLines.join("; ");
  }

  return { name, itemType, data };
}

async function handleItemIdentifyBuffer(chunk: string): Promise<void> {
  itemBuffer += chunk;
  if (itemBuffer.length > ITEM_BUFFER_MAX) {
    itemBuffer = itemBuffer.slice(-ITEM_BUFFER_MAX);
  }

  if (!ITEM_IDENTIFY_START.test(itemBuffer)) return;

  // Detect end of block: next prompt line (Вых:...) or a blank line after content
  const startIdx = itemBuffer.search(ITEM_IDENTIFY_START);
  const afterStart = itemBuffer.slice(startIdx);

  // Look for a prompt line that signals end of the block
  const endMatch = /\n(?=\S*\d+H\s|\S*Вых:|\s*$)/.exec(afterStart.slice(afterStart.indexOf("\n") + 1));
  if (!endMatch && itemBuffer.length < ITEM_BUFFER_MAX) return; // wait for more

  const block = endMatch
    ? afterStart.slice(0, afterStart.indexOf("\n") + 1 + endMatch.index + 1)
    : afterStart;

  // Reset buffer past this block
  itemBuffer = itemBuffer.slice(startIdx + block.length);

  const parsed = parseItemIdentifyBlock(block);
  if (!parsed) return;

  await mapStore.upsertItem(parsed.name, parsed.itemType, parsed.data);
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
  return {
    host: payload?.host?.trim() || runtimeConfig.mudHost,
    port: Number.isFinite(payload?.port) ? Number(payload?.port) : runtimeConfig.mudPort,
    tls: payload?.tls ?? runtimeConfig.mudTls,
    startupCommands:
      payload?.startupCommands
        ?.map((command) => command.trim())
        .filter((command) => command.length > 0) ?? runtimeConfig.startupCommands,
    commandDelayMs:
      typeof payload?.commandDelayMs === "number" && payload.commandDelayMs >= 0
        ? payload.commandDelayMs
        : runtimeConfig.commandDelayMs,
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
  survivalController.reset();

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

  await (async () => {
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
  })();
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

function scheduleSurvivalTick(delayMs: number): void {
  if (survivalTickTimer !== null) return;
  survivalTickTimer = setTimeout(() => {
    survivalTickTimer = null;
    void survivalController.runTick((d) => scheduleSurvivalTick(d));
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
  triggers.handleMudText(text);

  const wasInCombat = survivalPreviousInCombat;
  combatState.handleMudText(text);
  survivalController.handleMudText(text);
  const nowInCombat = combatState.getInCombat();
  survivalPreviousInCombat = nowInCombat;

  if (wasInCombat && !nowInCombat) {
    scheduleSurvivalTick(50);
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

  for (const room of result.rooms) {
    await mapStore.upsertRoom(room.vnum, room.name, room.exits, room.closedExits);
  }

  for (const edge of result.edges) {
    await mapStore.upsertEdge(edge);
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
  survivalController.updateConfig(normalizeSurvivalConfig({
    enabled: savedSurvival.foodItems.trim().length > 0 || savedSurvival.flaskItems.trim().length > 0,
    container: savedSurvival.container,
    foodItems: savedSurvival.foodItems.split("\n").map(s => s.trim()).filter(Boolean),
    flaskItems: savedSurvival.flaskItems.split("\n").map(s => s.trim()).filter(Boolean),
    buyFoodAlias: savedSurvival.buyFoodAlias,
    buyFoodCommands: savedSurvival.buyFoodCommands.split("\n").map(s => s.trim()).filter(Boolean),
    fillFlaskAlias: savedSurvival.fillFlaskAlias,
    fillFlaskCommands: savedSurvival.fillFlaskCommands.split("\n").map(s => s.trim()).filter(Boolean),
  }));
}

roomChangedListeners.add((vnum: number) => {
  void mapStore.getRoomAutoCommand(vnum).then((command) => {
    if (command && sharedSession.tcpSocket && sharedSession.connected) {
      writeAndLogMudCommand(null, sharedSession, sharedSession.tcpSocket, command, "room-auto-cmd");
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
          await connectToMud(ws, event.payload);
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
        case "farm_toggle": {
          const enabled = event.payload?.enabled === true;
          const pa = event.payload?.periodicAction;
          farmController.updateConfig({
            targetValues: event.payload?.targetValues ?? [],
            healCommands: event.payload?.healCommands ?? [],
            healThresholdPercent: event.payload?.healThresholdPercent ?? 50,
            lootValues: event.payload?.lootValues ?? [],
            periodicAction: {
              enabled: pa?.enabled === true,
              gotoAlias1: pa?.gotoAlias1 ?? "",
              commands: pa?.commands ?? [],
              gotoAlias2: pa?.gotoAlias2 ?? "",
              intervalMs: pa?.intervalMs ?? 0,
            },
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
          const survival = await mapStore.getSurvivalSettings();
          sendServerEvent(ws, { type: "survival_settings_data", payload: survival });
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
              buyFoodAlias: settings.buyFoodAlias,
              buyFoodCommands: settings.buyFoodCommands.split("\n").map(s => s.trim()).filter(Boolean),
              fillFlaskAlias: settings.fillFlaskAlias,
              fillFlaskCommands: settings.fillFlaskCommands.split("\n").map(s => s.trim()).filter(Boolean),
            }));
          }
          break;
        }
        case "triggers_toggle": {
          triggers.setEnabled(event.payload ?? {});
          break;
        }
        case "item_db_get": {
          logEvent(ws, "browser-in", "item_db_get");
          const items = await mapStore.getItems();
          sendServerEvent(ws, { type: "items_data", payload: { items } });
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
  void connectToMud(null, undefined);
}

function normalizeFarmZoneSettings(raw: Partial<FarmZoneSettings>): FarmZoneSettings {
  return {
    targets: typeof raw.targets === "string" ? raw.targets : "",
    healCommands: typeof raw.healCommands === "string" ? raw.healCommands : "",
    healThreshold: typeof raw.healThreshold === "number" && Number.isFinite(raw.healThreshold) ? raw.healThreshold : 50,
    loot: typeof raw.loot === "string" ? raw.loot : "",
    periodicActionEnabled: raw.periodicActionEnabled === true,
    periodicActionGotoAlias1: typeof raw.periodicActionGotoAlias1 === "string" ? raw.periodicActionGotoAlias1 : "",
    periodicActionCommand: typeof raw.periodicActionCommand === "string" ? raw.periodicActionCommand : "",
    periodicActionGotoAlias2: typeof raw.periodicActionGotoAlias2 === "string" ? raw.periodicActionGotoAlias2 : "",
    periodicActionIntervalMin: typeof raw.periodicActionIntervalMin === "number" && Number.isFinite(raw.periodicActionIntervalMin) ? raw.periodicActionIntervalMin : 30,
    survivalEnabled: raw.survivalEnabled === true,
  };
}

function normalizeSurvivalSettings(raw: Partial<SurvivalSettings>): SurvivalSettings {
  return {
    container: typeof raw.container === "string" ? raw.container : "",
    foodItems: typeof raw.foodItems === "string" ? raw.foodItems : "",
    flaskItems: typeof raw.flaskItems === "string" ? raw.flaskItems : "",
    buyFoodAlias: typeof raw.buyFoodAlias === "string" ? raw.buyFoodAlias : "",
    buyFoodCommands: typeof raw.buyFoodCommands === "string" ? raw.buyFoodCommands : "",
    fillFlaskAlias: typeof raw.fillFlaskAlias === "string" ? raw.fillFlaskAlias : "",
    fillFlaskCommands: typeof raw.fillFlaskCommands === "string" ? raw.fillFlaskCommands : "",
  };
}
