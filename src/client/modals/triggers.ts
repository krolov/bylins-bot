// Triggers configuration modal — loaded as a dynamic-import chunk on first
// click of the #triggers-button.
//
// Owns: triggers-modal DOM refs, the 7 checkbox toggles, the assist-tanks
// list editor, and the local mirror of trigger state. Server pushes
// triggers_state via the bus (with payload-replay so a state that arrived
// before the chunk loaded is still applied on first open).

import type { ClientEvent } from "../types.ts";
import * as bus from "../bus.ts";

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required UI element: ${selector}`);
  return el;
}

const triggersModal = requireElement<HTMLDivElement>("#triggers-modal");
const triggersModalBackdrop = requireElement<HTMLDivElement>("#triggers-modal .farm-modal__backdrop");
const triggersModalClose = requireElement<HTMLButtonElement>("#triggers-modal-close");
const triggersModalCancel = requireElement<HTMLButtonElement>("#triggers-modal-cancel");
const triggerDodgeCheckbox = requireElement<HTMLInputElement>("#trigger-dodge");
const triggerStandUpCheckbox = requireElement<HTMLInputElement>("#trigger-stand-up");
const triggerRearmCheckbox = requireElement<HTMLInputElement>("#trigger-rearm");
const triggerCurseCheckbox = requireElement<HTMLInputElement>("#trigger-curse");
const triggerLightCheckbox = requireElement<HTMLInputElement>("#trigger-light");
const triggerFollowLeaderCheckbox = requireElement<HTMLInputElement>("#trigger-follow-leader");
const triggerAssistCheckbox = requireElement<HTMLInputElement>("#trigger-assist");
const assistTanksList = requireElement<HTMLDivElement>("#assist-tanks-list");
const assistTankInput = requireElement<HTMLInputElement>("#assist-tank-input");
const assistTankAddBtn = requireElement<HTMLButtonElement>("#assist-tank-add-btn");

type TriggerState = {
  dodge: boolean;
  standUp: boolean;
  rearm: boolean;
  curse: boolean;
  light: boolean;
  followLeader: boolean;
  assist: boolean;
  assistTanks: string[];
};

let currentTriggerState: TriggerState = {
  dodge: true, standUp: true, rearm: true, curse: false,
  light: false, followLeader: true, assist: false, assistTanks: [],
};

function send(ev: ClientEvent): void {
  bus.emit("client_send", ev);
}

function renderAssistTanks(tanks: string[]): void {
  assistTanksList.innerHTML = "";
  for (const tank of tanks) {
    const item = document.createElement("div");
    item.className = "assist-tank-item";
    const name = document.createElement("span");
    name.className = "assist-tank-item__name";
    name.textContent = tank;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "button-secondary button-small";
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      const updated = currentTriggerState.assistTanks.filter((t) => t !== tank);
      currentTriggerState = { ...currentTriggerState, assistTanks: updated };
      send({ type: "triggers_toggle", payload: { assistTanks: updated } });
      renderAssistTanks(updated);
    });
    item.appendChild(name);
    item.appendChild(removeBtn);
    assistTanksList.appendChild(item);
  }
}

function applyStateToCheckboxes(): void {
  triggerDodgeCheckbox.checked = currentTriggerState.dodge;
  triggerStandUpCheckbox.checked = currentTriggerState.standUp;
  triggerRearmCheckbox.checked = currentTriggerState.rearm;
  triggerCurseCheckbox.checked = currentTriggerState.curse;
  triggerLightCheckbox.checked = currentTriggerState.light;
  triggerFollowLeaderCheckbox.checked = currentTriggerState.followLeader;
  triggerAssistCheckbox.checked = currentTriggerState.assist;
  renderAssistTanks(currentTriggerState.assistTanks);
}

function closeTriggersModal(): void {
  triggersModal.classList.add("farm-modal--hidden");
}

let initialized = false;
function init(): void {
  if (initialized) return;
  initialized = true;

  triggersModalClose.addEventListener("click", closeTriggersModal);
  triggersModalCancel.addEventListener("click", closeTriggersModal);
  triggersModalBackdrop.addEventListener("click", closeTriggersModal);

  triggerDodgeCheckbox.addEventListener("change", () => {
    currentTriggerState = { ...currentTriggerState, dodge: triggerDodgeCheckbox.checked };
    send({ type: "triggers_toggle", payload: { dodge: triggerDodgeCheckbox.checked } });
  });
  triggerStandUpCheckbox.addEventListener("change", () => {
    currentTriggerState = { ...currentTriggerState, standUp: triggerStandUpCheckbox.checked };
    send({ type: "triggers_toggle", payload: { standUp: triggerStandUpCheckbox.checked } });
  });
  triggerRearmCheckbox.addEventListener("change", () => {
    currentTriggerState = { ...currentTriggerState, rearm: triggerRearmCheckbox.checked };
    send({ type: "triggers_toggle", payload: { rearm: triggerRearmCheckbox.checked } });
  });
  triggerCurseCheckbox.addEventListener("change", () => {
    currentTriggerState = { ...currentTriggerState, curse: triggerCurseCheckbox.checked };
    send({ type: "triggers_toggle", payload: { curse: triggerCurseCheckbox.checked } });
  });
  triggerLightCheckbox.addEventListener("change", () => {
    currentTriggerState = { ...currentTriggerState, light: triggerLightCheckbox.checked };
    send({ type: "triggers_toggle", payload: { light: triggerLightCheckbox.checked } });
  });
  triggerFollowLeaderCheckbox.addEventListener("change", () => {
    currentTriggerState = { ...currentTriggerState, followLeader: triggerFollowLeaderCheckbox.checked };
    send({ type: "triggers_toggle", payload: { followLeader: triggerFollowLeaderCheckbox.checked } });
  });
  triggerAssistCheckbox.addEventListener("change", () => {
    currentTriggerState = { ...currentTriggerState, assist: triggerAssistCheckbox.checked };
    send({ type: "triggers_toggle", payload: { assist: triggerAssistCheckbox.checked } });
  });

  assistTankAddBtn.addEventListener("click", () => {
    const name = assistTankInput.value.trim();
    if (!name) return;
    if (currentTriggerState.assistTanks.includes(name)) return;
    const updated = [...currentTriggerState.assistTanks, name];
    currentTriggerState = { ...currentTriggerState, assistTanks: updated };
    send({ type: "triggers_toggle", payload: { assistTanks: updated } });
    renderAssistTanks(updated);
    assistTankInput.value = "";
  });

  assistTankInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") assistTankAddBtn.click();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !triggersModal.classList.contains("farm-modal--hidden")) {
      closeTriggersModal();
    }
  });

  bus.on("triggers_state", (payload) => {
    currentTriggerState = payload as TriggerState;
    if (!triggersModal.classList.contains("farm-modal--hidden")) {
      applyStateToCheckboxes();
    }
  });
}

export function openTriggersModal(): void {
  init();
  applyStateToCheckboxes();
  triggersModal.classList.remove("farm-modal--hidden");
}
