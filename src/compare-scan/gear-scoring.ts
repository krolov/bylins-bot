import type { GearItemCard } from "../wiki.ts";
import type { CharacterConfig } from "./config.ts";

function applyAffects(item: GearItemCard, cfg: CharacterConfig): number {
  let score = 0;
  for (const ae of cfg.affects) {
    if (item.affects.includes(ae.affect)) score += ae.score;
  }
  for (const pe of cfg.properties) {
    for (const p of item.properties) {
      const numM = /на\s+(\d+)/i.exec(p);
      const n = numM ? parseInt(numM[1]) : 1;
      if (p.startsWith(`${pe.affect} улучшает`)) score += pe.scorePerPoint * n;
      else if (p.startsWith(`${pe.affect} ухудшает`)) score -= pe.scorePerPoint * n;
    }
  }
  return score;
}

export function armorScore(item: GearItemCard, cfg: CharacterConfig): number {
  if (item.remorts > cfg.remorts) return -Infinity;
  let score = item.ac * cfg.acWeight + item.armor * cfg.armorWeight;

  for (const me of cfg.armorMaterials) {
    if (item.material.toUpperCase() === me.material.toUpperCase()) {
      score += me.score;
      break;
    }
  }

  score += applyAffects(item, cfg);
  return score;
}

export function weaponScore(item: GearItemCard, hand: "right" | "left" | "both", cfg: CharacterConfig): number {
  if (item.remorts > cfg.remorts) return -Infinity;
  if (!item.weaponClass) return -1000;

  if (hand === "both") {
    if (!cfg.twoHandedWeaponClasses.includes(item.weaponClass)) return -1000;
  } else {
    const wantClasses = hand === "right" ? cfg.rightWeaponClasses : cfg.leftWeaponClasses;
    if (!wantClasses.includes(item.weaponClass)) return -1000;
  }

  let score = item.damageAvg * cfg.damageAvgWeight;

  for (const me of cfg.weaponMaterials) {
    if (item.material.toUpperCase() === me.material.toUpperCase()) {
      score += me.score;
      break;
    }
  }

  score += applyAffects(item, cfg);
  return score;
}
