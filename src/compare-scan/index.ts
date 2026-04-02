export interface GearScanDeps {
  sendCommand: (cmd: string) => void;
  onProgress: (msg: string) => void;
  waitForOutput: (timeoutMs: number) => Promise<string>;
  cancelWait: () => void;
  registerTextHandler: (handler: (text: string) => void) => void;
  unregisterTextHandler: (handler: (text: string) => void) => void;
  getItemByName: (name: string) => Promise<{ itemType: string; data: Record<string, unknown>; hasGameData: boolean } | null>;
  upsertItem: (name: string, itemType: string, data: Record<string, unknown>, hasWikiData: boolean, hasGameData: boolean) => Promise<void>;
  wikiProxies: string[];
}
import {
  fetchWiki,
  parseSearchResults,
  parseGearItemCard,
  gearItemCardToData,
  gearItemCardFromCache,
  createProxyPicker,
} from "../wiki.ts";
import type { GearItemCard, StatRequirement, StatName } from "../wiki.ts";
import { selectConfig } from "./config.ts";
import type { CharacterConfig } from "./config.ts";
import { thiefConfig } from "./profiles/thief.ts";
import { merchantConfig } from "./profiles/merchant.ts";
import { armorScore, weaponScore } from "./gear-scoring.ts";

const ALL_CONFIGS: CharacterConfig[] = [thiefConfig, merchantConfig];

const COMPARE_SCAN_TIMEOUT_MS = 4000;
const SHOP_PAGE_TIMEOUT_MS = 3000;
const STRIP_ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const STRIP_CR = /\r/g;
const PROMPT_RE = /\d+H\s+\d+M\b/;
const PAGER_RE = /RETURN|нажмите\s+\[?return\]?|нажмите\s+enter|\[.*продолжени/i;
const END_OF_LIST_RE = /конец\s+списка|список\s+пуст|нет\s+предметов|nothing\s+for\s+sale/i;
const BAZAAR_PAGER_RE = /Листать\s*:/i;
const BAZAAR_END_RE = /список\s+пуст|нет\s+предметов|нет\s+лотов/i;
// [ 125]   покрытый пылью свиток                           5000  плоховато
const BAZAAR_LINE_RE = /^\s*\[\s*(\d+)\]\s+(.+?)\s{2,}(\d+)\s+\S+\s*$/;

const TOP_N = 5;

export type CandidateSource = "shop" | "bazaar" | "inventory";

export interface CompareCandidate {
  itemId: number;
  itemName: string;
  price: number;
  listNumber: number;
  score: number;
  source: CandidateSource;
  card: GearItemCard;
  hasGameData: boolean;
}

export interface CompareSlotResult {
  slot: string;
  currentItemName: string | null;
  currentCard: GearItemCard | null;
  currentScore: number;
  candidates: CompareCandidate[];
}

export interface CompareScanResult {
  hasShop: boolean;
  coins: number;
  slots: CompareSlotResult[];
}

type CharStats = Partial<Record<StatName, number>> & { remorts?: number };

// ─── helpers ─────────────────────────────────────────────────────────────────

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

function parseCoins(text: string): number {
  const handM = /у вас на руках\s+(\d+)\s+кун/i.exec(text);
  const inHand = handM ? parseInt(handM[1]) : 0;
  const grivnaM = /у вас на руках\s+\d+\s+кун\s+и\s+(\d+)\s+гривен/i.exec(text);
  const inHandGrivna = grivnaM ? parseInt(grivnaM[1]) * 10 : 0;
  const bankM = /ещё\s+(\d+)\s+кун\s+припрятано|еще\s+(\d+)\s+кун\s+припрятано/i.exec(text);
  const inBank = bankM ? parseInt(bankM[1] ?? bankM[2]) : 0;
  // shop mode fallback: "1421 кун"
  const simpleM = /(\d+)\s*(кун|золот)/i.exec(text);
  const simple = simpleM ? parseInt(simpleM[1]) : 0;
  return (inHand + inHandGrivna + inBank) || simple;
}

function stripCondition(s: string): string {
  return s
    .replace(/\s*\*.*$/, "")
    .replace(/(\s{2,}<[^>]+>|\s*\.\.[а-яёa-zA-Z!]+!?|\s*\(.*?\)|\s*\[\d+\])+\s*$/i, "")
    .trim();
}

function parseEquipLine(line: string): { slot: string; itemName: string } | null {
  const m = /^<([^>]+)>\s+(.+)$/.exec(line.trim());
  if (!m) return null;
  return { slot: m[1].trim(), itemName: stripCondition(m[2]) };
}

function parseShopLine(line: string): { name: string; price: number; shopNumber: number } | null {
  const m = /^\s*(\d+)\)\s+\S+\s{2,}(.+?)\s{2,}(\d+)\s*$/.exec(line);
  if (m) return { shopNumber: parseInt(m[1]), name: m[2].trim(), price: parseInt(m[3]) };
  return null;
}

function parseBazaarLine(line: string): { lotNumber: number; name: string; price: number } | null {
  const m = BAZAAR_LINE_RE.exec(line);
  if (m) return { lotNumber: parseInt(m[1]), name: m[2].trim(), price: parseInt(m[3]) };
  return null;
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

  function tryResolve(): void {
    const s = stripped();
    const ready = PROMPT_RE.test(s) || (stopRe !== undefined && stopRe.test(s));
    if (!ready || !resolve) return;
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

function makeItemFinder(deps: GearScanDeps): {
  findItem: (name: string) => Promise<{ card: GearItemCard; hasGameData: boolean } | null>;
  concurrency: number;
} {
  const memCache = new Map<string, { card: GearItemCard; hasGameData: boolean } | null>();
  const nextProxy = createProxyPicker(deps.wikiProxies);

  async function findItem(name: string): Promise<{ card: GearItemCard; hasGameData: boolean } | null> {
    const key = name.toLowerCase();
    if (memCache.has(key)) return memCache.get(key) ?? null;

    const dbRow = await deps.getItemByName(key);
    if (dbRow) {
      if (dbRow.itemType === "NOT_FOUND") {
        memCache.set(key, null);
        return null;
      }
      const card = gearItemCardFromCache(key, dbRow.itemType, dbRow.data);
      const result = card ? { card, hasGameData: dbRow.hasGameData } : null;
      memCache.set(key, result);
      return result;
    }

    const proxy = nextProxy();
    const html = await fetchWiki({ q: name }, proxy);
    const results = parseSearchResults(html);
    const exact = results.find((r) => r.name.toLowerCase() === key);
    const hit = exact ?? results[0];
    if (!hit) {
      memCache.set(key, null);
      void deps.upsertItem(key, "NOT_FOUND", {}, false, false).catch(() => {});
      return null;
    }
    const cardHtml = await fetchWiki({ id: String(hit.id) }, proxy);
    const card = parseGearItemCard(cardHtml, hit.id);
    if (card) {
      const result = { card, hasGameData: false };
      memCache.set(key, result);
      void deps.upsertItem(key, card.itemType, gearItemCardToData(card), true, false).catch(() => {});
      return result;
    }
    memCache.set(key, null);
    return null;
  }

  return { findItem, concurrency: deps.wikiProxies.length > 0 ? deps.wikiProxies.length : 3 };
}

const MUD_SLOT_TO_WIKI: Record<string, string> = {
  "в правой руке": "правая рука",
  "в левой руке": "левая рука",
  "в обеих руках": "обе руки",
  "на теле": "туловище",
  "на голове": "голову",
  "на ногах": "ноги",
  "на ступнях": "ступни",
  "на кистях": "кисти",
  "на руках": "руки",
  "на плечах": "плечи",
  "на поясе": "пояс",
  "на запястьях": "запястья",
  "на правом запястье": "запястья",
  "на левом запястье": "запястья",
  "на шее": "шею",
  "на груди": "шею",
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

/**
 * Converts an item name to a MUD equip keyword.
 * Rules: split by spaces, drop words ≤3 chars, take first 4 chars of each remaining word,
 * join with ".".
 * Example: "кожанные штаны" → "кожа.штан"
 * Example: "обруч из серебра" → "обру.сере" (из — dropped, ≤3 chars)
 */
export function toEquipKeyword(name: string): string {
  const words = name
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .map((w) => w.slice(0, 4));
  if (words.length === 0) {
    // fallback: just take first 4 chars of first word
    return name.toLowerCase().trim().slice(0, 4);
  }
  return words.join(".");
}

/**
 * Returns MUD command to equip an item given wiki slot name and item name.
 */
export function getWearCommand(wikiSlot: string, itemName: string): string {
  const kw = toEquipKeyword(itemName);
  if (wikiSlot === "правая рука") return `вооруж ${kw}`;
  if (wikiSlot === "левая рука") return `держ ${kw}`;
  return `наде ${kw}`;
}

/**
 * Returns MUD command to unequip current item in a slot.
 */
export function getUnwearCommand(itemName: string): string {
  const kw = toEquipKeyword(itemName);
  return `снять ${kw}`;
}

// ─── core scan ───────────────────────────────────────────────────────────────

interface ListItem {
  name: string;
  price: number;
  listNumber: number;
  source: CandidateSource;
}

async function fetchShopItems(
  sendCommand: (cmd: string) => void,
  waitFor: (ms: number, re?: RegExp) => Promise<string>,
): Promise<ListItem[]> {
  const items: ListItem[] = [];
  sendCommand("спис");
  let pageText = await waitFor(SHOP_PAGE_TIMEOUT_MS, PAGER_RE);
  while (true) {
    for (const line of pageText.split("\n")) {
      const item = parseShopLine(line);
      if (item) items.push({ name: item.name, price: item.price, listNumber: item.shopNumber, source: "shop" });
    }
    if (END_OF_LIST_RE.test(pageText) || !PAGER_RE.test(pageText)) break;
    sendCommand("");
    pageText = await waitFor(SHOP_PAGE_TIMEOUT_MS, PAGER_RE);
  }
  return items;
}

async function fetchBazaarItems(
  sendCommand: (cmd: string) => void,
  waitFor: (ms: number, re?: RegExp) => Promise<string>,
  onProgress: (msg: string) => void,
  maxCoins: number,
): Promise<ListItem[]> {
  const items: ListItem[] = [];
  sendCommand("базар предложения все");
  let pageText = await waitFor(5000, BAZAAR_PAGER_RE);
  let pageCount = 0;
  while (true) {
    pageCount++;
    for (const line of pageText.split("\n")) {
      const item = parseBazaarLine(line);
      if (item && item.price <= maxCoins) {
        items.push({ name: item.name, price: item.price, listNumber: item.lotNumber, source: "bazaar" });
      }
    }
    if (pageCount % 10 === 0) onProgress(`Базар: страница ${pageCount}, найдено ${items.length}...`);
    if (BAZAAR_END_RE.test(pageText)) break;
    if (!BAZAAR_PAGER_RE.test(pageText)) break;
    sendCommand("");
    pageText = await waitFor(5000, BAZAAR_PAGER_RE);
  }
  return items;
}

const INVENTORY_START_RE = /^Вы несете:/;
// Inventory item line: name at start, followed by spaces/ANSI/condition/count suffix
// We capture everything before the first two-space gap or end-of-line
const INVENTORY_ITEM_RE = /^([^\[]+?)(?:\s{2,}|\[|\s*$)/;

async function fetchInventoryItems(
  sendCommand: (cmd: string) => void,
  waitFor: (ms: number, re?: RegExp) => Promise<string>,
): Promise<ListItem[]> {
  const items: ListItem[] = [];
  sendCommand("инв");
  const text = await waitFor(3000);
  let inInventory = false;
  for (const line of text.split("\n")) {
    const stripped = line.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "").trim();
    if (INVENTORY_START_RE.test(stripped)) {
      inInventory = true;
      continue;
    }
    if (!inInventory) continue;
    if (stripped === "" || stripped.startsWith(">") || /^\d+H\s/.test(stripped)) break;
    const m = INVENTORY_ITEM_RE.exec(stripped);
    if (m) {
      const name = m[1].trim().replace(/\s*\*.*$/, "");
      if (name) items.push({ name, price: 0, listNumber: 0, source: "inventory" });
    }
  }
  return items;
}

type CandidateEntry = { item: ListItem; card: GearItemCard; hasGameData: boolean };

function buildSlotResults(
  allCandidates: CandidateEntry[],
  equipped: Map<string, string[]>,
  currentBySlot: Map<string, GearItemCard>,
  charStats: CharStats,
  cfg: CharacterConfig,
): CompareSlotResult[] {
  // Group candidates by slot
  const bySlot = new Map<string, CandidateEntry[]>();
  const rightWeaponCands: CandidateEntry[] = [];
  const leftWeaponCands: CandidateEntry[] = [];
  const twoHandedCands: CandidateEntry[] = [];
  const ringCands: CandidateEntry[] = [];
  const wristCands: CandidateEntry[] = [];
  const neckCands: CandidateEntry[] = [];

  for (const entry of allCandidates) {
    const { card } = entry;
    if (card.itemType === "ОРУЖИЕ") {
      if (card.canWearRight && meetsReqs(card.rightHandReqs, charStats)) rightWeaponCands.push(entry);
      if (card.canWearLeft && meetsReqs(card.leftHandReqs, charStats)) leftWeaponCands.push(entry);
      if (card.canWearBoth && meetsReqs(card.bothHandReqs, charStats)) twoHandedCands.push(entry);
    } else {
      if (!meetsReqs(card.wearReqs, charStats)) continue;
      for (const slot of card.wearSlots) {
        if (slot === "палец") {
          ringCands.push(entry);
        } else if (slot === "запястья") {
          wristCands.push(entry);
        } else if (slot === "шею") {
          neckCands.push(entry);
        } else {
          if (!bySlot.has(slot)) bySlot.set(slot, []);
          bySlot.get(slot)!.push(entry);
        }
      }
    }
  }

  function topN(
    cands: CandidateEntry[],
    scoreFn: (c: GearItemCard) => number,
  ): CompareCandidate[] {
    return cands
      .map((e) => ({ ...e, score: scoreFn(e.card) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N)
      .map((e) => ({
        itemId: e.card.id,
        itemName: e.card.name,
        price: e.item.price,
        listNumber: e.item.listNumber,
        score: e.score,
        source: e.item.source,
        card: e.card,
        hasGameData: e.hasGameData,
      }));
  }

  const results: CompareSlotResult[] = [];

  // Determine all equipped slots to show
  const allEquippedSlots = new Set<string>();
  for (const [mudSlot] of equipped.entries()) {
    const wikiSlot = MUD_SLOT_TO_WIKI[mudSlot.toLowerCase()] ?? mudSlot.toLowerCase();
    allEquippedSlots.add(wikiSlot);
  }
  // Also add slots with candidates
  for (const slot of bySlot.keys()) allEquippedSlots.add(slot);
  if (rightWeaponCands.length > 0 || currentBySlot.has("правая рука")) allEquippedSlots.add("правая рука");
  if (leftWeaponCands.length > 0 || currentBySlot.has("левая рука")) allEquippedSlots.add("левая рука");
  if (twoHandedCands.length > 0 || currentBySlot.has("обе руки")) allEquippedSlots.add("обе руки");
  allEquippedSlots.add("палец 1");
  allEquippedSlots.add("палец 2");
  allEquippedSlots.add("запястье 1");
  allEquippedSlots.add("запястье 2");
  allEquippedSlots.add("шея 1");
  allEquippedSlots.add("шея 2");

  // Get equipped rings/wrists/neck for current
  const equippedRingNames: string[] = [];
  const equippedWristNames: string[] = [];
  const equippedNeckNames: string[] = [];
  for (const [mudSlot, names] of equipped.entries()) {
    const normalized = mudSlot.toLowerCase();
    const wikiSlot = MUD_SLOT_TO_WIKI[normalized] ?? normalized;
    if (wikiSlot === "палец" || normalized === "на пальце") equippedRingNames.push(...names);
    if (normalized === "на правом запястье" || normalized === "на левом запястье" || normalized === "на запястьях") {
      equippedWristNames.push(...names);
    }
    if (normalized === "на шее" || normalized === "на груди") {
      equippedNeckNames.push(...names);
    }
  }

  // Weapon slots
  if (allEquippedSlots.has("правая рука")) {
    const current = currentBySlot.get("правая рука") ?? null;
    results.push({
      slot: "правая рука",
      currentItemName: current?.name ?? (equipped.get("в правой руке")?.[0] ?? null),
      currentCard: current,
      currentScore: current ? weaponScore(current, "right", cfg) : 0,
      candidates: topN(rightWeaponCands, (c) => weaponScore(c, "right", cfg)),
    });
  }
  if (allEquippedSlots.has("левая рука")) {
    const current = currentBySlot.get("левая рука") ?? null;
    results.push({
      slot: "левая рука",
      currentItemName: current?.name ?? (equipped.get("в левой руке")?.[0] ?? null),
      currentCard: current,
      currentScore: current ? weaponScore(current, "left", cfg) : 0,
      candidates: topN(leftWeaponCands, (c) => weaponScore(c, "left", cfg)),
    });
  }
  if (allEquippedSlots.has("обе руки")) {
    const current = currentBySlot.get("обе руки") ?? null;
    results.push({
      slot: "обе руки",
      currentItemName: current?.name ?? null,
      currentCard: current,
      currentScore: current ? weaponScore(current, "both", cfg) : 0,
      candidates: topN(twoHandedCands, (c) => weaponScore(c, "both", cfg)),
    });
  }

  // Armor slots
  const processedSlots = new Set(["правая рука", "левая рука", "обе руки", "палец", "запястья", "шею"]);
  for (const [slot, cands] of bySlot.entries()) {
    if (processedSlots.has(slot)) continue;
    const current = currentBySlot.get(slot) ?? null;
    results.push({
      slot,
      currentItemName: current?.name ?? null,
      currentCard: current,
      currentScore: current ? armorScore(current, cfg) : 0,
      candidates: topN(cands, (c) => armorScore(c, cfg)),
    });
    processedSlots.add(slot);
  }

  // Equipped slots with no candidates
  for (const [mudSlot, names] of equipped.entries()) {
    const wikiSlot = MUD_SLOT_TO_WIKI[mudSlot.toLowerCase()] ?? mudSlot.toLowerCase();
    if (processedSlots.has(wikiSlot)) continue;
    if (wikiSlot === "палец") continue;
    const normalized = mudSlot.toLowerCase();
    if (normalized === "на правом запястье" || normalized === "на левом запястье" || normalized === "на запястьях") continue;
    if (normalized === "на шее" || normalized === "на груди") continue;
    const current = currentBySlot.get(wikiSlot) ?? null;
    results.push({
      slot: wikiSlot,
      currentItemName: current?.name ?? names[0] ?? null,
      currentCard: current,
      currentScore: current ? armorScore(current, cfg) : 0,
      candidates: [],
    });
    processedSlots.add(wikiSlot);
  }

  // Rings
  const chosenRingIds = new Set<number>();
  for (let i = 0; i < 2; i++) {
    const subSlot = `палец ${i + 1}`;
    const currentName = equippedRingNames[i] ?? null;
    const currentCard = currentBySlot.get(subSlot) ?? null;
    const available = ringCands.filter((c) => !chosenRingIds.has(c.card.id));
    const top = topN(available, (c) => armorScore(c, cfg));
    if (top.length > 0) chosenRingIds.add(top[0]!.itemId);
    results.push({
      slot: subSlot,
      currentItemName: currentCard?.name ?? currentName,
      currentCard: currentCard ?? null,
      currentScore: currentCard ? armorScore(currentCard, cfg) : 0,
      candidates: top,
    });
  }

  // Wristbands
  const chosenWristIds = new Set<number>();
  for (let i = 0; i < 2; i++) {
    const subSlot = `запястье ${i + 1}`;
    const currentName = equippedWristNames[i] ?? null;
    const currentCard = currentBySlot.get(subSlot) ?? null;
    const available = wristCands.filter((c) => !chosenWristIds.has(c.card.id));
    const top = topN(available, (c) => armorScore(c, cfg));
    if (top.length > 0) chosenWristIds.add(top[0]!.itemId);
    results.push({
      slot: subSlot,
      currentItemName: currentCard?.name ?? currentName,
      currentCard: currentCard ?? null,
      currentScore: currentCard ? armorScore(currentCard, cfg) : 0,
      candidates: top,
    });
  }

  // Neck slots (шея = шея 1, грудь = шея 2)
  const chosenNeckIds = new Set<number>();
  for (let i = 0; i < 2; i++) {
    const subSlot = `шея ${i + 1}`;
    const currentName = equippedNeckNames[i] ?? null;
    const currentCard = currentBySlot.get(subSlot) ?? null;
    const available = neckCands.filter((c) => !chosenNeckIds.has(c.card.id));
    const top = topN(available, (c) => armorScore(c, cfg));
    if (top.length > 0) chosenNeckIds.add(top[0]!.itemId);
    results.push({
      slot: subSlot,
      currentItemName: currentCard?.name ?? currentName,
      currentCard: currentCard ?? null,
      currentScore: currentCard ? armorScore(currentCard, cfg) : 0,
      candidates: top,
    });
  }

  return results;
}

// ─── public API ──────────────────────────────────────────────────────────────

export async function runCompareScan(
  deps: GearScanDeps,
): Promise<CompareScanResult> {
  const { sendCommand, onProgress, registerTextHandler, unregisterTextHandler } = deps;
  const { findItem, concurrency } = makeItemFinder(deps);
  const waiter = createOutputWaiter();
  registerTextHandler(waiter.feed);

  try {
    onProgress("Запрашиваю экипировку...");
    sendCommand("экип");
    const equipText = await waiter.waitFor(COMPARE_SCAN_TIMEOUT_MS);

    onProgress("Запрашиваю уровень и деньги...");
    sendCommand("уров");
    const levelText = await waiter.waitFor(COMPARE_SCAN_TIMEOUT_MS);

    const coins = parseCoins(levelText);
    const cfg = selectConfig(levelText, ALL_CONFIGS, thiefConfig);
    const charStats = parseCharStats(levelText);
    onProgress(`Монет: ${coins}. Профиль: ${cfg.id}.`);

    // Parse equipped
    const equipped = new Map<string, string[]>();
    for (const line of equipText.split("\n")) {
      const parsed = parseEquipLine(line);
      if (parsed) {
        const existing = equipped.get(parsed.slot);
        if (existing) existing.push(parsed.itemName);
        else equipped.set(parsed.slot, [parsed.itemName]);
      }
    }

    onProgress("Пробую магазин...");
    const shopItems = await fetchShopItems(sendCommand, (ms, re) => waiter.waitFor(ms, re));
    const hasShop = shopItems.length > 0;
    if (hasShop) {
      onProgress(`Магазин: ${shopItems.length} предметов. Листаю базар...`);
    } else {
      onProgress("Магазин пуст. Листаю базар...");
    }
    const bazaarItems = await fetchBazaarItems(sendCommand, (ms, re) => waiter.waitFor(ms, re), onProgress, coins);
    onProgress(`Базар: ${bazaarItems.length} лотов по деньгам. Проверяю инвентарь...`);

    const inventoryItems = await fetchInventoryItems(sendCommand, (ms, re) => waiter.waitFor(ms, re));
    onProgress(`Инвентарь: ${inventoryItems.length} предметов.`);

    const equippedNames = new Set<string>(
      [...equipped.values()].flat().map((n) => n.toLowerCase()),
    );

    const allItems = [...shopItems, ...bazaarItems, ...inventoryItems];

    const cheapestByKey = new Map<string, ListItem>();
    for (const item of allItems) {
      if (equippedNames.has(item.name.toLowerCase())) continue;
      const key = `${item.source}:${item.name.toLowerCase()}`;
      const ex = cheapestByKey.get(key);
      if (!ex || item.price < ex.price) cheapestByKey.set(key, item);
    }
    const uniqueItems = [...cheapestByKey.values()];
    onProgress(`Уникальных предметов: ${uniqueItems.length}. Ищу в вики...`);

    // Fetch wiki cards
    const cards = await withThrottle(
      uniqueItems.map((item) => async () => {
        try {
          const result = await findItem(item.name);
          return result ? { item, card: result.card, hasGameData: result.hasGameData } : null;
        } catch {
          return null;
        }
      }),
      concurrency,
    );
    const validCandidates = cards.filter(
      (x): x is CandidateEntry => x !== null,
    );
    onProgress(`Найдено в вики: ${validCandidates.length}.`);

    // Fetch current equipped cards
    const equippedEntries = [...equipped.entries()].flatMap(([slot, names]) =>
      names.map((name) => ({ slot, name })),
    );
    const currentCardResults = await withThrottle(
      equippedEntries.map((e) => async () => {
        try {
          const result = await findItem(e.name);
          return result ? { slot: e.slot, card: result.card } : null;
        } catch {
          return null;
        }
      }),
      concurrency,
    );
    const currentBySlot = new Map<string, GearItemCard>();
    const slotCounts = new Map<string, number>();
    const MULTI_SLOTS = new Set(["палец", "запястья", "шею"]);
    for (const r of currentCardResults) {
      if (!r) continue;
      const wikiSlot = MUD_SLOT_TO_WIKI[r.slot.toLowerCase()] ?? r.slot.toLowerCase();
      const count = (slotCounts.get(wikiSlot) ?? 0) + 1;
      slotCounts.set(wikiSlot, count);
      if (MULTI_SLOTS.has(wikiSlot)) {
        const subSlotBase = wikiSlot === "запястья" ? "запястье" : wikiSlot === "шею" ? "шея" : "палец";
        currentBySlot.set(`${subSlotBase} ${count}`, r.card);
      } else {
        currentBySlot.set(wikiSlot, r.card);
      }
    }

    const slots = buildSlotResults(
      validCandidates,
      equipped,
      currentBySlot,
      charStats,
      cfg,
    );

    onProgress("Готово.");
    return { hasShop, coins, slots };
  } finally {
    unregisterTextHandler(waiter.feed);
    waiter.cancel();
  }
}
