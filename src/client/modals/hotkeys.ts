// Hotkeys configuration modal — loaded as a dynamic-import chunk on first
// click of the #hotkeys-button. Owns the table-edit UI + key-capture flow.
//
// The hotkeys runtime (the document-level keydown that actually sends MUD
// commands when a hotkey fires) stays in main.ts and remains eager — the
// user can use hotkeys without ever opening this modal.
//
// Sync between runtime and modal is done through the bus:
//   - on open, modal calls bus.emit("hotkeys_request") and waits for
//     bus.on("hotkeys_state", ...) reply.
//   - on save, modal calls bus.emit("hotkeys_save", entries); main.ts
//     persists and updates its in-memory array.

import type { HotkeyEntry } from "../types.ts";
import * as bus from "../bus.ts";

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required UI element: ${selector}`);
  return el;
}

const hotkeysModal = requireElement<HTMLDivElement>("#hotkeys-modal");
const hotkeysModalBackdrop = requireElement<HTMLDivElement>("#hotkeys-modal .farm-modal__backdrop");
const hotkeysModalClose = requireElement<HTMLButtonElement>("#hotkeys-modal-close");
const hotkeysModalCancel = requireElement<HTMLButtonElement>("#hotkeys-modal-cancel");
const hotkeysModalSave = requireElement<HTMLButtonElement>("#hotkeys-modal-save");
const hotkeysModalAddRow = requireElement<HTMLButtonElement>("#hotkeys-modal-add-row");
const hotkeysTableBody = requireElement<HTMLTableSectionElement>("#hotkeys-table-body");

let currentHotkeys: HotkeyEntry[] = [];
let capturingCell: { rowIndex: number; keyEl: HTMLInputElement } | null = null;

function renderHotkeysTable(entries: HotkeyEntry[]): void {
  hotkeysTableBody.innerHTML = "";

  entries.forEach((entry, idx) => {
    const tr = document.createElement("tr");
    tr.className = "hotkeys-modal__row";

    const tdKey = document.createElement("td");
    tdKey.className = "hotkeys-modal__cell";
    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.className = "topbar__input hotkeys-modal__key-input";
    keyInput.value = entry.label;
    keyInput.readOnly = true;
    keyInput.placeholder = "Нажмите кнопку…";
    keyInput.dataset.rowIndex = String(idx);
    keyInput.title = `Код: ${entry.key}`;

    keyInput.addEventListener("click", () => {
      capturingCell = { rowIndex: idx, keyEl: keyInput };
      keyInput.value = "…";
      keyInput.classList.add("hotkeys-modal__key-input--capturing");
    });

    tdKey.appendChild(keyInput);
    tr.appendChild(tdKey);

    const tdCmd = document.createElement("td");
    tdCmd.className = "hotkeys-modal__cell";
    const cmdInput = document.createElement("input");
    cmdInput.type = "text";
    cmdInput.className = "topbar__input hotkeys-modal__cmd-input";
    cmdInput.value = entry.command;
    cmdInput.placeholder = "команда";
    cmdInput.autocomplete = "off";
    cmdInput.dataset.rowIndex = String(idx);
    tdCmd.appendChild(cmdInput);
    tr.appendChild(tdCmd);

    const tdDel = document.createElement("td");
    tdDel.className = "hotkeys-modal__cell hotkeys-modal__cell--delete";
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "button-secondary button-small";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => {
      const currentEntries = readHotkeysFromTable();
      currentEntries.splice(idx, 1);
      renderHotkeysTable(currentEntries);
    });
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    hotkeysTableBody.appendChild(tr);
  });
}

function readHotkeysFromTable(): HotkeyEntry[] {
  const entries: HotkeyEntry[] = [];
  const rows = hotkeysTableBody.querySelectorAll<HTMLTableRowElement>(".hotkeys-modal__row");
  rows.forEach((row) => {
    const keyInput = row.querySelector<HTMLInputElement>(".hotkeys-modal__key-input");
    const cmdInput = row.querySelector<HTMLInputElement>(".hotkeys-modal__cmd-input");
    if (!keyInput || !cmdInput) return;
    const keyCode = keyInput.title.replace(/^Код: /, "");
    const label = keyInput.value;
    const command = cmdInput.value.trim();
    if (keyCode) {
      entries.push({ key: keyCode, label, command });
    }
  });
  return entries;
}

function keyToLabel(e: KeyboardEvent): string {
  const labels: Record<string, string> = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Enter: "Enter", Escape: "Esc", Tab: "Tab", Backspace: "⌫",
    Delete: "Del", Home: "Home", End: "End", PageUp: "PgUp", PageDown: "PgDn",
    Insert: "Ins", Space: "Пробел",
  };
  const base = labels[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : (/^F\d+$/.test(e.key) ? e.key : e.code || e.key));
  const prefix = e.metaKey ? "Cmd+" : e.altKey ? "Opt+" : e.ctrlKey ? "Ctrl+" : "";
  return prefix + base;
}

function closeHotkeysModal(): void {
  capturingCell = null;
  hotkeysModal.classList.add("farm-modal--hidden");
}

function commitHotkeys(): void {
  const entries = readHotkeysFromTable();
  currentHotkeys = entries;
  bus.emit("hotkeys_save", entries);
  closeHotkeysModal();
}

let initialized = false;
function init(): void {
  if (initialized) return;
  initialized = true;

  hotkeysModal.addEventListener("keydown", (e) => {
    if (!capturingCell) return;

    if (e.key === "Escape") {
      const prev = currentHotkeys[capturingCell.rowIndex];
      capturingCell.keyEl.value = prev?.label ?? "";
      capturingCell.keyEl.title = `Код: ${prev?.key ?? ""}`;
      capturingCell.keyEl.classList.remove("hotkeys-modal__key-input--capturing");
      capturingCell = null;
      e.stopPropagation();
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const label = keyToLabel(e);
    const modifier = e.metaKey ? "Cmd+" : e.altKey ? "Opt+" : e.ctrlKey ? "Ctrl+" : "";
    const keyCode = modifier + (e.code || e.key);
    capturingCell.keyEl.value = label;
    capturingCell.keyEl.title = `Код: ${keyCode}`;
    capturingCell.keyEl.classList.remove("hotkeys-modal__key-input--capturing");
    capturingCell = null;
  });

  hotkeysModalClose.addEventListener("click", closeHotkeysModal);
  hotkeysModalCancel.addEventListener("click", closeHotkeysModal);
  hotkeysModalBackdrop.addEventListener("click", closeHotkeysModal);
  hotkeysModalSave.addEventListener("click", commitHotkeys);

  hotkeysModalAddRow.addEventListener("click", () => {
    const currentEntries = readHotkeysFromTable();
    currentEntries.push({ key: "", label: "", command: "" });
    renderHotkeysTable(currentEntries);
    const rows = hotkeysTableBody.querySelectorAll<HTMLTableRowElement>(".hotkeys-modal__row");
    const lastRow = rows[rows.length - 1];
    lastRow?.querySelector<HTMLInputElement>(".hotkeys-modal__key-input")?.click();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !hotkeysModal.classList.contains("farm-modal--hidden")) {
      if (capturingCell) return;
      closeHotkeysModal();
    }
  });

  bus.on("hotkeys_state", (entries) => {
    currentHotkeys = entries as HotkeyEntry[];
    renderHotkeysTable([...currentHotkeys]);
  });
}

export function openHotkeysModal(): void {
  init();
  capturingCell = null;
  bus.emit("hotkeys_request", undefined);
  hotkeysModal.classList.remove("farm-modal--hidden");
}
