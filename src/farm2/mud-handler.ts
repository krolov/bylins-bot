import {
  TARGET_NOT_VISIBLE_REGEXP,
  MOB_DEATH_REGEXP,
} from "./types.ts";
import { stripAnsi, getZoneId } from "./room.ts";
import { settingsToConfig } from "./config.ts";
import { publishState, markRoomVisited, disable } from "./state.ts";
import { scheduleTick, runTick } from "./tick.ts";
import type { Farm2State, Farm2ControllerDependencies } from "./types.ts";

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
  },
): void {
  const normalized = stripAnsi(text).replace(/\r/g, "");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const schedule = (delayMs: number) => scheduleTick(state, () => runTick(state, deps), delayMs);

  if (options.roomChanged || (options.roomDescriptionReceived && state.pendingRoomScanAfterKill)) {
    const prevTargetKeys = new Set(state.currentVisibleTargets.keys());
    state.currentVisibleTargets.clear();
    for (const name of options.mobsInRoom) {
      state.currentVisibleTargets.set(name.toLowerCase(), name);
    }
    const mobListChanged =
      state.currentVisibleTargets.size !== prevTargetKeys.size ||
      [...state.currentVisibleTargets.keys()].some((k) => !prevTargetKeys.has(k));

    if (options.roomChanged || mobListChanged) {
      state.probeCombatNames = [];
      state.probeIndex = 0;
      state.probeSingleRoomName = null;
      state.probeLastAttemptAt = 0;
    }
    if (options.roomChanged) {
      state.isDark = false;
    }
    state.pendingRoomScanAfterKill = false;
  }

  if (deps.combatState.getInCombat()) {
    if (state.probeSingleRoomName !== null && options.combatMobNames.length > 0) {
      const combatName = options.combatMobNames[0];
      const roomName = state.probeSingleRoomName;
      const vnum = options.currentRoomId;
      state.probeSingleRoomName = null;
      void deps.linkMobRoomAndCombatName(roomName, combatName, vnum).catch(() => {});
    }
  }

  if (TARGET_NOT_VISIBLE_REGEXP.test(normalized)) {
    state.nextActionAt = 0;
    if (state.enabled && !state.pendingRoomScanAfterKill) {
      state.pendingRoomScanAfterKill = true;
      deps.reinitRoom();
    }
  }

  for (const line of lines) {
    if (!options.roomChanged && MOB_DEATH_REGEXP.test(line) && state.enabled && !state.pendingRoomScanAfterKill) {
      state.pendingRoomScanAfterKill = true;
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
      void deps.getZoneSettings(zoneId).then((zoneSettings) => {
        if (zoneSettings) {
          state.config = settingsToConfig(zoneSettings);
          deps.onLog(`[farm2] Zone ${zoneId} settings loaded (attack: ${state.config.attackCommand}).`);
        } else {
          deps.onLog(`[farm2] Zone ${zoneId} settings not found, using defaults.`);
        }
        publishState(state, deps);
        deps.onLog(`[farm2] Enabled for zone ${zoneId}.`);
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
      disable(state, deps, `[farm2] Stopped: left zone ${state.zoneId}.`);
      return;
    }

    const remainingWait = state.nextActionAt - Date.now();
    if (remainingWait <= 0) {
      schedule(TARGET_NOT_VISIBLE_REGEXP.test(normalized) ? 50 : 150);
    }
  }
}

export function handleSessionClosed(
  state: Farm2State,
  deps: Farm2ControllerDependencies,
  reason: string,
): void {
  if (state.enabled) {
    disable(state, deps, `[farm2] Stopped: ${reason}`);
  } else {
    state.timer.clear();
  }
}
