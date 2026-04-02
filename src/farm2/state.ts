import { DEFAULT_RETRY_DELAY_MS } from "./types.ts";
import { defaultConfig, settingsToConfig } from "./config.ts";
import { getZoneId } from "./room.ts";
import { createTickTimer } from "../utils/timer.ts";
import type { Farm2State, Farm2StateSnapshot, Farm2ControllerDependencies, Farm2Config } from "./types.ts";

export function createInitialState(config: Farm2Config): Farm2State {
  return {
    enabled: false,
    zoneId: null,
    pendingActivation: false,
    timer: createTickTimer(),
    tickInFlight: false,
    nextActionAt: 0,
    currentVisibleTargets: new Map<string, string>(),
    pendingRoomScanAfterKill: false,
    roomVisitOrder: new Map<number, number>(),
    visitSequence: 0,
    lastRecordedRoomId: null,
    lastMoveFromRoomId: null,
    isDark: false,
    config,
    stats: { hp: 0, hpMax: 0, energy: 0, energyMax: 0 },
    probeCombatNames: [],
    probeIndex: 0,
    probeSingleRoomName: null,
    probeLastAttemptAt: 0,
    pendingRoomScanSetAt: 0,
    lastRoomCorpseCount: 0,
    attackSentAt: 0,
  };
}

export function getStateSnapshot(state: Farm2State): Farm2StateSnapshot {
  return {
    enabled: state.enabled,
    zoneId: state.zoneId,
    pendingActivation: state.pendingActivation,
    attackCommand: state.config.attackCommand,
    targetValues: [...state.config.targetValues],
  };
}

export function publishState(state: Farm2State, deps: Pick<Farm2ControllerDependencies, "onStateChange">): void {
  deps.onStateChange(getStateSnapshot(state));
}

export function markRoomVisited(state: Farm2State, roomId: number | null): void {
  if (roomId === null || state.lastRecordedRoomId === roomId) {
    return;
  }

  state.visitSequence += 1;
  state.roomVisitOrder.set(roomId, state.visitSequence);
  state.lastRecordedRoomId = roomId;
}

export function resetTrackingState(state: Farm2State): void {
  state.nextActionAt = 0;
  state.currentVisibleTargets.clear();
  state.pendingRoomScanAfterKill = false;
  state.roomVisitOrder.clear();
  state.visitSequence = 0;
  state.lastRecordedRoomId = null;
  state.lastMoveFromRoomId = null;
  state.isDark = false;
  state.probeCombatNames = [];
  state.probeIndex = 0;
  state.probeSingleRoomName = null;
  state.probeLastAttemptAt = 0;
  state.pendingRoomScanSetAt = 0;
  state.lastRoomCorpseCount = 0;
  state.attackSentAt = 0;
}

export function disable(
  state: Farm2State,
  deps: Pick<Farm2ControllerDependencies, "onStateChange">,
): void {
  state.timer.clear();
  state.enabled = false;
  state.zoneId = null;
  state.pendingActivation = false;
  resetTrackingState(state);
  publishState(state, deps);
}

export async function enable(
  state: Farm2State,
  deps: Farm2ControllerDependencies,
  scheduleFn: (delayMs: number) => void,
): Promise<void> {
  state.timer.clear();
  resetTrackingState(state);

  state.enabled = true;
  state.config = defaultConfig();

  const currentRoomId = deps.getCurrentRoomId();

  if (currentRoomId === null) {
    state.zoneId = null;
    state.pendingActivation = true;
    publishState(state, deps);
    deps.reinitRoom();
    scheduleFn(DEFAULT_RETRY_DELAY_MS);
    return;
  }

  const zoneId = getZoneId(currentRoomId);
  state.zoneId = zoneId;
  state.pendingActivation = false;

  const [zoneSettings, mobNames] = await Promise.all([
    deps.getZoneSettings(zoneId),
    deps.getMobCombatNamesByZone(zoneId),
  ]);
  if (zoneSettings) {
    state.config = settingsToConfig(zoneSettings, mobNames.map((n) => n.toLowerCase()));
  }

  markRoomVisited(state, currentRoomId);
  publishState(state, deps);
  deps.reinitRoom();
  scheduleFn(DEFAULT_RETRY_DELAY_MS);
}

export function setEnabled(
  enabled: boolean,
  state: Farm2State,
  deps: Farm2ControllerDependencies,
  scheduleFn: (delayMs: number) => void,
): void {
  if (enabled) {
    void enable(state, deps, scheduleFn);
    return;
  }

  disable(state, deps);
}
