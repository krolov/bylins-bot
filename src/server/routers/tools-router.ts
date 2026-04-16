// ---------------------------------------------------------------------------
// Tools sub-router — owns the item-database / wiki / route-finder / gear
// comparator events. These are mostly read-only client tools that don't
// fit naturally with any of the runtime controllers.
//
//   - item_db_get            dump the local item DB to the client
//   - wiki_item_search       fetch a wiki card (proxied + cached)
//   - vorozhe_route_find     Floyd-style route through ingredient graph
//   - compare_scan_start     gear compare scan across equipped / bazaar
//   - compare_apply          send the commands the compare UI picked
// ---------------------------------------------------------------------------
import type { ClientEvent } from "../../events.type.ts";
import type { BunServerWebSocket } from "../constants.ts";
import { runCompareScan } from "../../compare-scan/index.ts";
import { searchAndCacheWikiItem } from "../../wiki.ts";
import { findVorozheRoute } from "../../vorozhe-graph.ts";
import type { ClientMessageRouterDeps, SubRouter } from "./types.ts";

const OWNS = new Set<ClientEvent["type"]>([
  "item_db_get",
  "wiki_item_search",
  "vorozhe_route_find",
  "compare_scan_start",
  "compare_apply",
]);

export function createToolsRouter(deps: ClientMessageRouterDeps): SubRouter {
  const {
    session,
    mudConnection,
    mapStore,
    runtimeConfig,
    mudTextHandlers,
    sendServerEvent,
    broadcastServerEvent,
    logEvent,
  } = deps;

  async function handle(ws: BunServerWebSocket, event: ClientEvent): Promise<void> {
    switch (event.type) {
      case "item_db_get": {
        logEvent(ws, "browser-in", "item_db_get");
        const items = await mapStore.getItems();
        sendServerEvent(ws, { type: "items_data", payload: { items } });
        break;
      }
      case "wiki_item_search": {
        const query = event.payload?.query?.trim() ?? "";
        logEvent(ws, "browser-in", `wiki_item_search: ${query}`);
        if (!query) break;
        try {
          const result = await searchAndCacheWikiItem(query, mapStore, runtimeConfig.wikiProxies);
          sendServerEvent(ws, { type: "wiki_item_search_result", payload: { query, ...result } });
        } catch (err: unknown) {
          sendServerEvent(ws, {
            type: "wiki_item_search_result",
            payload: { query, found: false, error: err instanceof Error ? err.message : "Ошибка поиска" },
          });
        }
        break;
      }
      case "vorozhe_route_find": {
        const from = event.payload?.from?.trim() ?? "";
        const to = event.payload?.to?.trim() ?? "";
        logEvent(ws, "browser-in", `vorozhe_route_find: ${from} → ${to}`);
        if (!from || !to) break;
        const result = findVorozheRoute(from, to);
        sendServerEvent(ws, {
          type: "vorozhe_route_result",
          payload: {
            from,
            to,
            found: result.found,
            steps: result.steps,
            totalItems: result.totalItems as Record<string, number>,
          },
        });
        break;
      }
      case "compare_scan_start": {
        logEvent(ws, "browser-in", "compare_scan_start");
        if (!session.tcpSocket || !session.connected) {
          sendServerEvent(ws, { type: "error", payload: { message: "Не подключены к MUD." } });
          break;
        }
        void runCompareScan({
          sendCommand: (cmd) => mudConnection.writeAndLogMudCommand(null, session.tcpSocket!, cmd, "compare-scan"),
          registerTextHandler: (h) => mudTextHandlers.add(h),
          unregisterTextHandler: (h) => mudTextHandlers.delete(h),
          onProgress: (msg) => {
            logEvent(ws, "browser-out", `[compare-scan] ${msg}`);
            broadcastServerEvent({ type: "compare_scan_progress", payload: { message: msg } });
          },
          waitForOutput: (_ms) => Promise.resolve(""),
          cancelWait: () => {},
          getItemByName: (name) => mapStore.getItemByName(name),
          upsertItem: (name, itemType, data, hasWikiData, hasGameData) =>
            mapStore.upsertItem(name, itemType, data, hasWikiData, hasGameData),
          wikiProxies: runtimeConfig.wikiProxies,
        }).then((result) => {
          broadcastServerEvent({ type: "compare_scan_result", payload: result });
        }).catch((err: unknown) => {
          broadcastServerEvent({
            type: "error",
            payload: { message: err instanceof Error ? err.message : "Ошибка сравнятора." },
          });
        });
        break;
      }
      case "compare_apply": {
        logEvent(ws, "browser-in", `compare_apply: ${event.payload.commands.join(" ; ")}`);
        if (!session.tcpSocket || !session.connected) {
          sendServerEvent(ws, { type: "error", payload: { message: "Не подключены к MUD." } });
          break;
        }
        const compareSocket = session.tcpSocket;
        for (const cmd of event.payload.commands) {
          mudConnection.writeAndLogMudCommand(null, compareSocket, cmd, "compare-apply");
        }
        break;
      }
    }
  }

  return { owns: OWNS, handle };
}
