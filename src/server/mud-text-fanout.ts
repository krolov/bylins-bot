// ---------------------------------------------------------------------------
// MUD text fan-out — the single callback fed into createMudConnection's
// onMudText. Every raw MUD chunk is multiplexed to:
//
//   - containerTracker (3 feeders: text, equipped-scan, pending-inspect)
//   - arbitrary per-chunk listeners registered on the listener hub
//   - bazaarNotifier (telegram-ping on zone entry, path checks)
//   - broadcast to browser clients + recent-output buffer
//   - chat line sniffer (persist + rebroadcast as chat_message)
//   - market sale sniffer (persist)
//   - lootSorter (debounced auto-sort trigger)
//   - mudTextPipeline (stats / parser / automapper / farm feed)
//
// This is a pure dispatch surface — every branch forwards to a module
// that already exists. Extracted so server.ts doesn't have to spell out
// the fan-out inline.
// ---------------------------------------------------------------------------
import type { BunServerWebSocket } from "./constants.ts";
import type { LogEventFn } from "./logging.ts";
import type { MapStore } from "../map/store.ts";
import type { ServerEvent } from "../events.type.ts";
import { extractChatLines } from "./chat.ts";
import { extractMarketSales } from "./market.ts";

interface ContainerTrackerLike {
  feedText: (text: string) => void;
  feedEquippedScan: (text: string) => void;
  feedPendingInspect: (text: string) => void;
}

interface BazaarNotifierLike {
  handleMudText: (text: string) => void;
}

interface LootSorterLike {
  handleMudText: (text: string) => void;
}

interface MudTextPipelineLike {
  handleMudText: (text: string, ws: BunServerWebSocket | null) => Promise<void>;
}

export interface MudTextFanoutDeps {
  containerTracker: ContainerTrackerLike;
  bazaarNotifier: BazaarNotifierLike;
  lootSorter: LootSorterLike;
  mudTextPipeline: MudTextPipelineLike;
  /** Per-chunk raw-text listeners registered via the listener hub. */
  mudTextHandlers: Set<(text: string) => void>;
  /** Remembers the last N chunks for late-joiner clients. */
  rememberOutput: (text: string) => void;
  broadcastServerEvent: (event: ServerEvent) => void;
  /** Persistence (chat + market sales). */
  mapStore: MapStore;
  logEvent: LogEventFn;
}

/**
 * Builds the `onMudText(text, ws)` callback plugged into createMudConnection.
 */
export function createMudTextFanout(
  deps: MudTextFanoutDeps,
): (text: string, ws: BunServerWebSocket | null) => void {
  return function onMudText(text, ws) {
    deps.containerTracker.feedText(text);
    deps.containerTracker.feedEquippedScan(text);
    deps.containerTracker.feedPendingInspect(text);
    for (const handler of deps.mudTextHandlers) handler(text);
    deps.bazaarNotifier.handleMudText(text);
    deps.rememberOutput(text);
    deps.broadcastServerEvent({ type: "output", payload: { text } });

    const chatLines = extractChatLines(text);
    if (chatLines.length > 0) {
      const now = Date.now();
      for (const line of chatLines) {
        const msg = { text: line.trim(), timestamp: now };
        deps.broadcastServerEvent({ type: "chat_message", payload: msg });
        void deps.mapStore.saveChatMessage(msg.text, msg.timestamp).catch((error: unknown) => {
          deps.logEvent(
            ws,
            "error",
            error instanceof Error ? `Chat persist error: ${error.message}` : "Chat persist error.",
          );
        });
      }
    }

    const marketSales = extractMarketSales(text);
    if (marketSales.length > 0) {
      const now = new Date();
      for (const sale of marketSales) {
        void deps.mapStore.saveMarketSale({ ...sale, soldAt: now }).catch((error: unknown) => {
          deps.logEvent(
            ws,
            "error",
            error instanceof Error ? `Market sale persist error: ${error.message}` : "Market sale persist error.",
          );
        });
      }
    }

    deps.lootSorter.handleMudText(text);
    void deps.mudTextPipeline.handleMudText(text, ws).catch((error: unknown) => {
      deps.logEvent(
        ws,
        "error",
        error instanceof Error ? `Automapper error: ${error.message}` : "Automapper error.",
      );
    });
  };
}
