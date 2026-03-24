const ANSI_ESCAPE_REGEXP = /\u001b\[[0-9;]*m/g;
const COMBAT_PROMPT_REGEXP = /\[[^:\]]+:[^\]]+\]\s+\[[^:\]]+:[^\]]+\]\s*>/;
const ROOM_PROMPT_REGEXP = /Вых:[^>]*>/i;

const DODGE_INTERVAL_MS = 1400;
const DODGE_INITIAL_DELAY_MS = 200;

export interface TriggerState {
  dodge: boolean;
  standUp: boolean;
}

interface TriggerDependencies {
  sendCommand(command: string): void;
  onStateChange(state: TriggerState): void;
}

export function createTriggers(deps: TriggerDependencies) {
  const enabled: TriggerState = {
    dodge: true,
    standUp: true,
  };

  let inCombat = false;
  let dodgeTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleDodge(delayMs: number): void {
    if (dodgeTimer) clearTimeout(dodgeTimer);
    dodgeTimer = setTimeout(() => {
      dodgeTimer = null;
      if (!inCombat || !enabled.dodge) return;
      deps.sendCommand("уклон");
      scheduleDodge(DODGE_INTERVAL_MS);
    }, delayMs);
  }

  function stopDodge(): void {
    if (dodgeTimer) {
      clearTimeout(dodgeTimer);
      dodgeTimer = null;
    }
  }

  function handleMudText(text: string): void {
    const stripped = text.replace(ANSI_ESCAPE_REGEXP, "").replace(/\r/g, "");
    const wasInCombat = inCombat;

    if (COMBAT_PROMPT_REGEXP.test(stripped)) {
      inCombat = true;
    }
    if (ROOM_PROMPT_REGEXP.test(stripped)) {
      inCombat = false;
    }

    if (inCombat && !wasInCombat && enabled.dodge) {
      scheduleDodge(DODGE_INITIAL_DELAY_MS);
    }

    if (!inCombat && wasInCombat) {
      stopDodge();
    }

    if (enabled.standUp && stripped.includes("Вам лучше встать на ноги!")) {
      deps.sendCommand("встать");
    }
  }

  function setEnabled(patch: Partial<TriggerState>): void {
    let changed = false;

    for (const key of Object.keys(patch) as Array<keyof TriggerState>) {
      if (key in enabled && enabled[key] !== patch[key]) {
        (enabled[key] as boolean) = patch[key] as boolean;
        changed = true;
      }
    }

    if (!enabled.dodge) {
      stopDodge();
    }

    if (changed) {
      deps.onStateChange(getState());
    }
  }

  function getState(): TriggerState {
    return { ...enabled };
  }

  function reset(): void {
    inCombat = false;
    stopDodge();
  }

  return { handleMudText, setEnabled, getState, reset };
}
