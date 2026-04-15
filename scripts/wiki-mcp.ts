import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import postgres from "postgres";

const BASE_URL = "https://wiki.bylins.su/stuff.php";
const CACHE_FILE = resolve(import.meta.dirname, "wiki-mcp-cache.json");

const DATABASE_URL = Bun.env.DATABASE_URL ?? "postgres://bylins:bylins@localhost:5432/bylins_bot";
const db = postgres(DATABASE_URL, { max: 2 });

interface DbGearItemCard {
  id: number;
  name: string;
  itemType: string;
  ac: number;
  armor: number;
  wearSlots: string[];
  weaponClass: string | null;
  damageAvg: number;
  damageDice: string | null;
  canWearRight: boolean;
  canWearLeft: boolean;
  material: string;
  isMetal: boolean;
  isShiny: boolean;
  affects: string[];
  properties: string[];
  forbidden: string[];
  remorts: number;
}

async function lookupByIdInDb(id: number): Promise<DbGearItemCard | null> {
  try {
    const rows = await db`
      SELECT data #>> '{}' AS json
      FROM game_items
      WHERE (data #>> '{}')::jsonb ->> 'id' = ${String(id)}
        AND data::text != '"{}"'
    `;
    if (!rows.length) return null;
    return JSON.parse(rows[0].json as string) as DbGearItemCard;
  } catch {
    return null;
  }
}

async function lookupByNameInDb(name: string): Promise<DbGearItemCard | null> {
  try {
    const rows = await db`
      SELECT data #>> '{}' AS json
      FROM game_items
      WHERE lower(name) = lower(${name})
        AND data::text != '"{}"'
    `;
    if (!rows.length) return null;
    return JSON.parse(rows[0].json as string) as DbGearItemCard;
  } catch {
    return null;
  }
}

type Cache = Record<string, string>;

function loadCache(): Cache {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8")) as Cache;
  } catch {
    return {};
  }
}

function saveCache(cache: Cache): void {
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}

const cache: Cache = loadCache();
console.error(`[cache] загружено ${Object.keys(cache).length} записей из ${CACHE_FILE}`);

const WEAR_SLOTS = [
  "голову",
  "ноги",
  "ступни",
  "кисти",
  "пояс",
  "плечи",
  "запястья",
  "туловище",
  "шею",
  "правая.рука",
  "левая.рука",
  "обе.руки",
  "колчан",
] as const;

interface SearchResult {
  id: number;
  name: string;
}

interface ItemCard {
  id: number;
  name: string;
  itemType: string;
  text: string;
  loadLocation: string;
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

function parseItemCard(html: string, id: number): ItemCard | null {
  const cardM = /Предмет\s+"([^"]+)",\s*тип\s*:\s*(\S+)([\s\S]*?)(?=Предполагаемое место лоада|$)/i.exec(html);
  if (!cardM) return null;

  const name = cardM[1].trim();
  const itemType = stripHtml(cardM[2]).trim();
  const text = stripHtml(cardM[3]).replace(/\n{3,}/g, "\n\n").trim();

  const loadM = /Предполагаемое место лоада[\s\S]*?<option[^>]+selected[^>]*>([^<]+)</i.exec(html);
  const loadLocation = loadM?.[1]?.trim() ?? "Неизвестно";

  return { id, name, itemType, text, loadLocation };
}

async function fetchWiki(params: Record<string, string>): Promise<string> {
  const url = new URL(BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const key = url.search;
  const isItemPage = "id" in params;

  if (!isItemPage && cache[key]) {
    console.error(`[cache] hit: ${key}`);
    return cache[key];
  }

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "bylins-bot/1.0 wiki-mcp" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} при запросе ${url}`);
  const html = await res.text();

  if (!isItemPage) {
    cache[key] = html;
    saveCache(cache);
    console.error(`[cache] saved: ${key} (всего ${Object.keys(cache).length})`);
  }

  return html;
}

const server = new McpServer({ name: "bylins-wiki-stuff", version: "1.0.0" });

server.registerTool(
  "search_items",
  {
    title: "Поиск предметов по названию",
    description:
      "Ищет предметы в базе wiki.bylins.su по подстроке в названии. " +
      "Возвращает список предметов с их ID. " +
      "Используй get_item для получения полной карточки по ID.",
    inputSchema: z.object({
      query: z.string().min(2).describe("Подстрока для поиска в названии предмета (рус/лат)"),
    }),
  },
  async ({ query }) => {
    const html = await fetchWiki({ q: query });
    const results = parseSearchResults(html);
    if (results.length === 0) {
      return { content: [{ type: "text", text: `Ничего не найдено по запросу «${query}»` }] };
    }
    const lines = results.map((r) => `ID ${r.id}: ${r.name}`).join("\n");
    return {
      content: [{ type: "text", text: `Найдено ${results.length} предмет(ов) по запросу «${query}»:\n\n${lines}` }],
    };
  }
);

server.registerTool(
  "get_item",
  {
    title: "Карточка предмета по ID",
    description:
      "Возвращает полную карточку предмета из wiki.bylins.su: название, тип, слот, " +
      "материал, броня/урон, аффекты, ограничения класса, место лоада.",
    inputSchema: z.object({
      id: z.number().int().positive().describe("Числовой ID предмета"),
    }),
  },
  async ({ id }) => {
    const dbCard = await lookupByIdInDb(id);
    if (dbCard) {
      console.error(`[db] hit: id=${id}`);
      const parts: string[] = [`=== ${dbCard.name} (ID: ${dbCard.id}) ===`];
      if (dbCard.itemType) parts.push(`Тип: ${dbCard.itemType}`);
      parts.push("");
      if (dbCard.weaponClass) parts.push(`Класс оружия: ${dbCard.weaponClass}`);
      if (dbCard.damageDice) parts.push(`Урон: ${dbCard.damageDice}`);
      if (dbCard.ac) parts.push(`AC: ${dbCard.ac}`);
      if (dbCard.armor) parts.push(`Броня: ${dbCard.armor}`);
      if (dbCard.wearSlots.length) parts.push(`Слоты: ${dbCard.wearSlots.join(", ")}`);
      parts.push(`Материал: ${dbCard.material}`);
      if (dbCard.affects.length) parts.push(`Аффекты: ${dbCard.affects.join(", ")}`);
      if (dbCard.properties.length) parts.push(`Свойства: ${dbCard.properties.join(", ")}`);
      if (dbCard.forbidden.length) parts.push(`Запрещено: ${dbCard.forbidden.join(", ")}`);
      if (dbCard.remorts) parts.push(`Реморты: ${dbCard.remorts}`);
      return { content: [{ type: "text", text: parts.join("\n") }] };
    }

    const html = await fetchWiki({ id: String(id) });
    const card = parseItemCard(html, id);
    if (!card) {
      return { content: [{ type: "text", text: `Предмет с ID ${id} не найден.` }] };
    }
    const text = [
      `=== ${card.name} (ID: ${card.id}) ===`,
      `Тип: ${card.itemType}`,
      "",
      card.text,
      "",
      `Место лоада: ${card.loadLocation}`,
    ].join("\n");
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "filter_by_affect",
  {
    title: "Предметы с нужным аффектом",
    description:
      "Возвращает список предметов, у которых есть указанный аффект. " +
      "Передавай название аффекта по-русски: ловкость, попадание, ускорение, доблесть и т.д.",
    inputSchema: z.object({
      affect: z.string().describe("Название аффекта по-русски (например: ловкость, попадание, ускорение)"),
      second_affect: z.string().optional().describe("Второй аффект для комбинированной фильтрации (опционально)"),
    }),
  },
  async ({ affect, second_affect }) => {
    const params: Record<string, string> = { aff1: affect };
    if (second_affect) params.aff2 = second_affect;
    const html = await fetchWiki(params);
    const results = parseSearchResults(html);
    const desc = second_affect ? `«${affect}» + «${second_affect}»` : `«${affect}»`;
    if (results.length === 0) {
      return { content: [{ type: "text", text: `Предметов с аффектом ${desc} не найдено.` }] };
    }
    const lines = results.map((r) => `ID ${r.id}: ${r.name}`).join("\n");
    return {
      content: [{ type: "text", text: `Найдено ${results.length} предмет(ов) с аффектом ${desc}:\n\n${lines}` }],
    };
  }
);

server.registerTool(
  "filter_by_slot",
  {
    title: "Предметы для конкретного слота",
    description:
      "Возвращает список предметов для указанного слота надевания. " +
      `Доступные слоты: ${WEAR_SLOTS.join(", ")}.`,
    inputSchema: z.object({
      slot: z.enum(WEAR_SLOTS).describe(`Слот надевания. Одно из: ${WEAR_SLOTS.join(", ")}`),
    }),
  },
  async ({ slot }) => {
    const html = await fetchWiki({ wear_at: slot });
    const results = parseSearchResults(html);
    if (results.length === 0) {
      return { content: [{ type: "text", text: `Предметов для слота «${slot}» не найдено.` }] };
    }
    const lines = results.map((r) => `ID ${r.id}: ${r.name}`).join("\n");
    return {
      content: [{ type: "text", text: `Найдено ${results.length} предмет(ов) для слота «${slot}»:\n\n${lines}` }],
    };
  }
);

server.registerTool(
  "search_combined",
  {
    title: "Комбинированный поиск предметов",
    description:
      "Комбинирует поиск по названию, слоту и аффектам в одном запросе. " +
      "Все параметры опциональны — указывай только нужные.",
    inputSchema: z.object({
      query: z.string().optional().describe("Подстрока в названии (опционально)"),
      slot: z.enum(WEAR_SLOTS).optional().describe(`Слот надевания (опционально). Одно из: ${WEAR_SLOTS.join(", ")}`),
      affect1: z.string().optional().describe("Первый аффект по-русски (опционально)"),
      affect2: z.string().optional().describe("Второй аффект по-русски (опционально)"),
    }),
  },
  async ({ query, slot, affect1, affect2 }) => {
    const params: Record<string, string> = {};
    if (query) params.q = query;
    if (slot) params.wear_at = slot;
    if (affect1) params.aff1 = affect1;
    if (affect2) params.aff2 = affect2;

    if (Object.keys(params).length === 0) {
      return {
        content: [{ type: "text", text: "Укажи хотя бы один параметр: query, slot, affect1 или affect2." }],
      };
    }

    const html = await fetchWiki(params);
    const results = parseSearchResults(html);

    const filterDesc = [
      query ? `название содержит «${query}»` : null,
      slot ? `слот «${slot}»` : null,
      affect1 ? `аффект «${affect1}»` : null,
      affect2 ? `аффект «${affect2}»` : null,
    ].filter(Boolean).join(", ");

    if (results.length === 0) {
      return { content: [{ type: "text", text: `Ничего не найдено (фильтры: ${filterDesc}).` }] };
    }

    const lines = results.map((r) => `ID ${r.id}: ${r.name}`).join("\n");
    return {
      content: [{ type: "text", text: `Найдено ${results.length} предмет(ов) (${filterDesc}):\n\n${lines}` }],
    };
  }
);

const METAL_MATERIALS = new Set(["ЖЕЛЕЗО", "БРОНЗА", "СТАЛЬ", "БУЛАТ", "СЕРЕБРО", "ЗОЛОТО", "МЕДЬ", "ОЛОВО"]);

const TATY_AFFECT_SCORE: Record<string, number> = {
  "ловкость":               60,
  "ускорение":              15,
  "доблесть":               15,
  "инициатива":             15,
  "восст.энергии":          12,
  "восст.жизни":            12,
  "стойкость":              12,
  "макс.жизнь":             12,
  "защита.от.тяжелых.ран":  12,
  "телосложение":            6,
};
const TATY_PROP_SCORE: Record<string, number> = {
  "ловкость":               40,
  "ускорение":              10,
  "доблесть":               10,
  "инициатива":             10,
  "восст.энергии":           8,
  "восст.жизни":             8,
  "стойкость":               8,
  "макс.жизнь":              5,
  "защита.от.тяжелых.ран":   8,
  "телосложение":            4,
};
const TATY_BAD_PROPS = new Set(["попадание", "воля"]);

// Количество ремортов текущего персонажа — захардкожено.
// Предметы с remorts > PLAYER_REMORTS недоступны и исключаются из анализа.
const PLAYER_REMORTS = 10;

interface GearItem {
  id: number;
  name: string;
  itemType: string;
  ac: number;
  armor: number;
  wearSlots: string[];
  weaponClass: string | null;
  damageAvg: number;
  canRight: boolean;
  canLeft: boolean;
  material: string;
  isMetal: boolean;
  isShiny: boolean;
  affects: string[];
  properties: string[];
  remorts: number; // требуемое количество ремортов (0 = без требований)
}

function parseGearItem(html: string, id: number): GearItem | null {
  const cardM = /Предмет\s+"([^"]+)",\s*тип\s*:\s*(\S+)([\s\S]*?)(?=Предполагаемое место лоада|$)/i.exec(html);
  if (!cardM) return null;

  const name = cardM[1].trim();
  const itemType = stripHtml(cardM[2]).trim().toUpperCase();
  const t = stripHtml(cardM[3]).replace(/\n{3,}/g, "\n\n").trim();

  const matM = /Материал\s*:\s*([A-ZА-ЯЁ.]+)/i.exec(t);
  const material = matM ? matM[1].toUpperCase() : "НЕИЗВЕСТНО";
  const isMetal = METAL_MATERIALS.has(material);
  const isShiny = /светится|горит|мерцает|пламен|шумит/i.test(t);

  const wearSlots: string[] = [];
  if (/надеть на туловище/i.test(t)) wearSlots.push("туловище");
  if (/надеть на голову/i.test(t)) wearSlots.push("голову");
  if (/надеть на ноги/i.test(t)) wearSlots.push("ноги");
  if (/обуть/i.test(t)) wearSlots.push("ступни");
  if (/надеть на кисти/i.test(t)) wearSlots.push("кисти");
  if (/надеть на руки/i.test(t)) wearSlots.push("руки");
  if (/надеть на плечи/i.test(t)) wearSlots.push("плечи");
  if (/надеть на пояс/i.test(t)) wearSlots.push("пояс");
  if (/надеть на запястья/i.test(t)) wearSlots.push("запястья");
  if (/надеть на шею/i.test(t)) wearSlots.push("шею");
  if (/надеть на палец/i.test(t)) wearSlots.push("палец");

  const wcM = /Принадлежит к классу\s+"([^"]+)"/i.exec(t);
  const weaponClass = wcM ? wcM[1].toLowerCase() : null;

  const avgM = /среднее\s+([\d.]+)/i.exec(t);
  let damageAvg = avgM ? parseFloat(avgM[1]) : 0;
  if (!damageAvg) {
    const diceM = /'(\d+)D(\d+)'/i.exec(t);
    if (diceM) damageAvg = parseInt(diceM[1]) * (parseInt(diceM[2]) + 1) / 2;
  }

  const acM = /защита\s*\(AC\)\s*:\s*(-?\d+)/i.exec(t);
  const armorM = /броня\s*:\s*(\d+)/i.exec(t);
  const ac = acM ? parseInt(acM[1]) : 0;
  const armor = armorM ? parseInt(armorM[1]) : 0;

  const affects: string[] = [];
  const affM = /Накладывает на [вВ]ас аффекты:\s*([^\n]+)/i.exec(t);
  if (affM && !/ничего/i.test(affM[1])) {
    affects.push(...affM[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean));
  }

  const properties: string[] = [];
  const propRe = /(\S+)\s+(улучшает|ухудшает)\s+на\s+(\d+)/gi;
  let pm: RegExpExecArray | null;
  while ((pm = propRe.exec(t)) !== null) {
    properties.push(`${pm[1]} ${pm[2]} на ${pm[3]}`);
  }

  const remortsM = /[Рр]еморт[ыов]*\s*:\s*(\d+)/i.exec(t);
  const remorts = remortsM ? parseInt(remortsM[1]) : 0;

  return {
    id, name, itemType, ac, armor, wearSlots,
    weaponClass, damageAvg,
    canRight: /правую руку/i.test(t),
    canLeft: /левую руку/i.test(t),
    material, isMetal, isShiny, affects, properties, remorts,
  };
}

function dbCardToGearItem(c: DbGearItemCard): GearItem {
  return {
    id: c.id,
    name: c.name,
    itemType: c.itemType,
    ac: c.ac,
    armor: c.armor,
    wearSlots: c.wearSlots,
    weaponClass: c.weaponClass,
    damageAvg: c.damageAvg,
    canRight: c.canWearRight,
    canLeft: c.canWearLeft,
    material: c.material,
    isMetal: c.isMetal,
    isShiny: c.isShiny,
    affects: c.affects,
    properties: c.properties,
    remorts: c.remorts ?? 0,
  };
}


function armorScore(item: GearItem): number {
  if (item.isMetal || item.isShiny) return -1000;
  let score = item.ac * 2 + item.armor * 3;
  for (const a of item.affects) {
    const bonus = TATY_AFFECT_SCORE[a];
    if (bonus !== undefined) score += bonus;
    if (TATY_BAD_PROPS.has(a)) score -= 10;
  }
  for (const p of item.properties) {
    for (const [key, bonus] of Object.entries(TATY_PROP_SCORE)) {
      if (p.includes(key)) score += p.includes("улучшает") ? bonus : -bonus;
    }
    for (const b of TATY_BAD_PROPS) {
      if (p.includes(b) && p.includes("улучшает")) score -= 5;
    }
  }
  return score;
}

function weaponScore(item: GearItem, wantClass: string): number {
  if (!item.weaponClass || item.weaponClass !== wantClass || item.isShiny) return -1000;
  let score = item.damageAvg * 10;
  if (item.isMetal) score -= 5;
  for (const p of item.properties) {
    if (p.includes("ловкость") && p.includes("улучшает")) score += 20;
    if (p.includes("повреждение") && p.includes("улучшает")) score += 15;
  }
  return score;
}

function parseShopList(raw: string): string[] {
  const names: string[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^[-=]+$/.test(t) || /^##/.test(t)) continue;
    if (/Доступно|Предмет|Цена|Листать|RETURN|прокричал/i.test(t)) continue;
    const shopM = /^\s*\d+\)\s+\S+\s{2,}(.+?)\s{2,}\d+\s*$/.exec(t);
    if (shopM) { names.push(shopM[1].trim()); continue; }
    if (t.length > 2 && !/^\d+$/.test(t)) names.push(t);
  }
  return [...new Set(names)];
}

server.registerTool(
  "analyze_gear",
  {
    title: "Анализ снаряжения для татя",
    description:
      "Принимает список названий предметов (или сырой вывод магазина MUD), " +
      "запрашивает характеристики каждого через wiki и возвращает: " +
      "лучшее проникающее оружие в правую руку, лучшее иное в левую, " +
      "лучшую броню по слотам (без металла), команды купить/надеть.",
    inputSchema: z.object({
      items: z.string().describe(
        "Список предметов — построчно (одно название = одна строка) " +
        "или сырой вывод команды list из магазина MUD."
      ),
    }),
  },
  async ({ items }) => {
    const names = parseShopList(items);
    if (names.length === 0) {
      return { content: [{ type: "text", text: "Не удалось извлечь названия предметов из входных данных." }] };
    }

    const cards = await Promise.all(
      names.map(async (name) => {
        const dbCard = await lookupByNameInDb(name);
        if (dbCard) {
          console.error(`[db] hit by name: ${name}`);
          return dbCardToGearItem(dbCard);
        }
        try {
          const html = await fetchWiki({ q: name });
          const results = parseSearchResults(html);
          const exact = results.find((r) => r.name.toLowerCase() === name.toLowerCase());
          const match = exact ?? results[0] ?? null;
          if (!match) return null;
          const itemHtml = await fetchWiki({ id: String(match.id) });
          return parseGearItem(itemHtml, match.id);
        } catch { return null; }
      })
    );

    const valid = cards.filter((c): c is GearItem => c !== null);
    const notFound = names.filter((_, i) => !cards[i]);

    const bySlot: Record<string, GearItem[]> = {};
    const rightCandidates: GearItem[] = [];
    const leftCandidates: GearItem[] = [];

    for (const card of valid) {
      if (card.itemType === "ОРУЖИЕ") {
        if (card.canRight) rightCandidates.push(card);
        if (card.canLeft) leftCandidates.push(card);
      } else {
        for (const slot of card.wearSlots) {
          if (!bySlot[slot]) bySlot[slot] = [];
          bySlot[slot].push(card);
        }
      }
    }

    const buy: GearItem[] = [];
    const skip: Array<{ name: string; reason: string }> = [];
    const recs: Array<{ slot: string; item: GearItem; desc: string }> = [];

    const pickBest = (candidates: GearItem[], scoreFn: (i: GearItem) => number, slot: string, wearCmd: string) => {
      if (!candidates.length) return;

      const available: GearItem[] = [];
      for (const i of candidates) {
        if (i.remorts > PLAYER_REMORTS) {
          skip.push({ name: i.name, reason: `требует ${i.remorts} ремортов (у вас ${PLAYER_REMORTS})` });
        } else {
          available.push(i);
        }
      }

      if (!available.length) return;
      const scored = available.map((i) => ({ i, s: scoreFn(i) })).sort((a, b) => b.s - a.s);
      const best = scored[0];
      if (best.s > -1000) {
        const parts: string[] = [];
        if (best.i.itemType === "ОРУЖИЕ") {
          parts.push(`${best.i.weaponClass}, урон ${best.i.damageAvg.toFixed(1)}`);
        } else {
          parts.push(`AC ${best.i.ac}, броня ${best.i.armor}`);
          if (best.i.affects.length) parts.push(`аффекты: ${best.i.affects.join(", ")}`);
          const goodProps = best.i.properties.filter((p) => Object.keys(TATY_PROP_SCORE).some((g) => p.includes(g) && p.includes("улучшает")));
          if (goodProps.length) parts.push(goodProps.join(", "));
        }
        if (best.i.remorts > 0) parts.push(`реморты: ${best.i.remorts}`);
        recs.push({ slot, item: best.i, desc: parts.join(", ") });
        buy.push(best.i);
        for (const { i } of scored.slice(1)) {
          if (!buy.find((b) => b.id === i.id)) {
            const reason = i.isMetal ? "МЕТАЛЛ — штраф на умения татя"
              : i.isShiny ? "светится — мешает скрытности"
              : i.weaponClass && i.weaponClass !== (slot === "правая рука" ? "проникающее оружие" : "иное оружие")
                ? `не тот класс (${i.weaponClass})`
              : `слабее лучшего варианта`;
            skip.push({ name: i.name, reason });
          }
        }
      } else {
        for (const { i } of scored) {
          skip.push({ name: i.name, reason: i.isMetal ? "МЕТАЛЛ" : i.isShiny ? "светится" : `не тот класс (${i.weaponClass})` });
        }
      }
    };

    pickBest(rightCandidates, (i) => weaponScore(i, "проникающее оружие"), "правая рука", "воор");
    pickBest(leftCandidates.filter((i) => !buy.find((b) => b.id === i.id) || i.weaponClass === "иное оружие"),
      (i) => weaponScore(i, "иное оружие"), "левая рука", "держать");

    for (const [slot, items] of Object.entries(bySlot)) {
      pickBest(items, armorScore, slot, "надеть");
    }

    const lines: string[] = [];

    if (notFound.length) {
      lines.push(`⚠️ Не найдено в wiki: ${notFound.join(", ")}\n`);
    }

    lines.push("✅ РЕКОМЕНДАЦИИ К ПОКУПКЕ\n");
    for (const { slot, item, desc } of recs) {
      lines.push(`[${slot.toUpperCase()}] ${item.name}`);
      lines.push(`  ${desc}`);
      lines.push(`  Материал: ${item.material}`);
    }

    if (skip.length) {
      lines.push("\n❌ НЕ ПОКУПАТЬ:");
      for (const { name, reason } of skip) {
        lines.push(`  - ${name}: ${reason}`);
      }
    }

    if (buy.length) {
      lines.push("\n📋 КОМАНДЫ ПОКУПКИ:");
      lines.push(buy.map((i) => `купить ${i.name}`).join("; "));

      lines.push("\n📋 КОМАНДЫ НАДЕВАНИЯ:");
      const wearCmds = recs.map(({ slot, item }) => {
        if (slot === "правая рука") return `воор ${item.name}`;
        if (slot === "левая рука") return `держать ${item.name}`;
        return `надеть ${item.name}`;
      });
      lines.push(wearCmds.join("; "));
    }

    return { content: [{ type: "text", text: lines.join("\n") }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("bylins-wiki-stuff MCP server запущен (stdio)");
