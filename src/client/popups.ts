// Alias / auto-command / map-context popups.
//
// These three popups share a tight lifecycle: right-clicking a map tile opens
// the context menu, from which the alias- or auto-command-popup is launched.
// They also share a common visual pattern (same CSS class `alias-popup`).
//
// The popups are bootstrapped once from main.ts via `createPopups()`. Because
// they need to read transient state held in main.ts (aliases, auto-commands,
// node names), the module takes a few getter callbacks rather than trying to
// own that state itself. Outbound WebSocket commands are fanned out through
// the shared pub-sub bus ("client_send"), mirroring the pattern used by
// modals and `inventory.ts`.

import * as bus from "./bus.ts";
import type { AliasPayload } from "./types.ts";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing required UI element: ${selector}`);
  }

  return element;
}

export interface PopupsDeps {
  getAliases: () => AliasPayload[];
  getRoomAutoCommands: () => Map<number, string>;
  getNodeName: (vnum: number) => string | undefined;
}

export interface Popups {
  openAliasPopup: (vnum: number, existingAlias: string | undefined, roomName: string) => void;
  openMapContextMenu: (vnum: number, x: number, y: number) => void;
}

export function createPopups(deps: PopupsDeps): Popups {
  const aliasPopup = requireElement<HTMLDivElement>("#alias-popup");
  const aliasPopupTitle = requireElement<HTMLSpanElement>("#alias-popup-title");
  const aliasPopupInput = requireElement<HTMLInputElement>("#alias-popup-input");
  const aliasPopupSave = requireElement<HTMLButtonElement>("#alias-popup-save");
  const aliasPopupDelete = requireElement<HTMLButtonElement>("#alias-popup-delete");
  const aliasPopupClose = requireElement<HTMLButtonElement>("#alias-popup-close");

  const mapContextMenu = requireElement<HTMLDivElement>("#map-context-menu");
  const mapContextGo = requireElement<HTMLButtonElement>("#map-context-go");
  const mapContextAlias = requireElement<HTMLButtonElement>("#map-context-alias");
  const mapContextAliasDelete = requireElement<HTMLButtonElement>("#map-context-alias-delete");
  const mapContextAutoCmd = requireElement<HTMLButtonElement>("#map-context-auto-cmd");
  const mapContextAutoCmdDelete = requireElement<HTMLButtonElement>("#map-context-auto-cmd-delete");

  const autoCmdPopup = requireElement<HTMLDivElement>("#auto-cmd-popup");
  const autoCmdPopupTitle = requireElement<HTMLSpanElement>("#auto-cmd-popup-title");
  const autoCmdPopupInput = requireElement<HTMLTextAreaElement>("#auto-cmd-popup-input");
  const autoCmdPopupSave = requireElement<HTMLButtonElement>("#auto-cmd-popup-save");
  const autoCmdPopupDelete = requireElement<HTMLButtonElement>("#auto-cmd-popup-delete");
  const autoCmdPopupClose = requireElement<HTMLButtonElement>("#auto-cmd-popup-close");

  let aliasPopupVnum: number | null = null;
  let autoCmdPopupVnum: number | null = null;
  let mapContextMenuVnum: number | null = null;

  function openAliasPopup(vnum: number, existingAlias: string | undefined, roomName: string): void {
    aliasPopupVnum = vnum;
    aliasPopupTitle.textContent = `Алиас: ${roomName} (${vnum})`;
    aliasPopupInput.value = existingAlias ?? "";
    aliasPopupDelete.classList.toggle("alias-popup__delete--hidden", !existingAlias);
    aliasPopup.classList.remove("alias-popup--hidden");
    aliasPopupInput.focus();
  }

  function closeAliasPopup(): void {
    aliasPopupVnum = null;
    aliasPopup.classList.add("alias-popup--hidden");
  }

  function openAutoCmdPopup(vnum: number, existingCommand: string | undefined, roomName: string): void {
    autoCmdPopupVnum = vnum;
    autoCmdPopupTitle.textContent = `Авто-команда: ${roomName} (${vnum})`;
    autoCmdPopupInput.value = existingCommand ?? "";
    autoCmdPopupDelete.classList.toggle("alias-popup__delete--hidden", !existingCommand);
    autoCmdPopup.classList.remove("alias-popup--hidden");
    autoCmdPopupInput.focus();
  }

  function closeAutoCmdPopup(): void {
    autoCmdPopupVnum = null;
    autoCmdPopup.classList.add("alias-popup--hidden");
  }

  function openMapContextMenu(vnum: number, x: number, y: number): void {
    mapContextMenuVnum = vnum;
    const hasAlias = deps.getAliases().some((a) => a.vnum === vnum);
    mapContextAliasDelete.classList.toggle("map-context-menu__item--hidden", !hasAlias);
    const autoCmds = deps.getRoomAutoCommands();
    const hasAutoCmd = autoCmds.has(vnum);
    mapContextAutoCmdDelete.classList.toggle("map-context-menu__item--hidden", !hasAutoCmd);
    mapContextAutoCmd.classList.toggle("map-context-menu__item--active", hasAutoCmd);
    mapContextAutoCmd.textContent = hasAutoCmd
      ? `Авто-команда: ${autoCmds.get(vnum)}…`
      : "Авто-команда…";
    mapContextMenu.style.left = `${x}px`;
    mapContextMenu.style.top = `${y}px`;
    mapContextMenu.classList.remove("map-context-menu--hidden");
    mapContextGo.focus();
  }

  function closeMapContextMenu(): void {
    mapContextMenuVnum = null;
    mapContextMenu.classList.add("map-context-menu--hidden");
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !mapContextMenu.classList.contains("map-context-menu--hidden")) {
      closeMapContextMenu();
    }
    if (e.key === "Escape" && !autoCmdPopup.classList.contains("alias-popup--hidden")) {
      closeAutoCmdPopup();
    }
  });

  aliasPopupSave.addEventListener("click", () => {
    const alias = aliasPopupInput.value.trim();
    if (aliasPopupVnum !== null && alias) {
      bus.emit("client_send", { type: "alias_set", payload: { vnum: aliasPopupVnum, alias } });
      closeAliasPopup();
    }
  });

  aliasPopupDelete.addEventListener("click", () => {
    if (aliasPopupVnum !== null) {
      bus.emit("client_send", { type: "alias_delete", payload: { vnum: aliasPopupVnum } });
      closeAliasPopup();
    }
  });

  aliasPopupClose.addEventListener("click", closeAliasPopup);

  aliasPopupInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") aliasPopupSave.click();
    if (e.key === "Escape") closeAliasPopup();
  });

  mapContextGo.addEventListener("click", () => {
    if (mapContextMenuVnum !== null) {
      bus.emit("client_send", { type: "navigate_to", payload: { vnums: [mapContextMenuVnum] } });
    }
    closeMapContextMenu();
  });

  mapContextAlias.addEventListener("click", () => {
    if (mapContextMenuVnum !== null) {
      const vnum = mapContextMenuVnum;
      const name = deps.getNodeName(vnum);
      openAliasPopup(vnum, deps.getAliases().find((a) => a.vnum === vnum)?.alias, name ?? String(vnum));
    }
    closeMapContextMenu();
  });

  mapContextAliasDelete.addEventListener("click", () => {
    if (mapContextMenuVnum !== null) {
      bus.emit("client_send", { type: "alias_delete", payload: { vnum: mapContextMenuVnum } });
    }
    closeMapContextMenu();
  });

  mapContextAutoCmd.addEventListener("click", () => {
    if (mapContextMenuVnum !== null) {
      const vnum = mapContextMenuVnum;
      const name = deps.getNodeName(vnum);
      openAutoCmdPopup(vnum, deps.getRoomAutoCommands().get(vnum), name ?? String(vnum));
    }
    closeMapContextMenu();
  });

  mapContextAutoCmdDelete.addEventListener("click", () => {
    if (mapContextMenuVnum !== null) {
      bus.emit("client_send", { type: "room_auto_command_delete", payload: { vnum: mapContextMenuVnum } });
    }
    closeMapContextMenu();
  });

  autoCmdPopupSave.addEventListener("click", () => {
    const command = autoCmdPopupInput.value.trim();
    if (autoCmdPopupVnum !== null && command) {
      bus.emit("client_send", { type: "room_auto_command_set", payload: { vnum: autoCmdPopupVnum, command } });
      closeAutoCmdPopup();
    }
  });

  autoCmdPopupDelete.addEventListener("click", () => {
    if (autoCmdPopupVnum !== null) {
      bus.emit("client_send", { type: "room_auto_command_delete", payload: { vnum: autoCmdPopupVnum } });
      closeAutoCmdPopup();
    }
  });

  autoCmdPopupClose.addEventListener("click", closeAutoCmdPopup);

  autoCmdPopupInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) autoCmdPopupSave.click();
    if (e.key === "Escape") closeAutoCmdPopup();
  });

  document.addEventListener("click", (e) => {
    if (!mapContextMenu.classList.contains("map-context-menu--hidden")) {
      if (!mapContextMenu.contains(e.target as Node)) {
        closeMapContextMenu();
      }
    }
  });

  return { openAliasPopup, openMapContextMenu };
}
