export interface AffectEntry {
  affect: string;
  score: number;
}

export interface PropertyEntry {
  affect: string;
  scorePerPoint: number;
}

export interface MaterialEntry {
  material: string;
  score: number;
}

export interface CharacterConfig {
  id: string;
  classKeywords: string[];
  remorts: number;
  forbiddenClasses: string[];

  acWeight: number;
  armorWeight: number;
  armorMaterials: MaterialEntry[];

  damageAvgWeight: number;
  rightWeaponClasses: string[];
  leftWeaponClasses: string[];
  twoHandedWeaponClasses: string[];
  weaponMaterials: MaterialEntry[];

  affects: AffectEntry[];
  properties: PropertyEntry[];
}

export function selectConfig(
  levelText: string,
  configs: CharacterConfig[],
  defaultConfig: CharacterConfig,
): CharacterConfig {
  const lower = levelText.toLowerCase();
  for (const cfg of configs) {
    if (cfg.classKeywords.some((kw) => lower.includes(kw))) {
      return cfg;
    }
  }
  return defaultConfig;
}
