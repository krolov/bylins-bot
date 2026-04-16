// ---------------------------------------------------------------------------
// Inventory sub-router — owns every event that reads or sorts items the
// character is carrying / wearing / has stashed.
//
//   - inspect_container        "осм <container>" — read a stash container
//   - inspect_inventory        "инв"             — read visible inventory
//   - equipped_scan            "equipment"        — read equipped items
//   - inventory_auto_sort      precompute "пол <kw> базар|хлам" commands
//   - bazaar_max_price_request client price lookup against recorded sales
// ---------------------------------------------------------------------------
import type { ClientEvent } from "../../events.type.ts";
import type { BunServerWebSocket } from "../constants.ts";
import type { ClientMessageRouterDeps, SubRouter } from "./types.ts";

const OWNS = new Set<ClientEvent["type"]>([
  "inspect_container",
  "inspect_inventory",
  "equipped_scan",
  "inventory_auto_sort",
  "bazaar_max_price_request",
]);

export function createInventoryRouter(deps: ClientMessageRouterDeps): SubRouter {
  const {
    session,
    mudConnection,
    containerTracker,
    mapStore,
    sendServerEvent,
    logEvent,
  } = deps;

  async function handle(ws: BunServerWebSocket, event: ClientEvent): Promise<void> {
    switch (event.type) {
      case "inspect_container": {
        const containerKey = event.payload?.container;
        if (
          containerKey !== "склад" &&
          containerKey !== "расход" &&
          containerKey !== "базар" &&
          containerKey !== "хлам"
        ) break;
        logEvent(ws, "browser-in", `inspect_container: ${containerKey}`);
        if (session.tcpSocket && session.connected) {
          mudConnection.writeAndLogMudCommand(ws, session.tcpSocket, `осм ${containerKey}`, "inspect-container");
        }
        break;
      }
      case "inspect_inventory":
        logEvent(ws, "browser-in", "inspect_inventory");
        if (session.tcpSocket && session.connected) {
          mudConnection.writeAndLogMudCommand(ws, session.tcpSocket, "инв", "inspect-inventory");
        }
        break;
      case "equipped_scan":
        logEvent(ws, "browser-in", "equipped_scan");
        if (session.tcpSocket && session.connected) {
          containerTracker.startEquippedScan();
          mudConnection.writeAndLogMudCommand(ws, session.tcpSocket, "equipment", "equipped-scan");
        }
        break;
      case "inventory_auto_sort": {
        const items = event.payload?.items ?? [];
        logEvent(ws, "browser-in", `inventory_auto_sort: ${items.length} items`);
        const commands: Array<{ command: string }> = [];
        for (const item of items) {
          const maxPrice = await mapStore.getMarketMaxPrice(item.name);
          const kw = item.name.split(/\s+/)[0] ?? item.name;
          commands.push({ command: maxPrice !== null ? `пол ${kw} базар` : `пол ${kw} хлам` });
        }
        sendServerEvent(ws, { type: "inventory_sort_result", payload: { commands } });
        break;
      }
      case "bazaar_max_price_request": {
        const itemName = event.payload?.itemName ?? "";
        const maxPrice = await mapStore.getMarketMaxPrice(itemName);
        sendServerEvent(ws, { type: "bazaar_max_price_response", payload: { itemName, maxPrice } });
        break;
      }
    }
  }

  return { owns: OWNS, handle };
}
