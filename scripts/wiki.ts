#!/usr/bin/env bun
import {
  searchItems,
  getItem,
  filterByAffect,
  filterBySlot,
  analyzeGear,
  WEAR_SLOTS,
} from "../src/wiki.ts";
import type { WearSlot } from "../src/wiki.ts";

const COMMANDS: Record<string, string> = {
  search: "search <query>              — найти предметы по названию",
  item: "item <id>                   — карточка предмета по ID",
  affect: "affect <аффект> [аффект2]   — предметы с аффектом",
  slot: `slot <слот>                 — предметы для слота (${WEAR_SLOTS.join(", ")})`,
  analyze: "analyze <item1,item2,...>   — анализ снаряжения для татя",
};

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === "help") {
    console.log("Использование: bun scripts/wiki.ts <команда> [аргументы]\n");
    console.log("Команды:");
    for (const desc of Object.values(COMMANDS)) console.log("  " + desc);
    return;
  }

  switch (cmd) {
    case "search": {
      const query = args.join(" ");
      if (!query) { console.error("Укажи строку поиска"); process.exit(1); }
      const results = await searchItems(query);
      if (!results.length) { console.log("Ничего не найдено."); return; }
      for (const r of results) console.log(`${r.id}\t${r.name}`);
      break;
    }
    case "item": {
      const id = parseInt(args[0], 10);
      if (!id) { console.error("Укажи числовой ID"); process.exit(1); }
      const card = await getItem(id);
      if (!card) { console.log("Предмет не найден."); return; }
      console.log(`=== ${card.name} (ID: ${card.id}) ===`);
      console.log(`Тип: ${card.itemType}`);
      console.log();
      console.log(card.text);
      console.log();
      console.log(`Место лоада: ${card.loadLocation}`);
      break;
    }
    case "affect": {
      const [aff1, aff2] = args;
      if (!aff1) { console.error("Укажи аффект"); process.exit(1); }
      const results = await filterByAffect(aff1, aff2);
      if (!results.length) { console.log("Ничего не найдено."); return; }
      for (const r of results) console.log(`${r.id}\t${r.name}`);
      break;
    }
    case "slot": {
      const slot = args[0] as WearSlot;
      if (!slot || !WEAR_SLOTS.includes(slot)) {
        console.error(`Укажи слот: ${WEAR_SLOTS.join(", ")}`);
        process.exit(1);
      }
      const results = await filterBySlot(slot);
      if (!results.length) { console.log("Ничего не найдено."); return; }
      for (const r of results) console.log(`${r.id}\t${r.name}`);
      break;
    }
    case "analyze": {
      const names = args.join(" ").split(",").map((s) => s.trim()).filter(Boolean);
      if (!names.length) { console.error("Укажи список предметов через запятую"); process.exit(1); }
      const result = await analyzeGear(names);
      if (result.notFound.length) console.log(`Не найдено в wiki: ${result.notFound.join(", ")}\n`);
      console.log("РЕКОМЕНДАЦИИ:");
      for (const { slot, item, desc } of result.recommendations) {
        console.log(`  [${slot.toUpperCase()}] ${item.name} — ${desc}`);
      }
      if (result.skipped.length) {
        console.log("\nНЕ РЕКОМЕНДУЕТСЯ:");
        for (const { name, reason } of result.skipped) console.log(`  - ${name}: ${reason}`);
      }
      if (result.buyCommands) console.log(`\nКупить:  ${result.buyCommands}`);
      if (result.wearCommands) console.log(`Надеть:  ${result.wearCommands}`);
      break;
    }
    default:
      console.error(`Неизвестная команда: ${cmd}`);
      process.exit(1);
  }
}

await main();
