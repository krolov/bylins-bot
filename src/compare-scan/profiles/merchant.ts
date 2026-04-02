import type { CharacterConfig } from "../config.ts";

export const merchantConfig: CharacterConfig = {
  id: "купец",
  classKeywords: ["купец", "торговец"],

  remorts: 0,

  acWeight: 5,
  armorWeight: 2,

  armorMaterials: [],

  damageAvgWeight: 8,

  rightWeaponClasses: ["иное оружие"],
  leftWeaponClasses: ["иное оружие"],
  twoHandedWeaponClasses: ["палицы и дубины", "иное оружие"],

  weaponMaterials: [],

  affects: [
    { affect: "ловкость", score: 30 },
    { affect: "память",   score:  5 },
    { affect: "здоровье", score:  5 },
  ],

  properties: [
    { affect: "ловкость",   scorePerPoint: 20  },
    { affect: "память",     scorePerPoint:  3  },
    { affect: "здоровье",   scorePerPoint:  0.1 },
    { affect: "попадание",  scorePerPoint: 15  },
    { affect: "повреждение", scorePerPoint: 10  },
  ],
};
