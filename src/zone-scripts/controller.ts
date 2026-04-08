import type { ScriptStep, StepState, StepStatus, ZoneScriptDeps, ZoneScriptStateSnapshot } from "./types.ts";
import { ZONE_102_ID, ZONE_102_NAME, zone102Steps } from "./zones/102.ts";
import { ZONE_103_ID, ZONE_103_NAME, zone103Steps } from "./zones/103.ts";
import { ZONE_104_ID, ZONE_104_NAME, zone104Steps } from "./zones/104.ts";
import { ZONE_111_ID, ZONE_111_NAME, zone111Steps } from "./zones/111.ts";
import { ZONE_258_ID, ZONE_258_NAME, zone258Steps } from "./zones/258.ts";
import { ZONE_280_ID, ZONE_280_NAME, zone280Steps } from "./zones/280.ts";
import { ZONE_286_ID, ZONE_286_NAME, zone286Steps } from "./zones/286.ts";
import { executeFarmZoneStep2 } from "./farm-zone-executor2.ts";

const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const COMMAND_DELAY_MS = 800;

interface ZoneScript {
  zoneId: number;
  zoneName: string;
  steps: ScriptStep[];
}

const ZONE_SCRIPTS: ZoneScript[] = [
  { zoneId: ZONE_102_ID, zoneName: ZONE_102_NAME, steps: zone102Steps },
  { zoneId: ZONE_103_ID, zoneName: ZONE_103_NAME, steps: zone103Steps },
  { zoneId: ZONE_104_ID, zoneName: ZONE_104_NAME, steps: zone104Steps },
  { zoneId: ZONE_111_ID, zoneName: ZONE_111_NAME, steps: zone111Steps },
  { zoneId: ZONE_258_ID, zoneName: ZONE_258_NAME, steps: zone258Steps },
  { zoneId: ZONE_280_ID, zoneName: ZONE_280_NAME, steps: zone280Steps },
  { zoneId: ZONE_286_ID, zoneName: ZONE_286_NAME, steps: zone286Steps },
];

interface RunnerState {
  enabled: boolean;
  zoneId: number | null;
  zoneName: string | null;
  steps: StepState[];
  currentStepIndex: number | null;
  errorMessage: string | null;
  abortController: AbortController | null;
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
          skipVnums: step.skipVnums,
          idleTimeoutMs: step.idleTimeoutMs,
          maxPassCount: step.maxPassCount,
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
  }

  function stop(): void {
    abort();
    state.enabled = false;
    state.zoneId = null;
    state.zoneName = null;
    state.steps = [];
    state.currentStepIndex = null;
    state.errorMessage = null;
    broadcastState();
  }

  function start(zoneId: number): void {
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

  return {
    getState(): ZoneScriptStateSnapshot {
      return getSnapshot(state);
    },

    setEnabled(enabled: boolean, zoneId?: number): void {
      if (enabled) {
        const targetZoneId = zoneId ?? state.zoneId;
        if (targetZoneId === null) {
          deps.onLog("Zone script: no zone ID specified");
          return;
        }
        start(targetZoneId);
      } else {
        stop();
      }
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
