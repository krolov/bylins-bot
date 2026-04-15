// Item database + wiki search modal — loaded as a dynamic-import chunk on
// first click of the #item-db-button. Owns its DOM refs, state, all
// listeners, and the items_data / wiki_item_search_result handlers via
// the bus.

import type { ClientEvent, ColumnDef, GameItemPayload } from "../types.ts";
import { ARMOR_COLUMNS, WEAPON_COLUMNS } from "../constants.ts";
import * as bus from "../bus.ts";

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required UI element: ${selector}`);
  return el;
}

const itemDbModal = requireElement<HTMLDivElement>("#item-db-modal");
const itemDbModalBackdrop = requireElement<HTMLDivElement>("#item-db-modal .farm-modal__backdrop");
const itemDbModalClose = requireElement<HTMLButtonElement>("#item-db-modal-close");
const itemDbTableBody = requireElement<HTMLTableSectionElement>("#item-db-table-body");
const itemDbThead = requireElement<HTMLTableSectionElement>("#item-db-thead");
const itemDbEmpty = requireElement<HTMLParagraphElement>("#item-db-empty");
const itemDbTabs = requireElement<HTMLDivElement>("#item-db-tabs");
const itemDbSearch = requireElement<HTMLInputElement>("#item-db-search");
const itemDbCount = requireElement<HTMLSpanElement>("#item-db-count");
const itemDbWikiInput = requireElement<HTMLInputElement>("#item-db-wiki-input");
const itemDbWikiBtn = requireElement<HTMLButtonElement>("#item-db-wiki-btn");
const itemDbWikiResult = requireElement<HTMLDivElement>("#item-db-wiki-result");

const itemDetailModal = requireElement<HTMLDivElement>("#item-detail-modal");
const itemDetailModalBackdrop = requireElement<HTMLDivElement>("#item-detail-modal .farm-modal__backdrop");
const itemDetailModalClose = requireElement<HTMLButtonElement>("#item-detail-modal-close");
const itemDetailModalCloseFooter = requireElement<HTMLButtonElement>("#item-detail-modal-close-footer");
const itemDetailModalTitle = requireElement<HTMLSpanElement>("#item-detail-modal-title");
const itemDetailModalBody = requireElement<HTMLDivElement>("#item-detail-modal-body");

let itemDbAllItems: GameItemPayload[] = [];
let itemDbActiveTab = "all";
const itemDbRowMap = new WeakMap<HTMLTableRowElement, GameItemPayload>();

function send(ev: ClientEvent): void {
  bus.emit("client_send", ev);
}

function getColumnsForTab(tab: string): ColumnDef[] {
  if (tab === "ОРУЖИЕ") return WEAPON_COLUMNS;
  if (tab === "БРОНЯ")  return ARMOR_COLUMNS;
  return [];
}

function renderGenericData(data: Record<string, unknown>): HTMLElement {
  const wrap = document.createElement("span");
  const entries = Object.entries(data).filter(([, v]) => v != null && v !== "" && v !== "ничего");
  wrap.textContent = entries.map(([k, v]) => {
    const val = typeof v === "object" ? JSON.stringify(v) : String(v);
    return `${k}: ${val}`;
  }).join(" · ");
  wrap.className = "items-modal__cell--muted";
  wrap.style.fontSize = "11px";
  return wrap;
}

function applyItemDbFilter(): void {
  const query = itemDbSearch.value.trim().toLowerCase();
  const tab   = itemDbActiveTab;
  const cols  = getColumnsForTab(tab);

  const filtered = itemDbAllItems.filter(item => {
    const tabMatch = tab === "all" || item.itemType === tab;
    const searchMatch = !query || item.name.toLowerCase().includes(query);
    return tabMatch && searchMatch;
  });

  itemDbTableBody.innerHTML = "";
  itemDbThead.querySelector("tr")!.innerHTML = "";

  if (filtered.length === 0) {
    itemDbEmpty.classList.remove("items-modal__empty--hidden");
    itemDbCount.textContent = "";
    return;
  }
  itemDbEmpty.classList.add("items-modal__empty--hidden");
  itemDbCount.textContent = `${filtered.length} предм.`;

  const headRow = itemDbThead.querySelector("tr")!;
  const nameHeader = document.createElement("th");
  nameHeader.className = "items-modal__th";
  nameHeader.textContent = "Название";
  headRow.appendChild(nameHeader);

  if (cols.length > 0) {
    for (const col of cols) {
      const th = document.createElement("th");
      th.className = "items-modal__th";
      th.textContent = col.label;
      headRow.appendChild(th);
    }
  } else {
    const th = document.createElement("th");
    th.className = "items-modal__th";
    th.textContent = "Данные";
    headRow.appendChild(th);

    const thType = document.createElement("th");
    thType.className = "items-modal__th";
    thType.textContent = "Тип";
    headRow.appendChild(thType);
  }

  for (const item of filtered) {
    const tr = document.createElement("tr");
    tr.className = "items-modal__row items-modal__row--clickable";
    itemDbRowMap.set(tr, item);

    const tdName = document.createElement("td");
    tdName.className = "items-modal__cell items-modal__cell--name";
    tdName.textContent = item.name;
    tr.appendChild(tdName);

    if (cols.length > 0) {
      for (const col of cols) {
        const td = document.createElement("td");
        td.className = `items-modal__cell${col.cls ? " " + col.cls : ""}`;
        td.textContent = col.render(item.data);
        tr.appendChild(td);
      }
    } else {
      const tdData = document.createElement("td");
      tdData.className = "items-modal__cell";
      tdData.appendChild(renderGenericData(item.data));
      tr.appendChild(tdData);

      const tdType = document.createElement("td");
      tdType.className = "items-modal__cell items-modal__cell--muted";
      tdType.textContent = item.itemType;
      tr.appendChild(tdType);
    }

    itemDbTableBody.appendChild(tr);
  }
}

function buildItemDbTabs(items: GameItemPayload[]): void {
  const types = [...new Set(items.map(i => i.itemType))].sort();
  itemDbTabs.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "items-modal__tab" + (itemDbActiveTab === "all" ? " items-modal__tab--active" : "");
  allBtn.dataset.tab = "all";
  allBtn.textContent = `Все (${items.length})`;
  itemDbTabs.appendChild(allBtn);

  for (const t of types) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "items-modal__tab" + (itemDbActiveTab === t ? " items-modal__tab--active" : "");
    btn.dataset.tab = t;
    btn.textContent = `${t} (${items.filter(i => i.itemType === t).length})`;
    itemDbTabs.appendChild(btn);
  }
}

function renderItemDbTable(items: GameItemPayload[]): void {
  itemDbAllItems = items;
  buildItemDbTabs(items);
  applyItemDbFilter();
}

function closeItemDbModal(): void {
  itemDbModal.classList.add("farm-modal--hidden");
}

function openItemDetailModal(item: GameItemPayload): void {
  itemDetailModalTitle.textContent = item.name;
  renderItemDetail(item);
  itemDetailModal.classList.remove("farm-modal--hidden");
}

function closeItemDetailModal(): void {
  itemDetailModal.classList.add("farm-modal--hidden");
}

function renderItemDetail(item: GameItemPayload): void {
  const d = item.data;
  itemDetailModalBody.innerHTML = "";

  function row(label: string, value: string | null | undefined): void {
    if (value === null || value === undefined || value === "") return;
    const p = document.createElement("p");
    p.className = "item-detail-modal__row";
    const labelEl = document.createElement("span");
    labelEl.className = "item-detail-modal__label";
    labelEl.textContent = label + ": ";
    const valueEl = document.createElement("span");
    valueEl.className = "item-detail-modal__value";
    valueEl.textContent = value;
    p.appendChild(labelEl);
    p.appendChild(valueEl);
    itemDetailModalBody.appendChild(p);
  }

  function listSection(label: string, arr: unknown): void {
    if (!Array.isArray(arr) || arr.length === 0) return;
    const section = document.createElement("div");
    section.className = "item-detail-modal__section";
    const h = document.createElement("p");
    h.className = "item-detail-modal__section-title";
    h.textContent = label + ":";
    section.appendChild(h);
    for (const entry of arr) {
      const p = document.createElement("p");
      p.className = "item-detail-modal__list-item";
      if (typeof entry === "object" && entry !== null && "stat" in entry && "value" in entry) {
        p.textContent = `${(entry as { stat: string; value: number }).stat}: ${(entry as { stat: string; value: number }).value}`;
      } else {
        p.textContent = String(entry);
      }
      section.appendChild(p);
    }
    itemDetailModalBody.appendChild(section);
  }

  row("Тип", item.itemType);
  row("Материал", typeof d["material"] === "string" ? d["material"] : null);

  if (d["weaponClass"] != null) {
    row("Класс оружия", String(d["weaponClass"]));
  }
  if (d["damageDice"] != null) {
    row("Урон (кости)", String(d["damageDice"]));
  }
  if (d["damageAvg"] != null && Number(d["damageAvg"]) > 0) {
    row("Средний урон", String(d["damageAvg"]));
  }
  if (d["ac"] != null && Number(d["ac"]) !== 0) {
    row("AC", String(d["ac"]));
  }
  if (d["armor"] != null && Number(d["armor"]) !== 0) {
    row("Броня", String(d["armor"]));
  }
  if (d["remorts"] != null && Number(d["remorts"]) > 0) {
    row("Перевоплощений", String(d["remorts"]));
  }
  if (d["isMetal"] === true) {
    row("Металл", "да");
  }
  if (d["isShiny"] === true) {
    row("Блестящий", "да");
  }

  const wearSlots = d["wearSlots"];
  if (Array.isArray(wearSlots) && wearSlots.length > 0) {
    row("Слоты", (wearSlots as string[]).join(", "));
  }

  listSection("Аффекты", d["affects"]);
  listSection("Свойства", d["properties"]);
  listSection("Запрет классам", d["forbidden"]);
  listSection("Треб. правая рука", d["rightHandReqs"]);
  listSection("Треб. левая рука", d["leftHandReqs"]);
  listSection("Треб. обе руки", d["bothHandReqs"]);
  listSection("Треб. надевание", d["wearReqs"]);

  if (d["id"] != null) {
    row("Wiki ID", String(d["id"]));
  }

  const firstSeen = item.firstSeen ? new Date(item.firstSeen).toLocaleDateString("ru-RU") : null;
  const lastSeen = item.lastSeen ? new Date(item.lastSeen).toLocaleDateString("ru-RU") : null;
  if (firstSeen) row("Первый раз", firstSeen);
  if (lastSeen) row("Последний раз", lastSeen);

  if (itemDetailModalBody.children.length === 0) {
    const p = document.createElement("p");
    p.className = "item-detail-modal__empty";
    p.textContent = "Нет данных";
    itemDetailModalBody.appendChild(p);
  }
}

function doWikiSearch(): void {
  const query = itemDbWikiInput.value.trim();
  if (!query) return;
  itemDbWikiResult.textContent = "Ищу...";
  itemDbWikiResult.classList.remove("items-modal__wiki-result--hidden", "items-modal__wiki-result--error");
  itemDbWikiBtn.disabled = true;
  send({ type: "wiki_item_search", payload: { query } });
}

let initialized = false;
function init(): void {
  if (initialized) return;
  initialized = true;

  itemDbModalClose.addEventListener("click", closeItemDbModal);
  itemDbModalBackdrop.addEventListener("click", closeItemDbModal);
  itemDbTableBody.addEventListener("click", (e) => {
    const tr = (e.target as HTMLElement).closest("tr") as HTMLTableRowElement | null;
    if (!tr) return;
    const item = itemDbRowMap.get(tr);
    if (!item) return;
    openItemDetailModal(item);
  });
  itemDetailModalClose.addEventListener("click", closeItemDetailModal);
  itemDetailModalCloseFooter.addEventListener("click", closeItemDetailModal);
  itemDetailModalBackdrop.addEventListener("click", closeItemDetailModal);

  itemDbTabs.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn) return;
    itemDbActiveTab = btn.dataset.tab!;
    itemDbTabs.querySelectorAll(".items-modal__tab").forEach(b => b.classList.remove("items-modal__tab--active"));
    btn.classList.add("items-modal__tab--active");
    applyItemDbFilter();
  });

  itemDbSearch.addEventListener("input", applyItemDbFilter);

  itemDbWikiBtn.addEventListener("click", doWikiSearch);
  itemDbWikiInput.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") doWikiSearch();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !itemDbModal.classList.contains("farm-modal--hidden")) {
      closeItemDbModal();
    }
    if (e.key === "Escape" && !itemDetailModal.classList.contains("farm-modal--hidden")) {
      closeItemDetailModal();
    }
  });

  bus.on("items_data", (p) => {
    renderItemDbTable((p as { items: GameItemPayload[] }).items);
  });

  bus.on("wiki_item_search_result", (payload) => {
    const p = payload as {
      query: string;
      found: boolean;
      name?: string;
      itemType?: string;
      text?: string;
      loadLocation?: string;
      error?: string;
    };
    itemDbWikiBtn.disabled = false;
    if (!p.found) {
      itemDbWikiResult.classList.add("items-modal__wiki-result--error");
      itemDbWikiResult.textContent = p.error ?? `«${p.query}» — не найдено на вики`;
    } else {
      itemDbWikiResult.classList.remove("items-modal__wiki-result--error");
      const parts: string[] = [];
      if (p.name) parts.push(`${p.name}${p.itemType ? ` (${p.itemType})` : ""}`);
      if (p.text) parts.push(p.text);
      if (p.loadLocation) parts.push(`Лоад: ${p.loadLocation}`);
      itemDbWikiResult.textContent = parts.join("\n\n") || "Найдено, но карточка пуста";
      send({ type: "item_db_get" });
    }
  });
}

export function openItemDbModal(): void {
  init();
  itemDbModal.classList.remove("farm-modal--hidden");
  send({ type: "item_db_get" });
}
