import type { CharacterConfig } from "../config.ts";

export const thiefConfig: CharacterConfig = {
  id: "тать",
  classKeywords: ["тать"],

  remorts: 4,

  acWeight: 5,
  armorWeight: 2,

  armorMaterials: [
    { material: "ЖЕЛЕЗО",  score: -1000 },
    { material: "БРОНЗА",  score: -1000 },
    { material: "СТАЛЬ",   score: -1000 },
    { material: "БУЛАТ",   score: -1000 },
    { material: "СЕРЕБРО", score: -1000 },
    { material: "ЗОЛОТО",  score: -1000 },
    { material: "МЕДЬ",    score: -1000 },
    { material: "ОЛОВО",   score: -1000 },
  ],

  damageAvgWeight: 20,

  rightWeaponClasses: ["проникающее оружие"],
  leftWeaponClasses: ["иное оружие"],
  twoHandedWeaponClasses: [],

  weaponMaterials: [],

  affects: [
    { affect: "невидимость",     score: 100 },
    { affect: "освящение",       score:  30 },
    { affect: "полет",           score: 100 },
     { affect: "тьма",            score:  30 },
    { affect: "доблесть",        score:  20 },
    { affect: "дыхание.водой",   score:  20 },
    { affect: "мигание",         score:  20 },
    { affect: "настороженность", score:  20 },
    { affect: "опр.жизни",       score:  20 },
    { affect: "опр.невидимости", score:  20 },
    { affect: "ускорение",       score:  20 },
    { affect: "светится",        score: -500 },
    { affect: "горит",           score: -500 },
    { affect: "мерцает",         score: -500 },
  ],

  properties: [
    { affect: "ловкость",    scorePerPoint: 50 },
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
