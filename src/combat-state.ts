const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const COMBAT_PROMPT_REGEXP = /\[[^:\]]+:[^\]]+\]\s+\[[^:\]]+:[^\]]+\]\s*>/;
const COMBAT_ACTIVITY_REGEXP =
  /Вы\s+(?:легонько|слегка)\s+огрели|Вы попытались огреть|попытал(?:ся|ась|ось)\s+(?:укусить|ужалить)\s+вас|без сознания и медленно умирает/i;
const ROOM_PROMPT_REGEXP = /Вых:[^>]*>/i;
const TARGET_NOT_VISIBLE_REGEXP = /Вы не видите цели\.?|Кого вы так сильно ненавидите/i;

export interface CombatState {
  handleMudText(text: string): void;
  getInCombat(): boolean;
  reset(): void;
}

export function createCombatState(): CombatState {
  let inCombat = false;

  function handleMudText(text: string): void {
    const normalized = text.replace(ANSI_SEQUENCE_REGEXP, "").replace(/\r/g, "");

    if (COMBAT_PROMPT_REGEXP.test(normalized) || COMBAT_ACTIVITY_REGEXP.test(normalized)) {
      inCombat = true;
    }

    if (ROOM_PROMPT_REGEXP.test(normalized) || TARGET_NOT_VISIBLE_REGEXP.test(normalized)) {
      inCombat = false;
    }
  }

  function getInCombat(): boolean {
    return inCombat;
  }

  function reset(): void {
    inCombat = false;
  }

  return { handleMudText, getInCombat, reset };
}
