// Survival settings modal — loaded as a dynamic-import chunk on first
// click of the #survival-settings-button.
//
// Owns: survival-settings-modal DOM refs, form fill/commit. The live
// `currentSurvivalSettings` lives in main.ts because action buttons
// (buy-food, fill-flask) depend on it; the modal communicates via the
// bus — it emits "survival_settings_commit" with normalized settings
// when the user saves, and listens to "survival_settings_data" replays
// to seed the form.

import type { ClientEvent } from "../types.ts";
import type { SurvivalSettings } from "../../events.type.ts";
import * as bus from "../bus.ts";

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required UI element: ${selector}`);
  return el;
}

const survivalSettingsModal = requireElement<HTMLDivElement>("#survival-settings-modal");
const survivalModalBackdrop = requireElement<HTMLDivElement>("#survival-settings-modal .farm-modal__backdrop");
const survivalModalContainer = requireElement<HTMLInputElement>("#survival-modal-container");
const survivalModalFoodItems = requireElement<HTMLTextAreaElement>("#survival-modal-food-items");
const survivalModalFlaskItems = requireElement<HTMLTextAreaElement>("#survival-modal-flask-items");
const survivalModalBuyFoodAlias = requireElement<HTMLInputElement>("#survival-modal-buy-food-alias");
const survivalModalBuyFoodItem = requireElement<HTMLInputElement>("#survival-modal-buy-food-item");
const survivalModalBuyFoodMax = requireElement<HTMLInputElement>("#survival-modal-buy-food-max");
const survivalModalFillFlaskAlias = requireElement<HTMLInputElement>("#survival-modal-fill-flask-alias");
const survivalModalFillFlaskSource = requireElement<HTMLInputElement>("#survival-modal-fill-flask-source");
const survivalModalClose = requireElement<HTMLButtonElement>("#survival-modal-close");
const survivalModalCancel = requireElement<HTMLButtonElement>("#survival-modal-cancel");
const survivalModalSave = requireElement<HTMLButtonElement>("#survival-modal-save");

function defaultSurvivalSettings(): SurvivalSettings {
  return { container: "", foodItems: "", flaskItems: "", buyFoodItem: "", buyFoodMax: 20, buyFoodAlias: "", fillFlaskAlias: "", fillFlaskSource: "" };
}

function normalizeSurvivalSettings(raw: Partial<SurvivalSettings>): SurvivalSettings {
  const def = defaultSurvivalSettings();
  return {
    container: typeof raw.container === "string" ? raw.container : def.container,
    foodItems: typeof raw.foodItems === "string" ? raw.foodItems : def.foodItems,
    flaskItems: typeof raw.flaskItems === "string" ? raw.flaskItems : def.flaskItems,
    buyFoodItem: typeof raw.buyFoodItem === "string" ? raw.buyFoodItem : def.buyFoodItem,
    buyFoodMax: typeof raw.buyFoodMax === "number" && Number.isFinite(raw.buyFoodMax) && raw.buyFoodMax > 0 ? Math.floor(raw.buyFoodMax) : def.buyFoodMax,
    buyFoodAlias: typeof raw.buyFoodAlias === "string" ? raw.buyFoodAlias : def.buyFoodAlias,
    fillFlaskAlias: typeof raw.fillFlaskAlias === "string" ? raw.fillFlaskAlias : def.fillFlaskAlias,
    fillFlaskSource: typeof raw.fillFlaskSource === "string" ? raw.fillFlaskSource : def.fillFlaskSource,
  };
}

function fillSurvivalModal(settings: SurvivalSettings): void {
  survivalModalContainer.value = settings.container;
  survivalModalFoodItems.value = settings.foodItems;
  survivalModalFlaskItems.value = settings.flaskItems;
  survivalModalBuyFoodItem.value = settings.buyFoodItem;
  survivalModalBuyFoodMax.value = String(settings.buyFoodMax);
  survivalModalBuyFoodAlias.value = settings.buyFoodAlias;
  survivalModalFillFlaskAlias.value = settings.fillFlaskAlias;
  survivalModalFillFlaskSource.value = settings.fillFlaskSource;
}

function send(ev: ClientEvent): void {
  bus.emit("client_send", ev);
}

let latestSettings: SurvivalSettings = defaultSurvivalSettings();

function closeSurvivalSettingsModal(): void {
  survivalSettingsModal.classList.add("farm-modal--hidden");
}

function commitSurvivalSettings(): void {
  latestSettings = normalizeSurvivalSettings({
    container: survivalModalContainer.value.trim(),
    foodItems: survivalModalFoodItems.value.trim(),
    flaskItems: survivalModalFlaskItems.value.trim(),
    buyFoodItem: survivalModalBuyFoodItem.value.trim(),
    buyFoodMax: Number(survivalModalBuyFoodMax.value) || 20,
    buyFoodAlias: survivalModalBuyFoodAlias.value.trim(),
    fillFlaskAlias: survivalModalFillFlaskAlias.value.trim(),
    fillFlaskSource: survivalModalFillFlaskSource.value.trim(),
  });

  send({ type: "survival_settings_save", payload: latestSettings });
  bus.emit("survival_settings_commit", latestSettings);
  closeSurvivalSettingsModal();
}

let initialized = false;
function init(): void {
  if (initialized) return;
  initialized = true;

  survivalModalClose.addEventListener("click", closeSurvivalSettingsModal);
  survivalModalCancel.addEventListener("click", closeSurvivalSettingsModal);
  survivalModalBackdrop.addEventListener("click", closeSurvivalSettingsModal);
  survivalModalSave.addEventListener("click", commitSurvivalSettings);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !survivalSettingsModal.classList.contains("farm-modal--hidden")) {
      closeSurvivalSettingsModal();
    }
  });

  bus.on<SurvivalSettings | null>("survival_settings_data", (payload) => {
    if (payload === null) return;
    latestSettings = normalizeSurvivalSettings(payload);
    if (!survivalSettingsModal.classList.contains("farm-modal--hidden")) {
      fillSurvivalModal(latestSettings);
    }
  });
}

export function openSurvivalSettingsModal(current: SurvivalSettings): void {
  init();
  latestSettings = current;
  fillSurvivalModal(current);
  survivalSettingsModal.classList.remove("farm-modal--hidden");
  survivalModalContainer.focus();
  send({ type: "survival_settings_get" });
}
