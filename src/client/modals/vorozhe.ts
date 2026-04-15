// Vorozhe (city-routing) modal — loaded as a dynamic-import chunk on first
// click of the #vorozhe-button. Owns its DOM refs, state, and listeners.
//
// Receives server payloads via the bus (replays the last cached payload if
// any was received before this chunk loaded).

import type { ClientEvent } from "../types.ts";
import { VOROZHE_CITIES } from "../constants.ts";
import * as bus from "../bus.ts";

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required UI element: ${selector}`);
  return el;
}

const vorozheModal = requireElement<HTMLDivElement>("#vorozhe-modal");
const vorozheModalClose = requireElement<HTMLButtonElement>("#vorozhe-modal-close");
const vorozheModalCancel = requireElement<HTMLButtonElement>("#vorozhe-modal-cancel");
const vorozheModalBackdrop = requireElement<HTMLDivElement>("#vorozhe-modal .farm-modal__backdrop");
const vorozheFromButtons = requireElement<HTMLDivElement>("#vorozhe-from-buttons");
const vorozheToButtons = requireElement<HTMLDivElement>("#vorozhe-to-buttons");
const vorozheResult = requireElement<HTMLDivElement>("#vorozhe-result");
const vorozheNoRoute = requireElement<HTMLDivElement>("#vorozhe-no-route");
const vorozheRouteTable = requireElement<HTMLTableElement>("#vorozhe-route-table");
const vorozheRouteTbody = requireElement<HTMLTableSectionElement>("#vorozhe-route-tbody");
const vorozheTotal = requireElement<HTMLDivElement>("#vorozhe-total");

let vorozheFrom: string | null = null;
const vororozheFromButtons: HTMLButtonElement[] = [];
let vorozheTo: string | null = null;
const vorozheToButtonsList: HTMLButtonElement[] = [];

function maybeRequestVorozheRoute(): void {
  if (!vorozheFrom || !vorozheTo) return;
  const ev: ClientEvent = { type: "vorozhe_route_find", payload: { from: vorozheFrom, to: vorozheTo } };
  bus.emit("client_send", ev);
}

function closeVorozheModal(): void {
  vorozheModal.classList.add("farm-modal--hidden");
}

function renderVorozheResult(payload: {
  from: string;
  to: string;
  found: boolean;
  steps: Array<{ from: string; to: string; items: string[] }>;
  totalItems: Record<string, number>;
}): void {
  vorozheResult.classList.remove("vorozhe-modal__result--hidden");

  if (!payload.found || payload.steps.length === 0) {
    vorozheNoRoute.classList.remove("vorozhe-modal__no-route--hidden");
    vorozheNoRoute.textContent =
      payload.from === payload.to ? "Вы уже в этом городе" : "Маршрут не найден";
    vorozheRouteTable.classList.add("vorozhe-modal__table--hidden");
    vorozheTotal.classList.add("vorozhe-modal__total--hidden");
    return;
  }

  vorozheNoRoute.classList.add("vorozhe-modal__no-route--hidden");
  vorozheRouteTable.classList.remove("vorozhe-modal__table--hidden");
  vorozheTotal.classList.remove("vorozhe-modal__total--hidden");

  vorozheRouteTbody.innerHTML = "";
  for (const step of payload.steps) {
    const tr = document.createElement("tr");
    const tdFrom = document.createElement("td");
    tdFrom.textContent = step.from;
    const tdTo = document.createElement("td");
    tdTo.textContent = step.to;
    const tdItems = document.createElement("td");
    for (const item of step.items) {
      const badge = document.createElement("span");
      badge.className = "vorozhe-item-badge";
      badge.textContent = item;
      tdItems.appendChild(badge);
    }
    tr.appendChild(tdFrom);
    tr.appendChild(tdTo);
    tr.appendChild(tdItems);
    vorozheRouteTbody.appendChild(tr);
  }

  const totalEntries = Object.entries(payload.totalItems);
  if (totalEntries.length > 0) {
    vorozheTotal.textContent = `Итого нужно: ${totalEntries.map(([item, count]) => `${item} ×${count}`).join(", ")}`;
  } else {
    vorozheTotal.classList.add("vorozhe-modal__total--hidden");
  }
}

let modalInitialized = false;
function initVorozheModal(): void {
  if (modalInitialized) return;
  modalInitialized = true;

  VOROZHE_CITIES.forEach((city) => {
    const fromBtn = document.createElement("button");
    fromBtn.type = "button";
    fromBtn.className = "vorozhe-city-btn";
    fromBtn.textContent = city;
    fromBtn.addEventListener("click", () => {
      vorozheFrom = city;
      vororozheFromButtons.forEach((b) => b.classList.remove("vorozhe-city-btn--active"));
      fromBtn.classList.add("vorozhe-city-btn--active");
      maybeRequestVorozheRoute();
    });
    vorozheFromButtons.appendChild(fromBtn);
    vororozheFromButtons.push(fromBtn);

    const toBtn = document.createElement("button");
    toBtn.type = "button";
    toBtn.className = "vorozhe-city-btn";
    toBtn.textContent = city;
    toBtn.addEventListener("click", () => {
      vorozheTo = city;
      vorozheToButtonsList.forEach((b) => b.classList.remove("vorozhe-city-btn--active"));
      toBtn.classList.add("vorozhe-city-btn--active");
      maybeRequestVorozheRoute();
    });
    vorozheToButtons.appendChild(toBtn);
    vorozheToButtonsList.push(toBtn);
  });

  vorozheModalClose.addEventListener("click", closeVorozheModal);
  vorozheModalCancel.addEventListener("click", closeVorozheModal);
  vorozheModalBackdrop.addEventListener("click", closeVorozheModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !vorozheModal.classList.contains("farm-modal--hidden")) {
      closeVorozheModal();
    }
  });

  bus.on("vorozhe_route_result", (payload) => {
    renderVorozheResult(payload as Parameters<typeof renderVorozheResult>[0]);
  });
}

export function openVorozheModal(): void {
  initVorozheModal();
  vorozheModal.classList.remove("farm-modal--hidden");
}
