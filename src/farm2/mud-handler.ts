import {
  TARGET_NOT_VISIBLE_REGEXP,
  MOB_DEATH_REGEXP,
} from "./types.ts";
import { stripAnsi, getZoneId } from "./room.ts";
import { settingsToConfig } from "./config.ts";
import { publishState, markRoomVisited, disable } from "./state.ts";
import { scheduleTick, runTick } from "./tick.ts";
import { createLogger } from "./logger.ts";
import { resetMobProbeState } from "../mob-resolver.ts";
import type { Farm2State, Farm2ControllerDependencies } from "./types.ts";

function sendSkinningSalvo(state: Farm2State, deps: Farm2ControllerDependencies): void {
  if (!state.config.skinningSalvoEnabled) {
    return;
  }
  const count = state.lastRoomCorpseCount;
  if (count <= 0) {
    return;
  }
  for (let i = count; i >= 1; i--) {
    deps.sendCommand(`${state.config.skinningSkinVerb} ${i}.тр`);
  }
  deps.sendCommand(state.config.lootMeatCommand);
  deps.sendCommand(state.config.lootHideCommand);
}

export function handleMudText(
  state: Farm2State,
  deps: Farm2ControllerDependencies,
  text: string,
  options: {
    roomChanged: boolean;
    roomDescriptionReceived: boolean;
    currentRoomId: number | null;
    mobsInRoom: string[];
    combatMobNames: string[];
    corpseCount: number;
  },
): void {
  const logger = createLogger(deps);
  const normalized = stripAnsi(text).replace(/\r/g, "");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const schedule = (delayMs: number) => scheduleTick(state, () => runTick(state, deps), delayMs);

  if (options.roomDescriptionReceived) {
    state.lastRoomCorpseCount = options.corpseCount;
  }

  if (options.roomChanged || (options.roomDescriptionReceived && state.pendingRoomScanAfterKill)) {
    const prevTargetKeys = new Set(state.currentVisibleTargets.keys());
    state.currentVisibleTargets.clear();
    for (const name of options.mobsInRoom) {
      state.currentVisibleTargets.set(name.toLowerCase(), name);
    }
    const mobListChanged =
      state.currentVisibleTargets.size !== prevTargetKeys.size ||
      [...state.currentVisibleTargets.keys()].some((k) => !prevTargetKeys.has(k));

    logger.debug(
      `handleMudText: roomChanged=${options.roomChanged} scanAfterKill=${state.pendingRoomScanAfterKill} ` +
      `mobsInRoom=[${options.mobsInRoom.join(", ")}] visibleTargets=[${[...state.currentVisibleTargets.keys()].join(", ")}] mobListChanged=${mobListChanged}`,
    );

    if (options.roomChanged || mobListChanged) {
      resetMobProbeState(state.probe);
    }
    if (options.roomChanged) {
      state.isDark = false;
    }
    state.pendingRoomScanAfterKill = false;

    if (
      state.enabled &&
      options.roomDescriptionReceived &&
      options.corpseCount > 0 &&
      options.mobsInRoom.length === 0
    ) {
      sendSkinningSalvo(state, deps);
    }
  }

  if (deps.combatState.getInCombat()) {
    if (state.probe.singleRoomName !== null && options.combatMobNames.length > 0) {
      const combatName = options.combatMobNames[0];
      const roomName = state.probe.singleRoomName;
      const vnum = options.currentRoomId;
      state.probe.singleRoomName = null;
      void deps.linkMobRoomAndCombatName(roomName, combatName, vnum).catch(() => {});
    }
  }

  if (TARGET_NOT_VISIBLE_REGEXP.test(normalized)) {
    state.nextActionAt = 0;
    if (state.enabled && !state.pendingRoomScanAfterKill) {
      state.pendingRoomScanAfterKill = true;
      state.pendingRoomScanSetAt = Date.now();
      sendSkinningSalvo(state, deps);
      deps.reinitRoom();
    }
  }

  for (const line of lines) {
    if (!options.roomChanged && MOB_DEATH_REGEXP.test(line) && state.enabled && !state.pendingRoomScanAfterKill) {
      state.pendingRoomScanAfterKill = true;
      state.pendingRoomScanSetAt = Date.now();
      sendSkinningSalvo(state, deps);
      deps.reinitRoom();
      break;
    }
  }

  if (state.enabled) {
    markRoomVisited(state, options.currentRoomId);

    if (state.pendingActivation && options.currentRoomId !== null) {
      const zoneId = getZoneId(options.currentRoomId);
      state.zoneId = zoneId;
      state.pendingActivation = false;
      markRoomVisited(state, options.currentRoomId);
      void Promise.all([
        deps.getZoneSettings(zoneId),
        deps.getMobCombatNamesByZone(zoneId),
      ]).then(([zoneSettings, mobNames]) => {
        if (zoneSettings) {
          state.config = settingsToConfig(zoneSettings, mobNames.map((n) => n.toLowerCase()));
        }
        publishState(state, deps);
        deps.reinitRoom();
        state.pendingRoomScanAfterKill = true;
      });
      return;
    }

    if (
      options.currentRoomId !== null &&
      state.zoneId !== null &&
      getZoneId(options.currentRoomId) !== state.zoneId
    ) {
      disable(state, deps);
      return;
    }

    const remainingWait = state.nextActionAt - Date.now();
    if (remainingWait <= 0) {
      schedule(TARGET_NOT_VISIBLE_REGEXP.test(normalized) ? 50 : 150);
    }
  }

  if (
    !state.enabled &&
    state.recalling &&
    options.currentRoomId !== null &&
    state.zoneId !== null &&
    getZoneId(options.currentRoomId) !== state.zoneId
  ) {
    state.recalling = false;
    state.recallTimer.clear();
    state.zoneId = null;
    if (state.loopEnabled) {
      const logger = createLogger(deps);
      logger.info(`Recall complete — loop restart scheduled in ${state.loopDelayMs / 60000} min`);
      state.loopRestartScheduledAt = Date.now();
    }
  }
}

export function handleSessionClosed(
  state: Farm2State,
  deps: Farm2ControllerDependencies,
  reason: string,
): void {
  if (state.enabled) {
    disable(state, deps);
  } else {
    state.timer.clear();
  }
}
