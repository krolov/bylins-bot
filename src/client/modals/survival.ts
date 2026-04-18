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
const survivalModalFoodItem = requireElement<HTMLInputElement>("#survival-modal-food-item");
const survivalModalEatCommand = requireElement<HTMLInputElement>("#survival-modal-eat-command");
const survivalModalClose = requireElement<HTMLButtonElement>("#survival-modal-close");
const survivalModalCancel = requireElement<HTMLButtonElement>("#survival-modal-cancel");
const survivalModalSave = requireElement<HTMLButtonElement>("#survival-modal-save");

function defaultSurvivalSettings(): SurvivalSettings {
  return { container: "", foodItem: "", eatCommand: "" };
}

function normalizeSurvivalSettings(raw: Partial<SurvivalSettings>): SurvivalSettings {
  const def = defaultSurvivalSettings();
  return {
    container: typeof raw.container === "string" ? raw.container : def.container,
    foodItem: typeof raw.foodItem === "string" ? raw.foodItem : def.foodItem,
    eatCommand: typeof raw.eatCommand === "string" ? raw.eatCommand : def.eatCommand,
  };
}

function fillSurvivalModal(settings: SurvivalSettings): void {
  survivalModalContainer.value = settings.container;
  survivalModalFoodItem.value = settings.foodItem;
  survivalModalEatCommand.value = settings.eatCommand;
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
    foodItem: survivalModalFoodItem.value.trim(),
    eatCommand: survivalModalEatCommand.value.trim(),
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
