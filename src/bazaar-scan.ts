import type { GearScanDeps, GearScanResult, GearScanRow } from "./gear-scan.ts";
import {
  fetchWiki,
  parseSearchResults,
  parseGearItemCard,
  gearItemCardToData,
  gearItemCardFromCache,
  createProxyPicker,
} from "./wiki.ts";
import type { GearItemCard, StatRequirement, StatName } from "./wiki.ts";
import { selectProfile } from "./gear-profile.ts";
import type { GearProfile } from "./gear-profile.ts";

const BAZAAR_PAGE_TIMEOUT_MS = 5000;
const GEAR_SCAN_TIMEOUT_MS = 4000;
const STRIP_ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const STRIP_CR = /\r/g;
const PROMPT_RE = /\d+H\s+\d+M\b/;

// Format: [ 125]   покрытый пылью свиток                           5000  плоховато
const BAZAAR_LINE_RE = /^\s*\[\s*(\d+)\]\s+(.+?)\s{2,}(\d+)\s+\S+\s*$/;
const BAZAAR_PAGER_RE = /Листать\s*:/i;
const BAZAAR_END_RE = /список\s+пуст|нет\s+предметов|нет\s+лотов/i;

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

/**
 * Суммирует все деньги персонажа: в руках + в лежне (банке).
 * "У вас на руках 525 кун и 0 гривен (и еще 4550 кун припрятано в лежне)."
 */
function parseTotalCoins(text: string): number {
  const handM = /у вас на руках\s+(\d+)\s+кун/i.exec(text);
  const inHand = handM ? parseInt(handM[1]) : 0;
  // 1 гривна = 10 кун
  const grivnaM = /у вас на руках\s+\d+\s+кун\s+и\s+(\d+)\s+гривен/i.exec(text);
  const inHandGrivna = grivnaM ? parseInt(grivnaM[1]) * 10 : 0;
  const bankM = /ещё\s+(\d+)\s+кун\s+припрятано|еще\s+(\d+)\s+кун\s+припрятано/i.exec(text);
  const inBank = bankM ? parseInt(bankM[1] ?? bankM[2]) : 0;

  return inHand + inHandGrivna + inBank;
}

function parseBazaarLine(line: string): { lotNumber: number; name: string; price: number } | null {
  const m = BAZAAR_LINE_RE.exec(line);
  if (m) return { lotNumber: parseInt(m[1]), name: m[2].trim(), price: parseInt(m[3]) };
  return null;
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

function weaponScore(item: GearItemCard, hand: "right" | "left" | "both", profile: GearProfile): number {
  if (!item.weaponClass) return -1000;
  if (profile.rejectShiny && item.isShiny) return -500;
  if (hand === "both") {
    if (!profile.twoHandedWeaponClasses.includes(item.weaponClass)) return -1000;
  } else {
    const wantClass = hand === "right" ? profile.rightWeaponClass : profile.leftWeaponClass;
    if (item.weaponClass !== wantClass) return -1000;
  }

  let score = item.damageAvg * profile.damageAvgWeight;

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

export async function runBazaarScan(deps: GearScanDeps): Promise<GearScanResult> {
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

    const coins = parseTotalCoins(levelText);
    const profile = selectProfile(levelText);
    const charStats = parseCharStats(levelText);
    onProgress(
      `Всего монет: ${coins} (в руках + в лежне). Профиль: ${profile.id}. ` +
      `Сила: ${charStats["сила"] ?? "?"}, Подв: ${charStats["ловкость"] ?? "?"}, Реморты: ${charStats.remorts ?? 0}`
    );

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

    onProgress("Листаю базар (базар предложения все)...");
    const bazaarItems: Array<{ name: string; price: number; lotNumber: number }> = [];
    sendCommand("базар предложения все");
    let pageText = await waiter.waitFor(BAZAAR_PAGE_TIMEOUT_MS, BAZAAR_PAGER_RE);
    let pageCount = 0;

    while (true) {
      pageCount++;
      for (const line of pageText.split("\n")) {
        const item = parseBazaarLine(line);
        if (item) bazaarItems.push(item);
      }
      if (pageCount % 10 === 0) {
        onProgress(`Страница ${pageCount}, найдено ${bazaarItems.length} лотов...`);
      }
      if (BAZAAR_END_RE.test(pageText)) break;
      if (!BAZAAR_PAGER_RE.test(pageText)) break;
      sendCommand("");
      pageText = await waiter.waitFor(BAZAAR_PAGE_TIMEOUT_MS, BAZAAR_PAGER_RE);
    }

    onProgress(`Всего лотов на базаре: ${bazaarItems.length}. Фильтрую по деньгам (до ${coins} кун)...`);

    const affordableItems = bazaarItems.filter((item) => item.price <= coins);

    const cheapestByName = new Map<string, { name: string; price: number; lotNumber: number }>();
    for (const item of affordableItems) {
      const key = item.name.toLowerCase();
      const existing = cheapestByName.get(key);
      if (!existing || item.price < existing.price) {
        cheapestByName.set(key, item);
      }
    }

    const uniqueAffordable = [...cheapestByName.values()];
    onProgress(
      `Доступно по деньгам: ${affordableItems.length} лотов (${uniqueAffordable.length} уникальных названий). ` +
      `Ищу в вики...`
    );

    const bazaarCards = await withThrottle(
      uniqueAffordable.map((s) => async () => {
        try {
          const card = await findItem(s.name);
          if (!card) onProgress(`[DEBUG] bazaar: "${s.name}" → не найден на вики`);
          return card
            ? { card, price: s.price, lotNumber: s.lotNumber, source: "bazaar" as const }
            : null;
        } catch {
          onProgress(`[DEBUG] bazaar: "${s.name}" → ошибка wiki`);
          return null;
        }
      }),
      concurrency,
    );

    const validBazaar = bazaarCards.filter(
      (x): x is { card: GearItemCard; price: number; lotNumber: number; source: "bazaar" } =>
        x !== null,
    );
    onProgress(
      `[DEBUG] bazaar valid: ${
        validBazaar
          .map((x) => `"${x.card.name}"(${x.card.wearSlots.join("/") || x.card.itemType})`)
          .join(", ") || "(нет)"
      }`
    );

    const currentCards = await withThrottle(
      [...equipped.entries()].flatMap(([slot, names]) =>
        names.map((name) => async () => {
          try {
            const card = await findItem(name);
            return card ? { slot, card } : null;
          } catch {
            return null;
          }
        })
      ),
      concurrency,
    );
    const validCurrent = currentCards.filter(
      (x): x is { slot: string; card: GearItemCard } => x !== null,
    );

    type Candidate = {
      card: GearItemCard;
      price: number;
      lotNumber?: number;
      source: "bazaar";
    };

    const allCandidates: Candidate[] = validBazaar;

    const candidateBySlot = new Map<string, Candidate[]>();
    const rightWeapons: Candidate[] = [];
    const leftWeapons: Candidate[] = [];
    const twoHandedWeapons: Candidate[] = [];
    const rings: Candidate[] = [];
    const wristbands: Candidate[] = [];

    for (const entry of allCandidates) {
      if (entry.card.remorts > (charStats.remorts ?? 0)) continue;
      if (entry.card.itemType === "ОРУЖИЕ") {
        if (entry.card.canWearRight && meetsReqs(entry.card.rightHandReqs, charStats))
          rightWeapons.push(entry);
        if (entry.card.canWearLeft && meetsReqs(entry.card.leftHandReqs, charStats))
          leftWeapons.push(entry);
        if (entry.card.canWearBoth && meetsReqs(entry.card.bothHandReqs, charStats))
          twoHandedWeapons.push(entry);
      } else {
        if (!meetsReqs(entry.card.wearReqs, charStats)) continue;
        for (const slot of entry.card.wearSlots) {
          if (slot === "палец") {
            rings.push(entry);
          } else if (slot === "запястья") {
            wristbands.push(entry);
          } else {
            if (!candidateBySlot.has(slot)) candidateBySlot.set(slot, []);
            candidateBySlot.get(slot)!.push(entry);
          }
        }
      }
    }

    const currentBySlot = new Map<string, GearItemCard>();
    for (const { slot: mudSlot, card } of validCurrent) {
      const wikiSlot = MUD_SLOT_TO_WIKI[mudSlot.toLowerCase()] ?? mudSlot.toLowerCase();
      currentBySlot.set(wikiSlot, card);
    }

    const currentRightWeapon: GearItemCard | undefined = currentBySlot.get("правая рука");
    const currentLeftWeapon: GearItemCard | undefined = currentBySlot.get("левая рука");
    const currentTwoHandedWeapon: GearItemCard | undefined = currentBySlot.get("обе руки");

    const currentRings: GearItemCard[] = [];
    for (const [mudSlot, names] of equipped.entries()) {
      if (
        MUD_SLOT_TO_WIKI[mudSlot.toLowerCase()] === "палец" ||
        mudSlot.toLowerCase() === "палец"
      ) {
        for (const name of names) {
          const found = validCurrent.find((c) => c.card.name === name || c.slot === mudSlot);
          if (found) currentRings.push(found.card);
        }
      }
    }

    const currentWristbands: GearItemCard[] = [];
    for (const [mudSlot, names] of equipped.entries()) {
      const normalized = mudSlot.toLowerCase();
      if (
        normalized === "на правом запястье" ||
        normalized === "на левом запястье" ||
        normalized === "на запястьях"
      ) {
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
      return best && bestScore > 0 ? best : null;
    }

    const rows: GearScanRow[] = [];

    if (rightWeapons.length > 0) {
      const scored = rightWeapons
        .map((c) => ({ name: c.card.name, score: weaponScore(c.card, "right", profile), dmg: c.card.damageAvg, metal: c.card.isMetal, props: c.card.properties.join("; ") }))
        .sort((a, b) => b.score - a.score);
      onProgress(`[DEBUG] правая рука (${scored.length} кандидатов): ` +
        scored.map((x) => `"${x.name}" score=${x.score.toFixed(1)} dmg=${x.dmg} metal=${x.metal} props=[${x.props}]`).join(" | "));
      if (currentRightWeapon) {
        const cs = weaponScore(currentRightWeapon, "right", profile);
        onProgress(`[DEBUG] текущее в правой: "${currentRightWeapon.name}" score=${cs.toFixed(1)} dmg=${currentRightWeapon.damageAvg} metal=${currentRightWeapon.isMetal}`);
      }
    } else {
      onProgress(`[DEBUG] правая рука: нет кандидатов на базаре`);
      if (currentRightWeapon) {
        const cs = weaponScore(currentRightWeapon, "right", profile);
        onProgress(`[DEBUG] текущее в правой: "${currentRightWeapon.name}" score=${cs.toFixed(1)} dmg=${currentRightWeapon.damageAvg} metal=${currentRightWeapon.isMetal}`);
      }
    }

    if (leftWeapons.length > 0) {
      const scored = leftWeapons
        .map((c) => ({ name: c.card.name, score: weaponScore(c.card, "left", profile), dmg: c.card.damageAvg, metal: c.card.isMetal, props: c.card.properties.join("; ") }))
        .sort((a, b) => b.score - a.score);
      onProgress(`[DEBUG] левая рука (${scored.length} кандидатов): ` +
        scored.map((x) => `"${x.name}" score=${x.score.toFixed(1)} dmg=${x.dmg} metal=${x.metal} props=[${x.props}]`).join(" | "));
      if (currentLeftWeapon) {
        const cs = weaponScore(currentLeftWeapon, "left", profile);
        onProgress(`[DEBUG] текущее в левой: "${currentLeftWeapon.name}" score=${cs.toFixed(1)} dmg=${currentLeftWeapon.damageAvg} metal=${currentLeftWeapon.isMetal}`);
      }
    } else {
      onProgress(`[DEBUG] левая рука: нет кандидатов на базаре`);
    }

    const twoHandedBest = bestCandidate(twoHandedWeapons, (c) => weaponScore(c, "both", profile));
    const twoHandedScore = twoHandedBest ? weaponScore(twoHandedBest.card, "both", profile) : -Infinity;
    const currentTwoHandedScore = currentTwoHandedWeapon ? weaponScore(currentTwoHandedWeapon, "both", profile) : -Infinity;
    const currentOneHandCombinedScore =
      (currentRightWeapon ? weaponScore(currentRightWeapon, "right", profile) : 0) +
      (currentLeftWeapon ? weaponScore(currentLeftWeapon, "left", profile) : 0);
    const useTwoHanded =
      twoHandedBest !== null &&
      twoHandedScore > 0 &&
      twoHandedScore > currentTwoHandedScore &&
      twoHandedScore > currentOneHandCombinedScore;

    if (useTwoHanded && twoHandedBest) {
      rows.push({
        slot: "обе руки",
        action: "buy",
        itemName: twoHandedBest.card.name,
        price: twoHandedBest.price,
        shopNumber: twoHandedBest.lotNumber,
        canAfford: true,
        source: "bazaar" as const,
        damageDice: twoHandedBest.card.damageDice ?? undefined,
        damageAvg: twoHandedBest.card.damageAvg || undefined,
        currentItemName: currentTwoHandedWeapon?.name ?? currentRightWeapon?.name,
        currentDamageDice: currentTwoHandedWeapon?.damageDice ?? currentRightWeapon?.damageDice ?? undefined,
        currentDamageAvg: currentTwoHandedWeapon?.damageAvg || currentRightWeapon?.damageAvg || undefined,
      });
    } else {

    const rightBest = bestCandidate(rightWeapons, (c) => weaponScore(c, "right", profile));
    if (rightBest) {
      const currentScore = currentRightWeapon
        ? weaponScore(currentRightWeapon, "right", profile)
        : -Infinity;
      const shopScore = weaponScore(rightBest.card, "right", profile);
      if (shopScore > currentScore) {
        rows.push({
          slot: "правая рука",
          action: "buy",
          itemName: rightBest.card.name,
          price: rightBest.price,
          shopNumber: rightBest.lotNumber,
          canAfford: true, // все предметы уже отфильтрованы по деньгам
          source: "bazaar" as const,
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

    const leftBest = bestCandidate(leftWeapons, (c) => weaponScore(c, "left", profile));
    if (leftBest) {
      const currentScore = currentLeftWeapon
        ? weaponScore(currentLeftWeapon, "left", profile)
        : -Infinity;
      const shopScore = weaponScore(leftBest.card, "left", profile);
      if (shopScore > currentScore) {
        rows.push({
          slot: "левая рука",
          action: "buy",
          itemName: leftBest.card.name,
          price: leftBest.price,
          shopNumber: leftBest.lotNumber,
          canAfford: true,
          source: "bazaar" as const,
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

    }

    const chosenRingIds = new Set<number>();
    for (let i = 0; i < 2; i++) {
      const subSlot = `палец ${i + 1}`;
      const remaining = rings.filter((c) => !chosenRingIds.has(c.card.id));
      const best = bestCandidate(remaining, (c) => armorScore(c, profile));
      if (!best) continue;
      const currentRing = currentRings[i];
      const currentScore = currentRing ? armorScore(currentRing, profile) : -Infinity;
      const shopScore = armorScore(best.card, profile);
      chosenRingIds.add(best.card.id);
      if (shopScore > currentScore) {
        rows.push({
          slot: subSlot,
          action: "buy",
          itemName: best.card.name,
          price: best.price,
          shopNumber: best.lotNumber,
          canAfford: true,
          source: "bazaar" as const,
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

    const chosenWristIds = new Set<number>();
    for (let i = 0; i < 2; i++) {
      const subSlot = `запястье ${i + 1}`;
      const remaining = wristbands.filter((c) => !chosenWristIds.has(c.card.id));
      const best = bestCandidate(remaining, (c) => armorScore(c, profile));
      if (!best) continue;
      const currentWristband = currentWristbands[i];
      const currentScore = currentWristband ? armorScore(currentWristband, profile) : -Infinity;
      const shopScore = armorScore(best.card, profile);
      chosenWristIds.add(best.card.id);
      if (shopScore > currentScore) {
        rows.push({
          slot: subSlot,
          action: "buy",
          itemName: best.card.name,
          price: best.price,
          shopNumber: best.lotNumber,
          canAfford: true,
          source: "bazaar" as const,
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

    for (const [slot, candidates] of candidateBySlot.entries()) {
      const best = bestCandidate(candidates, (c) => armorScore(c, profile));
      if (!best) continue;
      const currentCard = currentBySlot.get(slot);
      const currentScore = currentCard ? armorScore(currentCard, profile) : -Infinity;
      const shopScore = armorScore(best.card, profile);
      if (shopScore > currentScore) {
        rows.push({
          slot,
          action: "buy",
          itemName: best.card.name,
          price: best.price,
          shopNumber: best.lotNumber,
          canAfford: true,
          source: "bazaar" as const,
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
      if (
        normalized === "на правом запястье" ||
        normalized === "на левом запястье" ||
        normalized === "на запястьях"
      )
        continue;
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
      .filter(
        ([s]) =>
          MUD_SLOT_TO_WIKI[s.toLowerCase()] === "палец" ||
          s.toLowerCase() === "палец" ||
          s.toLowerCase() === "на пальце",
      )
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
        rows.push({
          slot: subSlot,
          action: "no_upgrade",
          currentItemName: equippedWristbands[i],
        });
      }
    }

    onProgress("Готово.");
    return { coins, rows, sellItems: [] };
  } finally {
    unregisterHandler(waiter.feed);
    waiter.cancel();
  }
}
