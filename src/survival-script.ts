const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const CONSUME_COMMAND_DELAY_MS = 800;
const COOLDOWN_MS = 5_000;

const HUNGER_REGEXP = /Вы (?:голодны|очень голодны|готовы сожрать быка)/i;
const THIRST_REGEXP = /Вас (?:мучает|сильно мучает) жажда|Вам хочется выпить озеро/i;
const SATIATED_REGEXP = /Вы полностью насытились|Вы наелись/i;
const TOO_FULL_REGEXP = /Вы слишком сыты для этого/i;
const THIRST_QUENCHED_REGEXP = /Вы не чувствуете жажды/i;
const DRANK_REGEXP = /Вы выпили /i;

export interface SurvivalConfig {
  enabled: boolean;
  container: string;
  foodItem: string;
  eatCommand: string;
}

export interface SurvivalControllerDependencies {
  sendCommand(command: string): void;
  isInCombat(): boolean;
  onLog(message: string): void;
  onDebugLog(message: string): void;
}

interface SurvivalState {
  hungry: boolean;
  thirsty: boolean;
  nextActionAt: number;
  config: SurvivalConfig;
}

export function normalizeSurvivalConfig(config: SurvivalConfig): SurvivalConfig {
  return {
    enabled: config.enabled === true,
    container: (config.container ?? "").trim(),
    foodItem: (config.foodItem ?? "").trim(),
    eatCommand: (config.eatCommand ?? "").trim(),
  };
}

export function createSurvivalController(deps: SurvivalControllerDependencies) {
  const state: SurvivalState = {
    hungry: false,
    thirsty: false,
    nextActionAt: 0,
    config: { enabled: false, container: "", foodItem: "", eatCommand: "" },
  };

  function reset(): void {
    state.hungry = false;
    state.thirsty = false;
    state.nextActionAt = 0;
  }

  function updateConfig(config: SurvivalConfig): void {
    state.config = normalizeSurvivalConfig(config);
  }

  function handleMudText(text: string): void {
    const normalized = stripAnsi(text).replace(/\r/g, "");

    if (HUNGER_REGEXP.test(normalized)) state.hungry = true;
    if (THIRST_REGEXP.test(normalized)) state.thirsty = true;

    if (SATIATED_REGEXP.test(normalized) || TOO_FULL_REGEXP.test(normalized)) {
      state.hungry = false;
    }

    if (THIRST_QUENCHED_REGEXP.test(normalized) || DRANK_REGEXP.test(normalized)) {
      state.thirsty = false;
    }
  }

  function isInFlight(): boolean {
    return false;
  }

  async function runTick(onSchedule: (delayMs: number) => void): Promise<boolean> {
    if (!state.config.enabled) {
      deps.onDebugLog("[survival] runTick: disabled, skipping");
      return false;
    }
    if (deps.isInCombat()) {
      deps.onDebugLog("[survival] runTick: in combat, skipping");
      return false;
    }

    const waitMs = state.nextActionAt - Date.now();
    if (waitMs > 0) {
      deps.onDebugLog(`[survival] runTick: cooldown ${waitMs}ms`);
      onSchedule(waitMs);
      return true;
    }

    if (!state.hungry && !state.thirsty) return false;

    const { container, foodItem, eatCommand } = state.config;

    if (!container || !foodItem || !eatCommand) {
      deps.onLog("[survival] hunger/thirst detected but food not configured");
      state.hungry = false;
      state.thirsty = false;
      return false;
    }

    deps.onLog(`[survival] hunger/thirst: взять ${foodItem} ${container} → ${eatCommand} → положить ${foodItem} ${container}`);
    state.nextActionAt = Date.now() + COOLDOWN_MS;

    deps.sendCommand(`взять ${foodItem} ${container}`);
    await delay(CONSUME_COMMAND_DELAY_MS);
    deps.sendCommand(eatCommand);
    await delay(CONSUME_COMMAND_DELAY_MS);
    deps.sendCommand(`положить ${foodItem} ${container}`);

    onSchedule(COOLDOWN_MS);
    return true;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ITEM_LINE_REGEXP = /^\s*(.+?)\s*(?:\[(\d+)\])?\s*$/;
const PROMPT_LINE_REGEXP = /^\s*\d+H\s+\d+M\b/i;
const CONTAINER_KEYWORDS_REGEXP = /торб|сунд|\(пуст|\(есть содержимое/i;

export function parseInspectItems(inspectText: string): Array<{ name: string; count: number }> {
  const normalized = stripAnsi(inspectText).replace(/\r/g, "");
  const lines = normalized.split("\n");
  const headerIndex = lines.findIndex((line) => /Заполнен/i.test(line));
  if (headerIndex < 0) return [];

  const items: Array<{ name: string; count: number }> = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? "";
    if (line.length === 0) continue;
    if (PROMPT_LINE_REGEXP.test(line) || /Вых:/i.test(line)) break;
    const match = ITEM_LINE_REGEXP.exec(line);
    if (!match) continue;
    const name = match[1]?.replace(/<[^>]+>/g, "").trim();
    if (!name) continue;
    const countRaw = match[2];
    const count = countRaw ? Number.parseInt(countRaw, 10) : 1;
    items.push({ name, count: Number.isFinite(count) && count > 0 ? count : 1 });
  }
  return items;
}

export function parseInventoryItems(inventoryText: string): Array<{ name: string; count: number }> {
  const normalized = stripAnsi(inventoryText).replace(/\r/g, "");
  const lines = normalized.split("\n");
  const headerIndex = lines.findIndex((line) => /Вы несете/i.test(line));
  if (headerIndex < 0) return [];

  const items: Array<{ name: string; count: number }> = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? "";
    if (line.length === 0) continue;
    if (PROMPT_LINE_REGEXP.test(line) || /Вых:/i.test(line)) break;
    if (CONTAINER_KEYWORDS_REGEXP.test(line) && !/\*Ринли\s+\*/i.test(line)) continue;
    const match = ITEM_LINE_REGEXP.exec(line);
    if (!match) continue;
    const name = match[1]?.replace(/<[^>]+>/g, "").trim();
    if (!name) continue;
    const countRaw = match[2];
    const count = countRaw ? Number.parseInt(countRaw, 10) : 1;
    items.push({ name, count: Number.isFinite(count) && count > 0 ? count : 1 });
  }
  return items;
}
