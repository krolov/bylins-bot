#!/usr/bin/env bun

import { parseEquipLine, getEquipCommand } from "../src/equip-utils.ts";

const BASE_URL = "https://wiki.bylins.su/stuff.php";

// ─── типы ────────────────────────────────────────────────────────────────────

interface SearchResult {
  id: number;
  name: string;
}

type WearSlot =
  | "туловище"
  | "голову"
  | "ноги"
  | "ступни"
  | "кисти"
  | "руки"
  | "плечи"
  | "пояс"
  | "запястья"
  | "шею"
  | "палец"
  | "правая рука"
  | "левая рука"
  | "обе руки";

type WeaponClass =
  | "проникающее оружие"
  | "иное оружие"
  | "короткие лезвия"
  | "длинные лезвия"
  | "двуручники"
  | "секиры"
  | "палицы и дубины"
  | "копья и рогатины"
  | "луки"
  | "другое";

type Material =
  | "ЖЕЛЕЗО"
  | "БРОНЗА"
  | "СТАЛЬ"
  | "БУЛАТ"
  | "СЕРЕБРО"
  | "ЗОЛОТО"
  | "КОЖА"
  | "ТКАНЬ"
  | "ДЕРЕВО"
  | "КОСТЬ"
  | "БЕРЕСТА"
  | "ОРГАНИКА"
  | "КЕРАМИКА"
  | string;

interface ItemCard {
  id: number;
  name: string;
  itemType: "БРОНЯ" | "ОРУЖИЕ" | "ОДЕЖДА" | string;
  // броня
  ac: number;
  armor: number;
  wearSlots: WearSlot[];
  // оружие
  weaponClass: WeaponClass | null;
  damageAvg: number;
  canWearRight: boolean;
  canWearLeft: boolean;
  requireStrRight: number;
  requireStrLeft: number;
  // общее
  material: Material;
  isMetal: boolean;
  isShiny: boolean; // мешает спрятаться
  affects: string[];
  properties: string[];
  forbidden: string[]; // неудобен для классов
  rawText: string;
}

// ─── константы ───────────────────────────────────────────────────────────────

const METAL_MATERIALS = new Set(["ЖЕЛЕЗО", "БРОНЗА", "СТАЛЬ", "БУЛАТ", "СЕРЕБРО", "ЗОЛОТО", "МЕДЬ", "ОЛОВО"]);

const TATY_BAD_AFFECTS = new Set(["попадание", "воля"]);

// ─── парсер wiki ──────────────────────────────────────────────────────────────

function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const linkRe = /href="[^"]*[?&]id=(\d+)[^"]*"[^>]*>([^<]+)</g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const id = parseInt(m[1], 10);
    const name = m[2].trim();
    if (id && name) results.push({ id, name });
  }
  const seen = new Set<number>();
  return results.filter((r) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}

function parseWearSlots(text: string): WearSlot[] {
  const slots: WearSlot[] = [];
  if (/надеть на туловище/i.test(text)) slots.push("туловище");
  if (/надеть на голову/i.test(text)) slots.push("голову");
  if (/надеть на ноги/i.test(text)) slots.push("ноги");
  if (/обуть/i.test(text)) slots.push("ступни");
  if (/надеть на кисти/i.test(text)) slots.push("кисти");
  if (/надеть на руки/i.test(text)) slots.push("руки");
  if (/надеть на плечи/i.test(text)) slots.push("плечи");
  if (/надеть на пояс/i.test(text)) slots.push("пояс");
  if (/надеть на запястья/i.test(text)) slots.push("запястья");
  if (/надеть на шею/i.test(text)) slots.push("шею");
  if (/надеть на палец/i.test(text)) slots.push("палец");
  return slots;
}

function parseWeaponClass(text: string): WeaponClass | null {
  const m = /Принадлежит к классу\s+"([^"]+)"/i.exec(text);
  if (!m) return null;
  return m[1].toLowerCase() as WeaponClass;
}

function parseDamageAvg(text: string): number {
  // '2D4' среднее 5.0
  const m = /среднее\s+([\d.]+)/i.exec(text);
  if (m) return parseFloat(m[1]);
  // fallback: XDY
  const m2 = /'(\d+)D(\d+)'/i.exec(text);
  if (m2) {
    const count = parseInt(m2[1]);
    const sides = parseInt(m2[2]);
    return count * (sides + 1) / 2;
  }
  return 0;
}

function parseAC(text: string): number {
  const m = /защита\s*\(AC\)\s*:\s*(-?\d+)/i.exec(text);
  return m ? parseInt(m[1]) : 0;
}

function parseArmor(text: string): number {
  const m = /броня\s*:\s*(\d+)/i.exec(text);
  return m ? parseInt(m[1]) : 0;
}

function parseMaterial(text: string): Material {
  const m = /Материал\s*:\s*([A-ZА-ЯЁ.]+)/i.exec(text);
  return m ? m[1].toUpperCase() : "НЕИЗВЕСТНО";
}

function parseAffects(text: string): string[] {
  const affects: string[] = [];
  // "Накладывает на вас аффекты: доблесть, ускорение"
  const affM = /Накладывает на [вВ]ас аффекты:\s*([^\n]+)/i.exec(text);
  if (affM && !/ничего/i.test(affM[1])) {
    affects.push(...affM[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean));
  }
  return affects;
}

function parseProperties(text: string): string[] {
  const props: string[] = [];
  // "ловкость улучшает на 1"
  const re = /(\S+)\s+(улучшает|ухудшает)\s+на\s+(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    props.push(`${m[1]} ${m[2]} на ${m[3]}`);
  }
  return props;
}

function parseForbidden(text: string): string[] {
  const m = /Неудобен\s*:\s*([^\n]+)/i.exec(text);
  if (!m || /ничего/i.test(m[1])) return [];
  return m[1].split(/[,;!\s]+/).map((s) => s.replace(/^!/, "").trim()).filter(Boolean);
}

function parseStrRequired(text: string): { right: number; left: number } {
  const rightM = /правую руку\s*\(требуется\s*(\d+)\s*сил/i.exec(text);
  const leftM = /левую руку\s*\(требуется\s*(\d+)\s*сил/i.exec(text);
  return {
    right: rightM ? parseInt(rightM[1]) : 0,
    left: leftM ? parseInt(leftM[1]) : 0,
  };
}

function parseItemCard(html: string, id: number): ItemCard | null {
  const cardM = /Предмет\s+"([^"]+)",\s*тип\s*:\s*(\S+)([\s\S]*?)(?=Предполагаемое место лоада|$)/i.exec(html);
  if (!cardM) return null;

  const name = cardM[1].trim();
  const itemType = stripHtml(cardM[2]).trim().toUpperCase();
  const rawText = stripHtml(cardM[3]).replace(/\n{3,}/g, "\n\n").trim();

  const material = parseMaterial(rawText);
  const isMetal = METAL_MATERIALS.has(material);
  const isShiny = /светится|горит|мерцает|пламен|шумит/i.test(rawText);

  const affects = parseAffects(rawText);
  const properties = parseProperties(rawText);
  const forbidden = parseForbidden(rawText);

  const str = parseStrRequired(rawText);

  // оружие
  const weaponClass = itemType === "ОРУЖИЕ" ? parseWeaponClass(rawText) : null;
  const damageAvg = itemType === "ОРУЖИЕ" ? parseDamageAvg(rawText) : 0;
  const canWearRight = /правую руку/i.test(rawText);
  const canWearLeft = /левую руку/i.test(rawText);

  // броня
  const wearSlots = itemType !== "ОРУЖИЕ" ? parseWearSlots(rawText) : [];
  const ac = parseAC(rawText);
  const armor = parseArmor(rawText);

  return {
    id,
    name,
    itemType,
    ac,
    armor,
    wearSlots,
    weaponClass,
    damageAvg,
    canWearRight,
    canWearLeft,
    requireStrRight: str.right,
    requireStrLeft: str.left,
    material,
    isMetal,
    isShiny,
    affects,
    properties,
    forbidden,
    rawText,
  };
}

// ─── wiki fetch ───────────────────────────────────────────────────────────────

async function fetchWiki(params: Record<string, string>): Promise<string> {
  const url = new URL(BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "bylins-bot/1.0 gear-advisor" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} при запросе ${url}`);
  return res.text();
}

async function searchItem(query: string): Promise<SearchResult[]> {
  const html = await fetchWiki({ q: query });
  return parseSearchResults(html);
}

async function getItem(id: number): Promise<ItemCard | null> {
  const html = await fetchWiki({ id: String(id) });
  return parseItemCard(html, id);
}

// ─── парсер входного списка ───────────────────────────────────────────────────

function parseInputList(input: string): string[] {
  const names: string[] = [];
  for (const line of input.split("\n")) {
    // убираем строки-заголовки и пустые
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[-=]+$/.test(trimmed)) continue;
    if (/^##/.test(trimmed)) continue;
    if (/Доступно|Предмет|Цена|Листать|прокричал|RETURN/i.test(trimmed)) continue;

    // формат магазина: "  1)  Навалом     название предмета   цена"
    const shopM = /^\s*\d+\)\s+\S+\s{2,}(.+?)\s{2,}\d+\s*$/.exec(trimmed);
    if (shopM) {
      names.push(shopM[1].trim());
      continue;
    }

    // формат экипировки/инвентаря MUD: "<слот>   название предмета   <состояние>   ..флаги"
    const equipParsed = parseEquipLine(trimmed);
    if (equipParsed) {
      names.push(equipParsed.name);
      continue;
    }

    // просто название предмета
    if (trimmed.length > 2 && !/^\d+$/.test(trimmed)) {
      names.push(trimmed);
    }
  }
  return [...new Set(names)]; // дедупликация
}

// ─── scoring ─────────────────────────────────────────────────────────────────

// Веса аффектов для брони татя.
// Ловкость получает двойной вес по сравнению с остальными хорошими аффектами:
// по исходникам bylins/mud ловкость влияет на 6+ систем одновременно —
// AC (dex_ac_bonus×10), бэкстаб (dex_bonus×2, уникальный двойной вес),
// скрытность/уклонение/кража/отмычка/подножка/удар-без-парирования (все dex_bonus×1),
// а также урон через feat WeaponFinesse (DEX заменяет STR при DEX>STR>17).
const AFFECT_SCORE: Record<string, number> = {
  "ловкость": 30,      // двойной вес: 6+ игровых систем масштабируются по DEX
  "ускорение": 15,     // доп. раунд атаки
  "доблесть": 15,      // бонус к урону/попаданию
  "инициатива": 15,
  "восст.энергии": 12,
  "восст.жизни": 12,
  "стойкость": 12,
  "макс.жизнь": 12,
  "защита.от.тяжелых.ран": 12,
};

const PROPERTY_SCORE: Record<string, number> = {
  "ловкость": 20,      // двойной вес (см. выше)
  "ускорение": 10,
  "доблесть": 10,
  "инициатива": 10,
  "восст.энергии": 8,
  "восст.жизни": 8,
  "стойкость": 8,
  "макс.жизнь": 8,
  "защита.от.тяжелых.ран": 8,
};

/** Очки полезности брони для татя */
function armorScore(item: ItemCard): number {
  if (item.isMetal) return -1000; // металл — запрет
  if (item.isShiny) return -500;  // светится — мешает скрытности

  let score = item.ac * 2 + item.armor * 3;

  // бонусы за полезные аффекты
  for (const a of item.affects) {
    const bonus = AFFECT_SCORE[a];
    if (bonus !== undefined) score += bonus;
    if (TATY_BAD_AFFECTS.has(a)) score -= 10;
  }
  // бонусы за свойства вида "ловкость улучшает на N"
  for (const p of item.properties) {
    for (const [affect, bonus] of Object.entries(PROPERTY_SCORE)) {
      if (p.includes(affect) && p.includes("улучшает")) score += bonus;
      if (p.includes(affect) && p.includes("ухудшает")) score -= bonus;
    }
    for (const bad of TATY_BAD_AFFECTS) {
      if (p.includes(bad) && p.includes("улучшает")) score -= 5;
    }
  }

  return score;
}

/** Очки полезности оружия */
function weaponScore(item: ItemCard, hand: "right" | "left"): number {
  if (!item.weaponClass) return -1000;
  if (item.isShiny) return -500;

  const wantClass = hand === "right" ? "проникающее оружие" : "иное оружие";
  if (item.weaponClass !== wantClass) return -1000;

  let score = item.damageAvg * 10;

  for (const p of item.properties) {
    if (p.includes("ловкость") && p.includes("улучшает")) score += 20;
    if (p.includes("повреждение") && p.includes("улучшает")) score += 15;
  }

  return score;
}

// ─── основная логика ──────────────────────────────────────────────────────────

interface SlotBest {
  slot: string;
  item: ItemCard;
  score: number;
  reason: string;
}

async function analyze(itemNames: string[]): Promise<void> {
  console.log(`\n🔍 Анализирую ${itemNames.length} предметов...\n`);

  // 1. ищем ID для каждого названия параллельно
  const searchResults = await Promise.all(
    itemNames.map(async (name) => {
      try {
        const results = await searchItem(name);
        // берём точное совпадение или первый результат
        const exact = results.find((r) => r.name.toLowerCase() === name.toLowerCase());
        const found = exact ?? results[0] ?? null;
        if (!found) {
          console.log(`  [поиск] "${name}" → не найдено в wiki`);
        } else if (!exact) {
          console.log(`  [поиск] "${name}" → нет точного совпадения, берём первый результат: "${found.name}" (id=${found.id})`);
        } else {
          console.log(`  [поиск] "${name}" → id=${found.id}`);
        }
        return found;
      } catch (e: unknown) {
        console.log(`  [поиск] "${name}" → ошибка: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    })
  );

  // 2. получаем карточки параллельно
  const cards = await Promise.all(
    searchResults.map(async (r) => {
      if (!r) return null;
      try {
        return await getItem(r.id);
      } catch {
        return null;
      }
    })
  );

  const validCards = cards.filter((c): c is ItemCard => c !== null);
  const notFound = itemNames.filter((_, i) => !cards[i]);

  if (notFound.length > 0) {
    console.log(`⚠️  Не найдено в wiki (${notFound.length}):`);
    for (const n of notFound) console.log(`   - ${n}`);
    console.log();
  }

  // 3. группируем по слотам и по типу оружия
  const bySlot: Record<string, ItemCard[]> = {};
  const rightWeapons: ItemCard[] = [];
  const leftWeapons: ItemCard[] = [];

  console.log("\n[группировка]");
  for (const card of validCards) {
    if (card.itemType === "ОРУЖИЕ") {
      const slots: string[] = [];
      if (card.canWearRight) { rightWeapons.push(card); slots.push("правая рука"); }
      if (card.canWearLeft)  { leftWeapons.push(card);  slots.push("левая рука"); }
      console.log(`  ОРУЖИЕ  "${card.name}" → слоты: [${slots.join(", ") || "нет"}], класс: ${card.weaponClass ?? "?"}, урон: ${card.damageAvg}, металл: ${card.isMetal}`);
    } else {
      for (const slot of card.wearSlots) {
        if (!bySlot[slot]) bySlot[slot] = [];
        bySlot[slot].push(card);
      }
      console.log(`  БРОНЯ   "${card.name}" → слоты: [${card.wearSlots.join(", ") || "нет"}], металл: ${card.isMetal}, ac: ${card.ac}, armor: ${card.armor}`);
    }
  }

  const recommendations: SlotBest[] = [];
  const toBuy: ItemCard[] = [];
  const toSkip: Array<{ name: string; reason: string }> = [];

  // 4. оружие
  const slotOrder = ["правая рука (проник.)", "левая рука (иное)", ...Object.keys(bySlot)];

  // правая рука
  if (rightWeapons.length > 0) {
    const scored = rightWeapons
      .map((item) => ({ item, score: weaponScore(item, "right") }))
      .sort((a, b) => b.score - a.score);

    console.log("\n[скоры: правая рука]");
    for (const { item, score } of scored) {
      console.log(`  score=${score.toFixed(1)}  "${item.name}"  (класс=${item.weaponClass}, урон=${item.damageAvg}, металл=${item.isMetal}, props=[${item.properties.join("; ")}])`);
    }

    const best = scored[0];
    if (best.score > -1000) {
      recommendations.push({
        slot: "правая рука",
        item: best.item,
        score: best.score,
        reason: `проникающее оружие, урон ${best.item.damageAvg.toFixed(1)}`,
      });
      toBuy.push(best.item);
      for (const { item } of scored.slice(1)) {
        toSkip.push({ name: item.name, reason: item.weaponClass !== "проникающее оружие" ? `не проникающее (${item.weaponClass})` : "слабее лучшего варианта" });
      }
    } else {
      for (const { item } of scored) {
        toSkip.push({ name: item.name, reason: `не подходит в правую руку (нужно проникающее, есть ${item.weaponClass})` });
      }
    }
  }

  // левая рука
  if (leftWeapons.length > 0) {
    const scored = leftWeapons
      .map((item) => ({ item, score: weaponScore(item, "left") }))
      .sort((a, b) => b.score - a.score);

    console.log("\n[скоры: левая рука]");
    for (const { item, score } of scored) {
      console.log(`  score=${score.toFixed(1)}  "${item.name}"  (класс=${item.weaponClass}, урон=${item.damageAvg}, металл=${item.isMetal}, props=[${item.properties.join("; ")}])`);
    }

    const best = scored[0];
    if (best.score > -1000) {
      recommendations.push({
        slot: "левая рука",
        item: best.item,
        score: best.score,
        reason: `иное оружие, урон ${best.item.damageAvg.toFixed(1)}`,
      });
      toBuy.push(best.item);
      for (const { item } of scored.slice(1)) {
        if (!toBuy.find((b) => b.id === item.id)) {
          toSkip.push({ name: item.name, reason: item.weaponClass !== "иное оружие" ? `не иное оружие (${item.weaponClass})` : "слабее лучшего варианта" });
        }
      }
    } else {
      for (const { item } of scored) {
        if (!toBuy.find((b) => b.id === item.id)) {
          toSkip.push({ name: item.name, reason: `не подходит в левую руку (нужно иное, есть ${item.weaponClass})` });
        }
      }
    }
  }

  // 5. броня по слотам
  for (const [slot, items] of Object.entries(bySlot)) {
    const scored = items
      .map((item) => ({ item, score: armorScore(item) }))
      .sort((a, b) => b.score - a.score);

    console.log(`\n[скоры: ${slot}]`);
    for (const { item, score } of scored) {
      console.log(`  score=${score.toFixed(1)}  "${item.name}"  (металл=${item.isMetal}, ac=${item.ac}, armor=${item.armor}, props=[${item.properties.join("; ")}])`);
    }

    const best = scored[0];
    const reasons: string[] = [];

    if (best.score < 0) {
      // лучший вариант — запрещённый
      for (const { item } of scored) {
        const r = item.isMetal ? "МЕТАЛЛ — штраф на умения татя" : item.isShiny ? "светится — мешает скрытности" : "не подходит";
        toSkip.push({ name: item.name, reason: r });
      }
      continue;
    }

    if (best.item.isMetal) reasons.push("⚠️ металл");
    if (best.item.isShiny) reasons.push("⚠️ светится");
    reasons.push(`AC ${best.item.ac}, броня ${best.item.armor}`);
    if (best.item.affects.length) reasons.push(`аффекты: ${best.item.affects.join(", ")}`);
    for (const p of best.item.properties) {
      if (Object.keys(AFFECT_SCORE).some((a) => p.includes(a))) reasons.push(p);
    }

    recommendations.push({
      slot,
      item: best.item,
      score: best.score,
      reason: reasons.join(", "),
    });
    toBuy.push(best.item);

    for (const { item } of scored.slice(1)) {
      const r = item.isMetal
        ? "МЕТАЛЛ — штраф на умения татя"
        : item.isShiny
        ? "светится — мешает скрытности"
        : `AC ${item.ac}+броня ${item.armor} < лучшего (${best.item.ac}+${best.item.armor})`;
      toSkip.push({ name: item.name, reason: r });
    }
  }

  // ─── вывод ───────────────────────────────────────────────────────────────

  console.log("═".repeat(60));
  console.log("✅ РЕКОМЕНДАЦИИ К ПОКУПКЕ");
  console.log("═".repeat(60));

  const slotEmoji: Record<string, string> = {
    "правая рука": "⚔️ ",
    "левая рука": "🗡️ ",
    туловище: "👕",
    голову: "⛑️ ",
    ноги: "👖",
    ступни: "👢",
    кисти: "🧤",
    руки: "💪",
    плечи: "🦺",
    пояс: "🔖",
    запястья: "📿",
    шею: "📿",
    палец: "💍",
  };

  for (const rec of recommendations) {
    const emoji = slotEmoji[rec.slot] ?? "▪️ ";
    console.log(`\n${emoji} [${rec.slot.toUpperCase()}] ${rec.item.name}`);
    console.log(`   ${rec.reason}`);
    if (rec.item.material) console.log(`   Материал: ${rec.item.material}`);
  }

  if (toSkip.length > 0) {
    console.log("\n" + "─".repeat(60));
    console.log("❌ НЕ ПОКУПАТЬ:");
    for (const { name, reason } of toSkip) {
      console.log(`   - ${name}: ${reason}`);
    }
  }

  // ─── команды ─────────────────────────────────────────────────────────────

  if (toBuy.length > 0) {
    console.log("\n" + "═".repeat(60));
    console.log("📋 КОМАНДЫ ПОКУПКИ (через ; ):");
    console.log("═".repeat(60));
    const cmds = toBuy.map((item) => `купить !${item.name}!`);
    console.log(cmds.join("; "));

    console.log("\n📋 КОМАНДЫ НАДЕВАНИЯ:");
    const wearCmds: string[] = [];
    for (const rec of recommendations) {
      const slot = rec.slot === "правая рука" ? "в правой руке" : rec.slot === "левая рука" ? "в левой руке" : rec.slot;
      wearCmds.push(getEquipCommand(slot, rec.item.name));
    }
    console.log(wearCmds.join("; "));
  }

  console.log("\n" + "═".repeat(60));
}

// ─── точка входа ─────────────────────────────────────────────────────────────

async function main() {
  let input = "";

  // аргумент командной строки
  if (process.argv[2]) {
    input = process.argv[2].replace(/\\n/g, "\n");
  } else {
    input = await Bun.stdin.text();
  }

  if (!input.trim()) {
    console.error("Использование: bun run scripts/gear-advisor.ts 'предмет1\\nпредмет2\\n...'");
    console.error("Или: echo -e 'предмет1\\nпредмет2' | bun run scripts/gear-advisor.ts");
    process.exit(1);
  }

  const names = parseInputList(input);
  if (names.length === 0) {
    console.error("Не удалось извлечь названия предметов из входных данных.");
    process.exit(1);
  }

  await analyze(names);
}

await main();

export {};
