import { defaultConfig } from "./config.ts";
import { createInitialState, getStateSnapshot, setEnabled } from "./state.ts";
import { scheduleTick, runTick } from "./tick.ts";
import { handleMudText, handleSessionClosed } from "./mud-handler.ts";
import { resolveAttackTarget } from "../mob-resolver.ts";
import type { Farm2ControllerDependencies, Farm2StateSnapshot, Farm2Stats } from "./types.ts";

export function createFarm2Controller(deps: Farm2ControllerDependencies) {
  const state = createInitialState(defaultConfig());

  const schedule = (delayMs: number) => scheduleTick(state, () => runTick(state, deps), delayMs);

  function updateStats(stats: Farm2Stats): void {
    state.stats = stats;

    if (state.enabled) {
      schedule(75);
    }
  }

  return {
    getState(): Farm2StateSnapshot {
      return getStateSnapshot(state);
    },
    setEnabled(enabled: boolean): void {
      setEnabled(enabled, state, deps, schedule);
    },
    updateStats,
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
      handleMudText(state, deps, text, options);
    },
    handleSessionClosed(reason: string): void {
      handleSessionClosed(state, deps, reason);
    },
    resolveAttackTarget(currentRoomId: number): Promise<string | null> {
      return resolveAttackTarget(state.probe, state.currentVisibleTargets, currentRoomId, deps);
    },
  };
}
