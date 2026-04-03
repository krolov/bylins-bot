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

// Автоасист: строка "Х сражается с Y!" в описании комнаты или в бою
const ASSIST_FIGHTING_REGEXP = /^(.+) сражается с (.+?)!?\s*$/;

// Постбой: события окончания боя / выхода из хол да / слепоты
const ASSIST_POSTCOMBAT_REGEXPS = [
  /^Кровушка стынет в жилах от предсмертного крика/,
  /^К вам вернулась способность двигаться\./,
  /^Вы вновь можете видеть\./,
  /^К вам вернулась способность видеть\./,
  /^Вы отступили из битвы\./,
];

// Антиспам: после первого асиста игнорируем повторные триггеры N мс
const ASSIST_COOLDOWN_MS = 2000;

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

// Follow-leader: лидеры клана, чьи команды выполняются
const FOLLOW_LEADER_NAMES = new Set([
  "Магуша", "Аделя", "Куруш", "Нимрок", "Цисса", "Экзар", "Берест",
]);

// гг-канал: «Имя дружине: 'текст'» или «Имя сообщил группе : 'текст'»
const FOLLOW_GG_REGEXP = /^(\S+) (?:дружине|сообщил[аи]? группе) : '(.+?)'\.?$/;

// гд-канал: «Имя клану: 'текст'»
const FOLLOW_GD_REGEXP = /^(\S+) клану: '(.+)'$/;

// личка с восклицательным знаком: «Имя сказал вам : '!команда'»
const FOLLOW_TELL_REGEXP = /^(\S+) сказал вам : '!(.+)'$/;

export interface TriggerState {
  dodge: boolean;
  standUp: boolean;
  rearm: boolean;
  curse: boolean;
  light: boolean;
  followLeader: boolean;
  assist: boolean;
  assistTanks: string[];
}

interface TriggerDependencies {
  sendCommand(command: string): void;
  onStateChange(state: TriggerState): void;
  onLog(message: string): void;
  isInCombat(): boolean;
  getCharacterName(): string;
  getCharLevel(): number;
  getCharDsu(): number;
  getCharRazb(): number;
}

export function createTriggers(deps: TriggerDependencies) {
  const enabled: TriggerState = {
    dodge: true,
    standUp: true,
    rearm: true,
    curse: false,
    light: false,
    followLeader: true,
    assist: false,
    assistTanks: [],
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

  let assistLastFiredAt = 0;
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

    if (enabled.followLeader) {
      handleFollowLeaderLogic(stripped);
    }

    if (enabled.assist) {
      handleAssistLogic(stripped);
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

  function tryHandleLocalCommand(command: string): boolean {
    const lower = command.trim().toLowerCase();
    if (lower === "дсу") {
      const level = deps.getCharLevel();
      const dsu = deps.getCharDsu();
      const razb = deps.getCharRazb();
      const dsuFormatted = dsu.toLocaleString("ru-RU");
      deps.sendCommand(`гг [ Разбег: ${razb} -+- Уровень: ${level} -+- ДСУ: ${dsuFormatted} ]`);
      return true;
    }
    if (lower === "автобаш да") {
      setEnabled({ assist: true });
      deps.onLog("[triggers] assist: enabled via follow-leader");
      return true;
    }
    if (lower === "автобаш нет") {
      setEnabled({ assist: false });
      deps.onLog("[triggers] assist: disabled via follow-leader");
      return true;
    }
    return false;
  }

  function handleFollowLeaderLogic(stripped: string): void {
    const charName = deps.getCharacterName();
    for (const line of stripped.split("\n")) {
      const ggMatch = FOLLOW_GG_REGEXP.exec(line) ?? FOLLOW_GD_REGEXP.exec(line);
      if (ggMatch) {
        const [, sender, text] = ggMatch;
        deps.onLog(`[triggers] follow-leader match: sender="${sender}" text="${text}" charName="${charName}" inNames=${FOLLOW_LEADER_NAMES.has(sender)} startsWith=${text.startsWith(`${charName} `)}`);
        if (FOLLOW_LEADER_NAMES.has(sender)) {
          let command: string | null = null;
          if (text.startsWith("!")) {
            // !команда — для всей группы
            command = text.slice(1).trim();
          } else if (text.startsWith(`${charName} `)) {
            // Ринли команда — адресовано конкретно нам
            command = text.slice(charName.length + 1).trim();
          }
          if (command) {
            deps.onLog(`[triggers] follow-leader: ${sender}: ${command}`);
            if (!tryHandleLocalCommand(command)) {
              deps.sendCommand(command);
            }
          }
        }
        continue;
      }

      const tellMatch = FOLLOW_TELL_REGEXP.exec(line);
      if (tellMatch) {
        const [, sender, command] = tellMatch;
        deps.onLog(`[triggers] follow-leader tell from ${sender}: ${command}`);
        if (!tryHandleLocalCommand(command)) {
          deps.sendCommand(command);
        }
      }
    }
  }

  function handleAssistLogic(stripped: string): void {
    for (const line of stripped.split("\n")) {
      for (const postcombatRegexp of ASSIST_POSTCOMBAT_REGEXPS) {
        if (postcombatRegexp.test(line)) {
          deps.onLog("[triggers] assist: postcombat trigger -> см");
          deps.sendCommand("см");
          return;
        }
      }

      const match = ASSIST_FIGHTING_REGEXP.exec(line);
      if (!match) continue;

      const [, leftPart, mob] = match;
      const leftLower = leftPart.toLowerCase();
      const isTank = enabled.assistTanks.some((tank) => leftLower.includes(tank.toLowerCase()));
      if (!isTank) continue;

      const now = Date.now();
      if (now - assistLastFiredAt < ASSIST_COOLDOWN_MS) {
        deps.onLog(`[triggers] assist: cooldown active, skipping`);
        continue;
      }
      assistLastFiredAt = now;

      const mobKey = mob.trim().slice(0, 4);
      deps.onLog(`[triggers] assist: tank detected, stabbing mob="${mobKey}"`);
      deps.sendCommand("спрят");
      deps.sendCommand(`закол ${mobKey}`);
      deps.sendCommand(`закол 2.${mobKey}`);
      deps.sendCommand(`закол 3.${mobKey}`);
      deps.sendCommand("отступ");
      return;
    }
  }

  function setEnabled(patch: Partial<TriggerState>): void {
    let changed = false;

    for (const key of Object.keys(patch) as Array<keyof TriggerState>) {
      if (!(key in enabled)) continue;
      const patchVal = patch[key];
      if (key === "assistTanks") {
        if (Array.isArray(patchVal)) {
          enabled.assistTanks = patchVal as string[];
          changed = true;
        }
      } else if (enabled[key] !== patchVal) {
        (enabled[key] as boolean) = patchVal as boolean;
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
