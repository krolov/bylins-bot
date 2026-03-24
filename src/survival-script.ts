const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const DEFAULT_RETRY_DELAY_MS = 1200;
const HUNGER_REGEXP = /Вы (?:голодны|очень голодны|готовы сожрать быка)/i;
const THIRST_REGEXP = /Вас (?:мучает|сильно мучает) жажда|Вам хочется выпить озеро/i;
const SATIATED_REGEXP = /Вы полностью насытились/i;
const THIRST_QUENCHED_REGEXP = /Вы не чувствуете жажды/i;
const CONSUME_COMMAND_DELAY_MS = 800;

export interface SurvivalConfig {
  enabled: boolean;
  container: string;
  foodItems: string[];
  flaskItems: string[];
  buyFoodAlias: string;
  buyFoodCommands: string[];
  fillFlaskAlias: string;
  fillFlaskCommands: string[];
}

export interface SurvivalControllerDependencies {
  getCurrentRoomId(): number | null;
  sendCommand(command: string): void;
  resolveNearest(alias: string): Promise<number | null>;
  navigateTo(vnum: number): Promise<void>;
  isInCombat(): boolean;
  onLog(message: string): void;
}

interface SurvivalState {
  hungry: boolean;
  thirsty: boolean;
  eatItemIndex: number;
  drinkItemIndex: number;
  eatPending: boolean;
  drinkPending: boolean;
  inFlight: boolean;
  nextActionAt: number;
  config: SurvivalConfig;
}

export function normalizeSurvivalConfig(config: SurvivalConfig): SurvivalConfig {
  return {
    enabled: config.enabled === true,
    container: (config.container ?? "").trim(),
    foodItems: Array.isArray(config.foodItems)
      ? config.foodItems.map((c) => c.trim()).filter((c) => c.length > 0)
      : [],
    flaskItems: Array.isArray(config.flaskItems)
      ? config.flaskItems.map((c) => c.trim()).filter((c) => c.length > 0)
      : [],
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

export function createSurvivalController(deps: SurvivalControllerDependencies) {
  const state: SurvivalState = {
    hungry: false,
    thirsty: false,
    eatItemIndex: 0,
    drinkItemIndex: 0,
    eatPending: false,
    drinkPending: false,
    inFlight: false,
    nextActionAt: 0,
    config: {
      enabled: false,
      container: "",
      foodItems: [],
      flaskItems: [],
      buyFoodAlias: "",
      buyFoodCommands: [],
      fillFlaskAlias: "",
      fillFlaskCommands: [],
    },
  };

  function reset(): void {
    state.hungry = false;
    state.thirsty = false;
    state.eatItemIndex = 0;
    state.drinkItemIndex = 0;
    state.eatPending = false;
    state.drinkPending = false;
    state.inFlight = false;
    state.nextActionAt = 0;
  }

  function updateConfig(config: SurvivalConfig): void {
    state.config = normalizeSurvivalConfig(config);
  }

  function handleMudText(text: string): void {
    const normalized = stripAnsi(text).replace(/\r/g, "");

    if (HUNGER_REGEXP.test(normalized)) state.hungry = true;
    if (THIRST_REGEXP.test(normalized)) state.thirsty = true;

    if (SATIATED_REGEXP.test(normalized)) {
      state.hungry = false;
      state.eatItemIndex = 0;
      state.eatPending = false;
    }
    if (THIRST_QUENCHED_REGEXP.test(normalized)) {
      state.thirsty = false;
      state.drinkItemIndex = 0;
      state.drinkPending = false;
    }
  }

  function isInFlight(): boolean {
    return state.inFlight;
  }

  async function runTick(onSchedule: (delayMs: number) => void): Promise<boolean> {
    if (!state.config.enabled || deps.isInCombat()) return false;

    const waitMs = state.nextActionAt - Date.now();
    if (waitMs > 0) {
      onSchedule(waitMs);
      return true;
    }

    if (state.hungry) {
      const { foodItems, container } = state.config;

      if (state.eatPending) {
        state.nextActionAt = Date.now() + CONSUME_COMMAND_DELAY_MS;
        onSchedule(CONSUME_COMMAND_DELAY_MS);
        return true;
      }

      if (foodItems.length > 0 && state.eatItemIndex < foodItems.length) {
        const item = foodItems[state.eatItemIndex];
        const takeCmd = container ? `взя ${item} ${container}` : `взя ${item}`;
        const eatCmd = `есть ${item}`;
        deps.onLog(`[survival] голод: ${takeCmd} → ${eatCmd}`);
        deps.sendCommand(takeCmd);
        deps.sendCommand(eatCmd);
        state.eatItemIndex += 1;
        state.eatPending = true;
        state.nextActionAt = Date.now() + CONSUME_COMMAND_DELAY_MS;
        onSchedule(CONSUME_COMMAND_DELAY_MS);
        return true;
      }

      if (foodItems.length > 0 && state.eatItemIndex >= foodItems.length) {
        deps.onLog("[survival] еда в контейнере кончилась, нечего есть");
        state.eatItemIndex = 0;
      }

      return false;
    }

    if (state.thirsty) {
      const { flaskItems, container, fillFlaskAlias, fillFlaskCommands } = state.config;

      if (state.drinkPending) {
        state.nextActionAt = Date.now() + CONSUME_COMMAND_DELAY_MS;
        onSchedule(CONSUME_COMMAND_DELAY_MS);
        return true;
      }

      if (flaskItems.length > 0 && state.drinkItemIndex < flaskItems.length) {
        const item = flaskItems[state.drinkItemIndex];
        const takeCmd = container ? `взя ${item} ${container}` : `взя ${item}`;
        const drinkCmd = `пить ${item}`;
        deps.onLog(`[survival] жажда: ${takeCmd} → ${drinkCmd}`);
        deps.sendCommand(takeCmd);
        deps.sendCommand(drinkCmd);
        state.drinkItemIndex += 1;
        state.drinkPending = true;
        state.nextActionAt = Date.now() + CONSUME_COMMAND_DELAY_MS;
        onSchedule(CONSUME_COMMAND_DELAY_MS);
        return true;
      }

      if (!state.inFlight && fillFlaskAlias) {
        const originVnum = deps.getCurrentRoomId();
        state.inFlight = true;
        void (async () => {
          try {
            deps.onLog(`[survival] фляга пуста, идём наполнять: "${fillFlaskAlias}"`);
            const vnum = await deps.resolveNearest(fillFlaskAlias);
            if (vnum === null) {
              deps.onLog(`[survival] алиас "${fillFlaskAlias}" не найден на карте, пропуск`);
              return;
            }
            await deps.navigateTo(vnum);
            for (const cmd of fillFlaskCommands) {
              deps.sendCommand(cmd);
            }
            state.drinkItemIndex = 0;
            state.drinkPending = false;
            if (originVnum !== null && originVnum !== deps.getCurrentRoomId()) {
              deps.onLog(`[survival] возвращаемся на исходную позицию (${originVnum})`);
              await deps.navigateTo(originVnum);
            }
          } finally {
            state.inFlight = false;
            onSchedule(DEFAULT_RETRY_DELAY_MS);
          }
        })();
        onSchedule(DEFAULT_RETRY_DELAY_MS);
        return true;
      }

      if (!state.inFlight && !fillFlaskAlias) {
        deps.onLog("[survival] фляга пуста, маршрут наполнения не настроен");
        state.drinkItemIndex = 0;
      }

      return false;
    }

    if (state.inFlight) {
      onSchedule(DEFAULT_RETRY_DELAY_MS);
      return true;
    }

    return false;
  }

  return {
    reset,
    updateConfig,
    handleMudText,
    isInFlight,
    runTick,
  };
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE_REGEXP, "");
}
