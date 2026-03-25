const ANSI_ESCAPE_REGEXP = /\u001b\[[0-9;]*m/g;
const COMBAT_PROMPT_REGEXP = /\[[^:\]]+:[^\]]+\]\s+\[[^:\]]+:[^\]]+\]\s*>/;
const ROOM_PROMPT_REGEXP = /Вых:[^>]*>/i;

const DODGE_INTERVAL_MS = 1400;
const DODGE_INITIAL_DELAY_MS = 200;

const EQUIPMENT_RIGHT_REGEXP = /^<в правой руке>/m;
const EQUIPMENT_LEFT_REGEXP = /^<в левой руке>/m;

const DISARM_BOTH_REGEXP = /выбил .+ из ваших рук/;
const DISARM_RIGHT_REGEXP = /выбил .+ из вашей правой руки/;
const DISARM_LEFT_REGEXP = /выбил .+ из вашей левой руки/;

// Зауч:0 означает «ничего не заучивается», Зауч:N:M — идёт заучивание
const MEMORIZING_REGEXP = /Зауч:(\d+)(?::(\d+))?/;

// Текст при успешном попадании проклятия на цель
const CURSE_HIT_REGEXP = /Красное сияние вспыхнуло/;

export interface TriggerState {
  dodge: boolean;
  standUp: boolean;
  rearm: boolean;
  curse: boolean;
}

interface TriggerDependencies {
  sendCommand(command: string): void;
  onStateChange(state: TriggerState): void;
  onLog(message: string): void;
}

export function createTriggers(deps: TriggerDependencies) {
  const enabled: TriggerState = {
    dodge: true,
    standUp: true,
    rearm: true,
    curse: false,
  };

  let inCombat = false;
  let dodgeTimer: ReturnType<typeof setTimeout> | null = null;
  let rightHandArmed = false;
  let leftHandArmed = false;

  let cursesReady = 2;
  let curseMemorizing = false;
  let curseHitThisBattle = false;
  let cursePending = false;
  let cursesSpentThisCycle = 0;

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

    if (inCombat && !wasInCombat && enabled.curse) {
      tryCastCurse("вход в бой");
    }

    if (!inCombat && wasInCombat) {
      stopDodge();
      curseHitThisBattle = false;
      cursePending = false;
    }

    if (enabled.standUp && stripped.includes("Вам лучше встать на ноги!")) {
      deps.sendCommand("встать");
    }

    if (stripped.includes("На вас надето:")) {
      rightHandArmed = EQUIPMENT_RIGHT_REGEXP.test(stripped);
      leftHandArmed = EQUIPMENT_LEFT_REGEXP.test(stripped);
    }

    if (enabled.rearm) {
      if (DISARM_RIGHT_REGEXP.test(stripped)) {
        rightHandArmed = false;
        deps.sendCommand("воор нож");
      } else if (DISARM_LEFT_REGEXP.test(stripped)) {
        leftHandArmed = false;
        deps.sendCommand("держ нож");
      } else if (DISARM_BOTH_REGEXP.test(stripped)) {
        if (rightHandArmed) {
          rightHandArmed = false;
          deps.sendCommand("воор нож");
        } else if (leftHandArmed) {
          leftHandArmed = false;
          deps.sendCommand("держ нож");
        }
      }
    }

    if (enabled.curse && inCombat) {
      handleCurseLogic(stripped);
    }
  }

  function tryCastCurse(reason: string): void {
    if (cursesReady > 0 && !curseMemorizing && !curseHitThisBattle && !cursePending) {
      deps.onLog(`[triggers] Кидаю проклятие (${reason}), осталось зарядов: ${cursesReady}`);
      deps.sendCommand("колд !прокл");
      cursesReady--;
      cursesSpentThisCycle++;
      cursePending = true;
      if (cursesReady === 0) {
        deps.onLog("[triggers] Все заряды использованы, ждём Зауч:0");
      }
    }
  }

  function handleCurseLogic(stripped: string): void {
    if (CURSE_HIT_REGEXP.test(stripped)) {
      curseHitThisBattle = true;
      cursePending = false;
      deps.onLog("[triggers] Проклятие попало — стоп на эту битву");
    }

    if (stripped.includes("Ваши потуги оказались напрасными")) {
      cursePending = false;
      deps.onLog("[triggers] Проклятие промахнулось");
      tryCastCurse("после промаха");
    }

    if (stripped.includes("Вы совершенно не помните, как произносится это заклинание")) {
      cursePending = false;
      deps.onLog("[triggers] Заклинание забыто — ждём Зауч:0");
    }

    const memorizeMatch = MEMORIZING_REGEXP.exec(stripped);
    if (memorizeMatch) {
      const major = Number(memorizeMatch[1]);
      const isMemorizing = major > 0 || memorizeMatch[2] !== undefined;
      const isIdle = major === 0 && memorizeMatch[2] === undefined;

      if (isMemorizing && !curseMemorizing) {
        curseMemorizing = true;
        cursePending = false;
        deps.onLog("[triggers] Начали заучивание проклятия");
      }

      if (isIdle && curseMemorizing) {
        curseMemorizing = false;
        cursesReady = cursesSpentThisCycle > 0 ? cursesSpentThisCycle : cursesReady;
        cursesSpentThisCycle = 0;
        deps.onLog(`[triggers] Зауч:0 — ${cursesReady} зарядов проклятия готовы`);
        if (inCombat) {
          tryCastCurse("после заучивания");
        }
      }
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
    rightHandArmed = false;
    leftHandArmed = false;
    cursesReady = 2;
    curseMemorizing = false;
    curseHitThisBattle = false;
    cursePending = false;
    cursesSpentThisCycle = 0;
    stopDodge();
  }

  return { handleMudText, setEnabled, getState, reset };
}
