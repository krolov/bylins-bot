import { appendFileSync, mkdirSync } from "node:fs";
import { runtimeConfig } from "./config.ts";
import { LOG_DIR, LOG_FILE } from "./server/constants.ts";
import type { BunServerWebSocket } from "./server/constants.ts";
import { extractChatLines } from "./server/chat.ts";
import { extractMarketSales } from "./server/market.ts";
import { createLootSorter } from "./server/loot-sorter.ts";
import { createBroadcaster } from "./server/broadcast.ts";
import { createLogEvent, createStatusUpdater, sanitizeLogText, appendLogLine } from "./server/logging.ts";
import { createStatsTracker } from "./server/stats.ts";
import { createListenerHub } from "./server/listeners.ts";
import type { RoomRefreshListener } from "./server/listeners.ts";
import { createSnapshotBroadcaster } from "./server/snapshots.ts";
import { createNavigationController } from "./server/navigation.ts";
import { createContainerInspector } from "./server/containers.ts";
import { createSendCommandHandler, normalizeTextMessage } from "./server/command-handler.ts";
import { createMudTextPipeline } from "./server/mud-text-pipeline.ts";
import { createHttpRoutes } from "./server/http-routes.ts";
import { createClientMessageRouter } from "./server/client-message-router.ts";
import { readLastProfileId, saveLastProfileId } from "./server/profile-storage.ts";
import { sql } from "./db.ts";
import { createCombatState } from "./combat-state.ts";
import { createFarmController } from "./farm/index.ts";
import { createSurvivalController, normalizeSurvivalConfig } from "./survival-script.ts";
import { findPath } from "./map/pathfinder.ts";
import { createParserState } from "./map/parser.ts";
import { createMapStore } from "./map/store.ts";
import { createTrackerState, trackOutgoingCommand } from "./map/tracker.ts";
import { createMover } from "./map/mover.ts";
import { createTriggers } from "./triggers.ts";
import { createContainerTracker } from "./container-tracker.ts";
import { createItemIdentifier } from "./item-identify.ts";
import { createRepairController } from "./repair-script.ts";
import { createGatherController } from "./gather-script.ts";
import type { WsData, ClientEvent } from "./events.type.ts";
import { normalizeSurvivalSettings } from "./settings-normalizers.ts";
import { createMudConnection } from "./mud-connection.ts";
import { createBazaarNotifier } from "./bazaar-notifier.ts";

const broadcaster = createBroadcaster();
const { browserClients, recentOutputChunks, sendServerEvent, broadcastServerEvent, rememberOutput } = broadcaster;

let debugLogEnabled = false;
const logEvent = createLogEvent({ getDebugLogEnabled: () => debugLogEnabled });

const mudConnection = createMudConnection({
  logEvent: (ws, direction, message, details) => logEvent(ws, direction, message, details),
  sanitizeLogText: (text) => sanitizeLogText(text),
  updateSessionStatus: (state, message) => updateSessionStatus(state, message),
  onMudText: (text, ws) => {
    containerTracker.feedText(text);
    containerTracker.feedEquippedScan(text);
    containerTracker.feedPendingInspect(text);
    for (const handler of mudTextHandlers) handler(text);
    bazaarNotifier.handleMudText(text);
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
    const marketSales = extractMarketSales(text);
    if (marketSales.length > 0) {
      const now = new Date();
      for (const sale of marketSales) {
        void mapStore.saveMarketSale({ ...sale, soldAt: now }).catch((error: unknown) => {
          logEvent(ws, "error", error instanceof Error ? `Market sale persist error: ${error.message}` : "Market sale persist error.");
        });
      }
    }
    lootSorter.handleMudText(text);
    void mudTextPipeline.handleMudText(text, ws).catch((error: unknown) => {
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
const updateSessionStatus = createStatusUpdater({ session: sharedSession, broadcastServerEvent });
let activeProfileId: string = readLastProfileId();

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
const mapStore = createMapStore(sql);
const combatState = createCombatState();
const farmController = createFarmController({
  // ── Shared plumbing ────────────────────────────────────────────────────
  getCurrentRoomId: () => trackerState.currentRoomId,
  isConnected: () => sharedSession.connected && Boolean(sharedSession.tcpSocket),
  getSnapshot: (currentVnum) => mapStore.getSnapshot(currentVnum),
  combatState,
  sendCommand: (command) => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, command, "farm");
  },
  move: (direction) => mover.move(direction, trackerState.currentRoomId),
  reinitRoom: () => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, "см", "farm");
  },
  onLog: (message) => {
    logEvent(null, "session", message);
  },
  // ── Loop-mode deps (formerly createFarm2Controller) ────────────────────
  getZoneSettings: (zoneId) => mapStore.getFarmSettings(activeProfileId, zoneId),
  getMobCombatNamesByZone: (zoneId) => mapStore.getMobCombatNamesByZone(zoneId),
  getCombatNameByRoomName: (roomName) => mapStore.getCombatNameByRoomName(roomName),
  isRoomNameBlacklisted: (roomName) => mapStore.isRoomNameBlacklisted(roomName),
  linkMobRoomAndCombatName: (roomName, combatName, vnum) => mapStore.saveMobRoomName(roomName, vnum, combatName),
  onLoopStateChange: (loopState) => {
    broadcastServerEvent({ type: "farm2_state", payload: loopState });
  },
  onDebugLog: (message) => {
    appendLogLine(`[${new Date().toISOString()}] session=system direction=session message=${JSON.stringify(message)}`);
  },
  // ── Script-mode deps (formerly createZoneScriptController) ─────────────
  navigateTo: (targetVnum) => startNavigation(null, targetVnum),
  onMudTextOnce: (pattern, timeoutMs) => onceMudText(pattern, timeoutMs),
  onceRoomChanged: (timeoutMs) => onceRoomChanged(timeoutMs),
  refreshCurrentRoom: (timeoutMs) => refreshCurrentRoom(timeoutMs),
  stealthMove: (direction) => mover.stealthMove(direction, trackerState.currentRoomId),
  getVisibleTargets: () => new Map(mudTextPipeline.getVisibleMobs()),
  getCorpseCount: () => mudTextPipeline.getCorpseCount(),
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
  autoSortInventory: async () => {
    await lootSorter.autoSortInventory();
  },
  onScriptStateChange: (scriptState) => {
    broadcastServerEvent({ type: "zone_script_state", payload: scriptState });
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
  getCharLevel: () => statsTracker.getLevel(),
  getCharDsu: () => statsTracker.getDsu(),
  getCharRazb: () => statsTracker.getRazb(),
  onEquipAll: () => {
     broadcastServerEvent({ type: "equip_all" });
  },
});



const navigationController = createNavigationController({
  mapStore,
  broadcastServerEvent,
  getCurrentRoomId: () => trackerState.currentRoomId,
  session: sharedSession,
  writeAndLogMudCommand: (ws, socket, command, origin) =>
    mudConnection.writeAndLogMudCommand(ws, socket, command, origin),
  onceRoomChanged: (timeoutMs) => onceRoomChanged(timeoutMs),
});
const navigationState = navigationController.state;
const startNavigation = navigationController.startNavigation;
const startNavigationToNearest = navigationController.startNavigationToNearest;
const stopNavigation = navigationController.stopNavigation;
const broadcastNavigationState = navigationController.broadcastNavigationState;

const listenerHub = createListenerHub();
const { mudTextHandlers, roomChangedListeners, roomRefreshListeners, sessionTeardownHooks, onceMudText, onceRoomChanged } = listenerHub;

const lootSorter = createLootSorter({
  session: sharedSession,
  writeAndLogMudCommand: (ws, socket, cmd, origin) =>
    mudConnection.writeAndLogMudCommand(ws, socket, cmd, origin),
  registerTextHandler: (h) => mudTextHandlers.add(h),
  unregisterTextHandler: (h) => mudTextHandlers.delete(h),
  getMarketMaxPrice: (itemName) => mapStore.getMarketMaxPrice(itemName),
  waitForInspectResult: (ms) => containerTracker.waitForInspectResult(ms),
  onError: (message) => logEvent(null, "error", message),
});

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

sessionTeardownHooks.add(() => farmController.handleSessionClosed("Session closed."));

const bazaarNotifier = createBazaarNotifier({
  telegramBotToken: runtimeConfig.telegramBotToken,
  telegramChatId: runtimeConfig.telegramChatId,
  getCurrentRoomId: () => trackerState.currentRoomId,
  getPathLength: async (fromVnum: number, toVnum: number) => {
    const snapshot = await mapStore.getSnapshot(fromVnum);
    const path = findPath(snapshot, fromVnum, toVnum);
    return path !== null ? path.length : null;
  },
  resolveAlias: (alias: string) => mapStore.resolveAliasAll(alias),
  navigateTo: (vnum: number) => startNavigation(null, vnum),
  onceRoomChanged: (timeoutMs: number) => onceRoomChanged(timeoutMs),
  isNavigating: () => navigationState.active,
  isInCombat: () => combatState.getInCombat(),
  sendCommand: (command: string) => {
    if (!sharedSession.tcpSocket || !sharedSession.connected) return;
    mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, command, "bazaar-notifier");
  },
  onLog: (message: string) => {
    logEvent(null, "session", message);
  },
});

// Character stats tracker — parses MUD prompt / max-stats phrase and
// broadcasts stats_update + feeds farmController. Details live in ./server/stats.ts.
const statsTracker = createStatsTracker({
  broadcastServerEvent,
  onStatsChanged: (stats) => farmController.updateStats(stats),
});

let survivalTickTimer: ReturnType<typeof setTimeout> | null = null;
let survivalTickRunning = false;

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
    payload: farmController.getLoopState(),
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
    payload: farmController.getScriptState(),
  });

  sendServerEvent(ws, {
    type: "zone_script_list",
    payload: farmController.getZoneList(),
  });

  sendServerEvent(ws, {
    type: "combat_state",
    payload: { inCombat: combatState.getInCombat() },
  });

  if (statsTracker.getHpMax() > 0 || statsTracker.getEnergyMax() > 0) {
    sendServerEvent(ws, {
      type: "stats_update",
      payload: {
        hp: statsTracker.getHp(),
        hpMax: statsTracker.getHpMax(),
        energy: statsTracker.getEnergy(),
        energyMax: statsTracker.getEnergyMax(),
      },
    });
  }
}

const handleSendCommand = createSendCommandHandler({
  session: sharedSession,
  combatState,
  writeAndLogMudCommand: (ws, socket, cmd, origin) =>
    mudConnection.writeAndLogMudCommand(ws, socket, cmd, origin),
  sendServerEvent,
  getStats: () => ({
    dsu: statsTracker.getDsu(),
    level: statsTracker.getLevel(),
    razb: statsTracker.getRazb(),
  }),
});

function resetMapState(): void {
  parserState.lineBuffer = "";
  parserState.pendingRoomHeader = null;
  trackerState.currentRoomId = null;
  trackerState.pendingMove = null;
  farmController.setLoopEnabled(false);
}

const snapshots = createSnapshotBroadcaster({
  mapStore,
  broadcastServerEvent,
  sendServerEvent,
  getCurrentRoomId: () => trackerState.currentRoomId,
  getNavigationSnapshot: () => ({
    active: navigationState.active,
    targetVnum: navigationState.targetVnum,
    totalSteps: navigationState.steps.length,
    currentStep: navigationState.currentStep,
  }),
});
const {
  getCurrentMapSnapshot,
  getCurrentZoneSnapshot,
  broadcastMapSnapshot,
  broadcastAliasesSnapshot,
  broadcastRoomAutoCommandsSnapshot,
} = snapshots;
const sendMapSnapshot = (ws: BunServerWebSocket) => snapshots.sendInitialSnapshot(ws);

const containerInspector = createContainerInspector({
  session: sharedSession,
  writeAndLogMudCommand: (ws, socket, cmd, origin) =>
    mudConnection.writeAndLogMudCommand(ws, socket, cmd, origin),
  waitForInspectResult: (ms) => containerTracker.waitForInspectResult(ms),
});
const inspectContainer = containerInspector.inspectContainer;
const inspectInventory = containerInspector.inspectInventory;

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

const mudTextPipeline = createMudTextPipeline({
  statsTracker,
  combatState,
  triggers,
  survivalController,
  gatherController,
  itemIdentifier,
  farmController,
  mover,
  parserState,
  trackerState,
  mapStore,
  broadcastServerEvent,
  logEvent,
  broadcastMapSnapshot,
  scheduleSurvivalTick,
  getMapRecordingEnabled: () => mapRecordingEnabled,
  roomChangedListeners,
  roomRefreshListeners,
});

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

const httpRoutes = createHttpRoutes({
  runtimeConfig,
  getCurrentMapSnapshot: () => getCurrentMapSnapshot(),
});

const clientMessageRouter = createClientMessageRouter({
  session: sharedSession,
  mudConnection,
  farmController,
  triggers,
  survivalController,
  gatherController,
  repairController,
  containerTracker,
  trackerState,
  mapStore,
  runtimeConfig,
  getActiveProfileId: () => activeProfileId,
  setActiveProfileId: (id) => {
    activeProfileId = id;
    saveLastProfileId(id);
  },
  getDebugLogEnabled: () => debugLogEnabled,
  setDebugLogEnabled: (enabled) => { debugLogEnabled = enabled; },
  getMapRecordingEnabled: () => mapRecordingEnabled,
  setMapRecordingEnabled: (enabled) => { mapRecordingEnabled = enabled; },
  sendServerEvent,
  broadcastServerEvent,
  logEvent,
  sanitizeLogText,
  mudTextHandlers,
  inspectContainer,
  startNavigationToNearest,
  stopNavigation,
  resetMapState,
  broadcastMapSnapshot,
  broadcastAliasesSnapshot,
  broadcastRoomAutoCommandsSnapshot,
  handleSendCommand,
  sendSurvivalSettings,
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

    return await httpRoutes.handle(url);
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

      await clientMessageRouter.handleMessage(ws, event);
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
