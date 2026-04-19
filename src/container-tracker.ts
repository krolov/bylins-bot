import { parseInspectItems, parseInventoryItems } from "./survival-script.ts";

const ANSI_STRIP_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const PROMPT_REGEXP = /\d+H\s+\d+M\b/i;
const CONTAINER_TRIGGER_BUFFER_MAX = 8192;

const EQUIPPED_SLOT_REGEXP = /^<([^>]+)>\s+(.+?)\s+<[а-яё ]+>$/i;
const EQUIPPED_WEAR_CMD: Record<string, string> = {
  "правый указательный палец": "над",
  "левый указательный палец": "над",
  "на шее": "над",
  "на груди": "над",
  "на теле": "над",
  "на голове": "над",
  "на ногах": "над",
  "на ступнях": "над",
  "на кистях": "над",
  "на руках": "над",
  "на плечах": "над",
  "на поясе": "над",
  "на правом запястье": "над",
  "на левом запястье": "над",
  "в правой руке": "воор",
  "в левой руке": "держ",
};

export function parseEquippedItems(text: string): Array<{ slot: string; name: string; keyword: string; wearCmd: string; correctlyMarked: boolean }> {
  const stripped = text.replace(ANSI_STRIP_REGEXP, "").replace(/\r/g, "");
  const lines = stripped.split("\n");
  const startIndex = lines.findIndex((l) => /На вас надето/i.test(l));
  if (startIndex < 0) return [];
  const result: Array<{ slot: string; name: string; keyword: string; wearCmd: string; correctlyMarked: boolean }> = [];
  const keywordCount: Record<string, number> = {};
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? "";
    if (!line || PROMPT_REGEXP.test(line) || /Вых:/i.test(line)) break;
    const match = EQUIPPED_SLOT_REGEXP.exec(line);
    if (!match) continue;
    const slot = match[1]?.trim() ?? "";
    const fullName = match[2]?.trim() ?? "";
    const escapedSlot = slot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const correctlyMarked = new RegExp(`\\*Ринли\\s*\\*${escapedSlot}\\*`, "i").test(fullName);
    const cleanName = fullName.replace(/\*+[^*]*\*+/g, "").trim();
    const baseKeyword = cleanName.split(/\s+/)[0] ?? cleanName;
    keywordCount[baseKeyword] = (keywordCount[baseKeyword] ?? 0) + 1;
    const n = keywordCount[baseKeyword];
    const keyword = n > 1 ? `${n}.${baseKeyword}` : baseKeyword;
    const wearCmd = EQUIPPED_WEAR_CMD[slot] ?? "над";
    result.push({ slot, name: cleanName, keyword, wearCmd, correctlyMarked });
  }
  return result;
}

export type ContainerKey = "склад" | "расход" | "базар" | "хлам";

export interface ContainerTrackerDeps {
  onContainerContents(container: ContainerKey, items: Array<{ name: string; count: number }>): void;
  onInventoryContents(items: Array<{ name: string; count: number }>): void;
  onEquippedContents(items: Array<{ slot: string; name: string; keyword: string; wearCmd: string; correctlyMarked: boolean }>): void;
}

const CONTAINER_LABEL_MAP: Record<string, ContainerKey> = {
  склад: "склад",
  расход: "расход",
  базар: "базар",
  хлам: "хлам",
};

export function createContainerTracker(deps: ContainerTrackerDeps) {
  let triggerBuffer = "";

  function flushTriggerBuffer(): void {
    const buf = triggerBuffer;
    triggerBuffer = "";
    const stripped = buf.replace(ANSI_STRIP_REGEXP, "").replace(/\r/g, "");

    if (/Заполнен|Пуст|Внутри ничего нет/i.test(stripped)) {
      const labelMatch = /(?:Ваши метки|Метки дружины):\s*(?:\S+\s+)?([а-яёА-ЯЁ]+)\s*$/im.exec(stripped);
      const label = labelMatch?.[1]?.toLowerCase() ?? "";
      const containerKey = CONTAINER_LABEL_MAP[label];
      if (containerKey !== undefined) {
        deps.onContainerContents(containerKey, parseInspectItems(stripped));
      }
    }

    if (/Вы несете/i.test(stripped)) {
      deps.onInventoryContents(parseInventoryItems(stripped));
    }
  }

  function feedTriggerBuffer(text: string): void {
    triggerBuffer += text;
    if (triggerBuffer.length > CONTAINER_TRIGGER_BUFFER_MAX) {
      triggerBuffer = triggerBuffer.slice(-CONTAINER_TRIGGER_BUFFER_MAX);
    }
    const stripped = text.replace(ANSI_STRIP_REGEXP, "").replace(/\r/g, "");
    if (PROMPT_REGEXP.test(stripped)) {
      flushTriggerBuffer();
    }
  }

  let equippedBuffer = "";
  let equippedPending = false;

  function feedEquippedScan(text: string): void {
    if (!equippedPending) return;
    equippedBuffer += text;
    const stripped = text.replace(ANSI_STRIP_REGEXP, "").replace(/\r/g, "");
    if (PROMPT_REGEXP.test(stripped)) {
      equippedPending = false;
      const items = parseEquippedItems(equippedBuffer);
      equippedBuffer = "";
      deps.onEquippedContents(items);
    }
  }

  function startEquippedScan(): void {
    equippedBuffer = "";
    equippedPending = true;
  }

  let pendingResolve: ((text: string) => void) | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingBuffer = "";

  function clearPending(): void {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    pendingResolve = null;
    pendingBuffer = "";
  }

  function feedPendingInspect(text: string): void {
    if (pendingResolve === null) return;
    pendingBuffer += text;
    const stripped = pendingBuffer.replace(ANSI_STRIP_REGEXP, "").replace(/\r/g, "");
    if (!PROMPT_REGEXP.test(stripped)) return;
    const resolve = pendingResolve;
    clearPending();
    resolve(stripped);
  }

  function waitForInspectResult(timeoutMs = 3000): Promise<string> {
    clearPending();
    return new Promise((resolve) => {
      pendingResolve = resolve;
      pendingTimer = setTimeout(() => {
        const buf = pendingBuffer;
        clearPending();
        resolve(buf);
      }, timeoutMs);
    });
  }

  function reset(): void {
    triggerBuffer = "";
    equippedBuffer = "";
    equippedPending = false;
    clearPending();
  }

  return {
    feedText: feedTriggerBuffer,
    feedEquippedScan,
    startEquippedScan,
    feedPendingInspect,
    waitForInspectResult,
    reset,
  };
}
