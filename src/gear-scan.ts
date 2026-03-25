import type { ServerWebSocket } from "bun";
import {
  fetchWiki,
  parseSearchResults,
  parseGearItemCard,
  gearItemCardToData,
  gearItemCardFromCache,
  createProxyPicker,
} from "./wiki.ts";
import type { GearItemCard, GearWearSlot, StatName, StatRequirement } from "./wiki.ts";
import { selectProfile } from "./gear-profile.ts";
import type { GearProfile } from "./gear-profile.ts";

const GEAR_SCAN_TIMEOUT_MS = 4000;
const SHOP_PAGE_TIMEOUT_MS = 3000;
const STRIP_ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const STRIP_CR = /\r/g;
const PROMPT_RE = /\d+H\s+\d+M\b/;

type CharStats = Partial<Record<StatName, number>> & { remorts?: number };

function parseCharStats(levelText: string): CharStats {
  const stats: CharStats = {};
  const strM = /Сила\s*:\s*(\d+)/i.exec(levelText);
  if (strM) stats["сила"] = parseInt(strM[1]);
  const dexM = /Подв\s*:\s*(\d+)/i.exec(levelText);
  if (dexM) stats["ловкость"] = parseInt(dexM[1]);
  const conM = /Тело\s*:\s*(\d+)/i.exec(levelText);
  if (conM) stats["здоровье"] = parseInt(conM[1]);
  const wisM = /Мудр\s*:\s*(\d+)/i.exec(levelText);
  if (wisM) stats["мудрость"] = parseInt(wisM[1]);
  const intM = /Ум\s*:\s*(\d+)/i.exec(levelText);
  if (intM) stats["ум"] = parseInt(intM[1]);
  const chaM = /Обаян\s*:\s*(\d+)/i.exec(levelText);
  if (chaM) stats["обаяние"] = parseInt(chaM[1]);
  const remortsM = /Перевоплощений\s*:\s*(\d+)/i.exec(levelText);
  stats.remorts = remortsM ? parseInt(remortsM[1]) : 0;
  return stats;
}

function meetsReqs(reqs: StatRequirement[], stats: CharStats): boolean {
  return reqs.every((r) => (stats[r.stat] ?? 0) >= r.value);
}

export interface GearScanRow {
  slot: string;
  action: "keep" | "buy" | "equip" | "no_upgrade";
  itemName?: string;
  price?: number;
  shopNumber?: number;
  canAfford?: boolean;
  source?: "shop" | "inventory";
  damageDice?: string;
  damageAvg?: number;
  itemAc?: number;
  itemArmor?: number;
  currentItemName?: string;
  currentDamageDice?: string;
  currentDamageAvg?: number;
  currentAc?: number;
  currentArmor?: number;
}

export interface SellItem {
  name: string;
  count: number;
  sellCommand: string;
}

export interface GearScanResult {
  coins: number;
  rows: GearScanRow[];
  sellItems: SellItem[];
}

interface WsData {
  sessionId: string;
}

type BunWs = ServerWebSocket<WsData>;

export interface GearScanDeps {
  sendCommand: (cmd: string) => void;
  onProgress: (msg: string) => void;
  waitForOutput: (timeoutMs: number) => Promise<string>;
  cancelWait: () => void;
  registerTextHandler: (handler: (text: string) => void) => void;
  unregisterTextHandler: (handler: (text: string) => void) => void;
  getItemByName: (name: string) => Promise<{ itemType: string; data: Record<string, unknown> } | null>;
  upsertItem: (name: string, itemType: string, data: Record<string, unknown>) => Promise<void>;
  wikiProxies: string[];
}



async function withThrottle<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let i = 0;
  async function next(): Promise<void> {
    const idx = i++;
    if (idx >= tasks.length) return;
    results[idx] = await tasks[idx]();
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, next));
  return results;
}

function makeItemCache(deps: GearScanDeps): {
  findItem: (name: string) => Promise<GearItemCard | null>;
  concurrency: number;
} {
  const memCache = new Map<string, GearItemCard | null>();
  const nextProxy = createProxyPicker(deps.wikiProxies);

  async function findItem(name: string): Promise<GearItemCard | null> {
    const key = name.toLowerCase();

    if (memCache.has(key)) return memCache.get(key)!;

    const dbCached = await deps.getItemByName(key);
    if (dbCached) {
      if (dbCached.itemType === "NOT_FOUND") {
        memCache.set(key, null);
        return null;
      }
      const card = gearItemCardFromCache(key, dbCached.itemType, dbCached.data);
      memCache.set(key, card);
      return card;
    }

    const proxy = nextProxy();
    const html = await fetchWiki({ q: name }, proxy);
    const results = parseSearchResults(html);
    const exact = results.find((r) => r.name.toLowerCase() === key);
    const hit = exact ?? results[0];
    if (!hit) {
      memCache.set(key, null);
      void deps.upsertItem(key, "NOT_FOUND", {}).catch(() => {});
      return null;
    }
    const cardHtml = await fetchWiki({ id: String(hit.id) }, proxy);
    const card = parseGearItemCard(cardHtml, hit.id);
    memCache.set(key, card);
    if (card) {
      void deps.upsertItem(key, card.itemType, gearItemCardToData(card)).catch(() => {});
    }
    return card;
  }

  return { findItem, concurrency: deps.wikiProxies.length > 0 ? deps.wikiProxies.length : 3 };
}

function armorScore(item: GearItemCard, profile: GearProfile): number {
  if (profile.rejectMetal && item.isMetal) return -1000;
  if (profile.rejectShiny && item.isShiny) return -500;

  let score = item.ac * profile.acWeight + item.armor * profile.armorWeight;
  if (!profile.rejectMetal && item.isMetal) score -= profile.metalPenalty;

  for (const aw of profile.armorAffects) {
    if (item.affects.includes(aw.affect)) score += aw.affectScore;
    for (const p of item.properties) {
      if (p.includes(aw.affect)) {
        const numM = /на\s+(\d+)/i.exec(p);
        const n = numM ? parseInt(numM[1]) : 1;
        if (p.includes("улучшает")) score += aw.propertyScorePerPoint * n;
        if (p.includes("ухудшает")) score -= aw.propertyScorePerPoint * n;
      }
    }
  }

  return score;
}

function weaponScore(item: GearItemCard, hand: "right" | "left", profile: GearProfile): number {
  if (!item.weaponClass) return -1000;
  if (profile.rejectShiny && item.isShiny) return -500;
  const wantClass = hand === "right" ? profile.rightWeaponClass : profile.leftWeaponClass;
  if (item.weaponClass !== wantClass) return -1000;

  let score = item.damageAvg * profile.damageAvgWeight;
  if (profile.rejectMetal && item.isMetal) return -1000;
  if (!profile.rejectMetal && item.isMetal) score -= profile.metalPenalty;

  for (const aw of profile.weaponAffects) {
    if (item.affects.includes(aw.affect)) score += aw.affectScore;
    for (const p of item.properties) {
      if (p.includes(aw.affect) && p.includes("улучшает")) {
        const numM = /на\s+(\d+)/i.exec(p);
        const n = numM ? parseInt(numM[1]) : 1;
        score += aw.propertyScorePerPoint * n;
      }
    }
  }

  return score;
}

function stripCondition(s: string): string {
  return s
    .replace(/(\s{2,}<[^>]+>|\s*\.\.[а-яёa-zA-Z!]+!?|\s*\(.*?\)|\s*\[\d+\])+\s*$/i, "")
    .trim();
}

function parseEquipLine(line: string): { slot: string; itemName: string } | null {
  const m = /^<([^>]+)>\s+(.+)$/.exec(line.trim());
  if (!m) return null;
  return { slot: m[1].trim(), itemName: stripCondition(m[2]) };
}

function parseCoins(text: string): number {
  const m = /(\d+)\s*(кун|золот)/i.exec(text);
  return m ? parseInt(m[1]) : 0;
}

function parseShopLine(line: string): { name: string; price: number; shopNumber: number } | null {
  const m = /^\s*(\d+)\)\s+\S+\s{2,}(.+?)\s{2,}(\d+)\s*$/.exec(line);
  if (m) return { shopNumber: parseInt(m[1]), name: m[2].trim(), price: parseInt(m[3]) };
  return null;
}

// Строки из вывода MUD, которые не являются названиями предметов инвентаря.
// Попадают в буфер когда сервер присылает push-сообщения (смена часа, score-тикер и т.д.)
// одновременно с командой "инв".
const INV_NOISE_RE =
  /^<[^>]+>|^вы\s|^ваши?\s|^сила\s*:|^подв\s*:|^тело\s*:|^мудр\s*:|^ум\s*:|^обаян\s*:|^размер\s|^рост\s|^вес\s|^броня\/|^защита\s+\(|^у вас на руках|^минул\s|^сейчас вам|^вы стоите|^вы лежите|^тут вы чувствуете|^на вас надето|^насаженный на палку череп/i;

function parseInvLines(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^[-=]+$/.test(trimmed)) continue;
    if (/инвентарь|несете|пусто|ничего/i.test(trimmed)) continue;
    if (PROMPT_RE.test(trimmed)) continue;
    if (/^\d+H\s/.test(trimmed)) continue;
    // Отфильтровываем мусор: строки экипировки (<слот> предмет), строки из score и
    // служебные MUD-уведомления (смена часа, статусные строки и т.д.)
    if (INV_NOISE_RE.test(trimmed)) continue;
    if (trimmed.length > 2) {
      const name = stripCondition(trimmed);
      if (name.length > 2) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

const PAGER_RE = /RETURN|нажмите\s+\[?return\]?|нажмите\s+enter|\[.*продолжени/i;
const END_OF_LIST_RE = /конец\s+списка|список\s+пуст|нет\s+предметов|nothing\s+for\s+sale/i;

function hasMorePages(text: string): boolean {
  return PAGER_RE.test(text);
}

function createOutputWaiter(): {
  waitFor: (timeoutMs: number, extraStopRe?: RegExp) => Promise<string>;
  cancel: () => void;
  feed: (text: string) => void;
} {
  let buf = "";
  let resolve: ((s: string) => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopRe: RegExp | undefined;

  function stripped(): string {
    return buf.replace(STRIP_ANSI, "").replace(STRIP_CR, "");
  }

  function tryResolve() {
    const s = stripped();
    const ready = PROMPT_RE.test(s) || (stopRe !== undefined && stopRe.test(s));
    if (!ready) return;
    if (!resolve) return;
    if (timer) clearTimeout(timer);
    timer = null;
    const r = resolve;
    resolve = null;
    stopRe = undefined;
    buf = "";
    r(s);
  }

  return {
    feed(text: string) {
      buf += text;
      tryResolve();
    },
    waitFor(timeoutMs: number, extraStopRe?: RegExp): Promise<string> {
      buf = "";
      stopRe = extraStopRe;
      return new Promise<string>((res) => {
        resolve = res;
        timer = setTimeout(() => {
          const r = resolve;
          resolve = null;
          stopRe = undefined;
          const s = stripped();
          buf = "";
          timer = null;
          if (r) r(s);
        }, timeoutMs);
      });
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      resolve = null;
      stopRe = undefined;
      buf = "";
    },
  };
}

export async function runGearScan(
  deps: GearScanDeps,
): Promise<GearScanResult> {
  const { sendCommand, onProgress, registerTextHandler: registerHandler, unregisterTextHandler: unregisterHandler } = deps;
  const { findItem, concurrency } = makeItemCache(deps);
  const waiter = createOutputWaiter();
  registerHandler(waiter.feed);

  try {
    onProgress("Запрашиваю экипировку...");
    sendCommand("экип");
    const equipText = await waiter.waitFor(GEAR_SCAN_TIMEOUT_MS);

    onProgress("Запрашиваю уровень и деньги...");
    sendCommand("уров");
    const levelText = await waiter.waitFor(GEAR_SCAN_TIMEOUT_MS);

    const coins = parseCoins(levelText);
    const profile = selectProfile(levelText);
    const charStats = parseCharStats(levelText);
    onProgress(`Монет на руках: ${coins}. Профиль: ${profile.id}. Сила: ${charStats["сила"] ?? "?"}, Подв: ${charStats["ловкость"] ?? "?"}, Перевоплощений: ${charStats.remorts ?? 0}`);

    const equipped: Map<string, string[]> = new Map();
    for (const line of equipText.split("\n")) {
      const parsed = parseEquipLine(line);
      if (parsed) {
        const existing = equipped.get(parsed.slot);
        if (existing) {
          existing.push(parsed.itemName);
        } else {
          equipped.set(parsed.slot, [parsed.itemName]);
        }
      }
    }
    onProgress(`[DEBUG] equipped slots: ${[...equipped.entries()].map(([s, ns]) => `"${s}"→[${ns.map(n => `"${n}"`).join(",")}]`).join(", ") || "(пусто)"}`);

    onProgress("Листаю список магазина...");
    const shopItems: Array<{ name: string; price: number; shopNumber: number }> = [];
    sendCommand("спис");
    let pageText = await waiter.waitFor(SHOP_PAGE_TIMEOUT_MS, PAGER_RE);
    while (true) {
      for (const line of pageText.split("\n")) {
        const item = parseShopLine(line);
        if (item) shopItems.push(item);
      }
      if (END_OF_LIST_RE.test(pageText) || !hasMorePages(pageText)) break;
      sendCommand("");
      pageText = await waiter.waitFor(SHOP_PAGE_TIMEOUT_MS, PAGER_RE);
    }

    onProgress(`Найдено ${shopItems.length} предметов в магазине. Проверяю инвентарь...`);
    sendCommand("инв");
    const invText = await waiter.waitFor(GEAR_SCAN_TIMEOUT_MS);
    const invCounts = parseInvLines(invText);
    const invNames = [...invCounts.keys()];
    onProgress(`[DEBUG] инвентарь (${invNames.length}): ${invNames.map((n) => `"${n}"`).join(", ") || "(пусто)"}`);
    onProgress(`В инвентаре ${invNames.length} предметов. Анализирую...`);

    const shopCards = await withThrottle(shopItems.map((s) => async () => {
      try {
        const card = await findItem(s.name);
        if (!card) onProgress(`[DEBUG] shop: "${s.name}" → не найден на вики`);
        return card ? { card, price: s.price, shopNumber: s.shopNumber, source: "shop" as const } : null;
      } catch {
        onProgress(`[DEBUG] shop: "${s.name}" → ошибка wiki`);
        return null;
      }
    }), concurrency,);
    const validShop = shopCards.filter(
      (x): x is { card: GearItemCard; price: number; shopNumber: number; source: "shop" } => x !== null,
    );
    onProgress(`[DEBUG] shop valid: ${validShop.map((x) => `"${x.card.name}"(${x.card.wearSlots.join("/")||x.card.itemType})`).join(", ") || "(нет)"}`);

    const invCards = await withThrottle(invNames.map((name) => async () => {
      try {
        const card = await findItem(name);
        if (!card) onProgress(`[DEBUG] inv: "${name}" → не найден на вики`);
        return card ? { card, price: 0, source: "inventory" as const, invName: name } : null;
      } catch {
        onProgress(`[DEBUG] inv: "${name}" → ошибка wiki`);
        return null;
      }
    }), concurrency,);
    const validInv = invCards.filter(
      (x): x is { card: GearItemCard; price: number; source: "inventory"; invName: string } => x !== null,
    );
    onProgress(`[DEBUG] inv valid: ${validInv.map((x) => `"${x.card.name}"(${x.card.wearSlots.join("/")||x.card.itemType})`).join(", ") || "(нет)"}`);


    type Candidate = { card: GearItemCard; price: number; shopNumber?: number; source: "shop" | "inventory"; invName?: string };
    const allCandidates: Candidate[] = [...validShop, ...validInv];

    const currentCards = await withThrottle([...equipped.entries()].flatMap(([slot, names]) =>
      names.map((name) => async () => {
        try {
          const card = await findItem(name);
          return card ? { slot, card } : null;
        } catch {
          return null;
        }
      }),
    ), concurrency,);
    const validCurrent = currentCards.filter((x): x is { slot: string; card: GearItemCard } => x !== null);
    onProgress(`[DEBUG] current cards: ${validCurrent.map((x) => `"${x.slot}"→"${x.card.name}"`).join(", ") || "(нет)"}`);

    const rows: GearScanRow[] = [];
    const chosenInvCardIds = new Set<number>();

    const shopBySlot = new Map<string, Candidate[]>();
    const shopRightWeapons: Candidate[] = [];
    const shopLeftWeapons: Candidate[] = [];
    const shopRings: Candidate[] = [];
    const shopWristbands: Candidate[] = [];

    for (const entry of allCandidates) {
      if (entry.card.remorts > (charStats.remorts ?? 0)) continue;
      if (entry.card.itemType === "ОРУЖИЕ") {
        if (entry.card.canWearRight && meetsReqs(entry.card.rightHandReqs, charStats)) shopRightWeapons.push(entry);
        if (entry.card.canWearLeft && meetsReqs(entry.card.leftHandReqs, charStats)) shopLeftWeapons.push(entry);
      } else {
        if (!meetsReqs(entry.card.wearReqs, charStats)) continue;
        for (const slot of entry.card.wearSlots) {
          if (slot === "палец") {
            shopRings.push(entry);
          } else if (slot === "запястья") {
            shopWristbands.push(entry);
          } else {
            if (!shopBySlot.has(slot)) shopBySlot.set(slot, []);
            shopBySlot.get(slot)!.push(entry);
          }
        }
      }
    }

    const currentBySlot = new Map<string, GearItemCard>();

    const MUD_SLOT_TO_WIKI: Record<string, string> = {
      "в правой руке": "правая рука",
      "в левой руке": "левая рука",
      "на теле": "туловище",
      "на голове": "голову",
      "на ногах": "ноги",
      "на ступнях": "ступни",
      "на кистях": "кисти",
      "на руках": "руки",
      "на плечах": "плечи",
      "на поясе": "пояс",
      "на запястьях": "запястья",
      "на шее": "шею",
      "на пальце": "палец",
      "правый указательный палец": "палец",
      "левый указательный палец": "палец",
      "правый средний палец": "палец",
      "левый средний палец": "палец",
      "правый безымянный палец": "палец",
      "левый безымянный палец": "палец",
      "правый мизинец": "палец",
      "левый мизинец": "палец",
    };

    for (const { slot: mudSlot, card } of validCurrent) {
      const wikiSlot = MUD_SLOT_TO_WIKI[mudSlot.toLowerCase()] ?? mudSlot.toLowerCase();
      currentBySlot.set(wikiSlot, card);
    }

    const currentRightWeapon: GearItemCard | undefined = currentBySlot.get("правая рука");
    const currentLeftWeapon: GearItemCard | undefined = currentBySlot.get("левая рука");
    const currentRings: GearItemCard[] = [];
    for (const [mudSlot, names] of equipped.entries()) {
      if (MUD_SLOT_TO_WIKI[mudSlot.toLowerCase()] === "палец" || mudSlot.toLowerCase() === "палец") {
        for (const name of names) {
          const found = validCurrent.find((c) => c.card.name === name || c.slot === mudSlot);
          if (found) currentRings.push(found.card);
        }
      }
    }

    const currentWristbands: GearItemCard[] = [];
    for (const [mudSlot, names] of equipped.entries()) {
      const normalized = mudSlot.toLowerCase();
      if (normalized === "на правом запястье" || normalized === "на левом запястье" || normalized === "на запястьях") {
        for (const name of names) {
          const found = validCurrent.find((c) => c.card.name === name || c.slot === mudSlot);
          if (found) currentWristbands.push(found.card);
        }
      }
    }

    function bestCandidate(
      candidates: Candidate[],
      scoreFn: (c: GearItemCard) => number,
    ): Candidate | null {
      if (candidates.length === 0) return null;
      let best: Candidate | null = null;
      let bestScore = -Infinity;
      for (const c of candidates) {
        const s = scoreFn(c.card);
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      return best && bestScore > -999 ? best : null;
    }

    const rightBest = bestCandidate(shopRightWeapons, (c) => weaponScore(c, "right", profile));
    if (rightBest) {
      const currentScore = currentRightWeapon ? weaponScore(currentRightWeapon, "right", profile) : -Infinity;
      const shopScore = weaponScore(rightBest.card, "right", profile);
      if (shopScore > currentScore) {
        if (rightBest.source === "inventory") chosenInvCardIds.add(rightBest.card.id);
        rows.push({
          slot: "правая рука",
          action: rightBest.source === "inventory" ? "equip" : "buy",
          itemName: rightBest.card.name,
          price: rightBest.source === "shop" ? rightBest.price : undefined,
          shopNumber: rightBest.source === "shop" ? rightBest.shopNumber : undefined,
          canAfford: rightBest.source === "shop" ? coins >= rightBest.price : undefined,
          source: rightBest.source,
          damageDice: rightBest.card.damageDice ?? undefined,
          damageAvg: rightBest.card.damageAvg || undefined,
          currentItemName: currentRightWeapon?.name,
          currentDamageDice: currentRightWeapon?.damageDice ?? undefined,
          currentDamageAvg: currentRightWeapon?.damageAvg || undefined,
        });
      } else {
        rows.push({
          slot: "правая рука",
          action: "keep",
          currentItemName: currentRightWeapon?.name,
          currentDamageDice: currentRightWeapon?.damageDice ?? undefined,
          currentDamageAvg: currentRightWeapon?.damageAvg || undefined,
        });
      }
    }

    const leftBest = bestCandidate(shopLeftWeapons, (c) => weaponScore(c, "left", profile));
    if (leftBest) {
      const currentScore = currentLeftWeapon ? weaponScore(currentLeftWeapon, "left", profile) : -Infinity;
      const shopScore = weaponScore(leftBest.card, "left", profile);
      if (shopScore > currentScore) {
        if (leftBest.source === "inventory") chosenInvCardIds.add(leftBest.card.id);
        rows.push({
          slot: "левая рука",
          action: leftBest.source === "inventory" ? "equip" : "buy",
          itemName: leftBest.card.name,
          price: leftBest.source === "shop" ? leftBest.price : undefined,
          shopNumber: leftBest.source === "shop" ? leftBest.shopNumber : undefined,
          canAfford: leftBest.source === "shop" ? coins >= leftBest.price : undefined,
          source: leftBest.source,
          damageDice: leftBest.card.damageDice ?? undefined,
          damageAvg: leftBest.card.damageAvg || undefined,
          currentItemName: currentLeftWeapon?.name,
          currentDamageDice: currentLeftWeapon?.damageDice ?? undefined,
          currentDamageAvg: currentLeftWeapon?.damageAvg || undefined,
        });
      } else {
        rows.push({
          slot: "левая рука",
          action: "keep",
          currentItemName: currentLeftWeapon?.name,
          currentDamageDice: currentLeftWeapon?.damageDice ?? undefined,
          currentDamageAvg: currentLeftWeapon?.damageAvg || undefined,
        });
      }
    }

    const chosenRingCardIds = new Set<number>();
    for (let i = 0; i < 2; i++) {
      const subSlot = `палец ${i + 1}`;
      const remaining = shopRings.filter((c) => !chosenRingCardIds.has(c.card.id));
      const best = bestCandidate(remaining, (c) => armorScore(c, profile));
      if (!best) continue;
      const currentRing = currentRings[i];
      const currentScore = currentRing ? armorScore(currentRing, profile) : -Infinity;
      const shopScore = armorScore(best.card, profile);
      chosenRingCardIds.add(best.card.id);
      if (shopScore > currentScore) {
        if (best.source === "inventory") chosenInvCardIds.add(best.card.id);
        rows.push({
          slot: subSlot,
          action: best.source === "inventory" ? "equip" : "buy",
          itemName: best.card.name,
          price: best.source === "shop" ? best.price : undefined,
          shopNumber: best.source === "shop" ? best.shopNumber : undefined,
          canAfford: best.source === "shop" ? coins >= best.price : undefined,
          source: best.source,
          itemAc: best.card.ac || undefined,
          itemArmor: best.card.armor || undefined,
          currentItemName: currentRing?.name,
          currentAc: currentRing?.ac || undefined,
          currentArmor: currentRing?.armor || undefined,
        });
      } else {
        rows.push({
          slot: subSlot,
          action: "keep",
          currentItemName: currentRing?.name,
          currentAc: currentRing?.ac || undefined,
          currentArmor: currentRing?.armor || undefined,
        });
      }
    }

    const chosenWristbandCardIds = new Set<number>();
    for (let i = 0; i < 2; i++) {
      const subSlot = `запястье ${i + 1}`;
      const remaining = shopWristbands.filter((c) => !chosenWristbandCardIds.has(c.card.id));
      const best = bestCandidate(remaining, (c) => armorScore(c, profile));
      if (!best) continue;
      const currentWristband = currentWristbands[i];
      const currentScore = currentWristband ? armorScore(currentWristband, profile) : -Infinity;
      const shopScore = armorScore(best.card, profile);
      chosenWristbandCardIds.add(best.card.id);
      if (shopScore > currentScore) {
        if (best.source === "inventory") chosenInvCardIds.add(best.card.id);
        rows.push({
          slot: subSlot,
          action: best.source === "inventory" ? "equip" : "buy",
          itemName: best.card.name,
          price: best.source === "shop" ? best.price : undefined,
          shopNumber: best.source === "shop" ? best.shopNumber : undefined,
          canAfford: best.source === "shop" ? coins >= best.price : undefined,
          source: best.source,
          itemAc: best.card.ac || undefined,
          itemArmor: best.card.armor || undefined,
          currentItemName: currentWristband?.name,
          currentAc: currentWristband?.ac || undefined,
          currentArmor: currentWristband?.armor || undefined,
        });
      } else {
        rows.push({
          slot: subSlot,
          action: "keep",
          currentItemName: currentWristband?.name,
          currentAc: currentWristband?.ac || undefined,
          currentArmor: currentWristband?.armor || undefined,
        });
      }
    }

    for (const [slot, candidates] of shopBySlot.entries()) {
      const best = bestCandidate(candidates, (c) => armorScore(c, profile));
      if (!best) continue;
      const currentCard = currentBySlot.get(slot);
      const currentScore = currentCard ? armorScore(currentCard, profile) : -Infinity;
      const shopScore = armorScore(best.card, profile);
      if (shopScore > currentScore) {
        if (best.source === "inventory") chosenInvCardIds.add(best.card.id);
        rows.push({
          slot,
          action: best.source === "inventory" ? "equip" : "buy",
          itemName: best.card.name,
          price: best.source === "shop" ? best.price : undefined,
          shopNumber: best.source === "shop" ? best.shopNumber : undefined,
          canAfford: best.source === "shop" ? coins >= best.price : undefined,
          source: best.source,
          itemAc: best.card.ac || undefined,
          itemArmor: best.card.armor || undefined,
          currentItemName: currentCard?.name,
          currentAc: currentCard?.ac || undefined,
          currentArmor: currentCard?.armor || undefined,
        });
      } else {
        rows.push({
          slot,
          action: "keep",
          currentItemName: currentCard?.name,
          currentAc: currentCard?.ac || undefined,
          currentArmor: currentCard?.armor || undefined,
        });
      }
    }

    for (const [mudSlot, equippedNames] of equipped.entries()) {
      const wikiSlot = MUD_SLOT_TO_WIKI[mudSlot.toLowerCase()] ?? mudSlot.toLowerCase();
      if (wikiSlot === "палец") continue;
      const normalized = mudSlot.toLowerCase();
      if (normalized === "на правом запястье" || normalized === "на левом запястье" || normalized === "на запястьях") continue;
      const alreadyHasRow = rows.some((r) => r.slot === wikiSlot);
      if (!alreadyHasRow) {
        const currentCard = currentBySlot.get(wikiSlot);
        rows.push({
          slot: wikiSlot,
          action: "no_upgrade",
          currentItemName: equippedNames[0],
          currentAc: currentCard?.ac || undefined,
          currentArmor: currentCard?.armor || undefined,
          currentDamageDice: currentCard?.damageDice ?? undefined,
          currentDamageAvg: currentCard?.damageAvg || undefined,
        });
      }
    }
    const equippedRings = [...equipped.entries()]
      .filter(([s]) => MUD_SLOT_TO_WIKI[s.toLowerCase()] === "палец" || s.toLowerCase() === "палец" || s.toLowerCase() === "на пальце")
      .flatMap(([, names]) => names);
    const ringSubSlots = ["палец 1", "палец 2"] as const;
    for (let i = 0; i < 2; i++) {
      const subSlot = ringSubSlots[i];
      if (!rows.some((r) => r.slot === subSlot)) {
        rows.push({ slot: subSlot, action: "no_upgrade", currentItemName: equippedRings[i] });
      }
    }

    const equippedWristbands = [
      ...(equipped.get("на правом запястье") ?? []),
      ...(equipped.get("на левом запястье") ?? []),
      ...(equipped.get("на запястьях") ?? []),
    ];
    const wristSubSlots = ["запястье 1", "запястье 2"] as const;
    for (let i = 0; i < 2; i++) {
      const subSlot = wristSubSlots[i];
      if (!rows.some((r) => r.slot === subSlot)) {
        rows.push({ slot: subSlot, action: "no_upgrade", currentItemName: equippedWristbands[i] });
      }
    }

    const sellItems: SellItem[] = [];
    for (const inv of validInv) {
      if (chosenInvCardIds.has(inv.card.id)) continue;
      const rawName = inv.invName;
      const count = invCounts.get(rawName) ?? 1;
      const escapedName = rawName.replace(/ /g, ".");
      const sellCommand = count > 1 ? `продать все.${escapedName}` : `продать ${escapedName}`;
      sellItems.push({ name: rawName, count, sellCommand });
    }

    onProgress("Готово.");
    onProgress(`[DEBUG] rows: ${rows.map((r) => `${r.slot}:${r.action}${r.itemName ? "→" + r.itemName : ""}${r.currentItemName ? "(cur:" + r.currentItemName + ")" : ""}`).join(", ")}`);
    return { coins, rows, sellItems };
  } finally {
    unregisterHandler(waiter.feed);
    waiter.cancel();
  }
}
