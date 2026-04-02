import {
  DEFAULT_RETRY_DELAY_MS,
  DARK_ROOM_RETRY_DELAY_MS,
  MOVE_TIMEOUT_RETRY_DELAY_MS,
  MOB_PROBE_DELAY_MS,
} from "./types.ts";
import { getZoneId } from "./room.ts";
import { chooseNextDirection } from "./navigation.ts";
import { publishState, disable } from "./state.ts";
import { createLogger } from "./logger.ts";
import type { Farm2State, Farm2ControllerDependencies } from "./types.ts";

const PENDING_ROOM_SCAN_TIMEOUT_MS = 5000;

function splitWords(name: string): string[] {
  return name.trim().split(/\s+/).filter((w) => w.length > 0);
}

const PROBE_STOPWORD_REGEXP =
  /^(?:вы|вас|вам|ваш|ваши|ваших|его|её|ее|их|им|с|со|по|на|в|во|за|из|к|у|при|обводя|мимо|здесь|стоит|лежит|сидит|ходит|бродит|парит|летит|стоя|проходит|пробегает|проезжает|ползет|ползёт|крадется|крадётся)$/i;

function buildProbeList(roomLine: string): string[] {
  const words = splitWords(roomLine.replace(/[,.!?;:()]/g, ""))
    .map((w) => w.toLowerCase())
    .filter((w) => !PROBE_STOPWORD_REGEXP.test(w));

  const result: string[] = [];
  for (const word of words) {
    if (word.includes("-")) {
      for (const part of word.split("-")) {
        if (part.length > 0 && !result.includes(part)) result.push(part);
      }
      if (!result.includes(word)) result.push(word);
    } else {
      if (!result.includes(word)) result.push(word);
    }
  }
  return result;
}

async function resolveAttackTarget(
  state: Farm2State,
  deps: Farm2ControllerDependencies,
  currentRoomId: number,
): Promise<string | null> {
  const logger = createLogger(deps);

  if (state.currentVisibleTargets.size === 0) {
    logger.debug("resolveAttackTarget: no visible targets");
    return null;
  }

  logger.debug(`resolveAttackTarget: visibleTargets=[${[...state.currentVisibleTargets.keys()].join(", ")}]`);

  const zoneId = getZoneId(currentRoomId);
  const allMobNames = await deps.getMobCombatNamesByZone(zoneId);
  const mobNamesLower = allMobNames.map((n) => n.toLowerCase());

  logger.debug(`resolveAttackTarget: zone=${zoneId} knownMobs=[${allMobNames.join(", ")}]`);

  for (const [lowerName, roomLine] of state.currentVisibleTargets) {
    const matchIdx = mobNamesLower.findIndex(
      (mobName) => lowerName === mobName || lowerName.startsWith(mobName + " "),
    );
    if (matchIdx !== -1) {
      state.probeCombatNames = [];
      state.probeIndex = 0;
      state.probeSingleRoomName = null;
      const words = splitWords(allMobNames[matchIdx] ?? "");
      const target = words[words.length - 1] ?? null;
      logger.debug(`resolveAttackTarget: matched by zone list "${lowerName}" → attack "${target}"`);
      return target;
    }

    const combatName = await deps.getCombatNameByRoomName(roomLine);
    if (combatName) {
      state.probeCombatNames = [];
      state.probeIndex = 0;
      state.probeSingleRoomName = null;
      const words = splitWords(combatName);
      const target = words[words.length - 1] ?? null;
      logger.debug(`resolveAttackTarget: matched by db link "${roomLine}" → attack "${target}"`);
      return target;
    }

    logger.debug(`resolveAttackTarget: no db link for roomLine="${roomLine}"`);
  }

  if (state.probeCombatNames.length === 0) {
    const expanded: string[] = [];
    for (const roomLine of state.currentVisibleTargets.values()) {
      if (roomLine.startsWith("...")) {
        logger.debug(`resolveAttackTarget: skipping aura line="${roomLine}"`);
        continue;
      }
      const isBlacklisted = await deps.isRoomNameBlacklisted(roomLine);
      if (isBlacklisted) {
        logger.debug(`resolveAttackTarget: skipping blacklisted roomLine="${roomLine}"`);
        continue;
      }
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
    logger.debug(`resolveAttackTarget: built probe list=[${expanded.join(", ")}]`);
  }

  const now = Date.now();

  if (state.probeIndex >= state.probeCombatNames.length) {
    logger.debug("resolveAttackTarget: probe list exhausted, giving up");
    state.probeCombatNames = [];
    state.probeIndex = 0;
    state.probeSingleRoomName = null;
    return null;
  }

  if (now - state.probeLastAttemptAt < MOB_PROBE_DELAY_MS) {
    logger.debug(`resolveAttackTarget: probe throttled (${now - state.probeLastAttemptAt}ms < ${MOB_PROBE_DELAY_MS}ms)`);
    return null;
  }

  const rawWord = state.probeCombatNames[state.probeIndex] ?? "";
  state.probeIndex += 1;
  state.probeLastAttemptAt = now;

  // Safety: strip last 2 chars to avoid exact-name matches, but keep at least 3 chars.
  const combatName = rawWord.length <= 2 ? rawWord : rawWord.slice(0, Math.max(3, rawWord.length - 2));

  logger.debug(`resolveAttackTarget: probing word="${combatName}" (raw="${rawWord}", index ${state.probeIndex - 1})`);

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

    const target = await resolveAttackTarget(state, deps, currentRoomId);

    if (target !== null) {
      deps.sendCommand(`${state.config.attackCommand} ${target}`);
      state.attackSentAt = Date.now();
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
