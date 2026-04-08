import { chooseNextDirection } from "../farm2/navigation.ts";
import { OPPOSITE_DIRECTION } from "../farm2/types.ts";
import { parseMobsFromRoomDescription, resolveAttackTarget, createMobProbeState, resetMobProbeState } from "../mob-resolver.ts";
import type { ZoneScriptDeps } from "./types.ts";
import type { Direction } from "../map/types.ts";

const TICK_INTERVAL_MS = 600;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const MOVE_BLOCKED_PENALTY = Number.MAX_SAFE_INTEGER;
const ROOM_ARRIVED_TIMEOUT_MS = 5_000;

const DIRECTION_TO_COMMAND: Record<Direction, string> = {
  north: "с",
  south: "ю",
  east: "в",
  west: "з",
  up: "вв",
  down: "вн",
};

type StealthPhase = "sneaking" | "fleeing" | "waiting_safe";

interface FarmZoneStepParams {
  entryVnum: number;
  roomVnums?: number[];
  routeVnums?: number[];
  targetValues: string[];
  idleTimeoutMs?: number;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

type RoutePhase = "moving" | "fleeing" | "waiting_safe";

function waitForCombat(deps: ZoneScriptDeps, signal: AbortSignal, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (deps.combatState.getInCombat()) { resolve(true); return; }
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
    const onAbort = () => { cleanup(); resolve(false); };
    signal.addEventListener("abort", onAbort, { once: true });
    const poll = setInterval(() => {
      if (deps.combatState.getInCombat()) { cleanup(); resolve(true); }
    }, 100);
    function cleanup() { clearTimeout(timer); clearInterval(poll); signal.removeEventListener("abort", onAbort); }
  });
}

async function executeRouteMode(
  routeVnums: number[],
  targetValues: string[],
  idleTimeoutMs: number,
  stealth: boolean,
  probe: ReturnType<typeof createMobProbeState>,
  deps: ZoneScriptDeps,
  signal: AbortSignal,
  initialLastCombatAt: number,
): Promise<void> {
  let routeIndex = 0;
  let phase: RoutePhase = "moving";
  let lastCombatAt = initialLastCombatAt;
  let didSneak = false;
  let prevInCombat = false;
  let lootPending = false;
  let lastMoveDirection: Direction | null = null;

  deps.onLog(`farm_zone[route]: started steps=${routeVnums.length} stealth=${stealth} idleTimeout=${idleTimeoutMs}ms`);

  while (!signal.aborted) {
    const inCombat = deps.combatState.getInCombat();
    const currentRoomId = deps.getCurrentRoomId();

    deps.onLog(`farm_zone[route]: tick phase=${phase} inCombat=${inCombat} routeIndex=${routeIndex} room=${currentRoomId}`);

    if (inCombat) {
      lastCombatAt = Date.now();
      if (phase === "moving") {
        phase = "fleeing";
        didSneak = false;
        deps.onLog(`farm_zone[route]: combat detected — switching to fleeing`);
      }
    }

    prevInCombat = inCombat;

    if (phase === "fleeing") {
      if (!inCombat) {
        phase = "waiting_safe";
        resetMobProbeState(probe);
        deps.onLog(`farm_zone[route]: safe — waiting_safe`);
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      }
      if (lastMoveDirection !== null) {
        const fleeDir = DIRECTION_TO_COMMAND[OPPOSITE_DIRECTION[lastMoveDirection]];
        deps.onLog(`farm_zone[route]: fleeing — sending "беж ${fleeDir}" (lastMoveDirection=${lastMoveDirection})`);
        const waitPromise = deps.onceRoomChanged(ROOM_ARRIVED_TIMEOUT_MS);
        deps.sendCommand(`беж ${fleeDir}`);
        try {
          await waitPromise;
          lastMoveDirection = null;
          deps.onLog(`farm_zone[route]: flee landed in room=${deps.getCurrentRoomId()}`);
        } catch (_ignored) {
          deps.onLog(`farm_zone[route]: flee room-change timeout — retrying`);
        }
      } else {
        deps.onLog(`farm_zone[route]: no lastMoveDirection — sending "беж"`);
        const waitPromise = deps.onceRoomChanged(ROOM_ARRIVED_TIMEOUT_MS);
        deps.sendCommand("беж");
        try {
          await waitPromise;
          deps.onLog(`farm_zone[route]: flee landed in room=${deps.getCurrentRoomId()}`);
        } catch (_ignored) {
          deps.onLog(`farm_zone[route]: flee room-change timeout`);
        }
      }
      continue;
    }

    if (phase === "waiting_safe") {
      if (inCombat) {
        phase = "fleeing";
        deps.onLog(`farm_zone[route]: combat in waiting_safe — fleeing`);
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      }
      phase = "moving";
      const prevIndex = (routeIndex - 1 + routeVnums.length) % routeVnums.length;
      const prevVnum = routeVnums[prevIndex];
      deps.onLog(`farm_zone[route]: returning to prev route vnum=${prevVnum} (index=${prevIndex})`);
      await deps.navigateTo(prevVnum);
      if (signal.aborted) return;
      routeIndex = prevIndex;
      deps.onLog(`farm_zone[route]: resumed at ${deps.getCurrentRoomId()} routeIndex=${routeIndex}`);
      await sleep(TICK_INTERVAL_MS, signal);
      continue;
    }

    const idleMs = Date.now() - lastCombatAt;
    if (idleMs >= idleTimeoutMs) {
      deps.onLog(`farm_zone[route]: zone cleared after ${idleMs}ms idle`);
      return;
    }

    if (currentRoomId === null) {
      await sleep(TICK_INTERVAL_MS, signal);
      continue;
    }

    const rawTargets = deps.getVisibleTargets();
    const visibleTargets = parseMobsFromRoomDescription([...rawTargets.values()], targetValues);
    deps.onLog(`farm_zone[route]: room=${currentRoomId} visibleTargets=${visibleTargets.size} didSneak=${didSneak}`);

    if (visibleTargets.size > 0) {
      if (stealth) {
        deps.onLog(`farm_zone[route]: attacking ${visibleTargets.size} target(s) via закол (didSneak=${didSneak})`);
        didSneak = false;
        if (!lootPending) {
          lootPending = true;
          void deps.onMudTextOnce(/мертв[а]?,\s*(?:его|её|ее)\s*душа/i, 15_000).then(async () => {
            deps.sendCommand("взя все.тр");
            deps.sendCommand("взя все все.тр");
            deps.sendCommand("бро все.тр");
            await deps.autoSortInventory();
          }).catch(() => {
            deps.onLog(`farm_zone[route]: death phrase timeout — no loot`);
          }).finally(() => {
            lootPending = false;
          });
        }
        for (const target of targetValues) {
          deps.sendCommand(`закол ${target}`);
        }
        await deps.onMudTextOnce(/мертв[а]?,\s*(?:его|её|ее)\s*душа|кого вы так сильно ненавидите/i, 3_000).catch(() => {});
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      } else {
        const target = [...visibleTargets.keys()][0];
        deps.onLog(`farm_zone[route]: attacking "${target}" via заколоть`);
        deps.sendCommand(`заколоть ${target}`);
        deps.reinitRoom();
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      }
    }

    resetMobProbeState(probe);

    const targetVnum = routeVnums[routeIndex];

    if (currentRoomId === targetVnum) {
      routeIndex = (routeIndex + 1) % routeVnums.length;
      deps.onLog(`farm_zone[route]: at target vnum=${targetVnum}, advancing to routeIndex=${routeIndex}`);
      continue;
    }

    const nextVnum = routeVnums[routeIndex];
    if (stealth) {
      deps.onLog(`farm_zone[route]: sneaking toward vnum=${nextVnum}`);
      const snapshot = await deps.getSnapshot(currentRoomId);
      const edge = snapshot.edges.find((e) => e.fromVnum === currentRoomId && e.toVnum === nextVnum && !e.isPortal);
      if (edge) {
        const cmd = DIRECTION_TO_COMMAND[edge.direction];
        const waitPromise = deps.onceRoomChanged(ROOM_ARRIVED_TIMEOUT_MS);
        deps.sendCommand(`краст ${cmd}`);
        try {
          await waitPromise;
          didSneak = true;
          lastMoveDirection = edge.direction;
          deps.onLog(`farm_zone[route]: sneak succeeded → room=${deps.getCurrentRoomId()}`);
        } catch (_ignored) {
          didSneak = false;
          lastMoveDirection = null;
          deps.onLog(`farm_zone[route]: sneak timed out`);
          await sleep(TICK_INTERVAL_MS, signal);
        }
      } else {
        deps.onLog(`farm_zone[route]: no direct edge to ${nextVnum} — navigating`);
        await deps.navigateTo(nextVnum);
        didSneak = false;
        if (signal.aborted) return;
      }
    } else {
      deps.onLog(`farm_zone[route]: navigating to vnum=${nextVnum}`);
      await deps.navigateTo(nextVnum);
      if (signal.aborted) return;
    }
  }
  if (signal.aborted) {
    deps.onLog(`farm_zone[route]: stopped — user aborted zoning`);
  }
}

export async function executeFarmZoneStep(
  params: FarmZoneStepParams,
  deps: ZoneScriptDeps,
  signal: AbortSignal,
): Promise<void> {
  const { entryVnum, roomVnums = [], routeVnums, targetValues, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = params;

  await deps.navigateTo(entryVnum);

  if (signal.aborted) return;

  const stealth = deps.isStealthProfile();
  deps.onLog(`farm_zone: isStealthProfile=${stealth}`);

  const probe = createMobProbeState();
  let lastCombatAt = Date.now();

  if (routeVnums && routeVnums.length > 0) {
    await executeRouteMode(routeVnums, targetValues, idleTimeoutMs, stealth, probe, deps, signal, lastCombatAt);
    return;
  }

  const roomVisitOrder = new Map<number, number>();
  let visitSequence = 0;
  let lastMoveFromRoomId: number | null = null;
  let lastMoveDirection: Direction | null = null;

  if (!stealth) {
    let wasInCombat = false;

    deps.onLog(`farm_zone: started rooms=${roomVnums.length} entry=${entryVnum} idleTimeout=${idleTimeoutMs}ms`);

    while (!signal.aborted) {
      if (deps.combatState.getInCombat()) {
        lastCombatAt = Date.now();
        wasInCombat = true;
        resetMobProbeState(probe);
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      }

      if (wasInCombat) {
        wasInCombat = false;
        await sleep(TICK_INTERVAL_MS, signal);
      }

      const idleMs = Date.now() - lastCombatAt;
      if (idleMs >= idleTimeoutMs) {
        deps.onLog(`farm_zone: cleared after ${idleMs}ms idle`);
        return;
      }

      const currentRoomId = deps.getCurrentRoomId();
      if (currentRoomId === null) {
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      }

      const rawTargets = deps.getVisibleTargets();
      const visibleTargets = parseMobsFromRoomDescription([...rawTargets.values()], targetValues);

      if (visibleTargets.size > 0) {
        const target = await resolveAttackTarget(probe, visibleTargets, currentRoomId, deps.mobResolver);
        if (target !== null) {
          deps.sendCommand(`заколоть ${target}`);
          await sleep(TICK_INTERVAL_MS, signal);
          continue;
        }
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      }

      resetMobProbeState(probe);

      const snapshot = await deps.getSnapshot(currentRoomId);
      const nextDirection = chooseNextDirection(snapshot, currentRoomId, roomVnums, roomVisitOrder, lastMoveFromRoomId);

      if (!nextDirection) {
        roomVisitOrder.clear();
        visitSequence = 0;
        lastMoveFromRoomId = null;
        lastMoveDirection = null;
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      }

      visitSequence += 1;
      roomVisitOrder.set(currentRoomId, visitSequence);
      lastMoveFromRoomId = currentRoomId;
      lastMoveDirection = nextDirection;

      const moveResult = await deps.move(nextDirection);

      if (moveResult !== "ok") {
        const blockedEdge = snapshot.edges.find(
          (e) => e.fromVnum === currentRoomId && e.direction === nextDirection && !e.isPortal,
        );
        if (blockedEdge) {
          roomVisitOrder.set(blockedEdge.toVnum, MOVE_BLOCKED_PENALTY);
        }
        lastMoveFromRoomId = null;
        lastMoveDirection = null;
      }

      await sleep(TICK_INTERVAL_MS, signal);
    }

    return;
  }

  let phase: StealthPhase = "sneaking";
  const preAttackRoomStack: Array<{ room: number; direction: Direction | null }> = [];
  let didSneak = false;
  let pendingResumeDirection: Direction | null = null;

  deps.onLog(`farm_zone[stealth]: started rooms=${roomVnums.length} entry=${entryVnum}`);

  while (!signal.aborted) {
    const inCombat = deps.combatState.getInCombat();
    const currentRoomIdDbg = deps.getCurrentRoomId();
    deps.onLog(`farm_zone[stealth]: tick phase=${phase} inCombat=${inCombat} didSneak=${didSneak} room=${currentRoomIdDbg} stack=[${preAttackRoomStack.join(",")}]`);

    if (inCombat) {
      lastCombatAt = Date.now();

      if (phase === "sneaking") {
        const attackEntry = { room: lastMoveFromRoomId ?? entryVnum, direction: lastMoveDirection };
        preAttackRoomStack.push(attackEntry);
        didSneak = false;
        phase = "fleeing";
        deps.onLog(`farm_zone[stealth]: combat detected in sneaking — pushed room ${attackEntry.room} dir=${attackEntry.direction} to stack, stack=[${preAttackRoomStack.map((e) => `${e.room}:${e.direction}`).join(",")}]`);
      }
    }

    if (phase === "fleeing") {
      if (!inCombat) {
        phase = "waiting_safe";
        resetMobProbeState(probe);
        roomVisitOrder.clear();
        visitSequence = 0;
        deps.onLog(`farm_zone[stealth]: reached safe zone (room=${currentRoomIdDbg}) — transitioning to waiting_safe`);
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      }

      if (lastMoveDirection !== null) {
        const fleeDir = DIRECTION_TO_COMMAND[OPPOSITE_DIRECTION[lastMoveDirection]];
        deps.onLog(`farm_zone[stealth]: fleeing — sending "беж ${fleeDir}" (lastMoveDirection=${lastMoveDirection})`);
        const waitPromise = deps.onceRoomChanged(ROOM_ARRIVED_TIMEOUT_MS);
        deps.sendCommand(`беж ${fleeDir}`);
        lastMoveDirection = null;
        lastMoveFromRoomId = null;
        try {
          await waitPromise;
          deps.onLog(`farm_zone[stealth]: flee landed in room=${deps.getCurrentRoomId()}`);
        } catch (_ignored) {
          deps.onLog(`farm_zone[stealth]: flee room-change timeout — still in room=${deps.getCurrentRoomId()}`);
        }
      } else {
        deps.onLog(`farm_zone[stealth]: no lastMoveDirection to flee — navigating back to entry ${entryVnum}`);
        await deps.navigateTo(entryVnum);
        lastMoveDirection = null;
        lastMoveFromRoomId = null;
      }

      continue;
    }

    if (phase === "waiting_safe") {
      if (inCombat) {
        phase = "fleeing";
        deps.onLog(`farm_zone[stealth]: combat in waiting_safe (room=${currentRoomIdDbg}) — switching to fleeing`);
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      }

      phase = "sneaking";
      const attackEntry = preAttackRoomStack.pop() ?? null;
      deps.onLog(`farm_zone[stealth]: waiting_safe → sneaking, targetRoom=${attackEntry?.room ?? null} dir=${attackEntry?.direction ?? null} stack=[${preAttackRoomStack.map((e) => `${e.room}:${e.direction}`).join(",")}] currentRoom=${currentRoomIdDbg}`);

      if (attackEntry !== null) {
        if (deps.getCurrentRoomId() !== attackEntry.room) {
          deps.onLog(`farm_zone[stealth]: navigating to pre-attack room ${attackEntry.room}`);
          await deps.navigateTo(attackEntry.room);
          if (signal.aborted) return;
          deps.onLog(`farm_zone[stealth]: arrived at ${deps.getCurrentRoomId()} (expected ${attackEntry.room})`);
        } else {
          deps.onLog(`farm_zone[stealth]: already at pre-attack room ${attackEntry.room}, skipping navigate`);
        }
        lastMoveFromRoomId = null;
        lastMoveDirection = null;
        pendingResumeDirection = attackEntry.direction;
      }
    }

    const idleMs = Date.now() - lastCombatAt;
    if (idleMs >= idleTimeoutMs) {
      deps.onLog(`farm_zone[stealth]: zone cleared after ${idleMs}ms idle`);
      return;
    }

    const currentRoomId = deps.getCurrentRoomId();
    if (currentRoomId === null) {
      deps.onLog(`farm_zone[stealth]: currentRoomId=null, waiting...`);
      await sleep(TICK_INTERVAL_MS, signal);
      continue;
    }

    const rawTargets = deps.getVisibleTargets();
    const visibleTargets = parseMobsFromRoomDescription([...rawTargets.values()], targetValues);
    deps.onLog(`farm_zone[stealth]: room=${currentRoomId} visibleTargets=${visibleTargets.size} didSneak=${didSneak} targets=[${[...visibleTargets.keys()].join(", ")}]`);

    if (visibleTargets.size > 0 && didSneak) {
      const target = await resolveAttackTarget(probe, visibleTargets, currentRoomId, deps.mobResolver);
      if (target !== null) {
        deps.onLog(`farm_zone[stealth]: attacking "${target}" via закол`);
        didSneak = false;
        deps.sendCommand(`закол ${target}`);
        deps.reinitRoom();
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      }
      deps.onLog(`farm_zone[stealth]: resolveAttackTarget returned null (probing still in progress)`);
      await sleep(TICK_INTERVAL_MS, signal);
      continue;
    }

    if (visibleTargets.size > 0 && !didSneak) {
      const target = await resolveAttackTarget(probe, visibleTargets, currentRoomId, deps.mobResolver);
      if (target !== null) {
        deps.onLog(`farm_zone[stealth]: attacking "${target}" via закол (no sneak, probe)`);
        deps.sendCommand(`закол ${target}`);
        deps.reinitRoom();
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      }
      deps.onLog(`farm_zone[stealth]: target visible but didSneak=false, probe in progress — waiting`);
      await sleep(TICK_INTERVAL_MS, signal);
      continue;
    }

    resetMobProbeState(probe);

    const resumeDirection: Direction | null = pendingResumeDirection;
    pendingResumeDirection = null;

    const snapshot = await deps.getSnapshot(currentRoomId);
    const nextDirection: Direction | null = resumeDirection ?? chooseNextDirection(snapshot, currentRoomId, roomVnums, roomVisitOrder, lastMoveFromRoomId);
    deps.onLog(`farm_zone[stealth]: next direction → ${nextDirection ?? "null"} (resume=${resumeDirection ?? "none"}, lastMoveFrom=${lastMoveFromRoomId})`);

    if (!nextDirection) {
      deps.onLog(`farm_zone[stealth]: no next direction — resetting visitOrder and looping`);
      roomVisitOrder.clear();
      visitSequence = 0;
      lastMoveFromRoomId = null;
      lastMoveDirection = null;
      await sleep(TICK_INTERVAL_MS, signal);
      continue;
    }

    visitSequence += 1;
    roomVisitOrder.set(currentRoomId, visitSequence);
    lastMoveFromRoomId = currentRoomId;
    lastMoveDirection = nextDirection;

    const dirCmd = DIRECTION_TO_COMMAND[nextDirection];
    deps.onLog(`farm_zone[stealth]: sneaking → "краст ${dirCmd}" from room ${currentRoomId}`);
    const waitPromise = deps.onceRoomChanged(ROOM_ARRIVED_TIMEOUT_MS);
    deps.sendCommand(`краст ${dirCmd}`);
    try {
      await waitPromise;
      didSneak = true;
      deps.onLog(`farm_zone[stealth]: sneak succeeded → arrived in room ${deps.getCurrentRoomId()}`);
    } catch (_ignored) {
      didSneak = false;
      deps.onLog(`farm_zone[stealth]: sneak timed out (room change not detected) — treating as blocked`);
      const blockedEdge = snapshot.edges.find(
        (e) => e.fromVnum === currentRoomId && e.direction === nextDirection && !e.isPortal,
      );
      if (blockedEdge) {
        roomVisitOrder.set(blockedEdge.toVnum, Number.MAX_SAFE_INTEGER);
        deps.onLog(`farm_zone[stealth]: penalized edge ${currentRoomId}→${blockedEdge.toVnum} (${nextDirection})`);
      }
      lastMoveFromRoomId = null;
      lastMoveDirection = null;
    }

    await sleep(TICK_INTERVAL_MS, signal);
  }
}
