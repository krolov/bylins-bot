import type { FarmZoneSettings, SurvivalSettings } from "./map/store.ts";

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
    foodItems: typeof raw.foodItems === "string" ? raw.foodItems : "",
    flaskItems: typeof raw.flaskItems === "string" ? raw.flaskItems : "",
    buyFoodItem: typeof raw.buyFoodItem === "string" ? raw.buyFoodItem : "",
    buyFoodMax: typeof raw.buyFoodMax === "number" && Number.isFinite(raw.buyFoodMax) && raw.buyFoodMax > 0 ? Math.floor(raw.buyFoodMax) : 20,
    buyFoodAlias: typeof raw.buyFoodAlias === "string" ? raw.buyFoodAlias : "",
    fillFlaskAlias: typeof raw.fillFlaskAlias === "string" ? raw.fillFlaskAlias : "",
    fillFlaskSource: typeof raw.fillFlaskSource === "string" ? raw.fillFlaskSource : "",
  };
}
