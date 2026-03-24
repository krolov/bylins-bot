import type { Direction, MapSnapshot } from "./map/types";
import { findPath } from "./map/pathfinder";

const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ROOM_PROMPT_REGEXP = /Вых:[^>]*>/i;
const COMBAT_PROMPT_REGEXP = /\[[^:\]]+:[^\]]+\]\s+\[[^:\]]+:[^\]]+\]\s*>/;
const COMBAT_ACTIVITY_REGEXP = /Вы\s+(?:легонько|слегка)\s+огрели|Вы попытались огреть|попытал(?:ся|ась|ось)\s+(?:укусить|ужалить)\s+вас|без сознания и медленно умирает/i;
const TARGET_NOT_VISIBLE_REGEXP = /Вы не видите цели\.?|Кого вы так сильно ненавидите/i;
const TARGET_REMOVAL_REGEXP = /труп|мертв|мертва|душа|без сознания|убежал|убежала|убежало|убежали|уполз|уползла|уползли|улетел|улетела|улетели|ушел|ушла|ушли|исчез|исчезла|исчезли/i;
// Моб пришёл в комнату: "Полоз приполз с запада.", "Аист прилетел с юга.", "Выдра прибежала с севера."
const MOB_ARRIVAL_REGEXP = /^(.+?)\s+(?:приполз|приползла|приползли|прибежал|прибежала|прибежали|пришел|пришла|пришли|прилетел|прилетела|прилетели|прошмыгнул|прошмыгнула|прошмыгнули|прошмыгнуло)\s+с\s+\S+\.?$/i;
// "Труп выдры лежит здесь." — предмет/труп на полу в описании комнаты
const LOOT_ON_FLOOR_REGEXP = /^(.+?)\s+лежит здесь\.?$/i;
// "Выдра мертва, ее душа медленно подымается в небеса." — моб только что умер
const LOOT_MOB_DEATH_REGEXP = /мертв[аео]?,\s+(?:его|её|ее|ее)\s+душа/i;
const LOOT_COMMAND_DELAY_MS = 600;
const PERIODIC_ACTION_COMMAND_DELAY_MS = 700;
// Блок мобов в описании комнаты: красные строки \u001b[1;31m после [ Exits: ... ]
// Формат: <ESC>[1;31m<строка1>\r\n<строка2>\r\n<ESC>[0;0m
const ROOM_MOB_BLOCK_REGEXP = /\u001b\[1;31m([\s\S]*?)\u001b\[0;0m/g;
// Убирает префикс состояния моба в скобках, например "(летит) " или "(спит) "
const TARGET_PREFIX_REGEXP = /^\([^)]*\)\s*/;
// Вычленяет имя моба из строки описания, отсекая глагол/описание действия
const TARGET_ACTION_SPLIT_REGEXP = /\s+(?:так\s+и\s+)?(?:тихо|величаво|злобно|изящно|медленно|стремительно|быстро)\s+(?=\S)|\s+(?:так\s+и\s+)?(?:норовит|стоит|сидит|лежит|ползает|ползет|ползут|идет|идут|ходит|ходят|бредет|бродит|бродят|разгуливает|проходит|проходят|присела|присел|крадется|крадутся|скользит|скользят|кружит|выгнул|выискивает|зудит|волнуется|спрятался|спряталась|спрятались|проскользнула|проскользнул|прошмыгнула|прошмыгнул|прошмыгнули|прошмыгнуло|извивается|проползает|шипит|орет|орёт|нахваливает|смотрит|несется|гоняет|пробегает|летает|жужжит|надоедает|пробует|отдыхает|прячется|пробежал|юркнула)(?=\s|$)/i;
const RESTING_PROMPT_REGEXP = /\b(?:ОЗ|Вых):/i;
// Голод: "Вы голодны.", "Вы очень голодны.", "Вы готовы сожрать быка."
const HUNGER_REGEXP = /Вы (?:голодны|очень голодны|готовы сожрать быка)/i;
// Жажда: "Вас мучает жажда.", "Вас сильно мучает жажда.", "Вам хочется выпить озеро."
const THIRST_REGEXP = /Вас (?:мучает|сильно мучает) жажда|Вам хочется выпить озеро/i;
// Подтверждение насыщения
const SATIATED_REGEXP = /Вы полностью насытились/i;
// Подтверждение утоления жажды
const THIRST_QUENCHED_REGEXP = /Вы не чувствуете жажды/i;
const CONSUME_COMMAND_DELAY_MS = 800;
// Персонаж сел (от игры или от скрипта)
const SITTING_REGEXP = /^Вы (?:сели|пристроились поудобнее)/i;
// Персонаж встал
const STANDING_REGEXP = /^Вы прекратили отдыхать и встали/i;
const DEFAULT_RETRY_DELAY_MS = 1200;
const MOVE_DELAY_MS = 900;
const HEAL_COMMAND_DELAY_MS = 700;
const REST_COMMAND_DELAY_MS = 1600;
const ENERGY_REST_THRESHOLD_RATIO = 0.25;
const ENERGY_RESUME_THRESHOLD_RATIO = 0.9;

const DIRECTION_TO_COMMAND: Record<Direction, string> = {
  north: "с",
  south: "ю",
  east: "в",
  west: "з",
  up: "вв",
  down: "вн",
};

const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
  up: "down",
  down: "up",
};

export interface PeriodicActionConfig {
  enabled: boolean;
  gotoAlias1: string;
  commands: string[];
  gotoAlias2: string;
  intervalMs: number;
}

export interface SurvivalConfig {
  enabled: boolean;
  eatCommands: string[];
  eatCount: number;
  drinkCommands: string[];
  drinkCount: number;
  buyFoodAlias: string;
  buyFoodCommands: string[];
  fillFlaskAlias: string;
  fillFlaskCommands: string[];
}

export interface FarmStateSnapshot {
  enabled: boolean;
  zoneId: number | null;
  pendingActivation: boolean;
  targetValues: string[];
  healCommands: string[];
  healThresholdPercent: number;
  lootValues: string[];
  periodicAction: PeriodicActionConfig;
}

interface FarmControllerDependencies {
  getCurrentRoomId(): number | null;
  isConnected(): boolean;
  getSnapshot(currentVnum: number | null): Promise<MapSnapshot>;
  sendCommand(command: string): void;
  requestRoomScan(): void;
  resolveAlias(alias: string): Promise<number | null>;
  resolveAliasAll(alias: string): Promise<number[]>;
  navigateTo(vnum: number): Promise<void>;
  onStateChange(state: FarmStateSnapshot): void;
  onLog(message: string): void;
}

interface FarmConfig {
  targetValues: string[];
  healCommands: string[];
  healThresholdPercent: number;
  lootValues: string[];
  periodicAction: PeriodicActionConfig;
  survival: SurvivalConfig;
}

interface FarmStats {
  hp: number;
  hpMax: number;
  energy: number;
  energyMax: number;
}

interface FarmState {
  enabled: boolean;
  zoneId: number | null;
  pendingActivation: boolean;
  inCombat: boolean;
  tickTimer: ReturnType<typeof setTimeout> | null;
  tickInFlight: boolean;
  nextActionAt: number;
  currentVisibleTargets: Map<string, string>;
  pendingLoot: string[];
  config: FarmConfig;
  stats: FarmStats;
  resting: boolean;
  healingInProgress: boolean;
  healCommandIndex: number;
  roomVisitOrder: Map<number, number>;
  visitSequence: number;
  lastRecordedRoomId: number | null;
  lastMoveFromRoomId: number | null;
  lastPeriodicActionAt: number;
  periodicActionInFlight: boolean;
  hungry: boolean;
  thirsty: boolean;
  eatAttempted: boolean;
  drinkAttempted: boolean;
  survivalInFlight: boolean;
  pendingRoomScanAfterKill: boolean;
}

export function createFarmController(deps: FarmControllerDependencies) {
  const state: FarmState = {
    enabled: false,
    zoneId: null,
    pendingActivation: false,
    inCombat: false,
    tickTimer: null,
    tickInFlight: false,
    nextActionAt: 0,
    currentVisibleTargets: new Map<string, string>(),
    pendingLoot: [],
    config: {
      targetValues: [],
      healCommands: [],
      healThresholdPercent: 50,
      lootValues: [],
      periodicAction: {
        enabled: false,
        gotoAlias1: "",
        commands: [],
        gotoAlias2: "",
        intervalMs: 0,
      },
      survival: {
        enabled: false,
        eatCommands: [],
        eatCount: 1,
        drinkCommands: [],
        drinkCount: 1,
        buyFoodAlias: "",
        buyFoodCommands: [],
        fillFlaskAlias: "",
        fillFlaskCommands: [],
      },
    },
    stats: {
      hp: 0,
      hpMax: 0,
      energy: 0,
      energyMax: 0,
    },
    resting: false,
    healingInProgress: false,
    healCommandIndex: 0,
    roomVisitOrder: new Map<number, number>(),
    visitSequence: 0,
    lastRecordedRoomId: null,
    lastMoveFromRoomId: null,
    lastPeriodicActionAt: 0,
    periodicActionInFlight: false,
    hungry: false,
    thirsty: false,
    eatAttempted: false,
    drinkAttempted: false,
    survivalInFlight: false,
    pendingRoomScanAfterKill: false,
  };

  function getState(): FarmStateSnapshot {
    return {
      enabled: state.enabled,
      zoneId: state.zoneId,
      pendingActivation: state.pendingActivation,
      targetValues: [...state.config.targetValues],
      healCommands: [...state.config.healCommands],
      healThresholdPercent: state.config.healThresholdPercent,
      lootValues: [...state.config.lootValues],
      periodicAction: { ...state.config.periodicAction },
    };
  }

  function publishState(): void {
    deps.onStateChange(getState());
  }

  function clearTickTimer(): void {
    if (state.tickTimer) {
      clearTimeout(state.tickTimer);
      state.tickTimer = null;
    }
  }

  function scheduleTick(delayMs: number): void {
    if (!state.enabled) {
      return;
    }

    clearTickTimer();
    state.tickTimer = setTimeout(() => {
      state.tickTimer = null;
      void runTick();
    }, Math.max(0, delayMs));
  }

  function markRoomVisited(roomId: number | null): void {
    if (roomId === null || state.lastRecordedRoomId === roomId) {
      return;
    }

    state.visitSequence += 1;
    state.roomVisitOrder.set(roomId, state.visitSequence);
    state.lastRecordedRoomId = roomId;
  }

  function resetTrackingState(): void {
    state.inCombat = false;
    state.nextActionAt = 0;
    state.currentVisibleTargets.clear();
    state.pendingLoot = [];
    state.resting = false;
    state.healingInProgress = false;
    state.healCommandIndex = 0;
    state.roomVisitOrder.clear();
    state.visitSequence = 0;
    state.lastRecordedRoomId = null;
    state.lastMoveFromRoomId = null;
    state.lastPeriodicActionAt = 0;
    state.periodicActionInFlight = false;
    state.hungry = false;
    state.thirsty = false;
    state.eatAttempted = false;
    state.drinkAttempted = false;
    state.survivalInFlight = false;
    state.pendingRoomScanAfterKill = false;
  }

  function disable(reason?: string): void {
    clearTickTimer();
    state.enabled = false;
    state.zoneId = null;
    state.pendingActivation = false;
    resetTrackingState();
    publishState();

    if (reason) {
      deps.onLog(reason);
    }
  }

  async function resolveNearest(alias: string): Promise<number | null> {
    const vnums = await deps.resolveAliasAll(alias);
    if (vnums.length === 0) return null;
    if (vnums.length === 1) return vnums[0];
    const currentRoomId = deps.getCurrentRoomId();
    if (currentRoomId === null) return vnums[0];
    const snapshot = await deps.getSnapshot(currentRoomId);
    let bestVnum: number | null = null;
    let bestLen = Infinity;
    for (const vnum of vnums) {
      if (vnum === currentRoomId) return vnum;
      const path = findPath(snapshot, currentRoomId, vnum);
      if (path !== null && path.length < bestLen) {
        bestLen = path.length;
        bestVnum = vnum;
      }
    }
    return bestVnum ?? vnums[0];
  }

  function enable(): void {
    const currentRoomId = deps.getCurrentRoomId();

    if (currentRoomId === null) {
      clearTickTimer();
      resetTrackingState();
      state.enabled = true;
      state.zoneId = null;
      state.pendingActivation = true;
      publishState();
      deps.onLog("Фарм ожидает текущую комнату...");
      deps.requestRoomScan();
      scheduleTick(DEFAULT_RETRY_DELAY_MS);
      return;
    }

    clearTickTimer();
    resetTrackingState();
    state.enabled = true;
    state.zoneId = getZoneId(currentRoomId);
    state.pendingActivation = false;
    markRoomVisited(currentRoomId);
    publishState();
    deps.onLog(`Фарм включён для зоны ${state.zoneId}.`);
    scheduleTick(50);
  }

  function setEnabled(enabled: boolean): void {
    if (enabled) {
      enable();
      return;
    }

    disable("Фарм выключен.");
  }

  function updateConfig(config: { targetValues: string[]; healCommands: string[]; healThresholdPercent: number; lootValues: string[]; periodicAction: PeriodicActionConfig; survival: SurvivalConfig }): void {
    state.config.targetValues = normalizeTargetValues(config.targetValues);
    state.config.healCommands = normalizeCommands(config.healCommands);
    state.config.healThresholdPercent = normalizePercent(config.healThresholdPercent, 50);
    state.config.lootValues = normalizeTargetValues(config.lootValues);
    state.config.periodicAction = normalizePeriodicAction(config.periodicAction);
    state.config.survival = normalizeSurvivalConfig(config.survival);
    deps.onLog(`[farm] config targetValues: [${state.config.targetValues.join(", ") || "пусто"}]`);
    publishState();
  }

  function updateStats(stats: FarmStats): void {
    state.stats = stats;

    if (state.resting && !shouldRestForEnergy(state.stats)) {
      state.resting = false;
      deps.sendCommand("встать");
      state.nextActionAt = Date.now() + REST_COMMAND_DELAY_MS;
      scheduleTick(REST_COMMAND_DELAY_MS);
      return;
    }

    if (state.enabled) {
      scheduleTick(75);
    }
  }

  function handleMudText(text: string, options: { roomChanged: boolean; roomDescriptionReceived: boolean; currentRoomId: number | null }): void {
    const normalized = stripAnsi(text).replace(/\r/g, "");
    const lines = normalized
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (options.roomChanged || (options.roomDescriptionReceived && state.pendingRoomScanAfterKill)) {
      state.currentVisibleTargets.clear();
      state.pendingLoot = [];
      parseMobsFromRoomDescription(text);
    }

    if (COMBAT_PROMPT_REGEXP.test(normalized) || COMBAT_ACTIVITY_REGEXP.test(normalized)) {
      state.inCombat = true;
    }

    if (ROOM_PROMPT_REGEXP.test(normalized)) {
      state.inCombat = false;
      if (state.pendingRoomScanAfterKill) {
        state.pendingRoomScanAfterKill = false;
      }
    }

    if (RESTING_PROMPT_REGEXP.test(normalized) && state.resting && !shouldRestForEnergy(state.stats)) {
      state.resting = false;
    }

    for (const line of lines) {
      if (SITTING_REGEXP.test(line)) {
        if (!state.resting && state.enabled) {
          deps.sendCommand("встать");
        }
        break;
      }
      if (STANDING_REGEXP.test(line)) {
        state.resting = false;
        break;
      }
    }

    for (const line of lines) {
      if (HUNGER_REGEXP.test(line)) {
        state.hungry = true;
      }
      if (THIRST_REGEXP.test(line)) {
        state.thirsty = true;
      }
      if (SATIATED_REGEXP.test(line)) {
        state.hungry = false;
        state.eatAttempted = false;
      }
      if (THIRST_QUENCHED_REGEXP.test(line)) {
        state.thirsty = false;
        state.drinkAttempted = false;
      }
    }
    if (HUNGER_REGEXP.test(normalized)) state.hungry = true;
    if (THIRST_REGEXP.test(normalized)) state.thirsty = true;
    if (SATIATED_REGEXP.test(normalized)) { state.hungry = false; state.eatAttempted = false; }
    if (THIRST_QUENCHED_REGEXP.test(normalized)) { state.thirsty = false; state.drinkAttempted = false; }

    if (TARGET_NOT_VISIBLE_REGEXP.test(normalized)) {
      state.inCombat = false;
      state.nextActionAt = 0;
      state.currentVisibleTargets.clear();
    }

    for (const line of lines) {
      if (state.config.lootValues.length > 0) {
        const floorMatch = LOOT_ON_FLOOR_REGEXP.exec(line);
        if (floorMatch) {
          const itemName = floorMatch[1].replace(TARGET_PREFIX_REGEXP, "").trim().toLowerCase();
          if (state.config.lootValues.some((v) => itemName.includes(v))) {
            if (!state.pendingLoot.includes(floorMatch[1].trim())) {
              state.pendingLoot.push(floorMatch[1].trim());
            }
          }
        }

        if (LOOT_MOB_DEATH_REGEXP.test(line)) {
          for (const lootValue of state.config.lootValues) {
            const keyword = `взять ${lootValue}`;
            if (!state.pendingLoot.includes(keyword)) {
              state.pendingLoot.push(keyword);
            }
          }
        }
      }

      if (!options.roomChanged && LOOT_MOB_DEATH_REGEXP.test(line) && state.enabled && !state.pendingRoomScanAfterKill) {
        state.pendingRoomScanAfterKill = true;
        state.inCombat = false;
        deps.sendCommand("см");
      }

      if (!options.roomChanged) {
        const lowerLine = line.toLowerCase();

        if (TARGET_REMOVAL_REGEXP.test(lowerLine)) {
          const arrivalMatch = MOB_ARRIVAL_REGEXP.exec(line);
          if (!arrivalMatch) {
            const removedName = extractMobNameFromMovementLine(line);
            if (removedName) {
              state.currentVisibleTargets.delete(removedName.toLowerCase());
            }
          }
          continue;
        }

        const arrivalMatch = MOB_ARRIVAL_REGEXP.exec(line);
        if (arrivalMatch) {
          const mobName = arrivalMatch[1].trim();
          if (mobName) {
            state.currentVisibleTargets.set(mobName.toLowerCase(), mobName);
          }
        }
      }
    }

    if (state.enabled) {
      markRoomVisited(options.currentRoomId);

      if (state.pendingActivation && options.currentRoomId !== null) {
        state.zoneId = getZoneId(options.currentRoomId);
        state.pendingActivation = false;
        markRoomVisited(options.currentRoomId);
        publishState();
        deps.onLog(`Фарм включён для зоны ${state.zoneId}.`);
      }

      if (!state.periodicActionInFlight && !state.survivalInFlight && options.currentRoomId !== null && state.zoneId !== null && getZoneId(options.currentRoomId) !== state.zoneId) {
        disable(`Фарм остановлен: персонаж вышел из зоны ${state.zoneId}.`);
        return;
      }

      const remainingWait = state.nextActionAt - Date.now();
      if (remainingWait <= 0) {
        scheduleTick(TARGET_NOT_VISIBLE_REGEXP.test(normalized) ? 50 : 150);
      }
    }
  }

  function parseMobsFromRoomDescription(rawText: string): void {
    ROOM_MOB_BLOCK_REGEXP.lastIndex = 0;
    let blockMatch: RegExpExecArray | null;

    while ((blockMatch = ROOM_MOB_BLOCK_REGEXP.exec(rawText)) !== null) {
      const blockContent = blockMatch[1];
      const blockLines = blockContent
        .split(/\r?\n/)
        .map((line) => stripAnsi(line).trim())
        .filter((line) => line.length > 0);

      for (const line of blockLines) {
        const mobName = extractTargetName(line);
        if (mobName) {
          state.currentVisibleTargets.set(mobName.toLowerCase(), mobName);
        }
      }
    }
  }

  function handleSessionClosed(reason: string): void {
    if (state.enabled) {
      disable(`Фарм остановлен: ${reason}`);
    } else {
      clearTickTimer();
    }
  }

  async function runTick(): Promise<void> {
    if (!state.enabled || state.tickInFlight) {
      return;
    }

    state.tickInFlight = true;

    try {
      if (!deps.isConnected()) {
        scheduleTick(DEFAULT_RETRY_DELAY_MS);
        return;
      }

      const currentRoomId = deps.getCurrentRoomId();

      if (currentRoomId === null) {
        scheduleTick(DEFAULT_RETRY_DELAY_MS);
        return;
      }

      if (state.zoneId === null) {
        state.zoneId = getZoneId(currentRoomId);
        state.pendingActivation = false;
        publishState();
      }

      if (!state.periodicActionInFlight && !state.survivalInFlight && getZoneId(currentRoomId) !== state.zoneId) {
        disable(`Фарм остановлен: персонаж вышел из зоны ${state.zoneId}.`);
        return;
      }

      const waitMs = state.nextActionAt - Date.now();

      if (waitMs > 0) {
        scheduleTick(waitMs);
        return;
      }

      if (shouldRestForEnergy(state.stats)) {
        if (!state.resting) {
          state.resting = true;
          deps.sendCommand("сесть");
          deps.sendCommand("отдохнуть");
          state.nextActionAt = Date.now() + REST_COMMAND_DELAY_MS;
        }

        scheduleTick(REST_COMMAND_DELAY_MS);
        return;
      }

      if (state.resting) {
        deps.sendCommand("встать");
        state.resting = false;
        state.nextActionAt = Date.now() + REST_COMMAND_DELAY_MS;
        scheduleTick(REST_COMMAND_DELAY_MS);
        return;
      }

      if (shouldHeal(state.stats, state.config.healThresholdPercent) && state.config.healCommands.length > 0) {
        const nextHealCommand = state.config.healCommands[state.healCommandIndex % state.config.healCommands.length];
        deps.sendCommand(nextHealCommand);
        state.healCommandIndex = (state.healCommandIndex + 1) % state.config.healCommands.length;
        state.healingInProgress = true;
        state.nextActionAt = Date.now() + HEAL_COMMAND_DELAY_MS;
        scheduleTick(HEAL_COMMAND_DELAY_MS);
        return;
      }

      state.healingInProgress = false;

      if (state.hungry && !state.inCombat && state.config.survival.enabled) {
        if (!state.eatAttempted && state.config.survival.eatCommands.length > 0) {
          const count = Math.max(1, state.config.survival.eatCount);
          deps.onLog(`[farm] голод: ${state.config.survival.eatCommands.join(", ")} x${count}`);
          for (let i = 0; i < count; i++) {
            for (const cmd of state.config.survival.eatCommands) {
              deps.sendCommand(cmd);
            }
          }
          state.eatAttempted = true;
          state.nextActionAt = Date.now() + CONSUME_COMMAND_DELAY_MS;
          scheduleTick(CONSUME_COMMAND_DELAY_MS);
          return;
        }
        if (state.hungry && state.config.survival.buyFoodAlias && !state.survivalInFlight) {
          const originVnum = deps.getCurrentRoomId();
          state.survivalInFlight = true;
          void (async () => {
            try {
              const alias = state.config.survival.buyFoodAlias;
              deps.onLog(`[farm] еда кончилась, идём к ближайшей точке "${alias}"`);
              const vnum = await resolveNearest(alias);
              if (vnum === null) {
                deps.onLog(`[farm] алиас "${alias}" не найден на карте, пропуск`);
                return;
              }
              await deps.navigateTo(vnum);
              for (const cmd of state.config.survival.buyFoodCommands) {
                deps.sendCommand(cmd);
              }
              state.eatAttempted = false;
              if (originVnum !== null && originVnum !== deps.getCurrentRoomId()) {
                deps.onLog(`[farm] возвращаемся на исходную позицию (${originVnum})`);
                await deps.navigateTo(originVnum);
              }
            } finally {
              state.survivalInFlight = false;
              scheduleTick(DEFAULT_RETRY_DELAY_MS);
            }
          })();
          scheduleTick(DEFAULT_RETRY_DELAY_MS);
          return;
        }
      }

      if (state.thirsty && !state.inCombat && state.config.survival.enabled) {
        if (!state.drinkAttempted && state.config.survival.drinkCommands.length > 0) {
          const count = Math.max(1, state.config.survival.drinkCount);
          deps.onLog(`[farm] жажда: ${state.config.survival.drinkCommands.join(", ")} x${count}`);
          for (let i = 0; i < count; i++) {
            for (const cmd of state.config.survival.drinkCommands) {
              deps.sendCommand(cmd);
            }
          }
          state.drinkAttempted = true;
          state.nextActionAt = Date.now() + CONSUME_COMMAND_DELAY_MS;
          scheduleTick(CONSUME_COMMAND_DELAY_MS);
          return;
        }
        if (state.thirsty && state.config.survival.fillFlaskAlias && !state.survivalInFlight) {
          const originVnum = deps.getCurrentRoomId();
          state.survivalInFlight = true;
          void (async () => {
            try {
              const alias = state.config.survival.fillFlaskAlias;
              deps.onLog(`[farm] вода кончилась, идём к ближайшей точке "${alias}"`);
              const vnum = await resolveNearest(alias);
              if (vnum === null) {
                deps.onLog(`[farm] алиас "${alias}" не найден на карте, пропуск`);
                return;
              }
              await deps.navigateTo(vnum);
              for (const cmd of state.config.survival.fillFlaskCommands) {
                deps.sendCommand(cmd);
              }
              state.drinkAttempted = false;
              if (originVnum !== null && originVnum !== deps.getCurrentRoomId()) {
                deps.onLog(`[farm] возвращаемся на исходную позицию (${originVnum})`);
                await deps.navigateTo(originVnum);
              }
            } finally {
              state.survivalInFlight = false;
              scheduleTick(DEFAULT_RETRY_DELAY_MS);
            }
          })();
          scheduleTick(DEFAULT_RETRY_DELAY_MS);
          return;
        }
      }

      if (state.survivalInFlight) {
        scheduleTick(DEFAULT_RETRY_DELAY_MS);
        return;
      }

      if (state.inCombat) {
        scheduleTick(DEFAULT_RETRY_DELAY_MS);
        return;
      }

      if (state.pendingRoomScanAfterKill) {
        scheduleTick(DEFAULT_RETRY_DELAY_MS);
        return;
      }

      if (state.pendingLoot.length > 0) {
        const entries = state.pendingLoot.splice(0);
        for (const lootEntry of entries) {
          const command = lootEntry.startsWith("взять ") ? lootEntry : `взять ${lootEntry}`;
          deps.sendCommand(command);
        }
        state.nextActionAt = Date.now() + LOOT_COMMAND_DELAY_MS;
        scheduleTick(LOOT_COMMAND_DELAY_MS);
        return;
      }

      if (
        !state.periodicActionInFlight &&
        state.config.periodicAction.enabled &&
        state.config.periodicAction.intervalMs > 0 &&
        state.config.periodicAction.gotoAlias1.trim() !== "" &&
        state.config.periodicAction.gotoAlias2.trim() !== "" &&
        Date.now() - state.lastPeriodicActionAt >= state.config.periodicAction.intervalMs
      ) {
        state.periodicActionInFlight = true;
        void (async () => {
          try {
            const alias1 = state.config.periodicAction.gotoAlias1.trim();
            const alias2 = state.config.periodicAction.gotoAlias2.trim();
            const cmds = state.config.periodicAction.commands;

            deps.onLog(`[farm] periodicAction: идём к "${alias1}"`);
            const vnum1 = await deps.resolveAlias(alias1);
            if (vnum1 === null) {
              deps.onLog(`[farm] periodicAction: алиас "${alias1}" не найден, пропуск`);
              return;
            }
            await deps.navigateTo(vnum1);

            if (cmds.length > 0) {
              deps.onLog(`[farm] periodicAction: команды [${cmds.join(", ")}]`);
              for (const cmd of cmds) {
                deps.sendCommand(cmd);
              }
            }

            deps.onLog(`[farm] periodicAction: идём к "${alias2}"`);
            const vnum2 = await deps.resolveAlias(alias2);
            if (vnum2 === null) {
              deps.onLog(`[farm] periodicAction: алиас "${alias2}" не найден, пропуск`);
              return;
            }
            await deps.navigateTo(vnum2);

            deps.onLog("[farm] periodicAction: завершено");
          } finally {
            state.lastPeriodicActionAt = Date.now();
            state.periodicActionInFlight = false;
            scheduleTick(DEFAULT_RETRY_DELAY_MS);
          }
        })();
        scheduleTick(DEFAULT_RETRY_DELAY_MS);
        return;
      }

      if (state.periodicActionInFlight) {
        scheduleTick(DEFAULT_RETRY_DELAY_MS);
        return;
      }

      const target = pickVisibleTarget(state.currentVisibleTargets, state.config.targetValues);

      if (target) {
        deps.sendCommand(`заколоть ${target}`);
        state.inCombat = true;
        scheduleTick(DEFAULT_RETRY_DELAY_MS);
        return;
      }

      const snapshot = await deps.getSnapshot(currentRoomId);
      const nextDirection = chooseNextDirection(snapshot, currentRoomId, state.zoneId, state.roomVisitOrder, state.lastMoveFromRoomId);

      if (!nextDirection) {
        scheduleTick(DEFAULT_RETRY_DELAY_MS);
        return;
      }

      state.lastMoveFromRoomId = currentRoomId;
      deps.sendCommand(DIRECTION_TO_COMMAND[nextDirection]);
      state.nextActionAt = Date.now() + MOVE_DELAY_MS;
      scheduleTick(MOVE_DELAY_MS);
    } finally {
      state.tickInFlight = false;
    }
  }

  return {
    getState,
    setEnabled,
    updateConfig,
    updateStats,
    handleMudText,
    handleSessionClosed,
  };
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE_REGEXP, "");
}

function getZoneId(vnum: number): number {
  return Math.floor(vnum / 100);
}

function extractTargetName(line: string): string | null {
  const sanitized = line
    .replace(TARGET_PREFIX_REGEXP, "")
    .replace(/\.$/, "")
    .trim();

  if (!sanitized) {
    return null;
  }

  const match = TARGET_ACTION_SPLIT_REGEXP.exec(sanitized);
  const candidate = (match ? sanitized.slice(0, match.index) : sanitized).trim();

  if (!candidate || candidate.length < 2) {
    return null;
  }

  if (/^(?:вы|вас|вам|ваших|ваш)\b/i.test(candidate)) {
    return null;
  }

  return candidate;
}

function extractMobNameFromMovementLine(line: string): string | null {
  const MOB_DEPARTURE_REGEXP = /^(.+?)\s+(?:убежал|убежала|убежало|убежали|уполз|уползла|уползли|улетел|улетела|улетели|ушел|ушла|ушли|исчез|исчезла|исчезли|без сознания)\s/i;
  const match = MOB_DEPARTURE_REGEXP.exec(line);
  if (!match) {
    return null;
  }
  const name = match[1].replace(TARGET_PREFIX_REGEXP, "").trim();
  return name.length > 0 ? name : null;
}

function normalizeTargetValues(targetValues: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawValue of targetValues) {
    const value = rawValue.trim().toLowerCase();

    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

function normalizeCommands(commands: string[]): string[] {
  return commands
    .map((command) => command.trim())
    .filter((command, index, all) => command.length > 0 && all.indexOf(command) === index);
}

function normalizePercent(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(100, Math.round(value)));
}

function shouldHeal(stats: FarmStats, thresholdPercent: number): boolean {
  if (stats.hpMax <= 0) {
    return false;
  }

  return (stats.hp / stats.hpMax) * 100 < thresholdPercent;
}

function shouldRestForEnergy(stats: FarmStats): boolean {
  if (stats.energyMax <= 0) {
    return false;
  }

  const energyRatio = stats.energy / stats.energyMax;
  return energyRatio < ENERGY_REST_THRESHOLD_RATIO;
}

function pickVisibleTarget(visibleTargets: Map<string, string>, targetValues: string[]): string | null {
  if (targetValues.length === 0) {
    return null;
  }

  for (const target of visibleTargets.values()) {
    const normalizedTarget = target.toLowerCase();

    for (const value of targetValues) {
      if (normalizedTarget.includes(value)) {
        return value;
      }
    }
  }

  return null;
}

function chooseNextDirection(
  snapshot: MapSnapshot,
  currentRoomId: number,
  zoneId: number,
  roomVisitOrder: Map<number, number>,
  lastMoveFromRoomId: number | null,
): Direction | null {
  const zoneNodes = snapshot.nodes.filter((node) => getZoneId(node.vnum) === zoneId);
  const nodeByVnum = new Map(zoneNodes.map((node) => [node.vnum, node]));

  if (!nodeByVnum.has(currentRoomId)) {
    return null;
  }

  const adjacency = new Map<number, Array<{ toVnum: number; direction: Direction }>>();
  const seenEdges = new Set<string>();

  const pushEdge = (fromVnum: number, toVnum: number, direction: Direction) => {
    const key = `${fromVnum}:${toVnum}:${direction}`;

    if (seenEdges.has(key)) {
      return;
    }

    seenEdges.add(key);

    const existing = adjacency.get(fromVnum) ?? [];
    existing.push({ toVnum, direction });
    adjacency.set(fromVnum, existing);
  };

  for (const edge of snapshot.edges) {
    if (edge.isPortal || getZoneId(edge.fromVnum) !== zoneId || getZoneId(edge.toVnum) !== zoneId) {
      continue;
    }

    if (!nodeByVnum.has(edge.fromVnum) || !nodeByVnum.has(edge.toVnum)) {
      continue;
    }

    pushEdge(edge.fromVnum, edge.toVnum, edge.direction);

    const reverseDirection = OPPOSITE_DIRECTION[edge.direction];
    const destinationNode = nodeByVnum.get(edge.toVnum);

    if (destinationNode?.exits.includes(reverseDirection)) {
      pushEdge(edge.toVnum, edge.fromVnum, reverseDirection);
    }
  }

  const choices = adjacency.get(currentRoomId) ?? [];

  if (choices.length === 0) {
    return null;
  }

  choices.sort((left, right) => {
    const leftVisit = roomVisitOrder.get(left.toVnum) ?? Number.NEGATIVE_INFINITY;
    const rightVisit = roomVisitOrder.get(right.toVnum) ?? Number.NEGATIVE_INFINITY;
    const leftReturnsToPrevious = left.toVnum === lastMoveFromRoomId;
    const rightReturnsToPrevious = right.toVnum === lastMoveFromRoomId;

    if (leftReturnsToPrevious !== rightReturnsToPrevious) {
      return leftReturnsToPrevious ? 1 : -1;
    }

    if (leftVisit !== rightVisit) {
      return leftVisit - rightVisit;
    }

    return left.direction.localeCompare(right.direction);
  });

  return choices[0]?.direction ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePeriodicAction(config: PeriodicActionConfig): PeriodicActionConfig {
  return {
    enabled: config.enabled === true,
    gotoAlias1: (config.gotoAlias1 ?? "").trim(),
    commands: Array.isArray(config.commands)
      ? config.commands.map((c) => c.trim()).filter((c) => c.length > 0)
      : [],
    gotoAlias2: (config.gotoAlias2 ?? "").trim(),
    intervalMs: Math.max(0, Math.round(Number.isFinite(config.intervalMs) ? config.intervalMs : 0)),
  };
}

function normalizeSurvivalConfig(config: SurvivalConfig): SurvivalConfig {
  return {
    enabled: config.enabled === true,
    eatCommands: Array.isArray(config.eatCommands)
      ? config.eatCommands.map((c) => c.trim()).filter((c) => c.length > 0)
      : [],
    eatCount: Math.max(1, Math.round(Number.isFinite(Number(config.eatCount)) ? Number(config.eatCount) : 1)),
    drinkCommands: Array.isArray(config.drinkCommands)
      ? config.drinkCommands.map((c) => c.trim()).filter((c) => c.length > 0)
      : [],
    drinkCount: Math.max(1, Math.round(Number.isFinite(Number(config.drinkCount)) ? Number(config.drinkCount) : 1)),
    buyFoodAlias: (config.buyFoodAlias ?? "").trim(),
    buyFoodCommands: Array.isArray(config.buyFoodCommands)
      ? config.buyFoodCommands.map((c) => c.trim()).filter((c) => c.length > 0)
      : [],
    fillFlaskAlias: (config.fillFlaskAlias ?? "").trim(),
    fillFlaskCommands: Array.isArray(config.fillFlaskCommands)
      ? config.fillFlaskCommands.map((c) => c.trim()).filter((c) => c.length > 0)
      : [],
  };
}
