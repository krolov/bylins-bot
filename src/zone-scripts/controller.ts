import type { ScriptStep, StepState, StepStatus, ZoneScriptDeps, ZoneScriptStateSnapshot } from "./types.ts";
import { ZONE_102_ID, ZONE_102_NAME, zone102Steps } from "./zones/102.ts";
import { ZONE_103_ID, ZONE_103_NAME, zone103Steps } from "./zones/103.ts";
import { ZONE_104_ID, ZONE_104_NAME, zone104Steps } from "./zones/104.ts";
import { ZONE_111_ID, ZONE_111_NAME, zone111Steps } from "./zones/111.ts";
import { ZONE_258_ID, ZONE_258_NAME, zone258Steps } from "./zones/258.ts";
import { ZONE_280_ID, ZONE_280_NAME, zone280Steps } from "./zones/280.ts";
import { ZONE_286_ID, ZONE_286_NAME, zone286Steps } from "./zones/286.ts";
import { ZONE_PLAYLISTS } from "./playlists.ts";
import type { ZonePlaylist } from "./playlists.ts";
import { executeFarmZoneStep2 } from "./farm-zone-executor2.ts";

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const COMMAND_DELAY_MS = 800;

interface ZoneScript {
  zoneId: number;
  zoneName: string;
  hundreds: number[];
  steps: ScriptStep[];
}

const ZONE_SCRIPTS: ZoneScript[] = [
  { zoneId: ZONE_102_ID, zoneName: ZONE_102_NAME, hundreds: [102], steps: zone102Steps },
  { zoneId: ZONE_103_ID, zoneName: ZONE_103_NAME, hundreds: [103], steps: zone103Steps },
  { zoneId: ZONE_104_ID, zoneName: ZONE_104_NAME, hundreds: [104], steps: zone104Steps },
  { zoneId: ZONE_111_ID, zoneName: ZONE_111_NAME, hundreds: [111], steps: zone111Steps },
  { zoneId: ZONE_258_ID, zoneName: ZONE_258_NAME, hundreds: [258], steps: zone258Steps },
  { zoneId: ZONE_280_ID, zoneName: ZONE_280_NAME, hundreds: [280], steps: zone280Steps },
  { zoneId: ZONE_286_ID, zoneName: ZONE_286_NAME, hundreds: [286], steps: zone286Steps },
];

interface RunnerState {
  enabled: boolean;
  zoneId: number | null;
  zoneName: string | null;
  steps: StepState[];
  currentStepIndex: number | null;
  errorMessage: string | null;
  abortController: AbortController | null;
  loopEnabled: boolean;
  loopDelayMs: number;
  loopAbortController: AbortController | null;
  loopWaitingUntil: number | null;
  playlistId: number | null;
  playlistZoneIds: readonly number[] | null;
  playlistZoneIndex: number;
}

function createInitialState(): RunnerState {
  return {
    enabled: false,
    zoneId: null,
    zoneName: null,
    steps: [],
    currentStepIndex: null,
    errorMessage: null,
    abortController: null,
    loopEnabled: false,
    loopDelayMs: 0,
    loopAbortController: null,
    loopWaitingUntil: null,
    playlistId: null,
    playlistZoneIds: null,
    playlistZoneIndex: 0,
  };
}

function getSnapshot(state: RunnerState): ZoneScriptStateSnapshot {
  return {
    enabled: state.enabled,
    zoneId: state.zoneId,
    zoneName: state.zoneName,
    currentStepIndex: state.currentStepIndex,
    steps: state.steps,
    errorMessage: state.errorMessage,
    loopWaitingUntil: state.loopWaitingUntil,
    playlistId: state.playlistId,
    playlistZoneIndex: state.playlistZoneIndex,
    playlistZoneCount: state.playlistZoneIds?.length ?? 0,
  };
}

function stepsFromScript(steps: ScriptStep[]): StepState[] {
  return steps.map((s, index) => ({
    index,
    label: s.label,
    status: "pending" as StepStatus,
  }));
}

function setStepStatus(state: RunnerState, index: number, status: StepStatus, error?: string): void {
  const step = state.steps[index];
  if (!step) return;
  step.status = status;
  if (error !== undefined) step.error = error;
  state.currentStepIndex = status === "active" ? index : state.currentStepIndex;
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

async function executeStep(
  step: ScriptStep,
  deps: ZoneScriptDeps,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new Error("aborted");

  switch (step.kind) {
    case "navigate": {
      await deps.navigateTo(step.targetVnum);
      break;
    }

    case "command": {
      deps.sendCommand(step.command);
      const delay = step.delayAfterMs ?? COMMAND_DELAY_MS;
      if (delay > 0) await sleep(delay, signal);
      break;
    }

    case "wait_text": {
      const timeout = step.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
      await deps.onMudTextOnce(step.pattern, timeout);
      break;
    }

    case "command_and_wait": {
      const timeout = step.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
      const waitPromise = deps.onMudTextOnce(step.pattern, timeout);
      deps.sendCommand(step.command);
      await waitPromise;
      break;
    }

    case "special_move": {
      const timeout = step.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
      const arrivedPromise = deps.navigateTo(step.targetVnum);
      deps.sendCommand(step.command);
      await Promise.race([
        arrivedPromise,
        sleep(timeout, signal).then(() => { throw new Error(`special_move timeout: ${step.command}`); }),
      ]);
      break;
    }

    case "farm_zone2": {
      await executeFarmZoneStep2(
        {
          entryVnum: step.entryVnum,
          routeVnums: step.routeVnums,
          targetValues: step.targetValues,
          mobNameMap: step.mobNameMap,
          skipVnums: step.skipVnums,
          idleTimeoutMs: step.idleTimeoutMs,
          maxPassCount: step.maxPassCount,
          skinCorpses: step.skinCorpses,
          assistTarget: step.assistTarget,
        },
        deps,
        signal,
      );
      break;
    }
  }
}

async function runScript(
  script: ZoneScript,
  state: RunnerState,
  deps: ZoneScriptDeps,
  signal: AbortSignal,
): Promise<void> {
  for (let i = 0; i < script.steps.length; i++) {
    if (signal.aborted) return;

    const step = script.steps[i];
    if (!step) continue;

    setStepStatus(state, i, "active");
    deps.onStateChange(getSnapshot(state));

    try {
      await executeStep(step, deps, signal);
      if (signal.aborted) return;
      setStepStatus(state, i, "done");
    } catch (err: unknown) {
      if (signal.aborted) return;
      const msg = err instanceof Error ? err.message : "Unknown error";
      setStepStatus(state, i, "error", msg);
      throw err;
    }

    deps.onStateChange(getSnapshot(state));
  }
}

async function waitForLoop(
  delayMs: number,
  deps: ZoneScriptDeps,
  signal: AbortSignal,
): Promise<void> {
  await sleep(delayMs, signal);
  while (!signal.aborted) {
    const { hp, hpMax } = deps.getStats();
    if (hpMax > 0 && hp >= hpMax) return;
    await sleep(10_000, signal);
  }
}

export function createZoneScriptController(deps: ZoneScriptDeps) {
  const state = createInitialState();

  function broadcastState(): void {
    deps.onStateChange(getSnapshot(state));
  }

  function abort(): void {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
    if (state.loopAbortController) {
      state.loopAbortController.abort();
      state.loopAbortController = null;
    }
  }

  function stop(): void {
    abort();
    state.enabled = false;
    state.zoneId = null;
    state.zoneName = null;
    state.steps = [];
    state.currentStepIndex = null;
    state.errorMessage = null;
    state.playlistId = null;
    state.playlistZoneIds = null;
    state.playlistZoneIndex = 0;
    broadcastState();
  }

  function start(zoneId: number): void {
    const playlist = ZONE_PLAYLISTS.find((p) => p.playlistId === zoneId);
    if (playlist) {
      startPlaylist(playlist);
      return;
    }

    const script = ZONE_SCRIPTS.find((s) => s.zoneId === zoneId);
    if (!script) {
      deps.onLog(`Zone script not found for zone ${zoneId}`);
      return;
    }

    abort();

    state.enabled = true;
    state.zoneId = script.zoneId;
    state.zoneName = script.zoneName;
    state.steps = stepsFromScript(script.steps);
    state.currentStepIndex = null;
    state.errorMessage = null;

    const abortController = new AbortController();
    state.abortController = abortController;

    broadcastState();
    deps.onLog(`Zone script started: zone ${zoneId}`);

    void runScript(script, state, deps, abortController.signal)
      .then(() => {
        if (abortController.signal.aborted) return;
        state.enabled = false;
        state.abortController = null;
        deps.onLog(`Zone script completed: zone ${zoneId}`);
        broadcastState();

        if (state.playlistZoneIds !== null) {
          const nextIndex = state.playlistZoneIndex + 1;
          if (nextIndex < state.playlistZoneIds.length) {
            state.playlistZoneIndex = nextIndex;
            broadcastState();
            start(state.playlistZoneIds[nextIndex]!);
            return;
          }
          state.playlistZoneIndex = 0;
        }

        if (state.loopEnabled && state.loopDelayMs > 0) {
          const restartId = state.playlistZoneIds !== null
            ? (state.playlistId ?? zoneId)
            : zoneId;
          const loopAbort = new AbortController();
          state.loopAbortController = loopAbort;
          state.loopWaitingUntil = Date.now() + state.loopDelayMs;
          broadcastState();
          void waitForLoop(state.loopDelayMs, deps, loopAbort.signal).then(() => {
            state.loopAbortController = null;
            state.loopWaitingUntil = null;
            if (!loopAbort.signal.aborted) start(restartId);
          }).catch(() => {
            state.loopAbortController = null;
            state.loopWaitingUntil = null;
            broadcastState();
          });
        }
      })
      .catch((err: unknown) => {
        if (abortController.signal.aborted) return;
        state.enabled = false;
        state.abortController = null;
        state.errorMessage = err instanceof Error ? err.message : "Unknown error";
        deps.onLog(`Zone script error: ${state.errorMessage}`);
        broadcastState();
      });
  }

  function startPlaylist(playlist: ZonePlaylist): void {
    abort();
    state.playlistId = playlist.playlistId;
    state.playlistZoneIds = playlist.zoneIds;
    state.playlistZoneIndex = 0;
    broadcastState();
    deps.onLog(`Playlist started: ${playlist.playlistName}`);
    start(playlist.zoneIds[0]!);
  }

  return {
    getState(): ZoneScriptStateSnapshot {
      return getSnapshot(state);
    },

    getZoneList(): Array<{ zoneId: number; zoneName: string; hundreds: number[]; stepLabels: string[] }> {
      const zones = ZONE_SCRIPTS.map((s) => ({
        zoneId: s.zoneId,
        zoneName: s.zoneName,
        hundreds: s.hundreds,
        stepLabels: s.steps.map((step) => step.label),
      }));
      const playlists = ZONE_PLAYLISTS.map((p) => ({
        zoneId: p.playlistId,
        zoneName: p.playlistName,
        hundreds: [] as number[],
        stepLabels: p.zoneIds.map((id) => {
          const zone = ZONE_SCRIPTS.find((s) => s.zoneId === id);
          return zone ? zone.zoneName : `Zone ${id}`;
        }),
      }));
      return [...zones, ...playlists];
    },

    setEnabled(enabled: boolean, zoneId?: number): void {
      if (enabled) {
        const targetId = zoneId ?? state.zoneId ?? state.playlistId;
        if (targetId === null) {
          deps.onLog("Zone script: no zone ID specified");
          return;
        }
        const isPlaylist = ZONE_PLAYLISTS.some((p) => p.playlistId === targetId);
        if (!isPlaylist) {
          state.playlistId = null;
          state.playlistZoneIds = null;
          state.playlistZoneIndex = 0;
        }
        start(targetId);
      } else {
        stop();
      }
    },

    setLoopConfig(enabled: boolean, delayMinutes: number): void {
      state.loopEnabled = enabled;
      state.loopDelayMs = delayMinutes * 60 * 1000;
    },

    handleSessionClosed(): void {
      if (state.enabled) {
        deps.onLog("Zone script stopped: session closed");
        abort();
        state.enabled = false;
        state.errorMessage = "Session closed";
        broadcastState();
      }
    },
  };
}
