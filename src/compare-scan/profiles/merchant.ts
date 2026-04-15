import type { CharacterConfig } from "../config.ts";

export const merchantConfig: CharacterConfig = {
  id: "купец",
  classKeywords: ["купец"],

  remorts: 0,
  forbiddenClasses: ["купец"],

  acWeight: 5,
  armorWeight: 2,

  armorMaterials: [],

  damageAvgWeight: 8,

  rightWeaponClasses: ["проникающее оружие", "иное оружие"],
  leftWeaponClasses: ["проникающее оружие", "иное оружие"],
  twoHandedWeaponClasses: ["палицы и дубины", "иное оружие"],

  weaponMaterials: [],

  affects: [
    { affect: "невидимость",     score: 100 },
    { affect: "полет",           score: 100 },
    { affect: "доблесть",        score:  20 },
    { affect: "дыхание.водой",   score:  20 },
    { affect: "мигание",         score:  20 },
    { affect: "настороженность", score:  20 },
    { affect: "опр.жизни",       score:  20 },
    { affect: "опр.невидимости", score:  20 },
    { affect: "ускорение",       score:  20 },
    { affect: "освящение",       score: -500 },
  ],

  properties: [
    { affect: "обаяние",     scorePerPoint: 50 },
    { affect: "телосложение", scorePerPoint: 25 },
    { affect: "защита",      scorePerPoint:  5 },
    { affect: "броня",       scorePerPoint:  3 },
    { affect: "попадание",   scorePerPoint:  2 },
    { affect: "повреждение", scorePerPoint:  2 },
    { affect: "реакция",     scorePerPoint:  2 },
    { affect: "здоровье",    scorePerPoint:  2 },
    { affect: "макс.жизнь",  scorePerPoint:  2 },
    { affect: "инициатива",  scorePerPoint:  1 },
  ],
};
