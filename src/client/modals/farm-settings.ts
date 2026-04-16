// Farm settings modal — loaded as a dynamic-import chunk on first click
// of the #farm-settings-button.
//
// Owns: farm-settings-modal DOM refs, form fill/commit, zone-scoped local
// state (farmModalZoneId). Server pushes farm_settings_data via the bus
// (with payload-replay so data that arrived before the chunk loaded is
// still applied on first open).

import type { ClientEvent, FarmSettings } from "../types.ts";
import * as bus from "../bus.ts";

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required UI element: ${selector}`);
  return el;
}

const farmSettingsModal = requireElement<HTMLDivElement>("#farm-settings-modal");
const farmModalBackdrop = requireElement<HTMLDivElement>("#farm-settings-modal .farm-modal__backdrop");
const farmModalAttackCommand = requireElement<HTMLInputElement>("#farm-modal-attack-command");
const farmModalSkinningEnabled = requireElement<HTMLInputElement>("#farm-modal-skinning-enabled");
const farmModalSkinningVerb = requireElement<HTMLInputElement>("#farm-modal-skinning-verb");
const farmModalLootMeat = requireElement<HTMLInputElement>("#farm-modal-loot-meat");
const farmModalLootHide = requireElement<HTMLInputElement>("#farm-modal-loot-hide");
const farmModalClose = requireElement<HTMLButtonElement>("#farm-modal-close");
const farmModalCancel = requireElement<HTMLButtonElement>("#farm-modal-cancel");
const farmModalStart = requireElement<HTMLButtonElement>("#farm-modal-start");

let farmModalZoneId: number | null = null;

function defaultFarmSettings(): FarmSettings {
  return {
    attackCommand: "заколоть",
    skinningSalvoEnabled: false,
    skinningSkinVerb: "освеж",
    lootMeatCommand: "бро все.мяс",
    lootHideCommand: "пол все.шкур хлам",
  };
}

function normalizeFarmSettings(raw: Partial<FarmSettings>): FarmSettings {
  const def = defaultFarmSettings();
  return {
    attackCommand: typeof raw.attackCommand === "string" ? raw.attackCommand : def.attackCommand,
    skinningSalvoEnabled: typeof raw.skinningSalvoEnabled === "boolean" ? raw.skinningSalvoEnabled : def.skinningSalvoEnabled,
    skinningSkinVerb: typeof raw.skinningSkinVerb === "string" ? raw.skinningSkinVerb : def.skinningSkinVerb,
    lootMeatCommand: typeof raw.lootMeatCommand === "string" ? raw.lootMeatCommand : def.lootMeatCommand,
    lootHideCommand: typeof raw.lootHideCommand === "string" ? raw.lootHideCommand : def.lootHideCommand,
  };
}

function fillFarmModal(settings: FarmSettings): void {
  farmModalAttackCommand.value = settings.attackCommand;
  farmModalSkinningEnabled.checked = settings.skinningSalvoEnabled;
  farmModalSkinningVerb.value = settings.skinningSkinVerb;
  farmModalLootMeat.value = settings.lootMeatCommand;
  farmModalLootHide.value = settings.lootHideCommand;
}

function send(ev: ClientEvent): void {
  bus.emit("client_send", ev);
}

function closeFarmSettingsModal(): void {
  farmModalZoneId = null;
  farmSettingsModal.classList.add("farm-modal--hidden");
}

function commitFarmSettings(): void {
  const settings: FarmSettings = {
    attackCommand: farmModalAttackCommand.value.trim(),
    skinningSalvoEnabled: farmModalSkinningEnabled.checked,
    skinningSkinVerb: farmModalSkinningVerb.value.trim(),
    lootMeatCommand: farmModalLootMeat.value.trim(),
    lootHideCommand: farmModalLootHide.value.trim(),
  };

  if (farmModalZoneId !== null) {
    send({
      type: "farm_settings_save",
      payload: { zoneId: farmModalZoneId, settings },
    });
  }

  closeFarmSettingsModal();
}

let initialized = false;
function init(): void {
  if (initialized) return;
  initialized = true;

  farmModalStart.addEventListener("click", commitFarmSettings);
  farmModalClose.addEventListener("click", closeFarmSettingsModal);
  farmModalCancel.addEventListener("click", closeFarmSettingsModal);
  farmModalBackdrop.addEventListener("click", closeFarmSettingsModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !farmSettingsModal.classList.contains("farm-modal--hidden")) {
      closeFarmSettingsModal();
    }
  });

  bus.on<{ zoneId: number; settings: FarmSettings | string | null }>("farm_settings_data", (payload) => {
    const rawSettings = payload.settings;
    const parsedSettings = typeof rawSettings === "string"
      ? (() => { try { return JSON.parse(rawSettings) as Partial<FarmSettings>; } catch { return null; } })()
      : rawSettings;
    if (parsedSettings !== null && farmModalZoneId === payload.zoneId) {
      fillFarmModal(normalizeFarmSettings(parsedSettings));
    }
  });
}

export function openFarmSettingsModal(zoneId: number): void {
  init();
  farmModalZoneId = zoneId;
  fillFarmModal(defaultFarmSettings());
  farmSettingsModal.classList.remove("farm-modal--hidden");
  farmModalAttackCommand.focus();
  send({ type: "farm_settings_get", payload: { zoneId } });
}
