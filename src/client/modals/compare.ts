// Compare Advisor modal — loaded as a dynamic-import chunk on first click of
// the #compare-button. Owns its DOM refs, scan request, and the
// compare_scan_progress / compare_scan_result handlers via the bus.

import type { ClientEvent, CompareScanPayload } from "../types.ts";
import * as bus from "../bus.ts";

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required UI element: ${selector}`);
  return el;
}

const compareAdvisorPanel = requireElement<HTMLDivElement>("#compare-advisor-panel");
const compareAdvisorClose = requireElement<HTMLButtonElement>("#compare-advisor-close");
const compareAdvisorStatus = requireElement<HTMLParagraphElement>("#compare-advisor-status");
const compareAdvisorTableBody = requireElement<HTMLTableSectionElement>("#compare-advisor-table-body");
const compareAdvisorCoins = requireElement<HTMLParagraphElement>("#compare-advisor-coins");

function send(ev: ClientEvent): void {
  bus.emit("client_send", ev);
}

function closeCompareAdvisor(): void {
  compareAdvisorPanel.classList.add("compare-advisor-panel--hidden");
}

function buildTooltip(card: CompareScanPayload["slots"][0]["candidates"][0]["card"] | null): string {
  if (!card) return "";
  const lines: string[] = [];
  if (card.itemType) lines.push(`Тип: ${card.itemType}`);
  if (card.material) lines.push(`Материал: ${card.material}`);
  if (card.ac) lines.push(`Защита: ${card.ac}`);
  if (card.armor) lines.push(`Броня: ${card.armor}`);
  if (card.damageAvg) lines.push(`Урон (avg): ${card.damageAvg}`);
  if (card.affects.length > 0) lines.push("", ...card.affects.map((a) => `+ ${a}`));
  if (card.properties.length > 0) lines.push("", ...card.properties.map((p) => `• ${p}`));
  return lines.join("\n");
}

function attachTooltip(el: HTMLElement, text: string): void {
  if (!text) return;
  const tip = document.createElement("div");
  tip.className = "compare-advisor__tooltip";
  tip.textContent = text;
  el.appendChild(tip);
  el.addEventListener("mouseenter", () => {
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    tip.classList.toggle("compare-advisor__tooltip--above", spaceBelow < 160);
    tip.classList.add("compare-advisor__tooltip--visible");
  });
  el.addEventListener("mouseleave", () => {
    tip.classList.remove("compare-advisor__tooltip--visible");
  });
}

function toStorageKeyword(name: string): string {
  const words = name
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .map((w) => w.slice(0, -2));
  if (words.length === 0) return name.toLowerCase().trim().slice(0, 4);
  return words.join(".");
}

function renderComparePanel(payload: CompareScanPayload): void {
  compareAdvisorPanel.classList.remove("compare-advisor-panel--hidden");
  compareAdvisorCoins.textContent = payload.hasShop
    ? `Монет: ${payload.coins}`
    : `Монет: ${payload.coins} (магазина нет)`;

  compareAdvisorTableBody.innerHTML = "";

  for (const slot of payload.slots) {
    if (slot.candidates.length === 0) continue;

    const currentRow = document.createElement("tr");
    currentRow.className = "compare-advisor__current-row";

    const slotTd = document.createElement("td");
    slotTd.className = "compare-advisor__slot-cell";
    slotTd.textContent = slot.slot;

    const currentNameTd = document.createElement("td");
    currentNameTd.className = "compare-advisor__current-item compare-advisor__item-name";
    currentNameTd.colSpan = 4;
    currentNameTd.textContent = slot.currentItemName
      ? `${slot.currentItemName} (${Math.round(slot.currentScore)} оч.)`
      : "— пусто —";
    if (slot.currentCard) attachTooltip(currentNameTd, buildTooltip(slot.currentCard));

    currentRow.appendChild(slotTd);
    currentRow.appendChild(currentNameTd);
    currentRow.appendChild(document.createElement("td"));
    compareAdvisorTableBody.appendChild(currentRow);

    for (const c of slot.candidates) {
      const sourceLabel =
        c.source === "shop" ? `м:${c.listNumber}` :
        c.source === "bazaar" ? `б:${c.listNumber}` :
        c.source === "guild_storage" ? "хр" : "инв";
      const scoreDiff = Math.round(c.score - slot.currentScore);
      const diffText = scoreDiff > 0 ? `+${scoreDiff}` : `${scoreDiff}`;
      const diffClass = scoreDiff > 0 ? "compare-advisor__diff--better" : "compare-advisor__diff--worse";

      const tr = document.createElement("tr");
      tr.className = "compare-advisor__candidate-row";

      const nameCell = document.createElement("td");
      nameCell.className = "compare-advisor__name-cell compare-advisor__item-name compare-advisor__name-cell--indent";
      nameCell.colSpan = 2;
      nameCell.textContent = c.itemName;
      attachTooltip(nameCell, buildTooltip(c.card));

      const priceCell = document.createElement("td");
      priceCell.textContent = (c.source === "inventory" || c.source === "guild_storage") ? "—" : `${c.price}`;

      const sourceCell = document.createElement("td");
      sourceCell.textContent = sourceLabel;

      const scoreCell = document.createElement("td");
      scoreCell.innerHTML = `${Math.round(c.score)} <span class="${diffClass}">(${diffText})</span>`;

      const actionCell = document.createElement("td");
      if (!c.hasGameData) {
        const charBtn = document.createElement("button");
        charBtn.type = "button";
        charBtn.className = "compare-advisor__char-btn button-secondary button-small";
        charBtn.textContent = "хар";
        charBtn.title = "Запросить характеристики из игры";
        charBtn.addEventListener("click", () => {
          const charCmd = c.source === "bazaar"
            ? `базар характ ${c.listNumber}`
            : c.source === "guild_storage"
            ? `хранилище характ ${toStorageKeyword(c.itemName)}`
            : `характ ${c.listNumber}`;
          send({ type: "send", payload: { command: charCmd } });
        });
        actionCell.appendChild(charBtn);
      }
      if (c.source !== "inventory") {
        const applyBtn = document.createElement("button");
        applyBtn.type = "button";
        applyBtn.className = "compare-advisor__apply-btn button-secondary button-small";
        applyBtn.textContent = "Взять";
        applyBtn.addEventListener("click", () => {
          const commands: string[] = [];
          if (c.source === "shop") commands.push(`купить ${c.listNumber}`);
          else if (c.source === "bazaar") commands.push(`bazaar buy ${c.listNumber}`);
          else if (c.source === "guild_storage") commands.push(`хранилище взять ${toStorageKeyword(c.itemName)}`);
          send({ type: "compare_apply", payload: { commands } });
        });
        actionCell.appendChild(applyBtn);
      }

      tr.appendChild(nameCell);
      tr.appendChild(priceCell);
      tr.appendChild(sourceCell);
      tr.appendChild(scoreCell);
      tr.appendChild(actionCell);
      compareAdvisorTableBody.appendChild(tr);
    }
  }

  const notFoundStorage = payload.notFound.filter((i) => i.source === "guild_storage");
  if (notFoundStorage.length > 0) {
    const headerRow = document.createElement("tr");
    headerRow.className = "compare-advisor__notfound-header-row";
    const headerTd = document.createElement("td");
    headerTd.colSpan = 5;
    headerTd.className = "compare-advisor__notfound-header";
    headerTd.textContent = `Не в базе — хранилище (${notFoundStorage.length})`;
    headerRow.appendChild(headerTd);
    compareAdvisorTableBody.appendChild(headerRow);

    for (const item of notFoundStorage) {
      const tr = document.createElement("tr");
      tr.className = "compare-advisor__notfound-row";

      const nameTd = document.createElement("td");
      nameTd.className = "compare-advisor__name-cell compare-advisor__item-name compare-advisor__name-cell--indent";
      nameTd.colSpan = 2;
      nameTd.textContent = item.name;

      const priceTd = document.createElement("td");
      priceTd.textContent = "—";

      const sourceTd = document.createElement("td");
      sourceTd.textContent = `хр:${item.listNumber}`;

      const actionTd = document.createElement("td");
      const charBtn = document.createElement("button");
      charBtn.type = "button";
      charBtn.className = "compare-advisor__char-btn button-secondary button-small";
      charBtn.textContent = "хар";
      charBtn.addEventListener("click", () => {
        const kw = toStorageKeyword(item.name);
        send({ type: "send", payload: { command: `хранилище опознать ${kw}` } });
        tr.style.display = "none";
      });
      actionTd.appendChild(charBtn);

      tr.appendChild(nameTd);
      tr.appendChild(priceTd);
      tr.appendChild(sourceTd);
      tr.appendChild(actionTd);
      compareAdvisorTableBody.appendChild(tr);
    }
  }

  const notFoundShop = payload.notFound.filter((i) => i.source === "shop");
  if (payload.hasShop && notFoundShop.length > 0) {
    const headerRow = document.createElement("tr");
    headerRow.className = "compare-advisor__notfound-header-row";
    const headerTd = document.createElement("td");
    headerTd.colSpan = 5;
    headerTd.className = "compare-advisor__notfound-header";
    headerTd.textContent = `Не в базе — магазин (${notFoundShop.length})`;
    headerRow.appendChild(headerTd);
    compareAdvisorTableBody.appendChild(headerRow);

    for (const item of notFoundShop) {
      const tr = document.createElement("tr");
      tr.className = "compare-advisor__notfound-row";

      const nameTd = document.createElement("td");
      nameTd.className = "compare-advisor__name-cell compare-advisor__item-name compare-advisor__name-cell--indent";
      nameTd.colSpan = 2;
      nameTd.textContent = item.name;

      const priceTd = document.createElement("td");
      priceTd.textContent = `${item.price}`;

      const sourceTd = document.createElement("td");
      sourceTd.textContent = `м:${item.listNumber}`;

      const actionTd = document.createElement("td");
      const charBtn = document.createElement("button");
      charBtn.type = "button";
      charBtn.className = "compare-advisor__char-btn button-secondary button-small";
      charBtn.textContent = `хар ${item.listNumber}`;
      charBtn.addEventListener("click", () => {
        send({ type: "send", payload: { command: `характ ${item.listNumber}` } });
        tr.style.display = "none";
      });
      actionTd.appendChild(charBtn);

      tr.appendChild(nameTd);
      tr.appendChild(priceTd);
      tr.appendChild(sourceTd);
      tr.appendChild(actionTd);
      compareAdvisorTableBody.appendChild(tr);
    }
  }
}

let initialized = false;
function init(): void {
  if (initialized) return;
  initialized = true;
  compareAdvisorClose.addEventListener("click", closeCompareAdvisor);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !compareAdvisorPanel.classList.contains("compare-advisor-panel--hidden")) {
      closeCompareAdvisor();
    }
  });
  bus.on("compare_scan_progress", (p) => {
    compareAdvisorStatus.textContent = (p as { message: string }).message;
  });
  bus.on("compare_scan_result", (p) => {
    renderComparePanel(p as CompareScanPayload);
  });
}

export function openCompareAdvisor(): void {
  init();
  compareAdvisorPanel.classList.remove("compare-advisor-panel--hidden");
  compareAdvisorStatus.textContent = "Сканирование...";
  compareAdvisorTableBody.innerHTML = "";
  send({ type: "compare_scan_start" });
}
