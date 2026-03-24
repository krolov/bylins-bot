export interface AffectWeight {
  affect: string;
  affectScore: number;
  propertyScorePerPoint: number;
}

export interface GearProfile {
  id: string;
  classKeywords: string[];
  acWeight: number;
  armorWeight: number;
  armorAffects: AffectWeight[];
  rejectMetal: boolean;
  metalPenalty: number;
  rejectShiny: boolean;
  rightWeaponClass: string;
  leftWeaponClass: string;
  damageAvgWeight: number;
  weaponAffects: AffectWeight[];
}

export const TATY_PROFILE: GearProfile = {
  id: "тать",
  classKeywords: ["тать"],

  acWeight: 5,
  armorWeight: 2,

  armorAffects: [
    { affect: "ловкость", affectScore: 30, propertyScorePerPoint: 20 },
  ],

  rejectMetal: true,
  metalPenalty: 0,
  rejectShiny: true,

  rightWeaponClass: "проникающее оружие",
  leftWeaponClass: "иное оружие",
  damageAvgWeight: 10,

  weaponAffects: [
    { affect: "ловкость",    affectScore: 0, propertyScorePerPoint: 20 },
    { affect: "повреждение", affectScore: 0, propertyScorePerPoint: 15 },
  ],
};

const ALL_PROFILES: GearProfile[] = [TATY_PROFILE];

export function selectProfile(levelText: string): GearProfile {
  const lower = levelText.toLowerCase();
  for (const profile of ALL_PROFILES) {
    if (profile.classKeywords.some((kw) => lower.includes(kw))) {
      return profile;
    }
  }
  return TATY_PROFILE;
}
