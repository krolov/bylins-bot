import type { FarmZoneSettings, SurvivalSettings, ZoneScriptSettings } from "./map/store.ts";

export function normalizeFarmZoneSettings(raw: Partial<FarmZoneSettings>): FarmZoneSettings {
  return {
    attackCommand: typeof raw.attackCommand === "string" && raw.attackCommand.trim().length > 0 ? raw.attackCommand.trim() : "закол",
    skinningSalvoEnabled: raw.skinningSalvoEnabled === true,
    skinningSkinVerb: typeof raw.skinningSkinVerb === "string" && raw.skinningSkinVerb.trim().length > 0 ? raw.skinningSkinVerb.trim() : "освеж",
    lootMeatCommand: typeof raw.lootMeatCommand === "string" ? raw.lootMeatCommand.trim() : "бро все.мяс",
    lootHideCommand: typeof raw.lootHideCommand === "string" ? raw.lootHideCommand.trim() : "пол все.шкур хлам",
  };
}

export function normalizeSurvivalSettings(raw: Partial<SurvivalSettings>): SurvivalSettings {
  return {
    container: typeof raw.container === "string" ? raw.container : "",
    foodItem: typeof raw.foodItem === "string" ? raw.foodItem : "",
    eatCommand: typeof raw.eatCommand === "string" ? raw.eatCommand : "",
  };
}

export function normalizeZoneScriptSettings(raw: Partial<ZoneScriptSettings>): ZoneScriptSettings {
  const assistTarget = typeof raw.assistTarget === "string" ? raw.assistTarget.trim() : "";
  return {
    assistTarget: assistTarget.length > 0 ? assistTarget : undefined,
  };
}
