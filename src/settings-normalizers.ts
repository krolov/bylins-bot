import type { FarmZoneSettings, SurvivalSettings, AutoSpellsSettings } from "./map/store.ts";
import type { SpellControllerConfig } from "./spell-script.ts";
import type { SneakControllerConfig } from "./sneak-script.ts";

export function normalizeFarmZoneSettings(raw: Partial<FarmZoneSettings>): FarmZoneSettings {
  return {
    targets: typeof raw.targets === "string" ? raw.targets : "",
    healCommands: typeof raw.healCommands === "string" ? raw.healCommands : "",
    healThreshold: typeof raw.healThreshold === "number" && Number.isFinite(raw.healThreshold) ? raw.healThreshold : 50,
    fleeCommand: typeof raw.fleeCommand === "string" ? raw.fleeCommand : "",
    fleeThreshold: typeof raw.fleeThreshold === "number" && Number.isFinite(raw.fleeThreshold) ? raw.fleeThreshold : 0,
    loot: typeof raw.loot === "string" ? raw.loot : "",
    periodicActionEnabled: raw.periodicActionEnabled === true,
    periodicActionGotoAlias1: typeof raw.periodicActionGotoAlias1 === "string" ? raw.periodicActionGotoAlias1 : "",
    periodicActionCommand: typeof raw.periodicActionCommand === "string" ? raw.periodicActionCommand : "",
    periodicActionCommandDelayMs: typeof raw.periodicActionCommandDelayMs === "number" && Number.isFinite(raw.periodicActionCommandDelayMs) ? raw.periodicActionCommandDelayMs : 0,
    periodicActionGotoAlias2: typeof raw.periodicActionGotoAlias2 === "string" ? raw.periodicActionGotoAlias2 : "",
    periodicActionIntervalMin: typeof raw.periodicActionIntervalMin === "number" && Number.isFinite(raw.periodicActionIntervalMin) ? raw.periodicActionIntervalMin : 30,
    survivalEnabled: raw.survivalEnabled === true,
    useStab: raw.useStab !== false,
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

export function normalizeAutoSpellsSettings(raw: Partial<AutoSpellsSettings>): SpellControllerConfig {
  const spells = Array.isArray(raw.spells)
    ? raw.spells
        .filter((s): s is { name: string; command: string; enabled: boolean } =>
          typeof s === "object" && s !== null &&
          typeof s.name === "string" && s.name.trim().length > 0 &&
          typeof s.command === "string" && s.command.trim().length > 0,
        )
        .map((s) => ({
          name: s.name.trim(),
          command: s.command.trim(),
          enabled: s.enabled === true,
        }))
    : [];
  const hasEnabledSpell = spells.some((s) => s.enabled);
  return {
    enabled: hasEnabledSpell,
    spells,
    checkIntervalMs: typeof raw.checkIntervalMs === "number" && Number.isFinite(raw.checkIntervalMs) && raw.checkIntervalMs >= 10_000
      ? raw.checkIntervalMs
      : 60_000,
  };
}

export function normalizeSneakSettings(raw: Partial<AutoSpellsSettings>): SneakControllerConfig {
  const spells = Array.isArray(raw.spells)
    ? raw.spells
        .filter((s): s is { name: string; command: string; enabled: boolean } =>
          typeof s === "object" && s !== null &&
          typeof s.name === "string" && s.name.trim().length > 0 &&
          typeof s.command === "string" && s.command.trim().length > 0,
        )
        .map((s) => ({
          name: s.name.trim(),
          command: s.command.trim(),
          enabled: s.enabled === true,
        }))
    : [];
  const hasEnabledSpell = spells.some((s) => s.enabled);
  return {
    enabled: hasEnabledSpell,
    spells,
    checkIntervalMs: typeof raw.checkIntervalMs === "number" && Number.isFinite(raw.checkIntervalMs) && raw.checkIntervalMs >= 5_000
      ? raw.checkIntervalMs
      : 20_000,
  };
}
