import { defaultConfig } from "./config.ts";
import { createInitialState, getStateSnapshot, setEnabled, disable, enable } from "./state.ts";
import { scheduleTick, runTick } from "./tick.ts";
import { handleMudText, handleSessionClosed } from "./mud-handler.ts";
import { resolveAttackTarget } from "../mob-resolver.ts";
import { createLogger } from "./logger.ts";
import type { Farm2ControllerDependencies, Farm2StateSnapshot, Farm2Stats } from "./types.ts";

const RECALL_HOTKEY = "5";
const RECALL_HP_THRESHOLD = 0.5;
const RECALL_REPEAT_INTERVAL_MS = 5000;

export function createFarm2Controller(deps: Farm2ControllerDependencies) {
  const state = createInitialState(defaultConfig());

  const schedule = (delayMs: number) => scheduleTick(state, () => runTick(state, deps), delayMs);

  function scheduleNextRecall(): void {
    state.recallTimer.schedule(async () => {
      if (!state.recalling) return;
      deps.sendCommand(RECALL_HOTKEY);
      scheduleNextRecall();
    }, RECALL_REPEAT_INTERVAL_MS);
  }

  function startRecalling(): void {
    const logger = createLogger(deps);
    logger.info(
      `HP dropped below ${RECALL_HP_THRESHOLD * 100}% (${state.stats.hp}/${state.stats.hpMax}) — triggering recall`,
    );
    const savedZoneId = state.zoneId;
    disable(state, deps); // sets enabled=false, publishes state to UI
    state.recalling = true;
    state.zoneId = savedZoneId; // keep for zone-exit detection in mud-handler
    deps.sendCommand(RECALL_HOTKEY);
    scheduleNextRecall();
  }

  function updateStats(stats: Farm2Stats): void {
    state.stats = stats;

    if (state.enabled && !state.recalling && stats.hpMax > 0 && stats.hp / stats.hpMax < RECALL_HP_THRESHOLD) {
      startRecalling();
      return;
    }

    if (
      !state.enabled &&
      state.loopRestartScheduledAt !== null &&
      Date.now() - state.loopRestartScheduledAt >= state.loopDelayMs &&
      stats.hpMax > 0 &&
      stats.hp >= stats.hpMax
    ) {
      const logger = createLogger(deps);
      logger.info("Loop: HP full — restarting farm");
      state.loopRestartScheduledAt = null;
      void enable(state, deps, schedule);
      return;
    }

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
    setLoopConfig(enabled: boolean, delayMinutes: number): void {
      state.loopEnabled = enabled;
      state.loopDelayMs = delayMinutes * 60 * 1000;
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
