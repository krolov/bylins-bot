import {
  DEFAULT_RETRY_DELAY_MS,
  DARK_ROOM_RETRY_DELAY_MS,
  MOVE_TIMEOUT_RETRY_DELAY_MS,
  MOB_PROBE_DELAY_MS,
} from "./types.ts";
import { getZoneId } from "./room.ts";
import { chooseNextDirection } from "./navigation.ts";
import { publishState, disable } from "./state.ts";
import type { Farm2State, Farm2ControllerDependencies } from "./types.ts";

function splitWords(name: string): string[] {
  return name.trim().split(/\s+/).filter((w) => w.length > 0);
}

function buildProbeList(roomLine: string): string[] {
  return splitWords(roomLine.replace(/[,.]/g, ""));
}

async function resolveAttackTarget(
  state: Farm2State,
  deps: Farm2ControllerDependencies,
  currentRoomId: number,
): Promise<string | null> {
  if (state.currentVisibleTargets.size === 0) {
    return null;
  }

  const zoneId = getZoneId(currentRoomId);
  const allMobNames = await deps.getMobCombatNamesByZone(zoneId);
  const mobNamesLower = allMobNames.map((n) => n.toLowerCase());

  for (const [lowerName, roomLine] of state.currentVisibleTargets) {
    const matchIdx = mobNamesLower.indexOf(lowerName);
    if (matchIdx !== -1) {
      state.probeCombatNames = [];
      state.probeIndex = 0;
      state.probeSingleRoomName = null;
      const words = splitWords(allMobNames[matchIdx] ?? "");
      return words[words.length - 1] ?? null;
    }

    const combatName = await deps.getCombatNameByRoomName(roomLine);
    if (combatName) {
      state.probeCombatNames = [];
      state.probeIndex = 0;
      state.probeSingleRoomName = null;
      const words = splitWords(combatName);
      return words[words.length - 1] ?? null;
    }
  }

  if (state.probeCombatNames.length === 0) {
    const expanded: string[] = [];
    for (const roomLine of state.currentVisibleTargets.values()) {
      for (const probe of buildProbeList(roomLine)) {
        if (!expanded.includes(probe)) expanded.push(probe);
      }
    }
    state.probeCombatNames = expanded;
    state.probeIndex = 0;
    if (state.currentVisibleTargets.size === 1) {
      state.probeSingleRoomName = [...state.currentVisibleTargets.values()][0] ?? null;
    } else {
      state.probeSingleRoomName = null;
    }
  }

  const now = Date.now();

  if (state.probeIndex >= state.probeCombatNames.length) {
    state.probeCombatNames = [];
    state.probeIndex = 0;
    state.probeSingleRoomName = null;
    return null;
  }

  if (now - state.probeLastAttemptAt < MOB_PROBE_DELAY_MS) {
    return null;
  }

  const combatName = state.probeCombatNames[state.probeIndex] ?? "";
  state.probeIndex += 1;
  state.probeLastAttemptAt = now;

  return combatName || null;
}

export function scheduleTick(state: Farm2State, runTickFn: () => Promise<void>, delayMs: number): void {
  if (!state.enabled) {
    return;
  }

  state.timer.schedule(runTickFn, delayMs);
}

export async function runTick(state: Farm2State, deps: Farm2ControllerDependencies): Promise<void> {
  if (!state.enabled || state.tickInFlight) {
    return;
  }

  state.tickInFlight = true;

  const schedule = (delayMs: number) => scheduleTick(state, () => runTick(state, deps), delayMs);

  try {
    if (!deps.isConnected()) {
      schedule(DEFAULT_RETRY_DELAY_MS);
      return;
    }

    const currentRoomId = deps.getCurrentRoomId();

    if (currentRoomId === null) {
      schedule(DEFAULT_RETRY_DELAY_MS);
      return;
    }

    if (state.isDark) {
      schedule(DARK_ROOM_RETRY_DELAY_MS);
      return;
    }

    if (state.zoneId === null) {
      state.zoneId = getZoneId(currentRoomId);
      state.pendingActivation = false;
      publishState(state, deps);
    }

    if (getZoneId(currentRoomId) !== state.zoneId) {
      disable(state, deps, `[farm2] Stopped: left zone ${state.zoneId}.`);
      return;
    }

    const waitMs = state.nextActionAt - Date.now();
    if (waitMs > 0) {
      schedule(waitMs);
      return;
    }

    if (deps.combatState.getInCombat()) {
      schedule(DEFAULT_RETRY_DELAY_MS);
      return;
    }

    if (state.pendingRoomScanAfterKill) {
      schedule(DEFAULT_RETRY_DELAY_MS);
      return;
    }

    const target = await resolveAttackTarget(state, deps, currentRoomId);

    if (target !== null) {
      deps.onLog(`[farm2] Attacking: ${state.config.attackCommand} ${target}`);
      deps.sendCommand(`${state.config.attackCommand} ${target}`);
      schedule(DEFAULT_RETRY_DELAY_MS);
      return;
    }

    if (target === null && state.probeCombatNames.length > 0) {
      if (state.currentVisibleTargets.size === 0) {
        state.probeCombatNames = [];
        state.probeIndex = 0;
        state.probeSingleRoomName = null;
      } else {
        schedule(DEFAULT_RETRY_DELAY_MS);
        return;
      }
    }

    const snapshot = await deps.getSnapshot(currentRoomId);
    const nextDirection = chooseNextDirection(
      snapshot,
      currentRoomId,
      state.zoneId,
      state.roomVisitOrder,
      state.lastMoveFromRoomId,
    );

    if (!nextDirection) {
      deps.onLog("[farm2] All zone rooms visited — starting new sweep.");
      state.roomVisitOrder.clear();
      state.visitSequence = 0;
      state.lastRecordedRoomId = null;
      state.lastMoveFromRoomId = null;
      schedule(DEFAULT_RETRY_DELAY_MS);
      return;
    }

    state.lastMoveFromRoomId = currentRoomId;
    const moveResult = await deps.move(nextDirection);

    if (moveResult === "blocked") {
      deps.onLog(`[farm2] Movement blocked (${nextDirection}) — trying another direction.`);
      const blockedEdge = snapshot.edges.find(
        (e) => e.fromVnum === currentRoomId && e.direction === nextDirection && !e.isPortal,
      );
      if (blockedEdge) {
        state.roomVisitOrder.set(blockedEdge.toVnum, Number.MAX_SAFE_INTEGER);
      }
      state.lastMoveFromRoomId = null;
      schedule(DEFAULT_RETRY_DELAY_MS);
      return;
    }

    if (moveResult === "timeout") {
      schedule(MOVE_TIMEOUT_RETRY_DELAY_MS);
      return;
    }

    schedule(DEFAULT_RETRY_DELAY_MS);
  } finally {
    state.tickInFlight = false;
  }
}
