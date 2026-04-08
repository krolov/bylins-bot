import { createReadStream, existsSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { sql } from "../src/db.ts";

const BAZAAR_SALE_RE = /Базар\s*:\s*лот\s+(\d+)\(([^)]+)\)\s+продан\S*\s+за\s+(\d+)\s+кун/;
const BAZAAR_OUR_SALE_RE = /Базар\s*:\s*лот\s+(\d+)\(([^)]+)\)\s+продан[^.]*\.\s+(\d+)\s+кун\s+переведено\s+на\s+ваш\s+счет/;
const AUCTION_SALE_RE = /Аукцион\s*:\s*лот\s+(\d+)\(([^)]+)\)\s+продан\S*\s+с\s+аукциона\s+за\s+(\d+)\s+кун/;
const ANSI_RE = /\u001b\[[0-9;]*m/g;
const LOG_TS_RE = /^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]/;

interface Sale {
  source: "bazaar" | "auction";
  lotNumber: number | null;
  itemName: string;
  price: number;
  isOurs: boolean;
  soldAt: Date;
}

function parseSalesFromLine(rawLogLine: string): Sale[] {
  const tsMatch = LOG_TS_RE.exec(rawLogLine);
  const soldAt = tsMatch ? new Date(tsMatch[1]) : new Date();

  const msgMatch = /message="(.*?)"(?:\s+bytes=|\s*$)/.exec(rawLogLine);
  if (!msgMatch) return [];

  const text = msgMatch[1]
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(ANSI_RE, "")
    .replace(/\\u001b\[[0-9;]*m/g, "");

  const result: Sale[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();

    const ours = BAZAAR_OUR_SALE_RE.exec(trimmed);
    if (ours) {
      result.push({ source: "bazaar", lotNumber: Number(ours[1]), itemName: ours[2].trim(), price: Number(ours[3]), isOurs: true, soldAt });
      continue;
    }
    const bazaar = BAZAAR_SALE_RE.exec(trimmed);
    if (bazaar) {
      result.push({ source: "bazaar", lotNumber: Number(bazaar[1]), itemName: bazaar[2].trim(), price: Number(bazaar[3]), isOurs: false, soldAt });
      continue;
    }
    const auction = AUCTION_SALE_RE.exec(trimmed);
    if (auction) {
      result.push({ source: "auction", lotNumber: Number(auction[1]), itemName: auction[2].trim(), price: Number(auction[3]), isOurs: false, soldAt });
    }
  }
  return result;
}

async function readLines(filePath: string, gz: boolean): Promise<string[]> {
  const lines: string[] = [];
  const fileStream = createReadStream(filePath);
  const stream = gz ? fileStream.pipe(createGunzip()) : fileStream;
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) lines.push(line);
  return lines;
}

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS market_sales (
      id          BIGSERIAL PRIMARY KEY,
      source      TEXT NOT NULL,
      lot_number  INT,
      item_name   TEXT NOT NULL,
      price       INT NOT NULL,
      is_ours     BOOLEAN NOT NULL DEFAULT FALSE,
      sold_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS market_sales_item_name_idx ON market_sales (item_name)`;
  await sql`CREATE INDEX IF NOT EXISTS market_sales_sold_at_idx ON market_sales (sold_at DESC)`;

  const logFiles: Array<{ path: string; gz: boolean }> = [
    { path: "/var/log/bylins-bot/mud-traffic.log.1", gz: false },
    { path: "/var/log/bylins-bot/mud-traffic.log", gz: false },
  ];

  if (existsSync("/var/log/bylins-bot/mud-traffic.log.2.gz")) {
    logFiles.unshift({ path: "/var/log/bylins-bot/mud-traffic.log.2.gz", gz: true });
  }

  const sales: Sale[] = [];
  for (const { path, gz } of logFiles) {
    console.log(`Reading ${path}...`);
    let lines: string[];
    try {
      lines = await readLines(path, gz);
    } catch {
      console.log(`  Skipped (not found)`);
      continue;
    }
    for (const line of lines) {
      if (!line.includes("mud-in")) continue;
      sales.push(...parseSalesFromLine(line));
    }
  }

  console.log(`Found ${sales.length} sales total.`);
  if (sales.length === 0) {
    console.log("Nothing to insert.");
    await sql.end();
    return;
  }

  let inserted = 0;
  for (const s of sales) {
    await sql`
      INSERT INTO market_sales (source, lot_number, item_name, price, is_ours, sold_at)
      VALUES (${s.source}, ${s.lotNumber}, ${s.itemName}, ${s.price}, ${s.isOurs}, ${s.soldAt})
    `;
    inserted++;
  }

  console.log(`Inserted ${inserted} rows.`);
  await sql.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
