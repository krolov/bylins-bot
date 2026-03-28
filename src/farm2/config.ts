import type { Farm2Config } from "./types.ts";
import type { FarmZoneSettings } from "./types.ts";

export function defaultConfig(): Farm2Config {
  return {
    attackCommand: "заколоть",
    targetValues: [],
    healCommands: [],
    healThresholdPercent: 50,
    fleeCommand: "",
    fleeThresholdPercent: 0,
  };
}

export function settingsToConfig(s: FarmZoneSettings): Farm2Config {
  return {
    attackCommand: "заколоть",
    targetValues: s.targets
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter((v) => v.length > 0),
    healCommands: [],
    healThresholdPercent: 50,
    fleeCommand: "",
    fleeThresholdPercent: 0,
  };
}
