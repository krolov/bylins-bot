// ---------------------------------------------------------------------------
// Market-line parsing: bazaar and auction sales from MUD output.
//
// The MUD broadcasts sale events on the global bazaar/auction channel.
// We match three shapes and emit ParsedMarketSale records so the server
// can persist them via mapStore.saveMarketSale.
// ---------------------------------------------------------------------------

import { ANSI_ESCAPE_RE } from "./constants.ts";

// "Базар : лот 76(белый камушек) продан за 45000 кун."
const BAZAAR_SALE_RE = /Базар\s*:\s*лот\s+(\d+)\(([^)]+)\)\s+продан\S*\s+за\s+(\d+)\s+кун/;
// "Базар : лот 14(дымчатый ...) продан. 1000 кун переведено на ваш счет." (our sale)
const BAZAAR_OUR_SALE_RE = /Базар\s*:\s*лот\s+(\d+)\(([^)]+)\)\s+продан[^.]*\.\s+(\d+)\s+кун\s+переведено\s+на\s+ваш\s+счет/;
// "Аукцион : лот 0(царская книга знаний) продан с аукциона за 12312 кун"
const AUCTION_SALE_RE = /Аукцион\s*:\s*лот\s+(\d+)\(([^)]+)\)\s+продан\S*\s+с\s+аукциона\s+за\s+(\d+)\s+кун/;

export interface ParsedMarketSale {
  source: "bazaar" | "auction";
  lotNumber: number | null;
  itemName: string;
  price: number;
  isOurs: boolean;
}

export function extractMarketSales(mudText: string): ParsedMarketSale[] {
  const stripped = mudText.replace(ANSI_ESCAPE_RE, "").replace(/\r/g, "");
  const lines = stripped.split("\n");
  const result: ParsedMarketSale[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const bazaarOurs = BAZAAR_OUR_SALE_RE.exec(trimmed);
    if (bazaarOurs) {
      result.push({
        source: "bazaar",
        lotNumber: Number(bazaarOurs[1]),
        itemName: bazaarOurs[2].trim(),
        price: Number(bazaarOurs[3]),
        isOurs: true,
      });
      continue;
    }
    const bazaar = BAZAAR_SALE_RE.exec(trimmed);
    if (bazaar) {
      result.push({
        source: "bazaar",
        lotNumber: Number(bazaar[1]),
        itemName: bazaar[2].trim(),
        price: Number(bazaar[3]),
        isOurs: false,
      });
      continue;
    }
    const auction = AUCTION_SALE_RE.exec(trimmed);
    if (auction) {
      result.push({
        source: "auction",
        lotNumber: Number(auction[1]),
        itemName: auction[2].trim(),
        price: Number(auction[3]),
        isOurs: false,
      });
    }
  }
  return result;
}
