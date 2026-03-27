import type { AutoSpellsSettings } from "./auto-spells-ui.ts";

interface SneakUiDeps {
  sendClientEvent(event: { type: "sneak_settings_get" } | { type: "sneak_settings_save"; payload: AutoSpellsSettings }): void;
}

const DEFAULT_INTERVAL_SEC = 20;

function requireEl<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

function createRow(spell: { name: string; command: string; enabled: boolean } = { name: "", command: "", enabled: true }): HTMLTableRowElement {
  const tr = document.createElement("tr");

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "topbar__input";
  nameInput.placeholder = "подкрадывание";
  nameInput.value = spell.name;
  nameInput.dataset.field = "name";

  const cmdInput = document.createElement("input");
  cmdInput.type = "text";
  cmdInput.className = "topbar__input";
  cmdInput.placeholder = "подкрасться";
  cmdInput.value = spell.command;
  cmdInput.dataset.field = "command";

  const enabledInput = document.createElement("input");
  enabledInput.type = "checkbox";
  enabledInput.checked = spell.enabled;
  enabledInput.dataset.field = "enabled";

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "button-secondary button-small";
  delBtn.textContent = "✕";
  delBtn.addEventListener("click", () => tr.remove());

  const tdName = document.createElement("td");
  tdName.appendChild(nameInput);
  const tdCmd = document.createElement("td");
  tdCmd.appendChild(cmdInput);
  const tdEnabled = document.createElement("td");
  tdEnabled.style.textAlign = "center";
  tdEnabled.appendChild(enabledInput);
  const tdDel = document.createElement("td");
  tdDel.appendChild(delBtn);

  tr.append(tdName, tdCmd, tdEnabled, tdDel);
  return tr;
}

function fill(tbody: HTMLTableSectionElement, intervalInput: HTMLInputElement, settings: AutoSpellsSettings): void {
  tbody.innerHTML = "";
  for (const spell of settings.spells) tbody.appendChild(createRow(spell));
  intervalInput.value = String(Math.round(settings.checkIntervalMs / 1000));
}

function collect(tbody: HTMLTableSectionElement, intervalInput: HTMLInputElement): AutoSpellsSettings {
  const rows = Array.from(tbody.querySelectorAll("tr")) as HTMLTableRowElement[];
  const spells: Array<{ name: string; command: string; enabled: boolean }> = [];
  for (const row of rows) {
    const name = ((row.querySelector("[data-field='name']") as HTMLInputElement | null)?.value ?? "").trim();
    const command = ((row.querySelector("[data-field='command']") as HTMLInputElement | null)?.value ?? "").trim();
    const enabled = (row.querySelector("[data-field='enabled']") as HTMLInputElement | null)?.checked ?? true;
    if (name || command) spells.push({ name, command, enabled });
  }
  const sec = parseInt(intervalInput.value, 10);
  return { spells, checkIntervalMs: Number.isFinite(sec) && sec >= 5 ? sec * 1000 : DEFAULT_INTERVAL_SEC * 1000 };
}

export function initSneakUi(deps: SneakUiDeps): (settings: AutoSpellsSettings) => void {
  const modal = requireEl<HTMLDivElement>("#sneak-modal");
  const backdrop = requireEl<HTMLDivElement>("#sneak-modal .farm-modal__backdrop");
  const tbody = requireEl<HTMLTableSectionElement>("#sneak-table-body");
  const intervalInput = requireEl<HTMLInputElement>("#sneak-interval");
  const btnOpen = requireEl<HTMLButtonElement>("#sneak-button");
  const btnClose = requireEl<HTMLButtonElement>("#sneak-modal-close");
  const btnCancel = requireEl<HTMLButtonElement>("#sneak-modal-cancel");
  const btnAdd = requireEl<HTMLButtonElement>("#sneak-add-row");
  const btnSave = requireEl<HTMLButtonElement>("#sneak-modal-save");

  function open(): void {
    fill(tbody, intervalInput, { spells: [], checkIntervalMs: DEFAULT_INTERVAL_SEC * 1000 });
    modal.classList.remove("farm-modal--hidden");
    deps.sendClientEvent({ type: "sneak_settings_get" });
  }

  function close(): void {
    modal.classList.add("farm-modal--hidden");
  }

  btnOpen.addEventListener("click", open);
  btnClose.addEventListener("click", close);
  btnCancel.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  btnAdd.addEventListener("click", () => tbody.appendChild(createRow()));
  btnSave.addEventListener("click", () => {
    deps.sendClientEvent({ type: "sneak_settings_save", payload: collect(tbody, intervalInput) });
    close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("farm-modal--hidden")) close();
  });

  return (settings: AutoSpellsSettings) => fill(tbody, intervalInput, settings);
}
