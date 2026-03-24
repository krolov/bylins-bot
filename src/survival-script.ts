const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ROOM_PROMPT_REGEXP = /Вых:[^>]*>/i;
const DEFAULT_RETRY_DELAY_MS = 1200;

// Голод: "Вы голодны.", "Вы очень голодны.", "Вы готовы сожрать быка."
const HUNGER_REGEXP = /Вы (?:голодны|очень голодны|готовы сожрать быка)/i;
// Жажда: "Вас мучает жажда.", "Вас сильно мучает жажда.", "Вам хочется выпить озеро."
const THIRST_REGEXP = /Вас (?:мучает|сильно мучает) жажда|Вам хочется выпить озеро/i;
// Подтверждение насыщения
const SATIATED_REGEXP = /Вы полностью насытились/i;
// Подтверждение утоления жажды
const THIRST_QUENCHED_REGEXP = /Вы не чувствуете жажды/i;
const CONSUME_COMMAND_DELAY_MS = 800;

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

export interface SurvivalControllerDependencies {
  getCurrentRoomId(): number | null;
  isConnected(): boolean;
  sendCommand(command: string): void;
  resolveNearest(alias: string): Promise<number | null>;
  navigateTo(vnum: number): Promise<void>;
  onLog(message: string): void;
}

interface SurvivalState {
  hungry: boolean;
  thirsty: boolean;
  eatAttempted: boolean;
  drinkAttempted: boolean;
  inFlight: boolean;
  nextActionAt: number;
  config: SurvivalConfig;
}

export function normalizeSurvivalConfig(config: SurvivalConfig): SurvivalConfig {
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

export function createSurvivalController(deps: SurvivalControllerDependencies) {
  const state: SurvivalState = {
    hungry: false,
    thirsty: false,
    eatAttempted: false,
    drinkAttempted: false,
    inFlight: false,
    nextActionAt: 0,
    config: {
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
  };

  function reset(): void {
    state.hungry = false;
    state.thirsty = false;
    state.eatAttempted = false;
    state.drinkAttempted = false;
    state.inFlight = false;
    state.nextActionAt = 0;
  }

  function updateConfig(config: SurvivalConfig): void {
    state.config = normalizeSurvivalConfig(config);
  }

  function handleMudText(text: string): void {
    const normalized = stripAnsi(text).replace(/\r/g, "");

    if (HUNGER_REGEXP.test(normalized)) {
      state.hungry = true;
    }
    if (THIRST_REGEXP.test(normalized)) {
      state.thirsty = true;
    }
    if (SATIATED_REGEXP.test(normalized)) {
      state.hungry = false;
      state.eatAttempted = false;
    }
    if (THIRST_QUENCHED_REGEXP.test(normalized)) {
      state.thirsty = false;
      state.drinkAttempted = false;
    }

    // Reset flags when a room prompt arrives (no longer in combat)
    if (ROOM_PROMPT_REGEXP.test(normalized)) {
      // intentionally empty — prompt detection for future use
    }
  }

  function isInFlight(): boolean {
    return state.inFlight;
  }

  function needsAttention(inCombat: boolean): boolean {
    if (!state.config.enabled) return false;
    if (inCombat) return false;
    return state.hungry || state.thirsty;
  }

  function getNextActionDelay(): number {
    return Math.max(0, state.nextActionAt - Date.now());
  }

  /**
   * Attempts to handle hunger/thirst. Returns true if an action was taken
   * (caller should yield / reschedule tick), false if nothing to do.
   *
   * scheduleTick is called by the caller when this returns true with a delay,
   * so this function uses onSchedule callback to request a reschedule.
   */
  async function runTick(inCombat: boolean, onSchedule: (delayMs: number) => void): Promise<boolean> {
    if (!state.config.enabled) return false;
    if (inCombat) return false;

    const waitMs = state.nextActionAt - Date.now();
    if (waitMs > 0) {
      onSchedule(waitMs);
      return true;
    }

    if (state.hungry) {
      if (!state.eatAttempted && state.config.eatCommands.length > 0) {
        const count = Math.max(1, state.config.eatCount);
        deps.onLog(`[survival] голод: ${state.config.eatCommands.join(", ")} x${count}`);
        for (let i = 0; i < count; i++) {
          for (const cmd of state.config.eatCommands) {
            deps.sendCommand(cmd);
          }
        }
        state.eatAttempted = true;
        state.nextActionAt = Date.now() + CONSUME_COMMAND_DELAY_MS;
        onSchedule(CONSUME_COMMAND_DELAY_MS);
        return true;
      }

      if (state.hungry && state.config.buyFoodAlias && !state.inFlight) {
        const originVnum = deps.getCurrentRoomId();
        state.inFlight = true;
        void (async () => {
          try {
            const alias = state.config.buyFoodAlias;
            deps.onLog(`[survival] еда кончилась, идём к ближайшей точке "${alias}"`);
            const vnum = await deps.resolveNearest(alias);
            if (vnum === null) {
              deps.onLog(`[survival] алиас "${alias}" не найден на карте, пропуск`);
              return;
            }
            await deps.navigateTo(vnum);
            for (const cmd of state.config.buyFoodCommands) {
              deps.sendCommand(cmd);
            }
            state.eatAttempted = false;
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
    }

    if (state.thirsty) {
      if (!state.drinkAttempted && state.config.drinkCommands.length > 0) {
        const count = Math.max(1, state.config.drinkCount);
        deps.onLog(`[survival] жажда: ${state.config.drinkCommands.join(", ")} x${count}`);
        for (let i = 0; i < count; i++) {
          for (const cmd of state.config.drinkCommands) {
            deps.sendCommand(cmd);
          }
        }
        state.drinkAttempted = true;
        state.nextActionAt = Date.now() + CONSUME_COMMAND_DELAY_MS;
        onSchedule(CONSUME_COMMAND_DELAY_MS);
        return true;
      }

      if (state.thirsty && state.config.fillFlaskAlias && !state.inFlight) {
        const originVnum = deps.getCurrentRoomId();
        state.inFlight = true;
        void (async () => {
          try {
            const alias = state.config.fillFlaskAlias;
            deps.onLog(`[survival] вода кончилась, идём к ближайшей точке "${alias}"`);
            const vnum = await deps.resolveNearest(alias);
            if (vnum === null) {
              deps.onLog(`[survival] алиас "${alias}" не найден на карте, пропуск`);
              return;
            }
            await deps.navigateTo(vnum);
            for (const cmd of state.config.fillFlaskCommands) {
              deps.sendCommand(cmd);
            }
            state.drinkAttempted = false;
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
    needsAttention,
    getNextActionDelay,
    runTick,
  };
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE_REGEXP, "");
}
