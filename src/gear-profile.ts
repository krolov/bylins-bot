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
  twoHandedWeaponClasses: string[];
  damageAvgWeight: number;
  weaponAffects: AffectWeight[];
}

export const TATY_PROFILE: GearProfile = {
  id: "тать",
  classKeywords: ["тать"],

  acWeight: 5,
  armorWeight: 2,

  armorAffects: [
    { affect: "невидимость",      affectScore: 100, propertyScorePerPoint: 0  },
    { affect: "освящение",        affectScore: 100, propertyScorePerPoint: 0  },
    { affect: "полет",            affectScore: 100, propertyScorePerPoint: 0  },
    { affect: "тьма",             affectScore: 100, propertyScorePerPoint: 0  },
    { affect: "доблесть",         affectScore:  20, propertyScorePerPoint: 0  },
    { affect: "дыхание.водой",    affectScore:  20, propertyScorePerPoint: 0  },
    { affect: "мигание",          affectScore:  20, propertyScorePerPoint: 0  },
    { affect: "настороженность",  affectScore:  20, propertyScorePerPoint: 0  },
    { affect: "опр.жизни",        affectScore:  20, propertyScorePerPoint: 0  },
    { affect: "опр.невидимости",  affectScore:  20, propertyScorePerPoint: 0  },
    { affect: "ускорение",        affectScore:  20, propertyScorePerPoint: 0  },
    { affect: "ловкость",         affectScore:   0, propertyScorePerPoint: 20 },
    { affect: "телосложение",     affectScore:   0, propertyScorePerPoint: 10 },
    { affect: "защита",           affectScore:   0, propertyScorePerPoint: 5  },
    { affect: "броня",            affectScore:   0, propertyScorePerPoint: 3  },
    { affect: "попадание",        affectScore:   0, propertyScorePerPoint: 2  },
    { affect: "повреждение",      affectScore:   0, propertyScorePerPoint: 2  },
    { affect: "реакция",          affectScore:   0, propertyScorePerPoint: 2  },
    { affect: "здоровье",         affectScore:   0, propertyScorePerPoint: 2  },
    { affect: "макс.жизнь",       affectScore:   0, propertyScorePerPoint: 2  },
    { affect: "инициатива",       affectScore:   0, propertyScorePerPoint: 1  },
  ],

  rejectMetal: true,
  metalPenalty: 0,
  rejectShiny: true,

  rightWeaponClass: "проникающее оружие",
  leftWeaponClass: "иное оружие",
  twoHandedWeaponClasses: [],
  damageAvgWeight: 10,

  weaponAffects: [
    { affect: "ловкость",    affectScore: 0, propertyScorePerPoint: 20 },
    { affect: "повреждение", affectScore: 0, propertyScorePerPoint: 5  },
  ],
};

export const MERCHANT_PROFILE: GearProfile = {
  id: "купец",
  classKeywords: ["купец", "торговец"],

  acWeight: 5,
  armorWeight: 2,

  armorAffects: [
    { affect: "ловкость", affectScore: 30, propertyScorePerPoint: 20 },
    { affect: "память",   affectScore: 5,  propertyScorePerPoint: 3  },
    { affect: "здоровье", affectScore: 5,  propertyScorePerPoint: 0.1 },
  ],

  rejectMetal: false,
  metalPenalty: 0,
  rejectShiny: false,

  rightWeaponClass: "иное оружие",
  leftWeaponClass: "иное оружие",
  twoHandedWeaponClasses: ["палицы и дубины", "иное оружие"],
  damageAvgWeight: 8,

  weaponAffects: [
    { affect: "попадание",   affectScore: 5, propertyScorePerPoint: 15 },
    { affect: "повреждение", affectScore: 0, propertyScorePerPoint: 10 },
  ],
};

const ALL_PROFILES: GearProfile[] = [TATY_PROFILE, MERCHANT_PROFILE];

export function selectProfile(levelText: string): GearProfile {
  const lower = levelText.toLowerCase();
  for (const profile of ALL_PROFILES) {
    if (profile.classKeywords.some((kw) => lower.includes(kw))) {
      return profile;
    }
  }
  return TATY_PROFILE;
}
