import { sql } from "../src/db";

await sql`
  CREATE TABLE IF NOT EXISTS game_items (
    name TEXT PRIMARY KEY,
    item_type TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const items = [
  {
    name: "ежовая иголка",
    item_type: "ОРУЖИЕ",
    data: {
      class: "проникающее оружие",
      weight: 5, price: 50, rent: 50, rent_day: 5,
      material: "КОСТЬ", durability_max: 50, durability_cur: 49,
      extra_flags: "!обезоружить",
      damage_dice: "2D4", damage_avg: 5.0,
      wield_requirements: [
        { hand: "правую руку", str: 5 },
        { hand: "левую руку", str: 9 },
        { hand: "обе руки", str: 3 },
      ],
      affects: "ничего",
    },
  },
  {
    name: "ржавая игла",
    item_type: "ОРУЖИЕ",
    data: {
      class: "проникающее оружие",
      weight: 7, price: 50, rent: 50, rent_day: 25,
      material: "ЖЕЛЕЗО", durability_max: 75, durability_cur: 75,
      extra_flags: "ничего",
      damage_dice: "3D4", damage_avg: 7.5,
      wield_requirements: [
        { hand: "правую руку", str: 7 },
        { hand: "левую руку", str: 13 },
      ],
      affects: "ничего",
    },
  },
  {
    name: "бронзовый кинжал",
    item_type: "ОРУЖИЕ",
    data: {
      class: "проникающее оружие",
      weight: 5, price: 0, rent: 0, rent_day: 0,
      material: "БРОНЗА", durability_max: 100, durability_cur: 98,
      extra_flags: "рассыпется,можно метнуть",
      damage_dice: "1D5", damage_avg: 3.0,
      wield_requirements: [
        { hand: "правую руку", str: 5 },
        { hand: "левую руку", str: 9 },
      ],
      affects: "ничего",
    },
  },
  {
    name: "изящный бандитский кинжал",
    item_type: "ОРУЖИЕ",
    data: {
      class: "проникающее оружие",
      weight: 8, price: 800, rent: 500, rent_day: 210,
      material: "СТАЛЬ", durability_max: 125, durability_cur: 110,
      extra_flags: "ничего",
      unavailable: "!дружинники",
      damage_dice: "4D4", damage_avg: 10.0,
      wield_requirements: [
        { hand: "правую руку", str: 8 },
      ],
      affects: "ускорение",
    },
  },
];

for (const item of items) {
  await sql`
    INSERT INTO game_items (name, item_type, data, first_seen, last_seen)
    VALUES (${item.name}, ${item.item_type}, ${JSON.stringify(item.data)}::jsonb, NOW(), NOW())
    ON CONFLICT (name)
    DO UPDATE SET
      item_type = EXCLUDED.item_type,
      data = EXCLUDED.data,
      last_seen = NOW()
  `;
  console.log("upserted:", item.name);
}

await sql.end();
console.log("done");
