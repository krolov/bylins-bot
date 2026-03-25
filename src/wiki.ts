const WIKI_BASE_URL = "https://wiki.bylins.su/stuff.php";

export function loadProxies(raw?: string): string[] {
  const src = raw ?? Bun.env.WIKI_PROXIES?.trim();
  if (!src) return [];
  return src
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(":");
      if (parts.length === 4) {
        const [host, port, user, pass] = parts;
        return `http://${user}:${pass}@${host}:${port}`;
      }
      return entry;
    });
}

export function createProxyPicker(proxies: string[]): () => string | undefined {
  let idx = 0;
  return () => {
    if (proxies.length === 0) return undefined;
    return proxies[idx++ % proxies.length];
  };
}

export async function fetchWiki(
  params: Record<string, string>,
  proxy?: string,
): Promise<string> {
  const url = new URL(WIKI_BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const options: RequestInit & { proxy?: string } = {
    headers: { "User-Agent": "bylins-bot/1.0 wiki" },
  };
  if (proxy) options.proxy = proxy;
  const res = await fetch(url.toString(), options);
  if (!res.ok) throw new Error(`wiki HTTP ${res.status} for ${url}`);
  return res.text();
}

export function stripHtml(s: string): string {
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

export const WEAR_SLOTS = [
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

export type WearSlot = (typeof WEAR_SLOTS)[number];

export type GearWearSlot =
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
  | "левая рука";

export interface SearchResult {
  id: number;
  name: string;
}

export interface WikiItemCard {
  id: number;
  name: string;
  itemType: string;
  text: string;
  loadLocation: string;
}

export type StatName = "сила" | "ловкость" | "мудрость" | "ум" | "здоровье" | "обаяние";

export interface StatRequirement {
  stat: StatName;
  value: number;
}

export interface GearItemCard {
  id: number;
  name: string;
  itemType: string;
  ac: number;
  armor: number;
  wearSlots: GearWearSlot[];
  weaponClass: string | null;
  damageAvg: number;
  damageDice: string | null;
  canWearRight: boolean;
  canWearLeft: boolean;
  rightHandReqs: StatRequirement[];
  leftHandReqs: StatRequirement[];
  wearReqs: StatRequirement[];
  material: string;
  isMetal: boolean;
  isShiny: boolean;
  affects: string[];
  properties: string[];
  forbidden: string[];
  remorts: number;
}

export interface GearItem {
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
}

export interface GearRecommendation {
  slot: string;
  item: GearItem;
  desc: string;
}

export interface AnalyzeResult {
  recommendations: GearRecommendation[];
  skipped: Array<{ name: string; reason: string }>;
  notFound: string[];
  buyCommands: string;
  wearCommands: string;
}

export function parseSearchResults(html: string): SearchResult[] {
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

const METAL_MATERIALS = new Set([
  "ЖЕЛЕЗО",
  "БРОНЗА",
  "СТАЛЬ",
  "БУЛАТ",
  "СЕРЕБРО",
  "ЗОЛОТО",
  "МЕДЬ",
  "ОЛОВО",
]);

export function parseGearWearSlots(text: string): GearWearSlot[] {
  const slots: GearWearSlot[] = [];
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

const STAT_NAME_MAP: Record<string, StatName> = {
  "сила": "сила",
  "силы": "сила",
  "ловкость": "ловкость",
  "ловкости": "ловкость",
  "мудрость": "мудрость",
  "мудрости": "мудрость",
  "ум": "ум",
  "ума": "ум",
  "здоровье": "здоровье",
  "здоровья": "здоровье",
  "обаяние": "обаяние",
  "обаяния": "обаяние",
};

function parseStatReqs(text: string): StatRequirement[] {
  const reqs: StatRequirement[] = [];
  const re = /требуется\s+(\d+)\s+([а-яёА-ЯЁ]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const stat = STAT_NAME_MAP[m[2].toLowerCase()];
    if (stat) reqs.push({ stat, value: parseInt(m[1]) });
  }
  return reqs;
}


export function parseGearItemCard(html: string, id: number): GearItemCard | null {
  const cardM =
    /Предмет\s+"([^"]+)",\s*тип\s*:\s*(\S+)([\s\S]*?)(?=Предполагаемое место лоада|$)/i.exec(
      html,
    );
  if (!cardM) return null;

  const name = cardM[1].trim();
  const itemType = stripHtml(cardM[2]).trim().toUpperCase();
  const rawText = stripHtml(cardM[3]).replace(/\n{3,}/g, "\n\n").trim();

  const matM = /Материал\s*:\s*([A-ZА-ЯЁ.]+)/i.exec(rawText);
  const material = matM ? matM[1].toUpperCase() : "НЕИЗВЕСТНО";
  const isMetal = METAL_MATERIALS.has(material);
  const isShiny = /светится|горит|мерцает|пламен|шумит/i.test(rawText);

  const affM = /Накладывает на [вВ]ас аффекты:\s*([^\n]+)/i.exec(rawText);
  const affects =
    affM && !/ничего/i.test(affM[1])
      ? affM[1]
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  const props: string[] = [];
  const propRe = /(\S+)\s+(улучшает|ухудшает)\s+на\s+(\d+)/gi;
  let pm: RegExpExecArray | null;
  while ((pm = propRe.exec(rawText)) !== null) {
    props.push(`${pm[1]} ${pm[2]} на ${pm[3]}`);
  }

  const forbM = /Неудобен\s*:\s*([^\n]+)/i.exec(rawText);
  const forbidden =
    forbM && !/ничего/i.test(forbM[1])
      ? forbM[1]
          .split(/[,;!\s]+/)
          .map((s) => s.replace(/^!/, "").trim())
          .filter(Boolean)
      : [];

  const weaponClass =
    itemType === "ОРУЖИЕ"
      ? (() => {
          const wm = /Принадлежит к классу\s+"([^"]+)"/i.exec(rawText);
          return wm ? wm[1].toLowerCase() : null;
        })()
      : null;

  const damM = /среднее\s+([\d.]+)/i.exec(rawText);
  const damM2 = /'(\d+)D(\d+)'/i.exec(rawText);
  const damageAvg = damM
    ? parseFloat(damM[1])
    : damM2
      ? (parseInt(damM2[1]) * (parseInt(damM2[2]) + 1)) / 2
      : 0;
  const damageDice = damM2
    ? `${damM2[1]}D${damM2[2]} (ср. ${((parseInt(damM2[1]) * (parseInt(damM2[2]) + 1)) / 2).toFixed(1)})`
    : null;

  const acM = /защита\s*\(AC\)\s*:\s*(-?\d+)/i.exec(rawText);
  const armorM = /броня\s*:\s*(\d+)/i.exec(rawText);
  const remortsM = /Требует\s+перевоплощений\s*:\s*(\d+)/i.exec(rawText);
  const remorts = remortsM ? parseInt(remortsM[1]) : 0;

  const rightHandReqs: StatRequirement[] = [];
  const leftHandReqs: StatRequirement[] = [];
  const wearReqs: StatRequirement[] = [];

  for (const line of rawText.split("\n")) {
    const lineReqs = parseStatReqs(line);
    if (!lineReqs.length) continue;
    if (/правую руку/i.test(line)) {
      rightHandReqs.push(...lineReqs);
    } else if (/левую руку/i.test(line)) {
      leftHandReqs.push(...lineReqs);
    } else {
      wearReqs.push(...lineReqs);
    }
  }

  return {
    id,
    name,
    itemType,
    ac: acM ? parseInt(acM[1]) : 0,
    armor: armorM ? parseInt(armorM[1]) : 0,
    wearSlots: itemType !== "ОРУЖИЕ" ? parseGearWearSlots(rawText) : [],
    weaponClass,
    damageAvg,
    damageDice,
    canWearRight: /правую руку/i.test(rawText),
    canWearLeft: /левую руку/i.test(rawText),
    rightHandReqs,
    leftHandReqs,
    wearReqs,
    material,
    isMetal,
    isShiny,
    affects,
    properties: props,
    forbidden,
    remorts,
  };
}

export function parseWikiItemCard(html: string, id: number): WikiItemCard | null {
  const cardM =
    /Предмет\s+"([^"]+)",\s*тип\s*:\s*(\S+)([\s\S]*?)(?=Предполагаемое место лоада|$)/i.exec(
      html,
    );
  if (!cardM) return null;

  const name = cardM[1].trim();
  const itemType = stripHtml(cardM[2]).trim();
  const text = stripHtml(cardM[3]).replace(/\n{3,}/g, "\n\n").trim();

  const loadM =
    /Предполагаемое место лоада[\s\S]*?<option[^>]+selected[^>]*>([^<]+)</i.exec(html);
  const loadLocation = loadM?.[1]?.trim() ?? "Неизвестно";

  return { id, name, itemType, text, loadLocation };
}

export function parseGearItem(html: string, id: number): GearItem | null {
  const cardM =
    /Предмет\s+"([^"]+)",\s*тип\s*:\s*(\S+)([\s\S]*?)(?=Предполагаемое место лоада|$)/i.exec(
      html,
    );
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
    if (diceM) damageAvg = (parseInt(diceM[1]) * (parseInt(diceM[2]) + 1)) / 2;
  }

  const acM = /защита\s*\(AC\)\s*:\s*(-?\d+)/i.exec(t);
  const armorM = /броня\s*:\s*(\d+)/i.exec(t);

  const affects: string[] = [];
  const affM = /Накладывает на [вВ]ас аффекты:\s*([^\n]+)/i.exec(t);
  if (affM && !/ничего/i.test(affM[1])) {
    affects.push(
      ...affM[1]
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  const properties: string[] = [];
  const propRe = /(\S+)\s+(улучшает|ухудшает)\s+на\s+(\d+)/gi;
  let pm: RegExpExecArray | null;
  while ((pm = propRe.exec(t)) !== null) {
    properties.push(`${pm[1]} ${pm[2]} на ${pm[3]}`);
  }

  return {
    id,
    name,
    itemType,
    ac: acM ? parseInt(acM[1]) : 0,
    armor: armorM ? parseInt(armorM[1]) : 0,
    wearSlots,
    weaponClass,
    damageAvg,
    canRight: /правую руку/i.test(t),
    canLeft: /левую руку/i.test(t),
    material,
    isMetal,
    isShiny,
    affects,
    properties,
  };
}

export function gearItemCardToData(card: GearItemCard): Record<string, unknown> {
  return {
    id: card.id,
    name: card.name,
    ac: card.ac,
    armor: card.armor,
    wearSlots: card.wearSlots,
    weaponClass: card.weaponClass,
    damageAvg: card.damageAvg,
    damageDice: card.damageDice,
    canWearRight: card.canWearRight,
    canWearLeft: card.canWearLeft,
    rightHandReqs: card.rightHandReqs,
    leftHandReqs: card.leftHandReqs,
    wearReqs: card.wearReqs,
    material: card.material,
    isMetal: card.isMetal,
    isShiny: card.isShiny,
    affects: card.affects,
    properties: card.properties,
    forbidden: card.forbidden,
    remorts: card.remorts,
  };
}

function isStatReqArray(v: unknown): v is StatRequirement[] {
  return Array.isArray(v) && v.every(
    (x) => typeof x === "object" && x !== null && typeof (x as StatRequirement).stat === "string" && typeof (x as StatRequirement).value === "number",
  );
}

export function gearItemCardFromCache(
  name: string,
  itemType: string,
  data: Record<string, unknown>,
): GearItemCard | null {
  if (typeof data.id !== "number") return null;
  return {
    id: data.id,
    name,
    itemType,
    ac: typeof data.ac === "number" ? data.ac : 0,
    armor: typeof data.armor === "number" ? data.armor : 0,
    wearSlots: Array.isArray(data.wearSlots) ? (data.wearSlots as GearWearSlot[]) : [],
    weaponClass: typeof data.weaponClass === "string" ? data.weaponClass : null,
    damageAvg: typeof data.damageAvg === "number" ? data.damageAvg : 0,
    damageDice: typeof data.damageDice === "string" ? data.damageDice : null,
    canWearRight: data.canWearRight === true,
    canWearLeft: data.canWearLeft === true,
    rightHandReqs: isStatReqArray(data.rightHandReqs) ? data.rightHandReqs : [],
    leftHandReqs: isStatReqArray(data.leftHandReqs) ? data.leftHandReqs : [],
    wearReqs: isStatReqArray(data.wearReqs) ? data.wearReqs : [],
    material: typeof data.material === "string" ? data.material : "НЕИЗВЕСТНО",
    isMetal: data.isMetal === true,
    isShiny: data.isShiny === true,
    affects: Array.isArray(data.affects) ? (data.affects as string[]) : [],
    properties: Array.isArray(data.properties) ? (data.properties as string[]) : [],
    forbidden: Array.isArray(data.forbidden) ? (data.forbidden as string[]) : [],
    remorts: typeof data.remorts === "number" ? data.remorts : 0,
  };
}

export async function searchItems(query: string): Promise<SearchResult[]> {
  const html = await fetchWiki({ q: query });
  return parseSearchResults(html);
}

export async function getItem(id: number): Promise<WikiItemCard | null> {
  const html = await fetchWiki({ id: String(id) });
  return parseWikiItemCard(html, id);
}

export async function filterByAffect(
  affect: string,
  secondAffect?: string,
): Promise<SearchResult[]> {
  const params: Record<string, string> = { aff1: affect };
  if (secondAffect) params.aff2 = secondAffect;
  const html = await fetchWiki(params);
  return parseSearchResults(html);
}

export async function filterBySlot(slot: WearSlot): Promise<SearchResult[]> {
  const html = await fetchWiki({ wear_at: slot });
  return parseSearchResults(html);
}

export async function searchCombined(opts: {
  query?: string;
  slot?: WearSlot;
  affect1?: string;
  affect2?: string;
}): Promise<SearchResult[]> {
  const params: Record<string, string> = {};
  if (opts.query) params.q = opts.query;
  if (opts.slot) params.wear_at = opts.slot;
  if (opts.affect1) params.aff1 = opts.affect1;
  if (opts.affect2) params.aff2 = opts.affect2;
  if (Object.keys(params).length === 0) return [];
  const html = await fetchWiki(params);
  return parseSearchResults(html);
}

const TATY_GOOD_PROPS = new Set([
  "ловкость",
  "ускорение",
  "доблесть",
  "инициатива",
  "восст.энергии",
  "восст.жизни",
  "стойкость",
  "макс.жизнь",
  "защита.от.тяжелых.ран",
]);
const TATY_BAD_PROPS = new Set(["попадание", "воля"]);

function analyzeArmorScore(item: GearItem): number {
  if (item.isMetal || item.isShiny) return -1000;
  let score = item.ac * 2 + item.armor * 3;
  for (const a of item.affects) {
    if (TATY_GOOD_PROPS.has(a)) score += 15;
    if (TATY_BAD_PROPS.has(a)) score -= 10;
  }
  for (const p of item.properties) {
    for (const g of TATY_GOOD_PROPS) {
      if (p.includes(g)) score += p.includes("улучшает") ? 10 : -10;
    }
    for (const b of TATY_BAD_PROPS) {
      if (p.includes(b) && p.includes("улучшает")) score -= 5;
    }
  }
  return score;
}

function analyzeWeaponScore(item: GearItem, wantClass: string): number {
  if (!item.weaponClass || item.weaponClass !== wantClass || item.isShiny) return -1000;
  let score = item.damageAvg * 10;
  if (item.isMetal) score -= 5;
  for (const p of item.properties) {
    if (p.includes("ловкость") && p.includes("улучшает")) score += 20;
    if (p.includes("повреждение") && p.includes("улучшает")) score += 15;
  }
  return score;
}

export async function analyzeGear(itemNames: string[]): Promise<AnalyzeResult> {
  const searchResults = await Promise.all(
    itemNames.map(async (name) => {
      try {
        const html = await fetchWiki({ q: name });
        const results = parseSearchResults(html);
        return (
          results.find((r) => r.name.toLowerCase() === name.toLowerCase()) ??
          results[0] ??
          null
        );
      } catch {
        return null;
      }
    }),
  );

  const cards = await Promise.all(
    searchResults.map(async (r) => {
      if (!r) return null;
      try {
        const html = await fetchWiki({ id: String(r.id) });
        return parseGearItem(html, r.id);
      } catch {
        return null;
      }
    }),
  );

  const valid = cards.filter((c): c is GearItem => c !== null);
  const notFound = itemNames.filter((_, i) => !cards[i]);

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

  const bought: GearItem[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const recommendations: GearRecommendation[] = [];

  const pickBest = (candidates: GearItem[], scoreFn: (i: GearItem) => number, slot: string) => {
    if (!candidates.length) return;
    const scored = candidates
      .map((i) => ({ i, s: scoreFn(i) }))
      .sort((a, b) => b.s - a.s);
    const best = scored[0];
    if (best.s > -1000) {
      const parts: string[] = [];
      if (best.i.itemType === "ОРУЖИЕ") {
        parts.push(`${best.i.weaponClass}, урон ${best.i.damageAvg.toFixed(1)}`);
      } else {
        parts.push(`AC ${best.i.ac}, броня ${best.i.armor}`);
        if (best.i.affects.length) parts.push(`аффекты: ${best.i.affects.join(", ")}`);
        const goodProps = best.i.properties.filter((p) =>
          [...TATY_GOOD_PROPS].some((g) => p.includes(g) && p.includes("улучшает")),
        );
        if (goodProps.length) parts.push(goodProps.join(", "));
      }
      recommendations.push({ slot, item: best.i, desc: parts.join(", ") });
      bought.push(best.i);
      for (const { i } of scored.slice(1)) {
        if (!bought.find((b) => b.id === i.id)) {
          skipped.push({
            name: i.name,
            reason: i.isMetal
              ? "металл"
              : i.isShiny
                ? "светится"
                : `слабее (${i.weaponClass ?? "броня"})`,
          });
        }
      }
    } else {
      for (const { i } of scored) {
        skipped.push({
          name: i.name,
          reason: i.isMetal
            ? "металл"
            : i.isShiny
              ? "светится"
              : `не тот класс (${i.weaponClass})`,
        });
      }
    }
  };

  pickBest(rightCandidates, (i) => analyzeWeaponScore(i, "проникающее оружие"), "правая рука");
  pickBest(
    leftCandidates.filter(
      (i) => !bought.find((b) => b.id === i.id) || i.weaponClass === "иное оружие",
    ),
    (i) => analyzeWeaponScore(i, "иное оружие"),
    "левая рука",
  );
  for (const [slot, items] of Object.entries(bySlot)) {
    pickBest(items, analyzeArmorScore, slot);
  }

  const buyCommands = bought.map((i) => `купить ${i.name}`).join("; ");
  const wearCommands = recommendations
    .map(({ slot, item }) => {
      if (slot === "правая рука") return `воор ${item.name}`;
      if (slot === "левая рука") return `держать ${item.name}`;
      return `надеть ${item.name}`;
    })
    .join("; ");

  return { recommendations, skipped, notFound, buyCommands, wearCommands };
}
