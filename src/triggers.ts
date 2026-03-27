const ANSI_ESCAPE_REGEXP = /\u001b\[[0-9;]*m/g;

const DODGE_INTERVAL_MS = 1400;
const DODGE_INITIAL_DELAY_MS = 200;

const CURSES_MAX = 2;

const EQUIPMENT_RIGHT_REGEXP = /^<в правой руке>/m;
const EQUIPMENT_LEFT_REGEXP = /^<в левой руке>/m;

const DISARM_BOTH_REGEXP = /выбил .+ из ваших рук/;
const DISARM_RIGHT_REGEXP = /выбил .+ из вашей правой руки/;
const DISARM_LEFT_REGEXP = /выбил .+ из вашей левой руки/;

// Зауч:0 означает «ничего не заучивается», Зауч:N:M — идёт заучивание
const MEMORIZING_REGEXP = /Зауч:(\d+)(?::(\d+))?/;

// Текст при успешном попадании проклятия на цель
const CURSE_HIT_REGEXP = /Красное сияние вспыхнуло/;

// Текст когда заклинание ушло в заучивание (один заряд потрачен → начинает восстанавливаться)
const CURSE_MEMORIZING_REGEXP = /Вы занесли заклинание "[^"]*проклятие[^"]*" в свои резы/i;

// Триггер света: темно в комнате
const LIGHT_DARK_REGEXP = /^Слишком темно\.\.\./m;

// Шарик начинает угасать — превентивное переколдование
const LIGHT_FADING_REGEXP = /Ваш светящийся шарик замерцал и начал угасать/;

// Шарик погас — срочное переколдование
const LIGHT_OUT_REGEXP = /Ваш светящийся шарик погас/;

// Успешно создан новый шарик
const LIGHT_CREATED_REGEXP = /Вы создали светящийся шарик/;

// Шарик надет (в экипировке для освещения)
const LIGHT_EQUIPPED_REGEXP = /^<для освещения>\s+светящийся шарик/m;

// Заклинание света ушло в резы
const LIGHT_MEMORIZING_REGEXP = /Вы занесли заклинание "[^"]*создать свет[^"]*" в свои резы/i;

export interface TriggerState {
  dodge: boolean;
  standUp: boolean;
  rearm: boolean;
  curse: boolean;
  light: boolean;
}

interface TriggerDependencies {
  sendCommand(command: string): void;
  onStateChange(state: TriggerState): void;
  onLog(message: string): void;
  isInCombat(): boolean;
}

export function createTriggers(deps: TriggerDependencies) {
  const enabled: TriggerState = {
    dodge: true,
    standUp: true,
    rearm: true,
    curse: false,
    light: false,
  };

  let dodgeTimer: ReturnType<typeof setTimeout> | null = null;
  let rightHandArmed = false;
  let leftHandArmed = false;

  let cursesReady = CURSES_MAX;
  let curseMemorizing = false;
  let curseHitThisBattle = false;
  let cursePending = false;

  let lightPending = false;
  let lightMemorizing = false;
  let lightEquipped = false;

  function scheduleDodge(delayMs: number): void {
    if (dodgeTimer) clearTimeout(dodgeTimer);
    dodgeTimer = setTimeout(() => {
      dodgeTimer = null;
      if (!deps.isInCombat() || !enabled.dodge) return;
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

    if (enabled.curse && deps.isInCombat()) {
      handleCurseLogic(stripped);
    }

    if (enabled.light) {
      handleLightLogic(stripped);
    }
  }

  function onCombatStart(): void {
    if (enabled.dodge) {
      scheduleDodge(DODGE_INITIAL_DELAY_MS);
    }
    if (enabled.curse) {
      tryCastCurse("вход в бой");
    }
  }

  function onCombatEnd(): void {
    stopDodge();
    curseHitThisBattle = false;
    cursePending = false;
  }

  function tryCastCurse(reason: string): void {
    if (cursesReady > 0 && !curseMemorizing && !curseHitThisBattle && !cursePending) {
      deps.onLog(`[triggers] Кидаю проклятие (${reason}), осталось зарядов: ${cursesReady}`);
      deps.sendCommand("колд !прокл");
      cursesReady--;
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

    if (CURSE_MEMORIZING_REGEXP.test(stripped) && !curseMemorizing) {
      curseMemorizing = true;
      deps.onLog("[triggers] Начали заучивание проклятия");
    }

    const memorizeMatch = MEMORIZING_REGEXP.exec(stripped);
    if (memorizeMatch) {
      const major = Number(memorizeMatch[1]);
      const isIdle = major === 0 && memorizeMatch[2] === undefined;

      if (isIdle && curseMemorizing) {
        curseMemorizing = false;
        cursePending = false;
        cursesReady = CURSES_MAX;
        deps.onLog(`[triggers] Зауч:0 — ${cursesReady} зарядов проклятия готовы`);
        if (deps.isInCombat()) {
          tryCastCurse("после заучивания");
        }
      }
    }
  }

  function tryCastLight(reason: string): void {
    if (!lightPending && !lightMemorizing && !lightEquipped) {
      deps.onLog(`[triggers] Колдую свет (${reason})`);
      deps.sendCommand("колд создать свет");
      lightPending = true;
    }
  }

  function handleLightLogic(stripped: string): void {
    if (stripped.includes("На вас надето:")) {
      lightEquipped = LIGHT_EQUIPPED_REGEXP.test(stripped);
    }

    if (LIGHT_OUT_REGEXP.test(stripped)) {
      lightEquipped = false;
      tryCastLight("шарик погас");
    }

    if (LIGHT_DARK_REGEXP.test(stripped)) {
      tryCastLight("темно");
    }

    if (LIGHT_FADING_REGEXP.test(stripped)) {
      lightEquipped = false;
      tryCastLight("шарик угасает");
    }

    if (LIGHT_CREATED_REGEXP.test(stripped)) {
      lightPending = false;
      deps.onLog("[triggers] Шарик создан — зажигаю");
      deps.sendCommand("зажечь шарик");
    }

    if (stripped.includes("Вы зажгли светящийся шарик")) {
      lightEquipped = true;
      deps.onLog("[triggers] Шарик зажжён и надет");
    }

    if (LIGHT_MEMORIZING_REGEXP.test(stripped) && !lightMemorizing) {
      lightMemorizing = true;
      lightPending = false;
      deps.onLog("[triggers] Заклинание света ушло в резы, ждём Зауч:0");
    }

    const memorizeMatch = MEMORIZING_REGEXP.exec(stripped);
    if (memorizeMatch) {
      const major = Number(memorizeMatch[1]);
      const isIdle = major === 0 && memorizeMatch[2] === undefined;

      if (isIdle && lightMemorizing) {
        lightMemorizing = false;
        lightPending = false;
        deps.onLog("[triggers] Зауч:0 — заклинание света готово");
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

    if (!enabled.light) {
      lightPending = false;
      lightMemorizing = false;
    }

    if (changed) {
      deps.onStateChange(getState());
    }
  }

  function getState(): TriggerState {
    return { ...enabled };
  }

  function reset(): void {
    rightHandArmed = false;
    leftHandArmed = false;
    cursesReady = CURSES_MAX;
    curseMemorizing = false;
    curseHitThisBattle = false;
    cursePending = false;
    lightPending = false;
    lightMemorizing = false;
    lightEquipped = false;
    stopDodge();
  }

  return { handleMudText, onCombatStart, onCombatEnd, setEnabled, getState, reset };
}
