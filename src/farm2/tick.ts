import {
  DEFAULT_RETRY_DELAY_MS,
  DARK_ROOM_RETRY_DELAY_MS,
  MOVE_TIMEOUT_RETRY_DELAY_MS,
} from "./types.ts";
import { getZoneId } from "./room.ts";
import { chooseNextDirection } from "./navigation.ts";
import { publishState, disable } from "./state.ts";
import { resolveAttackTarget, resetMobProbeState } from "../mob-resolver.ts";
import type { Farm2State, Farm2ControllerDependencies } from "./types.ts";

const PENDING_ROOM_SCAN_TIMEOUT_MS = 5000;

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
      disable(state, deps);
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
      if (Date.now() - state.pendingRoomScanSetAt > PENDING_ROOM_SCAN_TIMEOUT_MS) {
        state.pendingRoomScanAfterKill = false;
        state.pendingRoomScanSetAt = 0;
      } else {
        schedule(DEFAULT_RETRY_DELAY_MS);
        return;
      }
    }

    const target = await resolveAttackTarget(state.probe, state.currentVisibleTargets, currentRoomId, deps);

    if (target !== null) {
      deps.sendCommand(`${state.config.attackCommand} ${target}`);
      state.attackSentAt = Date.now();
      schedule(DEFAULT_RETRY_DELAY_MS);
      return;
    }

    if (target === null && state.probe.combatNames.length > 0) {
      if (state.currentVisibleTargets.size === 0) {
        resetMobProbeState(state.probe);
      } else {
        schedule(DEFAULT_RETRY_DELAY_MS);
        return;
      }
    }

    const snapshot = await deps.getSnapshot(currentRoomId);
    const zoneRoomVnums = snapshot.nodes
      .filter((n) => Math.floor(n.vnum / 100) === state.zoneId)
      .map((n) => n.vnum);
    const nextDirection = chooseNextDirection(
      snapshot,
      currentRoomId,
      zoneRoomVnums,
      state.roomVisitOrder,
      state.lastMoveFromRoomId,
    );

    if (!nextDirection) {
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
      const timedOutEdge = snapshot.edges.find(
        (e) => e.fromVnum === currentRoomId && e.direction === nextDirection && !e.isPortal,
      );
      if (timedOutEdge) {
        state.roomVisitOrder.set(timedOutEdge.toVnum, Number.MAX_SAFE_INTEGER);
      }
      state.lastMoveFromRoomId = null;
      schedule(MOVE_TIMEOUT_RETRY_DELAY_MS);
      return;
    }

    schedule(DEFAULT_RETRY_DELAY_MS);
  } finally {
    state.tickInFlight = false;
  }
}
