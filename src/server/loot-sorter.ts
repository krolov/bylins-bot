// ---------------------------------------------------------------------------
// Loot sorter — detects looted/picked-up items in the MUD text stream, and
// after a short debounce reads the inventory and dispatches "пол <item>
// <target>" commands that stash each item into "базар" (if it is a known
// marketable item) or "хлам" otherwise.
//
// Used by:
//   - MUD text pipeline (handleMudText) — populates pending loot + schedules.
//   - Farm controller (autoSortInventory) — forced full-inventory sort.
//
// Extracted from src/server.ts to keep server.ts focused on orchestration.
// ---------------------------------------------------------------------------
import { parseInventoryItems } from "../survival-script.ts";
import { LOOT_FROM_CORPSE_RE, PICKUP_FROM_GROUND_RE } from "./loot.ts";
import { ANSI_ESCAPE_RE } from "./constants.ts";
import type { Session } from "../mud-connection.ts";

export interface LootSorterDeps {
  /** Shared MUD session (read `.tcpSocket` and `.connected`). */
  session: Session;
  /** Writes a MUD command and logs it with the provided origin. */
  writeAndLogMudCommand: (
    ws: null,
    socket: NonNullable<Session["tcpSocket"]>,
    command: string,
    origin: string,
  ) => void;
  /** Registers a raw-text handler; used to capture the "инв" response. */
  registerTextHandler: (handler: (text: string) => void) => void;
  unregisterTextHandler: (handler: (text: string) => void) => void;
  /** Lookup marketable items to decide target container. */
  getMarketMaxPrice: (itemName: string) => Promise<number | null>;
  /** Alternative inventory read path used by autoSortInventory. */
  waitForInspectResult: (timeoutMs: number) => Promise<string>;
  /** Reports unexpected errors (persistence, parsing, etc.). */
  onError: (message: string) => void;
}

export interface LootSorter {
  /** Scan a MUD text chunk for loot lines and schedule a sort. */
  handleMudText: (text: string) => void;
  /**
   * Force a sort of the full inventory. Used by the farm controller after
   * corpse-looting bursts where individual lines may have been missed.
   */
  autoSortInventory: () => Promise<void>;
}

export function createLootSorter(deps: LootSorterDeps): LootSorter {
  const pendingLootItems = new Map<string, number>();
  let lootSortTimer: ReturnType<typeof setTimeout> | null = null;

  function handleMudText(text: string): void {
    let detected = false;

    if (LOOT_FROM_CORPSE_RE.test(text)) {
      detected = true;
      const stripped = text.replace(ANSI_ESCAPE_RE, "").replace(/\r/g, "");
      LOOT_FROM_CORPSE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LOOT_FROM_CORPSE_RE.exec(stripped)) !== null) {
        const name = m[1]?.trim();
        if (name) pendingLootItems.set(name, (pendingLootItems.get(name) ?? 0) + 1);
      }
    }
    if (PICKUP_FROM_GROUND_RE.test(text)) {
      detected = true;
      const stripped = text.replace(ANSI_ESCAPE_RE, "").replace(/\r/g, "");
      PICKUP_FROM_GROUND_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = PICKUP_FROM_GROUND_RE.exec(stripped)) !== null) {
        const name = m[1]?.trim();
        if (name) pendingLootItems.set(name, (pendingLootItems.get(name) ?? 0) + 1);
      }
    }

    if (detected) scheduleLootSort();
  }

  function scheduleLootSort(): void {
    if (lootSortTimer !== null) clearTimeout(lootSortTimer);
    lootSortTimer = setTimeout(() => {
      lootSortTimer = null;
      const items = new Map(pendingLootItems);
      pendingLootItems.clear();
      void sortLootedItems(items).catch((error: unknown) => {
        deps.onError(error instanceof Error ? `Loot sort error: ${error.message}` : "Loot sort error.");
      });
    }, 1500);
  }

  async function sortLootedItems(lootedNames: Map<string, number>): Promise<void> {
    const { session } = deps;
    if (!session.tcpSocket || !session.connected) return;

    const inventoryText = await new Promise<string>((resolve) => {
      let buf = "";
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        deps.unregisterTextHandler(handler);
        resolve(buf);
      }, 3000);
      const handler = (raw: string) => {
        if (done) return;
        const stripped = raw.replace(ANSI_ESCAPE_RE, "").replace(/\r/g, "");
        buf += stripped;
        if (/Вы несете:/i.test(stripped) && /\d+H\s+\d+M/i.test(stripped)) {
          done = true;
          clearTimeout(timer);
          deps.unregisterTextHandler(handler);
          resolve(buf);
        }
      };
      deps.registerTextHandler(handler);
      deps.writeAndLogMudCommand(null, session.tcpSocket!, "инв", "zone-script");
    });

    const inventoryItems = parseInventoryItems(inventoryText);
    const mobKey = (name: string) => name.split(/\s+/).map((w) => w.slice(0, 4)).join(".");

    const lootedKeys = new Set<string>();
    for (const [name] of lootedNames) {
      lootedKeys.add(mobKey(name).toLowerCase());
    }

    for (const item of inventoryItems) {
      if (!lootedKeys.has(mobKey(item.name).toLowerCase())) continue;
      const first = item.name.split(/\s+/)[0] ?? item.name;
      const maxPrice = await deps.getMarketMaxPrice(item.name);
      const target = maxPrice !== null ? "базар" : "хлам";
      deps.writeAndLogMudCommand(null, session.tcpSocket!, `пол ${first} ${target}`, "zone-script");
    }
  }

  async function autoSortInventory(): Promise<void> {
    const { session } = deps;
    if (!session.tcpSocket || !session.connected) return;
    const resultPromise = deps.waitForInspectResult(3000);
    deps.writeAndLogMudCommand(null, session.tcpSocket!, "инв", "zone-script");
    const inventoryText = await resultPromise;
    const items = parseInventoryItems(inventoryText);
    for (const item of items) {
      const maxPrice = await deps.getMarketMaxPrice(item.name);
      const kw = item.name.split(/\s+/)[0] ?? item.name;
      const target = maxPrice !== null ? "базар" : "хлам";
      deps.writeAndLogMudCommand(null, session.tcpSocket!, `пол ${kw} ${target}`, "zone-script");
    }
  }

  return { handleMudText, autoSortInventory };
}
