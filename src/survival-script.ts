const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const DEFAULT_RETRY_DELAY_MS = 1200;
const HUNGER_REGEXP = /Вы (?:голодны|очень голодны|готовы сожрать быка)/i;
const THIRST_REGEXP = /Вас (?:мучает|сильно мучает) жажда|Вам хочется выпить озеро/i;
const SATIATED_REGEXP = /Вы полностью насытились/i;
const ATE_REGEXP = /Вы съели /i;
const TOO_FULL_REGEXP = /Вы слишком сыты для этого/i;
const THIRST_QUENCHED_REGEXP = /Вы не чувствуете жажды/i;
const DRANK_REGEXP = /Вы выпили .+ из /i;
const NOT_FOUND_REGEXP = /Вы не смогли это найти|Вы не видите .+ в |У вас нет '/i;
const CONSUME_COMMAND_DELAY_MS = 800;
const INSPECT_TIMEOUT_MS = 2000;
const ITEM_LINE_REGEXP = /^\s*(.+?)\s*(?:\[(\d+)\])?\s*$/;
const PROMPT_LINE_REGEXP = /^\s*\d+H\s+\d+M\b/i;
const MAX_CONSUME_ITERATIONS = 20;

export interface SurvivalConfig {
  enabled: boolean;
  container: string;
  foodItems: string[];
  flaskItems: string[];
  buyFoodItem: string;
  buyFoodMax: number;
  buyFoodAlias: string;
  fillFlaskAlias: string;
  fillFlaskSource: string;
}

export interface SurvivalStatus {
  foodEmpty: boolean;
  flaskEmpty: boolean;
}

export interface SurvivalControllerDependencies {
  getCurrentRoomId(): number | null;
  sendCommand(command: string): void;
  resolveNearest(alias: string): Promise<number | null>;
  navigateTo(vnum: number): Promise<void>;
  isInCombat(): boolean;
  onLog(message: string): void;
  onStatusChange(status: SurvivalStatus): void;
}

interface SurvivalState {
  hungry: boolean;
  thirsty: boolean;
  inFlight: boolean;
  nextActionAt: number;
  foodEmpty: boolean;
  flaskEmpty: boolean;
  inspectPending: ((text: string) => void) | null;
  pendingPutBack: { keyword: string; container: string } | null;
  config: SurvivalConfig;
  eatingKeyword: string | null;
  drinkingKeyword: string | null;
  eatIterations: number;
  drinkIterations: number;
  eatNextTimer: ReturnType<typeof setTimeout> | null;
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
    buyFoodItem: (config.buyFoodItem ?? "").trim(),
    buyFoodMax: typeof config.buyFoodMax === "number" && Number.isFinite(config.buyFoodMax) && config.buyFoodMax > 0
      ? Math.floor(config.buyFoodMax)
      : 20,
    buyFoodAlias: (config.buyFoodAlias ?? "").trim(),
    fillFlaskAlias: (config.fillFlaskAlias ?? "").trim(),
    fillFlaskSource: (config.fillFlaskSource ?? "").trim(),
  };
}

export function createSurvivalController(deps: SurvivalControllerDependencies) {
  const state: SurvivalState = {
    hungry: false,
    thirsty: false,
    inFlight: false,
    nextActionAt: 0,
    foodEmpty: false,
    flaskEmpty: false,
    inspectPending: null,
    pendingPutBack: null,
    eatingKeyword: null,
    drinkingKeyword: null,
    eatIterations: 0,
    drinkIterations: 0,
    eatNextTimer: null,
    config: {
      enabled: false,
      container: "",
      foodItems: [],
      flaskItems: [],
      buyFoodItem: "",
      buyFoodMax: 20,
      buyFoodAlias: "",
      fillFlaskAlias: "",
      fillFlaskSource: "",
    },
  };

  function reset(): void {
    state.hungry = false;
    state.thirsty = false;
    state.inFlight = false;
    state.nextActionAt = 0;
    state.foodEmpty = false;
    state.flaskEmpty = false;
    state.inspectPending = null;
    state.pendingPutBack = null;
    state.eatingKeyword = null;
    state.drinkingKeyword = null;
    state.eatIterations = 0;
    state.drinkIterations = 0;
    cancelEatNextTimer();
    deps.onStatusChange({ foodEmpty: state.foodEmpty, flaskEmpty: state.flaskEmpty });
  }

  function cancelEatNextTimer(): void {
    if (state.eatNextTimer !== null) {
      clearTimeout(state.eatNextTimer);
      state.eatNextTimer = null;
    }
  }

  function updateConfig(config: SurvivalConfig): void {
    state.config = normalizeSurvivalConfig(config);
  }

  function handleMudText(text: string): void {
    const normalized = stripAnsi(text).replace(/\r/g, "");

    if (state.inspectPending !== null && /(Заполнен|Пуст)/i.test(normalized)) {
      const pending = state.inspectPending;
      state.inspectPending = null;
      pending(normalized);
    }

    if (HUNGER_REGEXP.test(normalized)) state.hungry = true;
    if (THIRST_REGEXP.test(normalized)) state.thirsty = true;

    if (SATIATED_REGEXP.test(normalized) || TOO_FULL_REGEXP.test(normalized)) {
      cancelEatNextTimer();
      state.hungry = false;
      state.inFlight = false;
      state.eatingKeyword = null;
      state.eatIterations = 0;
      setFoodEmpty(false);
    }

    if (NOT_FOUND_REGEXP.test(normalized)) {
      if (state.eatingKeyword !== null) {
        state.hungry = false;
        state.inFlight = false;
        state.eatingKeyword = null;
        state.eatIterations = 0;
        cancelEatNextTimer();
        setFoodEmpty(true);
        deps.onLog("[survival] еда не найдена, попробуем позже");
      }
      if (state.drinkingKeyword !== null) {
        state.thirsty = false;
        state.inFlight = false;
        state.drinkingKeyword = null;
        state.drinkIterations = 0;
        setFlaskEmpty(true);
        if (state.pendingPutBack !== null) {
          state.pendingPutBack = null;
        }
        deps.onLog("[survival] фляга не найдена, попробуем позже");
      }
    }

    if (ATE_REGEXP.test(normalized)) {
      if (state.eatingKeyword !== null) {
        state.eatIterations += 1;
        if (state.eatIterations >= MAX_CONSUME_ITERATIONS) {
          deps.onLog("[survival] достигнут лимит поедания, останавливаемся");
          state.hungry = false;
          state.inFlight = false;
          state.eatingKeyword = null;
          state.eatIterations = 0;
        } else {
          const keyword = state.eatingKeyword;
          const container = state.config.container;
          deps.sendCommand(`взять ${keyword} ${container}`);
          state.eatNextTimer = setTimeout(() => {
            state.eatNextTimer = null;
            deps.sendCommand(`есть ${keyword}`);
          }, CONSUME_COMMAND_DELAY_MS);
        }
      }
    }

    if (DRANK_REGEXP.test(normalized)) {
      setFlaskEmpty(false);
      if (state.drinkingKeyword !== null) {
        state.drinkIterations += 1;
        if (state.drinkIterations >= MAX_CONSUME_ITERATIONS) {
          deps.onLog("[survival] достигнут лимит питья, останавливаемся");
          state.thirsty = false;
          state.inFlight = false;
          if (state.pendingPutBack !== null) {
            const { keyword, container } = state.pendingPutBack;
            state.pendingPutBack = null;
            deps.sendCommand(`положить ${keyword} ${container}`);
          }
          state.drinkingKeyword = null;
          state.drinkIterations = 0;
        } else {
          deps.sendCommand(`пить ${state.drinkingKeyword}`);
        }
      }
    }

    if (THIRST_QUENCHED_REGEXP.test(normalized)) {
      state.thirsty = false;
      state.inFlight = false;
      state.drinkingKeyword = null;
      state.drinkIterations = 0;
      setFlaskEmpty(false);
      if (state.pendingPutBack !== null) {
        const { keyword, container } = state.pendingPutBack;
        state.pendingPutBack = null;
        deps.sendCommand(`положить ${keyword} ${container}`);
      }
    }
  }

  function isInFlight(): boolean {
    return state.inFlight;
  }

  async function runTick(onSchedule: (delayMs: number) => void): Promise<boolean> {
    if (!state.config.enabled || deps.isInCombat()) return false;
    if (state.inFlight) return true;

    const waitMs = state.nextActionAt - Date.now();
    if (waitMs > 0) {
      onSchedule(waitMs);
      return true;
    }

    if (state.hungry) {
      const { foodItems, container } = state.config;

      if (foodItems.length === 0 || container.length === 0) {
        setFoodEmpty(true);
        state.hungry = false;
        deps.onLog("[survival] еда в мешке кончилась");
        return false;
      }

      state.inFlight = true;
      deps.sendCommand(`осм ${container}`);
      const inspectText = await waitForInspect();
      const foodKeyword = findFirstMatchingKeyword(inspectText, foodItems);

      if (foodKeyword !== null) {
        deps.onLog(`[survival] голод: есть ${foodKeyword}`);
        state.eatingKeyword = foodKeyword;
        state.eatIterations = 0;
        deps.sendCommand(`взять ${foodKeyword} ${container}`);
        await delay(CONSUME_COMMAND_DELAY_MS);
        deps.sendCommand(`есть ${foodKeyword}`);
        state.nextActionAt = Date.now() + CONSUME_COMMAND_DELAY_MS;
        onSchedule(CONSUME_COMMAND_DELAY_MS);
        return true;
      }

      state.inFlight = false;
      setFoodEmpty(true);
      state.hungry = false;
      deps.onLog("[survival] еда в мешке кончилась");

      return false;
    }

    if (state.thirsty) {
      const { flaskItems, container } = state.config;

      if (flaskItems.length === 0 || container.length === 0) {
        setFlaskEmpty(true);
        state.thirsty = false;
        deps.onLog("[survival] вода в мешке кончилась");
        return false;
      }

      state.inFlight = true;
      deps.sendCommand(`осм ${container}`);
      const inspectText = await waitForInspect();
      const flaskKeyword = findFirstMatchingKeyword(inspectText, flaskItems);

      if (flaskKeyword !== null) {
        deps.onLog(`[survival] жажда: пить ${flaskKeyword}`);
        state.drinkingKeyword = flaskKeyword;
        state.drinkIterations = 0;
        deps.sendCommand(`взять ${flaskKeyword} ${container}`);
        await delay(CONSUME_COMMAND_DELAY_MS);
        state.pendingPutBack = { keyword: flaskKeyword, container };
        deps.sendCommand(`пить ${flaskKeyword}`);
        setFlaskEmpty(false);
        state.nextActionAt = Date.now() + CONSUME_COMMAND_DELAY_MS;
        onSchedule(CONSUME_COMMAND_DELAY_MS);
        return true;
      }

      state.inFlight = false;
      setFlaskEmpty(true);
      state.thirsty = false;
      deps.onLog("[survival] вода в мешке кончилась");

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
    getStatus,
    runTick,
  };

  function setFoodEmpty(value: boolean): void {
    if (state.foodEmpty === value) return;
    state.foodEmpty = value;
    deps.onStatusChange({ foodEmpty: state.foodEmpty, flaskEmpty: state.flaskEmpty });
  }

  function setFlaskEmpty(value: boolean): void {
    if (state.flaskEmpty === value) return;
    state.flaskEmpty = value;
    deps.onStatusChange({ foodEmpty: state.foodEmpty, flaskEmpty: state.flaskEmpty });
  }

  function getStatus(): SurvivalStatus {
    return { foodEmpty: state.foodEmpty, flaskEmpty: state.flaskEmpty };
  }

  function waitForInspect(): Promise<string> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        state.inspectPending = null;
        resolve("");
      }, INSPECT_TIMEOUT_MS);
      state.inspectPending = (text) => {
        clearTimeout(timer);
        resolve(text);
      };
    });
  }
}

function findFirstMatchingKeyword(inspectText: string, keywords: string[]): string | null {
  const items = parseInspectItems(inspectText);
  for (const keyword of keywords) {
    const normalizedKeyword = keyword.toLowerCase();
    if (items.some((item) => item.name.toLowerCase().includes(normalizedKeyword))) {
      return keyword;
    }
  }
  return null;
}

export function parseInspectItems(inspectText: string): Array<{ name: string; count: number }> {
  const normalized = stripAnsi(inspectText).replace(/\r/g, "");
  const lines = normalized.split("\n");
  const headerIndex = lines.findIndex((line) => /Заполнен/i.test(line));
  if (headerIndex < 0) {
    if (/Пуст/i.test(normalized)) {
      return [];
    }
    return [];
  }

  const items: Array<{ name: string; count: number }> = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? "";
    if (line.length === 0) continue;
    if (PROMPT_LINE_REGEXP.test(line) || /Вых:/i.test(line)) {
      break;
    }
    const match = ITEM_LINE_REGEXP.exec(line);
    if (!match) continue;
    const name = match[1]?.trim();
    if (!name) continue;
    const countRaw = match[2];
    const count = countRaw ? Number.parseInt(countRaw, 10) : 1;
    items.push({ name, count: Number.isFinite(count) && count > 0 ? count : 1 });
  }

  return items;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE_REGEXP, "");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
