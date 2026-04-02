import type { Farm2Config } from "./types.ts";
import type { FarmZoneSettings } from "./types.ts";

export function defaultConfig(): Farm2Config {
  return {
    attackCommand: "заколоть",
    targetValues: [],
    skinningSalvoEnabled: false,
    skinningSkinVerb: "освеж",
    lootMeatCommand: "пол все.мяс торб",
    lootHideCommand: "пол все.шкур торб",
  };
}

export function settingsToConfig(s: FarmZoneSettings, targetValues: string[]): Farm2Config {
  return {
    attackCommand: s.attackCommand,
    targetValues,
    skinningSalvoEnabled: s.skinningSalvoEnabled,
    skinningSkinVerb: s.skinningSkinVerb,
    lootMeatCommand: s.lootMeatCommand,
    lootHideCommand: s.lootHideCommand,
  };
}
