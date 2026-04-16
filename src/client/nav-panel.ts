// Nav-panel renderer — current zone aliases, neighbor zones, far zones, search.
//
// The module owns: the DOM refs for the nav-panel, the filter/pagination state
// (search query, far-zones page, cached neighbor/far/visited lists), and the
// event listeners for the search input and the panel's infinite-scroll
// trigger.
//
// It asks main.ts for the current map snapshot, full snapshot, aliases, and
// zone-names via the `deps` callbacks supplied to `createNavPanel()`. Outbound
// commands (follow a zone alias, go to a zone, cancel navigation) go through
// the shared pub-sub bus ("client_send").

import * as bus from "./bus.ts";
import type {
  AliasPayload,
  MapSnapshotPayload,
  NavigationStatePayload,
  NeighborZone,
  FarZone,
} from "./types.ts";

const FAR_ZONES_PAGE_SIZE = 30;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing required UI element: ${selector}`);
  }

  return element;
}

function getZoneId(vnum: number): number {
  return Math.floor(vnum / 100);
}

export interface NavPanelDeps {
  getSnapshot: () => MapSnapshotPayload;
  getFullSnapshot: () => MapSnapshotPayload;
  getZoneNames: () => Map<number, string>;
  getAliases: () => AliasPayload[];
}

export interface NavPanel {
  render: () => void;
  renderStatus: (state: NavigationStatePayload) => void;
}

export function createNavPanel(deps: NavPanelDeps): NavPanel {
  const navAliasList = requireElement<HTMLUListElement>("#nav-alias-list");
  const navAliasListEmpty = requireElement<HTMLParagraphElement>("#nav-alias-list-empty");
  const navZoneList = requireElement<HTMLUListElement>("#nav-zone-list");
  const navZoneListEmpty = requireElement<HTMLParagraphElement>("#nav-zone-list-empty");
  const navFarZonesList = requireElement<HTMLUListElement>("#nav-far-zones-list");
  const navFarZonesListEmpty = requireElement<HTMLParagraphElement>("#nav-far-zones-list-empty");
  const navZoneAliasesTitle = requireElement<HTMLDivElement>("#nav-zone-aliases-title");
  const navZonesSearch = requireElement<HTMLInputElement>("#nav-zones-search");
  const navZonesSearchClear = requireElement<HTMLButtonElement>("#nav-zones-search-clear");
  const navPanel = requireElement<HTMLDivElement>("#nav-panel");
  const navNeighborZonesSection = requireElement<HTMLDivElement>("#nav-neighbor-zones");
  const navFarZonesSection = requireElement<HTMLDivElement>("#nav-far-zones");
  const navStatus = requireElement<HTMLDivElement>("#nav-status");
  const navCurrentRoom = requireElement<HTMLDivElement>("#nav-current-room");

  let navZonesSearchQuery = "";
  let farZonesPage = 0;
  let allNeighborZones: NeighborZone[] = [];
  let allFarZones: FarZone[] = [];
  let allVisitedZones: FarZone[] = [];
  let allFarZonesFiltered: FarZone[] = [];

  function buildNavZoneItem(zone: NeighborZone | FarZone): HTMLLIElement {
    const zoneNames = deps.getZoneNames();
    const li = document.createElement("li");
    li.className = "nav-zone-list__item";

    const nameSpan = document.createElement("span");
    nameSpan.className = "nav-zone-list__name";
    nameSpan.textContent = zoneNames.get(zone.zoneId) ?? `Зона ${zone.zoneId}xx`;

    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "button-small nav-zone-list__go";
    goBtn.textContent = "Идти";
    goBtn.addEventListener("click", () => {
      bus.emit("client_send", { type: "navigate_to", payload: { vnums: zone.entryVnums } });
    });

    li.appendChild(nameSpan);
    li.appendChild(goBtn);
    return li;
  }

  function applyNavZonesFilter(): void {
    const query = navZonesSearchQuery;
    const zoneNames = deps.getZoneNames();

    const filteredNeighbor = query
      ? allNeighborZones.filter((z) => {
          const name = zoneNames.get(z.zoneId) ?? `Зона ${z.zoneId}xx`;
          return name.toLowerCase().includes(query);
        })
      : allNeighborZones;

    const sourceForFar = query ? allVisitedZones : allFarZones;
    const filteredFar = query
      ? sourceForFar.filter((z) => {
          const name = zoneNames.get(z.zoneId) ?? `Зона ${z.zoneId}xx`;
          return name.toLowerCase().includes(query);
        })
      : sourceForFar;

    const neighborSectionTitle = navNeighborZonesSection.querySelector<HTMLElement>(".nav-section__title");

    if (query && filteredNeighbor.length === 0) {
      navNeighborZonesSection.style.display = "none";
    } else {
      navNeighborZonesSection.style.display = "";
      if (neighborSectionTitle) neighborSectionTitle.style.display = "";
      navZoneList.innerHTML = "";
      navZoneListEmpty.classList.toggle("alias-list-empty--hidden", filteredNeighbor.length > 0);
      for (const zone of filteredNeighbor) {
        navZoneList.appendChild(buildNavZoneItem(zone));
      }
    }

    const farSectionTitle = navFarZonesSection.querySelector<HTMLElement>(".nav-section__title");

    if (query && filteredFar.length === 0) {
      navFarZonesSection.style.display = "none";
    } else {
      navFarZonesSection.style.display = "";
      if (farSectionTitle) {
        farSectionTitle.textContent = query ? "Все зоны" : "Дальние зоны";
      }
      navFarZonesList.innerHTML = "";
      navFarZonesListEmpty.classList.toggle("alias-list-empty--hidden", filteredFar.length > 0);

      farZonesPage = 0;
      const firstPage = filteredFar.slice(0, FAR_ZONES_PAGE_SIZE);
      for (const zone of firstPage) {
        navFarZonesList.appendChild(buildNavZoneItem(zone));
      }

      allFarZonesFiltered = filteredFar;
    }
  }

  function loadMoreFarZones(): void {
    farZonesPage += 1;
    const start = farZonesPage * FAR_ZONES_PAGE_SIZE;
    const end = start + FAR_ZONES_PAGE_SIZE;
    const nextItems = allFarZonesFiltered.slice(start, end);
    for (const zone of nextItems) {
      navFarZonesList.appendChild(buildNavZoneItem(zone));
    }
  }

  function buildNeighborZones(currentZone: number | null): NeighborZone[] {
    const full = deps.getFullSnapshot();
    if (currentZone === null || full.nodes.length === 0) return [];

    const neighborZoneIds = new Set<number>();
    for (const edge of full.edges) {
      const fromZone = getZoneId(edge.fromVnum);
      const toZone = getZoneId(edge.toVnum);
      if (fromZone === currentZone && toZone !== currentZone) {
        neighborZoneIds.add(toZone);
      }
      if (toZone === currentZone && fromZone !== currentZone) {
        neighborZoneIds.add(fromZone);
      }
    }

    const visitedVnums = new Set(full.nodes.filter((n) => n.visited).map((n) => n.vnum));
    const zoneNames = deps.getZoneNames();

    const result: NeighborZone[] = [];
    for (const zoneId of neighborZoneIds) {
      const zoneVnums = full.nodes
        .filter((n) => getZoneId(n.vnum) === zoneId && visitedVnums.has(n.vnum))
        .map((n) => n.vnum);
      if (zoneVnums.length > 0) {
        result.push({ zoneId, entryVnums: zoneVnums });
      }
    }

    result.sort((a, b) => {
      const nameA = zoneNames.get(a.zoneId) ?? "";
      const nameB = zoneNames.get(b.zoneId) ?? "";
      if (nameA && !nameB) return -1;
      if (!nameA && nameB) return 1;
      return nameA.localeCompare(nameB) || a.zoneId - b.zoneId;
    });

    return result;
  }

  function buildFarZones(currentZone: number | null, neighborZoneIds: Set<number>): FarZone[] {
    const full = deps.getFullSnapshot();
    if (currentZone === null || full.nodes.length === 0) return [];

    const zoneAdj = new Map<number, Set<number>>();
    for (const edge of full.edges) {
      const fromZone = getZoneId(edge.fromVnum);
      const toZone = getZoneId(edge.toVnum);
      if (fromZone === toZone) continue;
      if (!zoneAdj.has(fromZone)) zoneAdj.set(fromZone, new Set());
      if (!zoneAdj.has(toZone)) zoneAdj.set(toZone, new Set());
      zoneAdj.get(fromZone)!.add(toZone);
      zoneAdj.get(toZone)!.add(fromZone);
    }

    const visited = new Set<number>([currentZone, ...neighborZoneIds]);
    const queue: Array<{ zoneId: number; hops: number }> = [];

    for (const nz of neighborZoneIds) {
      queue.push({ zoneId: nz, hops: 1 });
    }

    const farZoneHops = new Map<number, number>();

    let head = 0;
    while (head < queue.length) {
      const { zoneId, hops } = queue[head++]!;
      if (hops >= 4) continue;
      const neighbors = zoneAdj.get(zoneId);
      if (!neighbors) continue;
      for (const nz of neighbors) {
        if (visited.has(nz)) continue;
        visited.add(nz);
        farZoneHops.set(nz, hops + 1);
        queue.push({ zoneId: nz, hops: hops + 1 });
      }
    }

    const visitedVnums = new Set(full.nodes.filter((n) => n.visited).map((n) => n.vnum));
    const zoneNames = deps.getZoneNames();

    const result: FarZone[] = [];
    for (const [zoneId, hops] of farZoneHops) {
      const zoneVnums = full.nodes
        .filter((n) => getZoneId(n.vnum) === zoneId && visitedVnums.has(n.vnum))
        .map((n) => n.vnum);
      if (zoneVnums.length > 0) {
        result.push({ zoneId, hops, entryVnums: zoneVnums });
      }
    }

    result.sort((a, b) => {
      if (a.hops !== b.hops) return a.hops - b.hops;
      const nameA = zoneNames.get(a.zoneId) ?? "";
      const nameB = zoneNames.get(b.zoneId) ?? "";
      if (nameA && !nameB) return -1;
      if (!nameA && nameB) return 1;
      return nameA.localeCompare(nameB) || a.zoneId - b.zoneId;
    });

    return result;
  }

  function buildAllVisitedZones(currentZone: number | null, neighborZoneIds: Set<number>): FarZone[] {
    const full = deps.getFullSnapshot();
    if (full.nodes.length === 0) return [];

    const visitedVnums = new Set(full.nodes.filter((n) => n.visited).map((n) => n.vnum));
    const zoneNames = deps.getZoneNames();

    const excludedZones = new Set<number>();
    if (currentZone !== null) excludedZones.add(currentZone);
    for (const nz of neighborZoneIds) excludedZones.add(nz);

    const zoneVnumsMap = new Map<number, number[]>();
    for (const node of full.nodes) {
      if (!visitedVnums.has(node.vnum)) continue;
      const zoneId = getZoneId(node.vnum);
      if (excludedZones.has(zoneId)) continue;
      if (!zoneVnumsMap.has(zoneId)) zoneVnumsMap.set(zoneId, []);
      zoneVnumsMap.get(zoneId)!.push(node.vnum);
    }

    const result: FarZone[] = [];
    for (const [zoneId, vnums] of zoneVnumsMap) {
      result.push({ zoneId, hops: 0, entryVnums: vnums });
    }

    result.sort((a, b) => {
      const nameA = zoneNames.get(a.zoneId) ?? "";
      const nameB = zoneNames.get(b.zoneId) ?? "";
      if (nameA && !nameB) return -1;
      if (!nameA && nameB) return 1;
      return nameA.localeCompare(nameB) || a.zoneId - b.zoneId;
    });

    return result;
  }

  function render(): void {
    const snapshot = deps.getSnapshot();
    const aliases = deps.getAliases();
    const zoneNames = deps.getZoneNames();
    const currentVnum = snapshot.currentVnum;
    const currentZone = currentVnum !== null ? getZoneId(currentVnum) : null;

    if (currentVnum !== null) {
      const currentNode = snapshot.nodes.find((n) => n.vnum === currentVnum);
      const roomName = currentNode?.name ?? String(currentVnum);
      navCurrentRoom.textContent = `${roomName} (${currentVnum})`;
      navCurrentRoom.classList.remove("nav-current-room--hidden");
    } else {
      navCurrentRoom.classList.add("nav-current-room--hidden");
    }

    navZoneAliasesTitle.textContent =
      currentZone !== null
        ? `Текущая зона ${zoneNames.get(currentZone) ? `— ${zoneNames.get(currentZone)}` : `(${currentZone}xx)`}`
        : "Текущая зона";

    const zoneAliases =
      currentZone !== null ? aliases.filter((a) => getZoneId(a.vnum) === currentZone) : [];

    navAliasList.innerHTML = "";
    navAliasListEmpty.classList.toggle("alias-list-empty--hidden", zoneAliases.length > 0);

    for (const entry of zoneAliases) {
      const li = document.createElement("li");
      li.className = "alias-list__item";

      const label = document.createElement("span");
      label.className = "alias-list__label";
      label.textContent = entry.alias;

      const vnumSpan = document.createElement("span");
      vnumSpan.className = "alias-list__vnum";
      vnumSpan.textContent = String(entry.vnum);

      const goBtn = document.createElement("button");
      goBtn.type = "button";
      goBtn.className = "button-small alias-list__go";
      goBtn.textContent = "Идти";
      goBtn.addEventListener("click", () => {
        const aliasName = entry.alias.toLowerCase();
        const allVnums = deps
          .getAliases()
          .filter((a) => a.alias.toLowerCase() === aliasName)
          .map((a) => a.vnum);
        bus.emit("client_send", { type: "navigate_to", payload: { vnums: allVnums } });
      });

      li.appendChild(label);
      li.appendChild(vnumSpan);
      li.appendChild(goBtn);
      navAliasList.appendChild(li);
    }

    const neighborZones = buildNeighborZones(currentZone);
    const neighborZoneIdSet = new Set(neighborZones.map((z) => z.zoneId));
    const farZones = buildFarZones(currentZone, neighborZoneIdSet);

    allNeighborZones = neighborZones;
    allFarZones = farZones;
    allVisitedZones = buildAllVisitedZones(currentZone, neighborZoneIdSet);
    farZonesPage = 0;

    applyNavZonesFilter();
  }

  function renderStatus(state: NavigationStatePayload): void {
    navStatus.innerHTML = "";
    if (!state.active) {
      navStatus.classList.add("nav-status--hidden");
      return;
    }

    navStatus.classList.remove("nav-status--hidden");
    const label = document.createElement("span");
    label.textContent = `Навигация: шаг ${state.currentStep + 1} / ${state.totalSteps}`;
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "button-secondary button-small";
    cancelBtn.textContent = "Отмена";
    cancelBtn.addEventListener("click", () => {
      bus.emit("client_send", { type: "navigate_stop" });
    });
    navStatus.appendChild(label);
    navStatus.appendChild(cancelBtn);
  }

  navPanel.addEventListener("scroll", () => {
    if (navPanel.scrollTop + navPanel.clientHeight >= navPanel.scrollHeight - 100) {
      const totalRendered = (farZonesPage + 1) * FAR_ZONES_PAGE_SIZE;
      if (totalRendered < allFarZonesFiltered.length) {
        loadMoreFarZones();
      }
    }
  });

  navZonesSearch.addEventListener("input", () => {
    navZonesSearchQuery = navZonesSearch.value.trim().toLowerCase();
    navZonesSearchClear.classList.toggle("nav-zones-search__clear--hidden", navZonesSearchQuery === "");
    applyNavZonesFilter();
  });

  navZonesSearchClear.addEventListener("click", () => {
    navZonesSearch.value = "";
    navZonesSearchQuery = "";
    navZonesSearchClear.classList.add("nav-zones-search__clear--hidden");
    applyNavZonesFilter();
  });

  return { render, renderStatus };
}
