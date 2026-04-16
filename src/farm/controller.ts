// ---------------------------------------------------------------------------
// Unified farm controller — wraps the two legacy farming subsystems behind
// one public API:
//   - loop:   createFarm2Controller (reactive tick loop from src/farm2/)
//   - script: createZoneScriptController (step runner from src/zone-scripts/)
//
// Both subsystems continue to live in their original directories for now;
// this module is a thin facade so server.ts can wire a single controller
// instead of two. The plan (/root/.claude/plans/serialized-honking-eagle.md)
// has a follow-up phase that physically moves the legacy files under
// src/farm/loop/ and src/farm/script/.
// ---------------------------------------------------------------------------

import { createFarm2Controller } from "../farm2/index.ts";
import { createZoneScriptController } from "../zone-scripts/index.ts";
import type { Farm2ControllerDependencies, Farm2Stats } from "../farm2/types.ts";
import type { ZoneScriptDeps } from "../zone-scripts/types.ts";
import type { Farm2StateSnapshot, ZoneScriptStateSnapshot } from "./types.ts";

/**
 * Dependencies for the unified farm controller.
 *
 * This is the merged super-set of Farm2ControllerDependencies and
 * ZoneScriptDeps. The two legacy state-change callbacks have different
 * payload types, so they keep separate names:
 *   - onLoopStateChange(state: Farm2StateSnapshot) — emitted by loop mode
 *   - onScriptStateChange(state: ZoneScriptStateSnapshot) — emitted by script mode
 *
 * Server.ts is expected to broadcast each via its existing WS event
 * (farm2_state / zone_script_state respectively) — the client contract
 * stays unchanged.
 */
export interface FarmControllerDeps
  extends Omit<Farm2ControllerDependencies, "onStateChange">,
    Omit<ZoneScriptDeps, "onStateChange"> {
  onLoopStateChange(state: Farm2StateSnapshot): void;
  onScriptStateChange(state: ZoneScriptStateSnapshot): void;
}

export function createFarmController(deps: FarmControllerDeps) {
  const loopDeps: Farm2ControllerDependencies = {
    getCurrentRoomId: deps.getCurrentRoomId,
    isConnected: deps.isConnected,
    getSnapshot: deps.getSnapshot,
    sendCommand: deps.sendCommand,
    reinitRoom: deps.reinitRoom,
    move: deps.move,
    combatState: deps.combatState,
    getZoneSettings: deps.getZoneSettings,
    getMobCombatNamesByZone: deps.getMobCombatNamesByZone,
    getCombatNameByRoomName: deps.getCombatNameByRoomName,
    isRoomNameBlacklisted: deps.isRoomNameBlacklisted,
    linkMobRoomAndCombatName: deps.linkMobRoomAndCombatName,
    onStateChange: deps.onLoopStateChange,
    onLog: deps.onLog,
    onDebugLog: deps.onDebugLog,
  };

  const scriptDeps: ZoneScriptDeps = {
    getCurrentRoomId: deps.getCurrentRoomId,
    isConnected: deps.isConnected,
    navigateTo: deps.navigateTo,
    sendCommand: deps.sendCommand,
    onMudTextOnce: deps.onMudTextOnce,
    onceRoomChanged: deps.onceRoomChanged,
    refreshCurrentRoom: deps.refreshCurrentRoom,
    onStateChange: deps.onScriptStateChange,
    onLog: deps.onLog,
    getSnapshot: deps.getSnapshot,
    move: deps.move,
    stealthMove: deps.stealthMove,
    combatState: deps.combatState,
    getVisibleTargets: deps.getVisibleTargets,
    getCorpseCount: deps.getCorpseCount,
    reinitRoom: deps.reinitRoom,
    mobResolver: deps.mobResolver,
    isStealthProfile: deps.isStealthProfile,
    autoSortInventory: deps.autoSortInventory,
  };

  const loop = createFarm2Controller(loopDeps);
  const script = createZoneScriptController(scriptDeps);

  return {
    // ── Loop mode ─────────────────────────────────────────────────────────
    setLoopEnabled(enabled: boolean): void {
      loop.setEnabled(enabled);
    },
    updateStats(stats: Farm2Stats): void {
      loop.updateStats(stats);
    },
    resolveAttackTarget(currentRoomId: number): Promise<string | null> {
      return loop.resolveAttackTarget(currentRoomId);
    },
    getLoopState(): Farm2StateSnapshot {
      return loop.getState();
    },

    // ── Script mode ───────────────────────────────────────────────────────
    setScriptEnabled(enabled: boolean, zoneId?: number): void {
      script.setEnabled(enabled, zoneId);
    },
    getScriptState(): ZoneScriptStateSnapshot {
      return script.getState();
    },
    getZoneList(): ReturnType<typeof script.getZoneList> {
      return script.getZoneList();
    },

    // ── Shared lifecycle ──────────────────────────────────────────────────
    handleMudText(
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
      // Only the loop mode is reactive to mud text. The script mode pulls
      // text via onMudTextOnce / onceRoomChanged (registered per step), which
      // is driven by the same mud-text listener set on server.ts side.
      loop.handleMudText(text, options);
    },
    handleSessionClosed(reason: string): void {
      loop.handleSessionClosed(reason);
      script.handleSessionClosed();
    },
  };
}

export type FarmController = ReturnType<typeof createFarmController>;
