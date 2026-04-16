// ---------------------------------------------------------------------------
// Farm Zone Executor v2
//
// Drives the character along a fixed route (routeVnums), killing mobs at each
// step and looting corpses.
//
// Movement  — each tick advances to the next vnum via "краст <dir>". If no
//             direct edge exists, falls back to navigateTo().
//
// Attack    — on room entry, checks visible mobs filtered by targetValues.
//             If any found: fires "закол <target>" for EVERY entry in
//             targetValues simultaneously, sets a fire-and-forget loot
//             subscription on the death phrase (3 s timeout per kill), then
//             waits up to 3 s for death or "don't know who you hate" phrase
//             before looping again in the same room — until the room is clear.
//
// Flee/return — when inCombat becomes true during "moving" the executor
//               switches to "fleeing": sends "беж <opposite>" and waits for
//               a room change. Once inCombat becomes false it enters
//               "waiting_safe", then navigates back to the previous route vnum
//               and resumes forward.
//
// Completion — the loop exits when no combat has occurred for idleTimeoutMs ms.
// ---------------------------------------------------------------------------

import { OPPOSITE_DIRECTION } from "../loop/types.ts";
import { parseMobsFromRoomDescription } from "../../mob-resolver.ts";
import type { ZoneScriptDeps } from "./types.ts";
import type { Direction } from "../../map/types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TICK_INTERVAL_MS = 600;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const ROOM_ARRIVED_TIMEOUT_MS = 5_000;
const DEATH_LOOT_TIMEOUT_MS = 15_000;
const DEATH_WAIT_TIMEOUT_MS = 3_000;

const DIRECTION_TO_COMMAND: Record<Direction, string> = {
  north: "с",
  south: "ю",
  east: "в",
  west: "з",
  up: "вв",
  down: "вн",
};

const DEATH_PHRASE = /мертв[аео]?,\s*(?:его|её|ее)\s*душа/i;
const DEATH_OR_MISS_PHRASE = /мертв[аео]?,\s*(?:его|её|ее)\s*душа|кого вы так сильно ненавидите/i;
const MISS_PHRASE = /кого вы так сильно ненавидите/i;
const FLEE_SUCCESS_PHRASE = /Вы быстро убежали с поля битвы\./i;

const MAX_CONSECUTIVE_MISSES = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RESTING_PATTERN = /^(.+?)\s+отдыхает здесь$/;
const SITTING_PATTERN = /^(.+?)\s+сидит здесь$/;
const UNCONSCIOUS_PATTERN = /^(.+?)\s+лежит здесь, без сознания$/;

function resolveSpecialPatternKeyword(roomLineLower: string): string | undefined {
  const restingMatch = RESTING_PATTERN.exec(roomLineLower);
  if (restingMatch) {
    const words = restingMatch[1].trim().split(/\s+/);
    return words[words.length - 1];
  }
  const sittingMatch = SITTING_PATTERN.exec(roomLineLower);
  if (sittingMatch) {
    const words = sittingMatch[1].trim().split(/\s+/);
    return words[words.length - 1];
  }
  const unconsciousMatch = UNCONSCIOUS_PATTERN.exec(roomLineLower);
  if (unconsciousMatch) {
    const words = unconsciousMatch[1].trim().split(/\s+/);
    return words[words.length - 1];
  }
  return undefined;
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

function skinCorpsesSequence(count: number, sendCommand: (cmd: string) => void): void {
  for (let i = count; i >= 1; i--) {
    const target = i === 1 ? "тр" : `${i}.тр`;
    sendCommand(`освеж ${target}`);
  }
  sendCommand("брос все.кус.мяс");
  sendCommand("пол все.шкур хлам");
}

async function lootAndSkinRoom(deps: ZoneScriptDeps, skinCorpses: boolean): Promise<void> {
  const count = deps.getCorpseCount();
  if (count <= 0) return;
  deps.onLog(`farm_zone2: lootAndSkinRoom count=${count} skinCorpses=${skinCorpses}`);
  if (skinCorpses) {
    skinCorpsesSequence(count, deps.sendCommand.bind(deps));
  }
  deps.sendCommand("взя все.тр");
  deps.sendCommand("взя все все.тр");
  deps.sendCommand("бро все.тр");
  await deps.autoSortInventory();
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export interface FarmZoneStep2Params {
  entryVnum: number;
  routeVnums: number[];
  targetValues?: string[];
  mobNameMap?: Record<string, string>;
  skipVnums?: number[];
  idleTimeoutMs?: number;
  maxPassCount?: number;
  skinCorpses?: boolean;
}

// ---------------------------------------------------------------------------
// Phase type
// ---------------------------------------------------------------------------

type Phase = "moving" | "fleeing" | "waiting_safe";

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export async function executeFarmZoneStep2(
  params: FarmZoneStep2Params,
  deps: ZoneScriptDeps,
  signal: AbortSignal,
): Promise<void> {
  const { entryVnum, routeVnums, targetValues, mobNameMap, skipVnums = [], idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, maxPassCount = 1, skinCorpses = false } = params;
  const skipSet = new Set(skipVnums);
  const filterKeys: string[] = targetValues ?? (mobNameMap !== undefined ? [...Object.keys(mobNameMap), "отдыхает здесь", "сидит здесь", "без сознания"] : []);

  if (routeVnums.length === 0) {
    deps.onLog("farm_zone2: routeVnums is empty — nothing to do");
    return;
  }

  deps.onLog(`farm_zone2: navigating to entry vnum=${entryVnum}`);
  await deps.navigateTo(entryVnum);
  if (signal.aborted) return;

  deps.onLog(`farm_zone2: started route steps=${routeVnums.length} idleTimeout=${idleTimeoutMs}ms${maxPassCount !== undefined ? ` maxPassCount=${maxPassCount}` : ""}`);

  let routeIndex = 0;
  let passCount = 0;
  let phase: Phase = "moving";
  let lastCombatAt = Date.now();
  let lastMoveDirection: Direction | null = null;
  let lootPending = false;
  let lastSeenMobs: string[] = [];
  let consecutiveMissCount = 0;

  while (!signal.aborted) {
    const inCombat = deps.combatState.getInCombat();
    const currentRoomId = deps.getCurrentRoomId();

    deps.onLog(
      `farm_zone2: tick phase=${phase} inCombat=${inCombat} routeIndex=${routeIndex} room=${currentRoomId}`,
    );

    // ── Detect combat entry ─────────────────────────────────────────────────
    if (inCombat && phase === "moving") {
      lastCombatAt = Date.now();
      phase = "fleeing";
      deps.onLog(
        `farm_zone2: combat detected — switching to fleeing (room=${currentRoomId}, routeIndex=${routeIndex}, lastMoveDirection=${lastMoveDirection ?? "null"})`,
      );
    }

    if (inCombat) {
      lastCombatAt = Date.now();
    }

    // ── Fleeing phase ────────────────────────────────────────────────────────
    if (phase === "fleeing") {
      if (!inCombat) {
        phase = "waiting_safe";
        deps.onLog(`farm_zone2: safe — entering waiting_safe`);
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      }

      if (lastMoveDirection !== null) {
        const fleeCmd = DIRECTION_TO_COMMAND[OPPOSITE_DIRECTION[lastMoveDirection]];
        deps.onLog(`farm_zone2: fleeing via "беж ${fleeCmd}" (lastMove=${lastMoveDirection})`);
        const waitPromise = deps.onceRoomChanged(ROOM_ARRIVED_TIMEOUT_MS);
        const fleeSuccessPromise = deps.onMudTextOnce(FLEE_SUCCESS_PHRASE, ROOM_ARRIVED_TIMEOUT_MS);
        deps.sendCommand(`беж ${fleeCmd}`);
        try {
          await waitPromise;
          lastMoveDirection = null;
          deps.onLog(`farm_zone2: flee landed in room=${deps.getCurrentRoomId()}`);
          await fleeSuccessPromise;
          deps.onLog("farm_zone2: flee success text seen — refreshing current room");
          const refreshedRoom = await deps.refreshCurrentRoom(ROOM_ARRIVED_TIMEOUT_MS);
          if (refreshedRoom === null) {
            deps.onLog("farm_zone2: flee room refresh timeout");
          }
        } catch (_ignored) {
          deps.onLog("farm_zone2: flee room-change timeout — retrying next tick");
        }
      } else {
        deps.onLog(
          `farm_zone2: no lastMoveDirection — sending bare беж (room=${currentRoomId}, routeIndex=${routeIndex})`,
        );
        const waitPromise = deps.onceRoomChanged(ROOM_ARRIVED_TIMEOUT_MS);
        const fleeSuccessPromise = deps.onMudTextOnce(FLEE_SUCCESS_PHRASE, ROOM_ARRIVED_TIMEOUT_MS);
        deps.sendCommand("беж");
        try {
          await waitPromise;
          deps.onLog(`farm_zone2: flee landed in room=${deps.getCurrentRoomId()}`);
          await fleeSuccessPromise;
          deps.onLog("farm_zone2: flee success text seen after bare беж — refreshing current room");
          const refreshedRoom = await deps.refreshCurrentRoom(ROOM_ARRIVED_TIMEOUT_MS);
          if (refreshedRoom === null) {
            deps.onLog("farm_zone2: flee room refresh timeout after bare беж");
          }
        } catch (_ignored) {
          deps.onLog("farm_zone2: flee room-change timeout");
        }
      }
      continue;
    }

    // ── Waiting-safe phase ───────────────────────────────────────────────────
    if (phase === "waiting_safe") {
      if (inCombat) {
        phase = "fleeing";
        deps.onLog("farm_zone2: combat in waiting_safe — switching to fleeing");
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      }

      const prevIndex = (routeIndex - 1 + routeVnums.length) % routeVnums.length;
      const prevVnum = routeVnums[prevIndex];
      deps.onLog(`farm_zone2: waiting_safe — refreshing current room before return to vnum=${prevVnum}`);
      const refreshedRoom = await deps.refreshCurrentRoom(ROOM_ARRIVED_TIMEOUT_MS);
      if (refreshedRoom === null) {
        deps.onLog("farm_zone2: waiting_safe room refresh timeout");
      }
      if (signal.aborted) return;

      deps.onLog(`farm_zone2: returning to prev route vnum=${prevVnum} (index=${prevIndex})`);
      await deps.navigateTo(prevVnum);
      if (signal.aborted) return;

      const arrivedRoom = deps.getCurrentRoomId();
      if (arrivedRoom !== prevVnum) {
        deps.onLog(
          `farm_zone2: navigateTo did not reach prevVnum=${prevVnum} (now at ${arrivedRoom}) — retrying next tick`,
        );
        await sleep(TICK_INTERVAL_MS, signal);
        continue;
      }

      routeIndex = prevIndex;
      phase = "moving";
      lastMoveDirection = null;
      lastSeenMobs = [...deps.getVisibleTargets().values()];
      consecutiveMissCount = 0;
      deps.onLog(`farm_zone2: resumed at room=${arrivedRoom} routeIndex=${routeIndex} lastSeenMobs=${lastSeenMobs.length}`);
      await sleep(TICK_INTERVAL_MS, signal);
      continue;
    }

    // ── Idle-timeout check ───────────────────────────────────────────────────
    const idleMs = Date.now() - lastCombatAt;
    if (idleMs >= idleTimeoutMs) {
      deps.onLog(`farm_zone2: zone cleared after ${idleMs}ms idle`);
      return;
    }

    if (currentRoomId === null) {
      await sleep(TICK_INTERVAL_MS, signal);
      continue;
    }

    // ── Attack mobs in current room ──────────────────────────────────────────
    if (!skipSet.has(currentRoomId)) {
      deps.onLog(`farm_zone2: lastSeenMobs=[${lastSeenMobs.join(" | ")}] filterKeys.length=${filterKeys.length} firstKey="${filterKeys[0] ?? ""}"`);
      for (const mob of lastSeenMobs) {
        const mobLower = mob.toLowerCase();
        const hit = filterKeys.find((k) => mobLower.includes(k));
        deps.onLog(`farm_zone2: match "${mob}" → ${hit !== undefined ? `"${hit}"` : "NO MATCH"}`);
      }
      const visibleTargets = parseMobsFromRoomDescription(lastSeenMobs, filterKeys);

      deps.onLog(
        `farm_zone2: room=${currentRoomId} visibleTargets=${visibleTargets.size} targets=[${[...visibleTargets.keys()].join(", ")}]`,
      );

      if (visibleTargets.size > 0) {
        if (!lootPending) {
          lootPending = true;
          void deps
            .onMudTextOnce(DEATH_PHRASE, DEATH_LOOT_TIMEOUT_MS)
            .then(async () => {
              if (skinCorpses) {
                const count = deps.getCorpseCount();
                if (count > 0) {
                  skinCorpsesSequence(count, deps.sendCommand.bind(deps));
                }
              }
              deps.sendCommand("взя все.тр");
              deps.sendCommand("взя все все.тр");
              deps.sendCommand("бро все.тр");
              await deps.autoSortInventory();
            })
            .catch(() => {
              deps.onLog("farm_zone2: death-phrase loot timeout — no loot this kill");
            })
            .finally(() => {
              lootPending = false;
            });
        }

        if (mobNameMap !== undefined) {
          const attackKeywords = new Set<string>();
          const mobMapKeys = Object.keys(mobNameMap).sort((a, b) => b.length - a.length);
          for (const roomLineLower of visibleTargets.keys()) {
            const matchedKey = mobMapKeys.find((k) => roomLineLower.includes(k));
            const keyword = matchedKey !== undefined ? mobNameMap[matchedKey] : resolveSpecialPatternKeyword(roomLineLower);
            if (keyword !== undefined) attackKeywords.add(keyword);
          }
          if (attackKeywords.size === 0) {
            deps.onLog(`farm_zone2: mobNameMap: no mapping for visible targets [${[...visibleTargets.keys()].join(", ")}] — skipping attack`);
          } else {
            for (const keyword of attackKeywords) {
              deps.sendCommand("спрят");
              deps.sendCommand(`закол ${keyword}`);
            }
            deps.onLog(`farm_zone2: attack sent via mobNameMap for ${attackKeywords.size} keyword(s), waiting for death/miss`);
          }
        } else {
          for (const target of (targetValues ?? [])) {
            deps.sendCommand("спрят");
            deps.sendCommand(`закол ${target}`);
          }
          deps.onLog(`farm_zone2: attack sent for ${(targetValues ?? []).length} target(s), waiting for death/miss`);
        }

        const deathPromise = deps.onMudTextOnce(DEATH_PHRASE, DEATH_WAIT_TIMEOUT_MS);
        const missPromise = deps.onMudTextOnce(MISS_PHRASE, DEATH_WAIT_TIMEOUT_MS);
        const waitResult = await Promise.race([
          deathPromise.then(() => "death" as const).catch(() => "timeout" as const),
          missPromise.then(() => "miss" as const).catch(() => "timeout_miss" as const),
        ]);

        if (waitResult === "miss") {
          consecutiveMissCount++;
          deps.onLog(`farm_zone2: mob not attackable ("кого ненавидите") consecutiveMiss=${consecutiveMissCount}/${MAX_CONSECUTIVE_MISSES}`);
          if (consecutiveMissCount >= MAX_CONSECUTIVE_MISSES) {
            deps.onLog(`farm_zone2: max consecutive misses reached — skipping room ${currentRoomId} and advancing`);
            consecutiveMissCount = 0;
            lastSeenMobs = [];
            // fall through to advance route
          } else {
            await deps.refreshCurrentRoom(ROOM_ARRIVED_TIMEOUT_MS);
            lastSeenMobs = [...deps.getVisibleTargets().values()];
            deps.onLog(`farm_zone2: after miss refresh lastSeenMobs=[${lastSeenMobs.join(" | ")}]`);
            continue;
          }
        } else {
          if (waitResult === "death") {
            consecutiveMissCount = 0;
          } else {
            deps.onLog("farm_zone2: death/miss wait timeout");
          }
          deps.onLog("farm_zone2: refreshing room to get updated mob list");
          await deps.refreshCurrentRoom(ROOM_ARRIVED_TIMEOUT_MS);
          lastSeenMobs = [...deps.getVisibleTargets().values()];
          deps.onLog(`farm_zone2: after refresh lastSeenMobs=[${lastSeenMobs.join(" | ")}]`);
          continue;
        }
      }
    } else {
      deps.onLog(`farm_zone2: room=${currentRoomId} is in skipVnums — skipping attack`);
    }

    // ── No mobs (or skip room) — advance route ───────────────────────────────
    const targetVnum = routeVnums[routeIndex];

    // If already at the target, advance the index and loop immediately.
    if (currentRoomId === targetVnum) {
      await lootAndSkinRoom(deps, skinCorpses);
      const nextIndex = (routeIndex + 1) % routeVnums.length;
      if (nextIndex === 0) {
        passCount++;
        deps.onLog(`farm_zone2: completed pass #${passCount}${maxPassCount !== undefined ? `/${maxPassCount}` : ""}`);
        if (maxPassCount !== undefined && passCount >= maxPassCount) {
          deps.onLog(`farm_zone2: maxPassCount=${maxPassCount} reached — stopping`);
          return;
        }
      }
      routeIndex = nextIndex;
      deps.onLog(
        `farm_zone2: at target vnum=${targetVnum}, advancing routeIndex → ${routeIndex}`,
      );
      continue;
    }

    // Try a direct edge (sneak step).
    const snapshot = await deps.getSnapshot(currentRoomId);
    const edge = snapshot.edges.find(
      (e) => e.fromVnum === currentRoomId && e.toVnum === targetVnum && !e.isPortal,
    );

    if (edge) {
      const dirCmd = DIRECTION_TO_COMMAND[edge.direction];
      deps.onLog(`farm_zone2: sneaking "краст ${dirCmd}" toward vnum=${targetVnum}`);
      const moveResult = await deps.stealthMove(edge.direction);
      if (moveResult.kind === "ok") {
        lastMoveDirection = edge.direction;
        lastSeenMobs = moveResult.mobs;
        consecutiveMissCount = 0;
        deps.onLog(
          `farm_zone2: sneak succeeded → room=${moveResult.roomId} mobs=${moveResult.mobs.length}`,
        );
        deps.onLog(
          `farm_zone2: stealthMove raw mobs=[${moveResult.mobs.join(" | ")}] after move to room=${moveResult.roomId}`,
        );
        const visibleAfterMove = parseMobsFromRoomDescription(lastSeenMobs, filterKeys);
        if (visibleAfterMove.size === 0) {
          await lootAndSkinRoom(deps, skinCorpses);
        }
      } else {
        lastMoveDirection = null;
        lastSeenMobs = [];
        deps.onLog(
          `farm_zone2: sneak ${moveResult.kind} — falling back to navigateTo and clearing lastMoveDirection (targetVnum=${targetVnum})`,
        );
        await deps.navigateTo(targetVnum);
        if (signal.aborted) return;
      }
    } else {
      deps.onLog(`farm_zone2: no direct edge to vnum=${targetVnum} — using navigateTo`);
      await deps.navigateTo(targetVnum);
      if (signal.aborted) return;
      lastMoveDirection = null;
      consecutiveMissCount = 0;
      lastSeenMobs = [...deps.getVisibleTargets().values()];
      deps.onLog(
        `farm_zone2: navigateTo completed without direct edge — cleared lastMoveDirection (targetVnum=${targetVnum}, room=${deps.getCurrentRoomId()})`,
      );
    }

  }

  if (signal.aborted) {
    deps.onLog("farm_zone2: stopped — user aborted zoning");
  }
}
