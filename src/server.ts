import { appendFileSync, mkdirSync } from "node:fs";
import { runtimeConfig } from "./config.ts";
import { LOG_DIR, LOG_FILE } from "./server/constants.ts";
import type { BunServerWebSocket } from "./server/constants.ts";
import { createLootSorter } from "./server/loot-sorter.ts";
import { createBroadcaster } from "./server/broadcast.ts";
import { createLogEvent, createStatusUpdater, sanitizeLogText } from "./server/logging.ts";
import { createStatsTracker } from "./server/stats.ts";
import { createListenerHub } from "./server/listeners.ts";
import { createSnapshotBroadcaster } from "./server/snapshots.ts";
import { createNavigationController } from "./server/navigation.ts";
import { createContainerInspector } from "./server/containers.ts";
import { createSendCommandHandler, normalizeTextMessage } from "./server/command-handler.ts";
import { createMudTextPipeline } from "./server/mud-text-pipeline.ts";
import { createHttpRoutes } from "./server/http-routes.ts";
import { createClientMessageRouter } from "./server/client-message-router.ts";
import { createMudTextFanout } from "./server/mud-text-fanout.ts";
import { createInitialStateSender } from "./server/initial-state.ts";
import { createSurvivalTicker } from "./server/survival-ticker.ts";
import { createBunServer } from "./server/bun-server.ts";
import { createFarmWiring } from "./server/farm-wiring.ts";
import { subscribeRoomAutoCommands } from "./server/room-auto-commands.ts";
import { readLastProfileId, saveLastProfileId } from "./server/profile-storage.ts";
import { sql } from "./db.ts";
import { createCombatState } from "./combat-state.ts";
import { createSurvivalController, survivalSettingsToConfig } from "./survival-script.ts";
import { findNearestByPath, findPath } from "./map/pathfinder.ts";
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
  logEvent,
  sanitizeLogText,
  updateSessionStatus: (state, message) => updateSessionStatus(state, message),
  onMudText: (text, ws) => mudTextFanout(text, ws),
  onTcpError: (ws, message) => broadcastServerEvent({ type: "error", payload: { message } }),
  onSessionTeardown: () => {
    combatState.reset();
    survivalTicker.clear();
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

/** Returns a sendCommand-shaped closure tagged with the given origin. */
const sendMudCommand = (origin: string) => (command: string) => {
  if (!sharedSession.tcpSocket || !sharedSession.connected) return;
  mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket, command, origin);
};
/** Appends a session-level log line via logEvent (matches the inline format). */
const logSession = (message: string) => logEvent(null, "session", message);

const parserState = createParserState();
const trackerState = createTrackerState();
const mover = createMover({
  sendCommand: sendMudCommand("mover"),
  onLog: (message) => {
    logSession(message);
    broadcastServerEvent({ type: "status", payload: { state: sharedSession.state, message } });
  },
});
let mapRecordingEnabled = true;
const mapStore = createMapStore(sql);
const combatState = createCombatState();
const farmController = createFarmWiring({
  session: sharedSession,
  mapStore,
  trackerState,
  mover,
  combatState,
  runtimeConfig,
  lootSorter: { autoSortInventory: () => lootSorter.autoSortInventory() },
  pipeline: {
    getVisibleMobs: () => mudTextPipeline.getVisibleMobs(),
    getCorpseCount: () => mudTextPipeline.getCorpseCount(),
  },
  sendCommand: sendMudCommand("farm"),
  broadcastServerEvent,
  logSession,
  onMudTextOnce: (pattern, timeoutMs) => onceMudText(pattern, timeoutMs),
  onceRoomChanged: (timeoutMs) => onceRoomChanged(timeoutMs),
  refreshCurrentRoom: (timeoutMs) => refreshCurrentRoom(timeoutMs),
  navigateTo: (targetVnum) => startNavigation(null, targetVnum),
  getActiveProfileId: () => activeProfileId,
});
const survivalController = createSurvivalController({
  getCurrentRoomId: () => trackerState.currentRoomId,
  sendCommand: sendMudCommand("survival-script"),
  resolveNearest: async (alias) => (await mapStore.resolveAliasAll(alias))[0] ?? null,
  navigateTo: (vnum) => startNavigation(null, vnum),
  isInCombat: () => combatState.getInCombat(),
  onLog: logSession,
  onDebugLog: logSession,
  onStatusChange: (status) => broadcastServerEvent({ type: "survival_status", payload: status }),
});

const repairController = createRepairController({
  getCurrentRoomId: () => trackerState.currentRoomId,
  sendCommand: sendMudCommand("repair-script"),
  resolveNearest: async (alias) => {
    const vnums = await mapStore.resolveAliasAll(alias);
    const currentVnum = trackerState.currentRoomId;
    if (vnums.length === 0) return null;
    if (currentVnum === null) return vnums[0] ?? null;
    return findNearestByPath(await mapStore.getSnapshot(currentVnum), currentVnum, vnums);
  },
  navigateTo: (vnum) => startNavigation(null, vnum),
  isInCombat: () => combatState.getInCombat(),
  isConnected: () => sharedSession.connected,
  registerTextHandler: (h) => mudTextHandlers.add(h),
  unregisterTextHandler: (h) => mudTextHandlers.delete(h),
  onStateChange: (state) => broadcastServerEvent({ type: "repair_state", payload: state }),
  onLog: logSession,
});

const gatherController = createGatherController({
  sendCommand: sendMudCommand("gather-script"),
  onLog: logSession,
});

const containerTracker = createContainerTracker({
  onContainerContents: (container, items) =>
    broadcastServerEvent({ type: "container_contents", payload: { container, items } }),
  onInventoryContents: (items) =>
    broadcastServerEvent({ type: "inventory_contents", payload: { items } }),
  onEquippedContents: (items) =>
    broadcastServerEvent({ type: "equipped_contents", payload: { items } }),
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
  sendCommand: sendMudCommand("triggers"),
  onStateChange: (state) => broadcastServerEvent({ type: "triggers_state", payload: state }),
  onLog: logSession,
  isInCombat: () => combatState.getInCombat(),
  getCharacterName: () => runtimeConfig.profiles.find((p) => p.id === activeProfileId)?.name ?? "",
  getCharLevel: () => statsTracker.getLevel(),
  getCharDsu: () => statsTracker.getDsu(),
  getCharRazb: () => statsTracker.getRazb(),
  onEquipAll: () => broadcastServerEvent({ type: "equip_all" }),
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
const { state: navigationState, startNavigation, startNavigationToNearest, stopNavigation } = navigationController;

const listenerHub = createListenerHub();
const {
  mudTextHandlers,
  roomChangedListeners,
  roomRefreshListeners,
  sessionTeardownHooks,
  onceMudText,
  onceRoomChanged,
  onceRoomRefresh,
} = listenerHub;

/** Sends `см` and waits for the parser to re-process the current room. */
function refreshCurrentRoom(timeoutMs: number): Promise<number | null> {
  if (!sharedSession.tcpSocket || !sharedSession.connected) return Promise.resolve(null);
  const promise = onceRoomRefresh(timeoutMs);
  mudConnection.writeAndLogMudCommand(null, sharedSession.tcpSocket!, "см", "zone-script");
  return promise;
}

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

sessionTeardownHooks.add(() => farmController.handleSessionClosed("Session closed."));

const bazaarNotifier = createBazaarNotifier({
  telegramBotToken: runtimeConfig.telegramBotToken,
  telegramChatId: runtimeConfig.telegramChatId,
  getCurrentRoomId: () => trackerState.currentRoomId,
  getPathLength: async (fromVnum, toVnum) => {
    const snapshot = await mapStore.getSnapshot(fromVnum);
    const path = findPath(snapshot, fromVnum, toVnum);
    return path !== null ? path.length : null;
  },
  resolveAlias: (alias) => mapStore.resolveAliasAll(alias),
  navigateTo: (vnum) => startNavigation(null, vnum),
  onceRoomChanged: (timeoutMs) => onceRoomChanged(timeoutMs),
  isNavigating: () => navigationState.active,
  isInCombat: () => combatState.getInCombat(),
  sendCommand: sendMudCommand("bazaar-notifier"),
  onLog: logSession,
});

// Character stats tracker — parses MUD prompt / max-stats phrase and
// broadcasts stats_update + feeds farmController. Details live in ./server/stats.ts.
const statsTracker = createStatsTracker({
  broadcastServerEvent,
  onStatsChanged: (stats) => farmController.updateStats(stats),
});

const survivalTicker = createSurvivalTicker(survivalController);
const scheduleSurvivalTick = survivalTicker.schedule;

async function sendSurvivalSettings(ws: BunServerWebSocket): Promise<void> {
  const survival = await mapStore.getSurvivalSettings();
  sendServerEvent(ws, { type: "survival_settings_data", payload: survival });
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
  broadcastMapSnapshot,
  broadcastAliasesSnapshot,
  broadcastRoomAutoCommandsSnapshot,
  sendInitialSnapshot: sendMapSnapshot,
} = snapshots;

const { inspectContainer } = createContainerInspector({
  session: sharedSession,
  writeAndLogMudCommand: (ws, socket, cmd, origin) =>
    mudConnection.writeAndLogMudCommand(ws, socket, cmd, origin),
  waitForInspectResult: (ms) => containerTracker.waitForInspectResult(ms),
});

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

const mudTextFanout = createMudTextFanout({
  containerTracker,
  bazaarNotifier,
  lootSorter,
  mudTextPipeline,
  mudTextHandlers,
  rememberOutput,
  broadcastServerEvent,
  mapStore,
  logEvent,
});

await mapStore.initialize();

const savedSurvival = await mapStore.getSurvivalSettings();
if (savedSurvival) {
  survivalController.updateConfig(survivalSettingsToConfig(normalizeSurvivalSettings(savedSurvival)));
}

const savedTriggers = await mapStore.getTriggerSettings(activeProfileId);
if (savedTriggers) triggers.setEnabled(savedTriggers);

subscribeRoomAutoCommands({
  roomChangedListeners,
  getRoomAutoCommand: (vnum) => mapStore.getRoomAutoCommand(vnum),
  sendCommand: sendMudCommand("room-auto-cmd"),
});

const httpRoutes = createHttpRoutes({
  runtimeConfig,
  getCurrentMapSnapshot: () => getCurrentMapSnapshot(),
});

const initialStateSender = createInitialStateSender({
  runtimeConfig,
  farmController,
  triggers,
  survivalController,
  repairController,
  gatherController,
  combatState,
  statsTracker,
  session: sharedSession,
  mapStore,
  sendServerEvent,
  logEvent,
  getMapRecordingEnabled: () => mapRecordingEnabled,
  getRecentOutputChunks: () => recentOutputChunks,
  sendMapSnapshot,
  sendSurvivalSettings,
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

const server = createBunServer({
  runtimeConfig,
  logEvent,
  httpRoutes,
  initialStateSender,
  clientMessageRouter,
  browserClients,
  sendServerEvent,
  normalizeTextMessage,
});

logEvent(null, "session", `MUD client server listening on http://${server.hostname}:${server.port}`);
console.log(`MUD client server listening on http://${server.hostname}:${server.port}`);

if (runtimeConfig.autoConnect) {
  void mudConnection.connectToMud(null, { profileId: readLastProfileId() });
}
