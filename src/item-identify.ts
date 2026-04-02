import type { GameItem } from "./events.type.ts";
import { fetchWiki, parseSearchResults, parseGearItemCard, gearItemCardToData, parseMudIdentifyBlock, mergeItemSources, gearItemCardFromCache } from "./wiki.ts";

const ITEM_IDENTIFY_START = /Вы узнали следующее:/;
const ITEM_BUFFER_MAX = 4096;

export interface ItemIdentifierDeps {
  getItemByName(name: string): Promise<GameItem | null>;
  upsertItem(name: string, itemType: string, data: Record<string, unknown>, hasWikiData: boolean, hasGameData: boolean): Promise<void>;
  wikiProxies: string[];
}

export function createItemIdentifier(deps: ItemIdentifierDeps) {
  let itemBuffer = "";

  async function handleChunk(chunk: string): Promise<void> {
    itemBuffer += chunk;
    if (itemBuffer.length > ITEM_BUFFER_MAX) {
      itemBuffer = itemBuffer.slice(-ITEM_BUFFER_MAX);
    }

    if (!ITEM_IDENTIFY_START.test(itemBuffer)) return;

    const startIdx = itemBuffer.search(ITEM_IDENTIFY_START);
    const afterStart = itemBuffer.slice(startIdx);

    const endMatch = /\n(?=\S*\d+H\s|\S*Вых:|\s*$)/.exec(afterStart.slice(afterStart.indexOf("\n") + 1));
    if (!endMatch && itemBuffer.length < ITEM_BUFFER_MAX) return;

    const block = endMatch
      ? afterStart.slice(0, afterStart.indexOf("\n") + 1 + endMatch.index + 1)
      : afterStart;

    itemBuffer = itemBuffer.slice(startIdx + block.length);

    const mudParsed = parseMudIdentifyBlock(block);
    if (!mudParsed) return;

    const nameLower = mudParsed.name.toLowerCase();

    const existing = await deps.getItemByName(nameLower);
    const baseCard = existing
      ? gearItemCardFromCache(existing.name, existing.itemType, existing.data as Record<string, unknown>)
      : null;

    let wikiCard = null;
    try {
      const proxy = deps.wikiProxies[0];
      const searchHtml = await fetchWiki({ q: mudParsed.name }, proxy);
      const results = parseSearchResults(searchHtml);
      const hit = results.find(r => r.name.toLowerCase() === nameLower) ?? results[0] ?? null;
      if (hit) {
        const cardHtml = await fetchWiki({ id: String(hit.id) }, proxy);
        wikiCard = parseGearItemCard(cardHtml, hit.id);
      }
    } catch {
    }

    const merged = mergeItemSources(baseCard, wikiCard, mudParsed.partial, mudParsed.name, mudParsed.itemType);
    if (!merged) return;

    await deps.upsertItem(nameLower, mudParsed.itemType, gearItemCardToData(merged), wikiCard !== null, true);
  }

  return { handleChunk };
}
