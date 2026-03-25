import { ANSI_SEQUENCE_REGEXP, parseEquipLine, getEquipCommand, extractKeyword, sendSequence } from "./equip-utils.ts";

const COMMAND_DELAY_MS = 200;
const EQUIP_RESPONSE_TIMEOUT_MS = 4000;
const REPAIR_RESPONSE_TIMEOUT_MS = 3000;

const CONDITION_SKIP = new Set(["великолепно"]);

const REPAIR_SUCCESS_REGEXP = /починил|починила/i;
const REPAIR_FAIL_REGEXP = /не может починить|не умеет|не знает как|Чаво\?|не нужно чинить|не буду тратить/i;

export interface RepairState {
  running: boolean;
  message: string;
}

interface RepairControllerDependencies {
  sendCommand(command: string): void;
  resolveNearest(alias: string): Promise<number | null>;
  navigateTo(vnum: number): Promise<void>;
  getCurrentRoomId(): number | null;
  isInCombat(): boolean;
  isConnected(): boolean;
  registerTextHandler(handler: (text: string) => void): void;
  unregisterTextHandler(handler: (text: string) => void): void;
  onStateChange(state: RepairState): void;
  onLog(message: string): void;
}

interface WornItem {
  slot: string;
  keyword: string;
  condition: string;
  needsRepair: boolean;
}

export function createRepairController(deps: RepairControllerDependencies) {
  let running = false;

  function publishState(message: string): void {
    deps.onStateChange({ running, message });
  }

  function stripAnsi(text: string): string {
    return text.replace(ANSI_SEQUENCE_REGEXP, "");
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForText(pattern: RegExp, timeoutMs: number): Promise<string> {
    return new Promise((resolve) => {
      let done = false;
      let buffer = "";

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        deps.unregisterTextHandler(handler);
        resolve(buffer);
      }, timeoutMs);

      const handler = (text: string) => {
        if (done) return;
        buffer += stripAnsi(text);
        if (pattern.test(buffer)) {
          done = true;
          clearTimeout(timer);
          deps.unregisterTextHandler(handler);
          resolve(buffer);
        }
      };

      deps.registerTextHandler(handler);
    });
  }

  async function fetchEquipment(): Promise<WornItem[]> {
    const PROMPT_REGEXP = /Вых:[^>]*>/i;
    const waitPromise = waitForText(PROMPT_REGEXP, EQUIP_RESPONSE_TIMEOUT_MS);
    deps.sendCommand("экип");
    const text = await waitPromise;

    return parseEquipmentOutput(text);
  }

  function parseEquipmentOutput(text: string): WornItem[] {
    const items: WornItem[] = [];
    for (const line of text.split(/\r?\n/)) {
      const parsed = parseEquipLine(line);
      if (!parsed) continue;
      items.push({
        slot: parsed.slot,
        keyword: extractKeyword(parsed.name),
        condition: parsed.condition,
        needsRepair: !CONDITION_SKIP.has(parsed.condition.toLowerCase()),
      });
    }
    return items;
  }

  async function repairItem(item: WornItem): Promise<boolean> {
    const equipCmd = getEquipCommand(item.slot, item.keyword);
    deps.onLog(`[repair] чиним: ${item.keyword} (${item.condition})`);

    const resultPromise = waitForText(
      new RegExp(`${REPAIR_SUCCESS_REGEXP.source}|${REPAIR_FAIL_REGEXP.source}`, "i"),
      REPAIR_RESPONSE_TIMEOUT_MS,
    );
    await sendSequence(`снять ${item.keyword};чинить ${item.keyword};${equipCmd}`, deps.sendCommand, COMMAND_DELAY_MS);
    const repairResult = await resultPromise;

    if (REPAIR_FAIL_REGEXP.test(repairResult)) {
      deps.onLog(`[repair] кузнец не смог починить: ${item.keyword}`);
    } else {
      deps.onLog(`[repair] починено: ${item.keyword}`);
    }

    return true;
  }

  async function run(): Promise<void> {
    if (running) {
      deps.onLog("[repair] уже запущен");
      return;
    }

    if (!deps.isConnected()) {
      deps.onLog("[repair] не подключён к MUD");
      return;
    }

    if (deps.isInCombat()) {
      deps.onLog("[repair] в бою, нельзя запустить починку");
      return;
    }

    running = true;
    publishState("Проверяем снаряжение...");

    try {
      // 1. Получаем текущий экип
      deps.onLog("[repair] запрашиваем экип...");
      const items = await fetchEquipment();
      const toRepair = items.filter((i) => i.needsRepair);

      if (toRepair.length === 0) {
        deps.onLog("[repair] всё снаряжение в идеальном состоянии");
        publishState("Всё в порядке");
        return;
      }

      deps.onLog(`[repair] требуют починки: ${toRepair.map((i) => `${i.keyword} (${i.condition})`).join("; ")}`);
      publishState(`Нужно починить: ${toRepair.length} предметов`);

      // 2. Запоминаем текущую позицию
      const originVnum = deps.getCurrentRoomId();

      // 3. Ищем ближайшую кузницу
      const smithVnum = await deps.resolveNearest("кузнец");
      if (smithVnum === null) {
        deps.onLog('[repair] алиас "кузнец" не найден на карте');
        publishState('Алиас "кузнец" не найден');
        return;
      }

      // 4. Идём к кузнице
      deps.onLog(`[repair] идём к кузнице (vnum ${smithVnum})...`);
      publishState("Идём к кузнице...");
      await deps.navigateTo(smithVnum);
      await delay(COMMAND_DELAY_MS);

      // 5. Чиним каждый предмет
      publishState(`Чиним (0/${toRepair.length})...`);
      for (let i = 0; i < toRepair.length; i++) {
        const item = toRepair[i]!;
        publishState(`Чиним (${i + 1}/${toRepair.length}): ${item.keyword}`);
        await repairItem(item);
        await delay(COMMAND_DELAY_MS);
      }

      deps.onLog("[repair] починка завершена");
      publishState("Починка завершена");

      // 6. Возвращаемся назад
      if (originVnum !== null && originVnum !== deps.getCurrentRoomId()) {
        deps.onLog(`[repair] возвращаемся на место (vnum ${originVnum})...`);
        publishState("Возвращаемся...");
        await deps.navigateTo(originVnum);
      }

      publishState("Готово");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Неизвестная ошибка";
      deps.onLog(`[repair] ошибка: ${msg}`);
      publishState(`Ошибка: ${msg}`);
    } finally {
      running = false;
      publishState("Готово");
    }
  }

  return {
    run,
    isRunning: () => running,
  };
}
