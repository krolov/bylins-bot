// Panel + container splitter drag logic with localStorage persistence.
//
// Bootstrapped once from main.ts via `initSplitters()`; thereafter it owns the
// `main.shell` grid-template-columns declaration and persists both widths
// across reloads.

const PANEL_SPLIT_KEY = "panel-split-map-fr";
const PANEL_SPLIT_MIN_FR = 0.15;
const PANEL_SPLIT_MAX_FR = 0.75;
const CONTAINER_SPLIT_KEY = "panel-split-container-px";
const CONTAINER_SPLIT_MIN_PX = 100;
const CONTAINER_SPLIT_MAX_PX = 500;
const CONTAINER_SPLIT_DEFAULT_PX = 160;

export function initSplitters(): void {
  const shellEl = document.querySelector<HTMLElement>("main.shell");
  const panelSplitterEl = document.getElementById("panel-splitter");
  const containerSplitterEl = document.getElementById("container-splitter");

  let currentContainerPx = CONTAINER_SPLIT_DEFAULT_PX;

  function applyPanelSplit(mapFr: number): void {
    if (!shellEl) return;
    const clamped = Math.max(PANEL_SPLIT_MIN_FR, Math.min(PANEL_SPLIT_MAX_FR, mapFr));
    shellEl.style.gridTemplateColumns = `56px ${1 - clamped}fr 6px ${clamped}fr 6px ${currentContainerPx}px`;
  }

  function applyContainerSplit(px: number): void {
    if (!shellEl) return;
    const clamped = Math.max(CONTAINER_SPLIT_MIN_PX, Math.min(CONTAINER_SPLIT_MAX_PX, px));
    currentContainerPx = clamped;
    const match = shellEl.style.gridTemplateColumns.match(/^(56px\s+[\d.]+fr\s+6px\s+[\d.]+fr)\s+6px\s+[\d.]+px$/);
    const base = match ? match[1] : `56px ${1 - 0.35}fr 6px ${0.35}fr`;
    shellEl.style.gridTemplateColumns = `${base} 6px ${clamped}px`;
  }

  function loadPanelSplit(): void {
    const storedContainer = localStorage.getItem(CONTAINER_SPLIT_KEY);
    if (storedContainer !== null) {
      const px = parseFloat(storedContainer);
      if (!isNaN(px)) currentContainerPx = Math.max(CONTAINER_SPLIT_MIN_PX, Math.min(CONTAINER_SPLIT_MAX_PX, px));
    }

    const stored = localStorage.getItem(PANEL_SPLIT_KEY);
    if (stored !== null) {
      const fr = parseFloat(stored);
      if (!isNaN(fr)) {
        applyPanelSplit(fr);
        return;
      }
    }
    applyPanelSplit(0.35);
  }

  loadPanelSplit();

  if (panelSplitterEl !== null && shellEl !== null) {
    let dragging = false;

    panelSplitterEl.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      dragging = true;
      panelSplitterEl.classList.add("panel-splitter--dragging");
      panelSplitterEl.setPointerCapture(e.pointerId);
    });

    panelSplitterEl.addEventListener("pointermove", (e: PointerEvent) => {
      if (!dragging) return;
      const shellRect = shellEl.getBoundingClientRect();
      const gaps = 5 * 8;
      const available = shellRect.width - 56 - currentContainerPx - gaps;
      const offsetX = e.clientX - shellRect.left - 56 - gaps / 2;
      applyPanelSplit(Math.max(0, 1 - offsetX / available));
    });

    function stopSplitterDrag(e: PointerEvent): void {
      if (!dragging) return;
      dragging = false;
      panelSplitterEl!.classList.remove("panel-splitter--dragging");
      panelSplitterEl!.releasePointerCapture(e.pointerId);
      const match = shellEl!.style.gridTemplateColumns.match(/56px\s+[\d.]+fr\s+6px\s+([\d.]+)fr/);
      if (match) localStorage.setItem(PANEL_SPLIT_KEY, match[1]);
    }

    panelSplitterEl.addEventListener("pointerup", stopSplitterDrag);
    panelSplitterEl.addEventListener("pointercancel", stopSplitterDrag);
  }

  if (containerSplitterEl !== null && shellEl !== null) {
    let dragging = false;

    containerSplitterEl.addEventListener("pointerdown", (e: PointerEvent) => {
      e.preventDefault();
      dragging = true;
      containerSplitterEl.classList.add("panel-splitter--dragging");
      containerSplitterEl.setPointerCapture(e.pointerId);
    });

    containerSplitterEl.addEventListener("pointermove", (e: PointerEvent) => {
      if (!dragging) return;
      const shellRect = shellEl.getBoundingClientRect();
      const px = shellRect.right - e.clientX - 8;
      applyContainerSplit(px);
    });

    function stopContainerDrag(e: PointerEvent): void {
      if (!dragging) return;
      dragging = false;
      containerSplitterEl!.classList.remove("panel-splitter--dragging");
      containerSplitterEl!.releasePointerCapture(e.pointerId);
      localStorage.setItem(CONTAINER_SPLIT_KEY, String(currentContainerPx));
    }

    containerSplitterEl.addEventListener("pointerup", stopContainerDrag);
    containerSplitterEl.addEventListener("pointercancel", stopContainerDrag);
  }
}
