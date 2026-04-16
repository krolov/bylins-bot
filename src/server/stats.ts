// ---------------------------------------------------------------------------
// Character stats tracker.
//
// Owns HP / energy / level / DSU / razb values parsed from the MUD prompt
// and broadcasts `stats_update` events + feeds the farm loop via updateStats.
//
// MUD phrases the module understands:
//   - Max-stats phrase:
//       "Вы можете выдержать 50(50) единиц повреждения, и пройти 86(86) верст"
//   - Prompt after ANSI strip:
//       "50H 86M 1421o Зауч:0 ОЗ:0 2L 5G Вых:СВЮЗ>"
//     Groups: (1) HP, (2) Energy, (3) DSU, (4) Level. Between ОЗ:N and L the
//     MUD may insert [mob:state] combat blocks or Зс:N, so the pattern uses
//     a lazy .*? to jump over them.
//   - Razb phrase (party size cap):
//       "вступить в группу с максимальной разницей в X уровней"
// ---------------------------------------------------------------------------

import { ANSI_ESCAPE_RE } from "./constants.ts";
import type { ServerEvent } from "../events.type.ts";

const MAX_STATS_REGEXP = /Вы можете выдержать \d+\((\d+)\) единиц[а-я]* повреждения.*?пройти \d+\((\d+)\) верст/i;
const PROMPT_STATS_REGEXP = /(\d+)H\s+(\d+)M\s+(\d+)o\s+Зауч:\d+\s+ОЗ:\d+.*?(\d+)L\s+\d+G/;
const PROMPT_LEVEL_REGEXP = /(\d+)L\s+\d+G/;
const RAZB_REGEXP = /максимальной разницей в (\d+) уровн/i;

export interface CharacterStats {
  hp: number;
  hpMax: number;
  energy: number;
  energyMax: number;
}

export interface StatsTrackerDeps {
  broadcastServerEvent(event: ServerEvent): void;
  onStatsChanged(stats: CharacterStats): void;
}

export interface StatsTracker {
  parseAndBroadcast(text: string): void;
  getHp(): number;
  getHpMax(): number;
  getEnergy(): number;
  getEnergyMax(): number;
  getLevel(): number;
  getDsu(): number;
  getRazb(): number;
}

export function createStatsTracker(deps: StatsTrackerDeps): StatsTracker {
  let hp = 0;
  let hpMax = 0;
  let energy = 0;
  let energyMax = 0;
  let level = 0;
  let dsu = 0;
  let razb = 5;

  function parseAndBroadcast(text: string): void {
    let changed = false;

    const maxMatch = MAX_STATS_REGEXP.exec(text);
    if (maxMatch) {
      const newHpMax = Number(maxMatch[1]);
      const newEnergyMax = Number(maxMatch[2]);
      if (newHpMax !== hpMax || newEnergyMax !== energyMax) {
        hpMax = newHpMax;
        energyMax = newEnergyMax;
        changed = true;
      }
    }

    const stripped = text.replace(ANSI_ESCAPE_RE, "");
    const promptMatch = PROMPT_STATS_REGEXP.exec(stripped);
    if (promptMatch) {
      const newHp = Number(promptMatch[1]);
      const newEnergy = Number(promptMatch[2]);
      const newDsu = Number(promptMatch[3]);
      const newLevel = Number(promptMatch[4]);
      if (newHp !== hp || newEnergy !== energy) {
        hp = newHp;
        energy = newEnergy;
        changed = true;
      }
      if (newDsu !== dsu) dsu = newDsu;
      if (newLevel !== 0 && newLevel !== level) level = newLevel;
    } else {
      const levelMatch = PROMPT_LEVEL_REGEXP.exec(stripped);
      if (levelMatch) {
        const newLevel = Number(levelMatch[1]);
        if (newLevel !== 0 && newLevel !== level) level = newLevel;
      }
    }

    const razbMatch = RAZB_REGEXP.exec(stripped);
    if (razbMatch) {
      razb = Number(razbMatch[1]);
    }

    if (changed) {
      const snapshot: CharacterStats = { hp, hpMax, energy, energyMax };
      deps.broadcastServerEvent({ type: "stats_update", payload: snapshot });
      deps.onStatsChanged(snapshot);
    }
  }

  return {
    parseAndBroadcast,
    getHp: () => hp,
    getHpMax: () => hpMax,
    getEnergy: () => energy,
    getEnergyMax: () => energyMax,
    getLevel: () => level,
    getDsu: () => dsu,
    getRazb: () => razb,
  };
}
