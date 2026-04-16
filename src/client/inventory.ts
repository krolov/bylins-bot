// Container / inventory table renderers.
//
// Rendering is fully DOM-driven and has no internal state. Every button
// dispatches outbound commands via the shared pub-sub bus ("client_send"),
// which main.ts binds to the actual `sendClientEvent`.

import * as bus from "./bus.ts";
import type { ClientEvent } from "./types.ts";

type ContainerName = "склад" | "расход" | "базар" | "хлам";

function send(ev: ClientEvent): void {
  bus.emit("client_send", ev);
}

function sortItems<T extends { name: string; count: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"));
}

function renderItemRow(
  item: { name: string; count: number },
  sellCommand: ((kw: string, count: number) => string) | null,
  dropCommand: ((kw: string, count: number) => string) | null,
): HTMLTableRowElement {
  const keyword = item.name.split(/\s+/)[0] ?? item.name;
  const tr = document.createElement("tr");

  const tdSell = document.createElement("td");
  tdSell.className = "container-panel__sell-cell";
  if (sellCommand !== null) {
    const sellBtn = document.createElement("button");
    sellBtn.type = "button";
    sellBtn.className = "container-panel__sell-btn";
    sellBtn.textContent = "П";
    sellBtn.title = "Продать";
    sellBtn.addEventListener("click", () => {
      const cmd = sellCommand(keyword, item.count);
      for (const part of cmd.split(";;").map((s) => s.trim()).filter(Boolean)) {
        send({ type: "send", payload: { command: part } });
      }
    });
    tdSell.appendChild(sellBtn);
  }

  const tdDrop = document.createElement("td");
  tdDrop.className = "container-panel__sell-cell";
  if (dropCommand !== null) {
    const dropBtn = document.createElement("button");
    dropBtn.type = "button";
    dropBtn.className = "container-panel__sell-btn";
    dropBtn.textContent = "В";
    dropBtn.title = "Выбросить";
    dropBtn.addEventListener("click", () => {
      send({ type: "send", payload: { command: dropCommand(keyword, item.count) } });
    });
    tdDrop.appendChild(dropBtn);
  }

  const tdCount = document.createElement("td");
  tdCount.className = "container-panel__count";
  tdCount.textContent = item.count > 1 ? `×${item.count}` : "";

  const tdName = document.createElement("td");
  tdName.className = "container-panel__name";
  tdName.textContent = item.name;

  tr.appendChild(tdSell);
  tr.appendChild(tdDrop);
  tr.appendChild(tdCount);
  tr.appendChild(tdName);
  return tr;
}

function renderBazaarSellRow(
  item: { name: string; count: number },
  takeFrom: string,
  dropCommand: ((kw: string, count: number) => string) | null,
): HTMLTableRowElement {
  const kw = item.name.split(/\s+/)[0] ?? item.name;
  const tr = document.createElement("tr");
  tr.dataset["itemName"] = item.name;

  const tdSell = document.createElement("td");
  tdSell.className = "container-panel__sell-cell";
  const sellBtn = document.createElement("button");
  sellBtn.type = "button";
  sellBtn.className = "container-panel__sell-btn";
  sellBtn.textContent = "П";
  sellBtn.title = "Продать";
  sellBtn.dataset["takeCmd"] = `взя ${kw} ${takeFrom}`;
  sellBtn.dataset["sellPrice"] = "";
  sellBtn.addEventListener("click", () => {
    const price = sellBtn.dataset["sellPrice"];
    if (!price) return;
    send({ type: "send", payload: { command: sellBtn.dataset["takeCmd"] ?? "" } });
    send({ type: "send", payload: { command: `базар выставить ${kw} ${price}` } });
  });
  tdSell.appendChild(sellBtn);

  const tdDrop = document.createElement("td");
  tdDrop.className = "container-panel__sell-cell";
  if (dropCommand !== null) {
    const dropBtn = document.createElement("button");
    dropBtn.type = "button";
    dropBtn.className = "container-panel__sell-btn";
    dropBtn.textContent = "В";
    dropBtn.title = "Выбросить";
    dropBtn.addEventListener("click", () => {
      send({ type: "send", payload: { command: dropCommand(kw, item.count) } });
    });
    tdDrop.appendChild(dropBtn);
  }

  const tdCount = document.createElement("td");
  tdCount.className = "container-panel__count";
  tdCount.textContent = item.count > 1 ? `×${item.count}` : "";

  const tdName = document.createElement("td");
  tdName.className = "container-panel__name";
  tdName.textContent = item.name;

  tr.appendChild(tdSell);
  tr.appendChild(tdDrop);
  tr.appendChild(tdCount);
  tr.appendChild(tdName);
  return tr;
}

function requestBazaarMaxPrices(tbody: HTMLTableSectionElement): void {
  const rows = tbody.querySelectorAll<HTMLTableRowElement>("tr[data-item-name]");
  rows.forEach((row) => {
    const itemName = row.dataset["itemName"];
    if (itemName) {
      send({ type: "bazaar_max_price_request", payload: { itemName } });
    }
  });
}

export function renderContainerList(
  tbody: HTMLTableSectionElement,
  items: Array<{ name: string; count: number }>,
  container: ContainerName,
): void {
  tbody.innerHTML = "";
  for (const item of sortItems(items)) {
    if (container === "склад") {
      tbody.appendChild(renderItemRow(
        item,
        null,
        (k, count) => count > 1 ? `бросить все.${k} склад` : `бросить ${k} склад`,
      ));
    } else if (container === "расход") {
      tbody.appendChild(renderBazaarSellRow(
        item,
        "расход",
        (k, count) => count > 1 ? `бросить все.${k} расход` : `бросить ${k} расход`,
      ));
    } else if (container === "базар") {
      tbody.appendChild(renderBazaarSellRow(item, "базар", null));
    } else {
      tbody.appendChild(renderItemRow(
        item,
        (k) => `взя ${k} хлам;;прод ${k}`,
        (k) => `взя ${k} хлам;;бро ${k}`,
      ));
    }
  }
  if (container === "базар" || container === "расход") {
    requestBazaarMaxPrices(tbody);
  }
}

export function renderInventoryList(
  tbody: HTMLTableSectionElement,
  items: Array<{ name: string; count: number }>,
): void {
  tbody.innerHTML = "";
  for (const item of sortItems(items)) {
    const kw = item.name.split(/\s+/)[0] ?? item.name;
    const tr = document.createElement("tr");

    const tdSort = document.createElement("td");
    tdSort.className = "container-panel__sell-cell";
    const sortBtn = document.createElement("button");
    sortBtn.type = "button";
    sortBtn.className = "container-panel__sell-btn";
    sortBtn.textContent = "⇅";
    sortBtn.title = "Авто: базар или хлам";
    sortBtn.addEventListener("click", () => {
      send({ type: "inventory_auto_sort", payload: { items: [item] } });
    });
    tdSort.appendChild(sortBtn);

    const tdSell = document.createElement("td");
    tdSell.className = "container-panel__sell-cell";
    const sellBtn = document.createElement("button");
    sellBtn.type = "button";
    sellBtn.className = "container-panel__sell-btn";
    sellBtn.textContent = "П";
    sellBtn.title = "Продать";
    sellBtn.addEventListener("click", () => {
      send({ type: "send", payload: { command: `прод ${kw}` } });
    });
    tdSell.appendChild(sellBtn);

    const tdDrop = document.createElement("td");
    tdDrop.className = "container-panel__sell-cell";
    const dropBtn = document.createElement("button");
    dropBtn.type = "button";
    dropBtn.className = "container-panel__sell-btn";
    dropBtn.textContent = "В";
    dropBtn.title = "Выбросить";
    dropBtn.addEventListener("click", () => {
      const cmd = item.count > 1 ? `бросить все.${kw}` : `бросить ${kw}`;
      send({ type: "send", payload: { command: cmd } });
    });
    tdDrop.appendChild(dropBtn);

    const tdCount = document.createElement("td");
    tdCount.className = "container-panel__count";
    tdCount.textContent = item.count > 1 ? `×${item.count}` : "";

    const tdName = document.createElement("td");
    tdName.className = "container-panel__name";
    tdName.textContent = item.name;

    tr.appendChild(tdSort);
    tr.appendChild(tdSell);
    tr.appendChild(tdDrop);
    tr.appendChild(tdCount);
    tr.appendChild(tdName);
    tbody.appendChild(tr);
  }
}
