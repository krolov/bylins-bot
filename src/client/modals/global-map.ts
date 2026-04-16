// Global zone-graph map modal — loaded as a dynamic-import chunk on first
// click of #global-map-button. Owns: global-map modal DOM refs, zone-rename
// popup, zoom/pan/search state, and all zone-graph build/layout/render code.
//
// Shared state (zoneNames Map, latestFullSnapshot) flows in from main.ts via
// the bus with payload-replay. Zone-name renames flow back through the bus
// as "zone_name_set_local"; main owns the canonical Map and persists it.

import type { ClientEvent, MapSnapshotPayload, ZoneEdge, ZoneNode } from "../types.ts";
import * as bus from "../bus.ts";

function requireElement<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required UI element: ${selector}`);
  return el;
}

function getZoneId(vnum: number): number {
  return Math.floor(vnum / 100);
}

function send(ev: ClientEvent): void {
  bus.emit("client_send", ev);
}

const globalMapModal = requireElement<HTMLDivElement>("#global-map-modal");
const globalMapModalClose = requireElement<HTMLButtonElement>("#global-map-modal-close");
const globalMapCanvas = requireElement<HTMLDivElement>("#global-map-canvas");
const globalMapZoomIn = requireElement<HTMLButtonElement>("#global-map-zoom-in");
const globalMapZoomOut = requireElement<HTMLButtonElement>("#global-map-zoom-out");
const globalMapZoomLabel = requireElement<HTMLSpanElement>("#global-map-zoom-label");
const globalMapSearch = requireElement<HTMLInputElement>("#global-map-search");

const zoneRenamePopup = requireElement<HTMLDivElement>("#zone-rename-popup");
const zoneRenameInput = requireElement<HTMLInputElement>("#zone-rename-input");
const zoneRenameTitle = requireElement<HTMLSpanElement>("#zone-rename-title");
const zoneRenameSave = requireElement<HTMLButtonElement>("#zone-rename-save");
const zoneRenameDelete = requireElement<HTMLButtonElement>("#zone-rename-delete");
const zoneRenameClose = requireElement<HTMLButtonElement>("#zone-rename-close");

const ZONE_CELL = 120;
const ZONE_TILE = 100;
const ZONE_PAD = 3;

let latestFullSnapshot: MapSnapshotPayload = { currentVnum: null, nodes: [], edges: [], zoneNames: [] };
let zoneNames: Map<number, string> = new Map();
let globalMapZoom = 0.6;
let globalMapOpen = false;
let globalMapSearchQuery = "";
let globalMapZoneRenameId: number | null = null;
let globalMapDragOrigin: { x: number; y: number; scrollLeft: number; scrollTop: number } | null = null;
let globalMapDidDrag = false;

function buildZoneGraph(snapshot: MapSnapshotPayload): { zones: Map<number, ZoneNode>; edges: ZoneEdge[] } {
  const zones = new Map<number, ZoneNode>();
  for (const node of snapshot.nodes) {
    const zoneId = getZoneId(node.vnum);
    const existing = zones.get(zoneId);
    if (existing) {
      existing.roomCount++;
      if (node.visited) existing.visitedCount++;
    } else {
      zones.set(zoneId, { zoneId, roomCount: 1, visitedCount: node.visited ? 1 : 0, gridX: 0, gridY: 0 });
    }
  }
  const edgeSet = new Set<string>();
  const edges: ZoneEdge[] = [];
  for (const edge of snapshot.edges) {
    const fromZone = getZoneId(edge.fromVnum);
    const toZone = getZoneId(edge.toVnum);
    if (fromZone === toZone) continue;
    const key = fromZone < toZone ? `${fromZone}-${toZone}` : `${toZone}-${fromZone}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push({ fromZone, toZone, direction: edge.direction });
  }
  return { zones, edges };
}

function layoutZoneGraph(zones: Map<number, ZoneNode>, edges: ZoneEdge[]): void {
  if (zones.size === 0) return;

  const DIR_OFFSET: Record<string, [number, number]> = {
    north:     [0, -1],
    south:     [0,  1],
    east:      [1,  0],
    west:      [-1, 0],
    northeast: [1, -1],
    northwest: [-1, -1],
    southeast: [1,  1],
    southwest: [-1,  1],
    up:        [0, -1],
    down:      [0,  1],
  };

  const adj = new Map<number, { nb: number; dx: number; dy: number }[]>();
  for (const z of zones.keys()) adj.set(z, []);
  for (const edge of edges) {
    const off = DIR_OFFSET[edge.direction];
    const dx = off ? off[0] : 0;
    const dy = off ? off[1] : 0;
    adj.get(edge.fromZone)?.push({ nb: edge.toZone, dx,  dy  });
    adj.get(edge.toZone)?.push(  { nb: edge.fromZone, dx: -dx, dy: -dy });
  }

  const sortedZones = Array.from(zones.keys()).sort((a, b) => a - b);
  const col = new Map<number, number>();
  const row = new Map<number, number>();
  const visited = new Set<number>();
  const components: number[][] = [];

  for (const startZone of sortedZones) {
    if (visited.has(startZone)) continue;
    const comp: number[] = [];
    const q = [startZone];
    visited.add(startZone);
    while (q.length > 0) {
      const cur = q.shift()!;
      comp.push(cur);
      for (const { nb } of adj.get(cur) ?? []) {
        if (!visited.has(nb)) { visited.add(nb); q.push(nb); }
      }
    }
    components.push(comp);
  }

  function cellKey(x: number, y: number): string { return `${x},${y}`; }

  let globalOffsetX = 0;

  for (const component of components) {
    const root = component[0]!;
    const posX = new Map<number, number>();
    const posY = new Map<number, number>();
    const localOccupied = new Map<string, number>();

    posX.set(root, 0);
    posY.set(root, 0);
    localOccupied.set(cellKey(0, 0), root);

    const bfsQ = [root];
    const placed = new Set([root]);

    while (bfsQ.length > 0) {
      const cur = bfsQ.shift()!;
      const cx = posX.get(cur)!;
      const cy = posY.get(cur)!;

      for (const { nb, dx, dy } of adj.get(cur) ?? []) {
        if (placed.has(nb)) continue;
        placed.add(nb);

        let tx = cx + dx * 2;
        let ty = cy + dy * 2;

        if (localOccupied.has(cellKey(tx, ty))) {
          const perps: [number, number][] = dy !== 0
            ? [[2, 0], [-2, 0], [4, 0], [-4, 0], [6, 0], [-6, 0], [8, 0], [-8, 0]]
            : [[0, 2], [0, -2], [0, 4], [0, -4], [0, 6], [0, -6], [0, 8], [0, -8]];
          let found = false;
          for (const [ox, oy] of perps) {
            if (!localOccupied.has(cellKey(tx + ox, ty + oy))) {
              tx += ox; ty += oy; found = true; break;
            }
          }
          if (!found) {
            outer: for (let r = 2; r <= 16; r += 2) {
              for (let ox = -r; ox <= r; ox += 2) {
                for (let oy = -r; oy <= r; oy += 2) {
                  if (Math.abs(ox) !== r && Math.abs(oy) !== r) continue;
                  if (!localOccupied.has(cellKey(tx + ox, ty + oy))) {
                    tx += ox; ty += oy; break outer;
                  }
                }
              }
            }
          }
        }

        posX.set(nb, tx);
        posY.set(nb, ty);
        localOccupied.set(cellKey(tx, ty), nb);
        bfsQ.push(nb);
      }
    }

    const allX = [...posX.values()];
    const allY = [...posY.values()];
    const minCX = Math.min(...allX);
    const maxCX = Math.max(...allX);

    for (const z of component) {
      col.set(z, globalOffsetX + (posX.get(z)! - minCX));
      row.set(z, posY.get(z)!);
    }

    globalOffsetX += (maxCX - minCX) + 4;
  }

  const allRows = [...row.values()];
  const minRow = Math.min(...allRows);

  for (const zoneId of zones.keys()) {
    const zone = zones.get(zoneId)!;
    zone.gridX = col.get(zoneId) ?? 0;
    zone.gridY = (row.get(zoneId) ?? 0) - minRow;
  }
}

function routeZoneEdge(
  fromZone: ZoneNode,
  toZone: ZoneNode,
  occupied: Set<string>,
): Array<[number, number]> {
  const sx = fromZone.gridX, sy = fromZone.gridY;
  const tx = toZone.gridX, ty = toZone.gridY;
  if (sx === tx && sy === ty) return [[sx, sy]];

  const key = (x: number, y: number): string => `${x},${y}`;

  const DIRS: [number, number][] = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ];

  type Node = { x: number; y: number; g: number; f: number; parent: Node | null };
  const open = new Map<string, Node>();
  const closed = new Set<string>();

  const startNode: Node = { x: sx, y: sy, g: 0, f: Math.abs(tx - sx) + Math.abs(ty - sy), parent: null };
  open.set(key(sx, sy), startNode);

  let iterations = 0;
  while (open.size > 0 && iterations++ < 2000) {
    let current: Node | null = null;
    for (const node of open.values()) {
      if (!current || node.f < current.f) current = node;
    }
    if (!current) break;

    if (current.x === tx && current.y === ty) {
      const path: Array<[number, number]> = [];
      let n: Node | null = current;
      while (n) { path.unshift([n.x, n.y]); n = n.parent; }
      return path;
    }

    open.delete(key(current.x, current.y));
    closed.add(key(current.x, current.y));

    for (const [dx, dy] of DIRS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;
      const isTarget = nx === tx && ny === ty;
      if (!isTarget && occupied.has(nk)) continue;

      const g = current.g + 1.0;
      const h = Math.abs(tx - nx) + Math.abs(ty - ny);
      const existing = open.get(nk);
      if (!existing || g < existing.g) {
        open.set(nk, { x: nx, y: ny, g, f: g + h, parent: current });
      }
    }
  }

  return [[sx, sy], [tx, ty]];
}

function renderZoneMap(snapshot: MapSnapshotPayload): void {
  globalMapCanvas.innerHTML = "";

  if (snapshot.nodes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "map-empty";
    empty.textContent = "No map data yet";
    globalMapCanvas.appendChild(empty);
    return;
  }

  const { zones, edges } = buildZoneGraph(snapshot);
  if (zones.size === 0) return;

  layoutZoneGraph(zones, edges);

  const scale = globalMapZoom;
  const G_CELL = Math.round(ZONE_CELL * scale);
  const G_TILE = Math.round(ZONE_TILE * scale);
  const G_PAD = ZONE_PAD;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const z of zones.values()) {
    if (z.gridX < minX) minX = z.gridX;
    if (z.gridY < minY) minY = z.gridY;
    if (z.gridX > maxX) maxX = z.gridX;
    if (z.gridY > maxY) maxY = z.gridY;
  }

  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  const canvasW = (cols + G_PAD * 2) * G_CELL;
  const canvasH = (rows + G_PAD * 2) * G_CELL;

  function toRenderY(gy: number): number { return gy - minY; }
  function tileCenter(gx: number, gy: number): [number, number] {
    return [(gx - minX + G_PAD) * G_CELL + G_TILE / 2, (toRenderY(gy) + G_PAD) * G_CELL + G_TILE / 2];
  }
  function tileEdgePoint(gx: number, gy: number, towardGx: number, towardGy: number): [number, number] {
    const [cx, cy] = tileCenter(gx, gy);
    const dx = towardGx - gx;
    const dy = towardGy - gy;
    const half = G_TILE / 2;
    const ex = dx === 0 ? 0 : dx > 0 ? half : -half;
    const ey = dy === 0 ? 0 : dy > 0 ? half : -half;
    return [cx + ex, cy + ey];
  }

  const wrapper = document.createElement("div");
  wrapper.style.width = `${canvasW}px`;
  wrapper.style.height = `${canvasH}px`;
  wrapper.style.position = "relative";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(canvasW));
  svg.setAttribute("height", String(canvasH));
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.pointerEvents = "none";

  const currentZoneId = snapshot.currentVnum != null ? getZoneId(snapshot.currentVnum) : null;

  const occupiedCells = new Set<string>(
    Array.from(zones.values()).map((z) => `${z.gridX},${z.gridY}`)
  );

  const pairEdgeCount = new Map<string, number>();
  const pairEdgeIndex = new Map<string, number>();
  for (const edge of edges) {
    const k = [Math.min(edge.fromZone, edge.toZone), Math.max(edge.fromZone, edge.toZone)].join(",");
    pairEdgeCount.set(k, (pairEdgeCount.get(k) ?? 0) + 1);
    pairEdgeIndex.set(k, 0);
  }

  function buildSvgPath(pixelPoints: [number, number][], offsetPx: number): string {
    if (pixelPoints.length < 2) return "";

    const applyOffset = (pts: [number, number][], offset: number): [number, number][] => {
      if (offset === 0 || pts.length < 2) return pts;
      const [ax, ay] = pts[0]!;
      const [bx, by] = pts[pts.length - 1]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      return pts.map(([x, y]) => [x + nx * offset, y + ny * offset] as [number, number]);
    };

    const pts = applyOffset(pixelPoints, offsetPx);

    if (pts.length === 2) {
      return `M ${pts[0]![0]},${pts[0]![1]} L ${pts[1]![0]},${pts[1]![1]}`;
    }

    let d = `M ${pts[0]![0]},${pts[0]![1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [px1, py1] = pts[i]!;
      const [px2, py2] = pts[i + 1]!;
      const qx = (px1 + px2) / 2;
      const qy = (py1 + py2) / 2;
      d += ` L ${px1},${py1} Q ${px1},${py1} ${qx},${qy}`;
    }
    d += ` L ${pts[pts.length - 1]![0]},${pts[pts.length - 1]![1]}`;
    return d;
  }

  for (const edge of edges) {
    const from = zones.get(edge.fromZone);
    const to = zones.get(edge.toZone);
    if (!from || !to) continue;

    const routePath = routeZoneEdge(from, to, occupiedCells);
    if (routePath.length < 2) continue;

    const pixelPoints: [number, number][] = routePath.map(([gx, gy], i) => {
      if (i === 0) {
        const [ngx, ngy] = routePath[1]!;
        return tileEdgePoint(gx, gy, ngx, ngy);
      }
      if (i === routePath.length - 1) {
        const [pgx, pgy] = routePath[routePath.length - 2]!;
        return tileEdgePoint(gx, gy, pgx, pgy);
      }
      return tileCenter(gx, gy);
    });

    const pairKey = [Math.min(edge.fromZone, edge.toZone), Math.max(edge.fromZone, edge.toZone)].join(",");
    const count = pairEdgeCount.get(pairKey) ?? 1;
    const idx = pairEdgeIndex.get(pairKey) ?? 0;
    pairEdgeIndex.set(pairKey, idx + 1);

    const BUNDLE_SPACING = 6;
    const offsetPx = count === 1 ? 0 : (idx - (count - 1) / 2) * BUNDLE_SPACING;

    const d = buildSvgPath(pixelPoints, offsetPx);

    const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathEl.setAttribute("d", d);
    pathEl.setAttribute("class", "global-map-portal-line");
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("data-from", String(edge.fromZone));
    pathEl.setAttribute("data-to", String(edge.toZone));
    svg.appendChild(pathEl);
  }

  function findZonePath(fromZoneId: number, toZoneId: number): Set<string> {
    if (fromZoneId === toZoneId) return new Set();
    const adj = new Map<number, number[]>();
    for (const e of edges) {
      if (!adj.has(e.fromZone)) adj.set(e.fromZone, []);
      if (!adj.has(e.toZone)) adj.set(e.toZone, []);
      adj.get(e.fromZone)!.push(e.toZone);
      adj.get(e.toZone)!.push(e.fromZone);
    }
    const prev = new Map<number, number>();
    const visited = new Set([fromZoneId]);
    const queue = [fromZoneId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === toZoneId) break;
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          prev.set(nb, cur);
          queue.push(nb);
        }
      }
    }
    const pathEdges = new Set<string>();
    let cur: number | undefined = toZoneId;
    while (cur !== undefined && prev.has(cur)) {
      const p: number = prev.get(cur)!;
      pathEdges.add(`${Math.min(p, cur)},${Math.max(p, cur)}`);
      cur = p;
    }
    return pathEdges;
  }

  wrapper.appendChild(svg);

  for (const zone of zones.values()) {
    const isCurrent = zone.zoneId === currentZoneId;
    const px = (zone.gridX - minX + G_PAD) * G_CELL;
    const py = (toRenderY(zone.gridY) + G_PAD) * G_CELL;

    const tile = document.createElement("div");
    tile.className = isCurrent ? "zone-tile zone-tile--current" : "zone-tile";
    tile.style.left = `${px}px`;
    tile.style.top = `${py}px`;
    tile.style.width = `${G_TILE}px`;
    tile.style.height = `${G_TILE}px`;
    tile.setAttribute("data-zone-id", String(zone.zoneId));

    const zIdStr = String(zone.zoneId);
    tile.addEventListener("mouseenter", () => {
      const pathEdges = currentZoneId != null && zone.zoneId !== currentZoneId
        ? findZonePath(zone.zoneId, currentZoneId)
        : new Set<string>();

      svg.querySelectorAll<SVGPathElement>("path").forEach((pl) => {
        const f = pl.getAttribute("data-from")!;
        const t = pl.getAttribute("data-to")!;
        const isConnected = f === zIdStr || t === zIdStr;
        const pairKey = `${Math.min(Number(f), Number(t))},${Math.max(Number(f), Number(t))}`;
        const isPath = pathEdges.has(pairKey);
        pl.classList.toggle("global-map-portal-line--active", isConnected && !isPath);
        pl.classList.toggle("global-map-portal-line--path", isPath);
        pl.classList.toggle("global-map-portal-line--dim", !isConnected && !isPath);
      });
    });
    tile.addEventListener("mouseleave", () => {
      svg.querySelectorAll<SVGPathElement>("path").forEach((pl) => {
        pl.classList.remove("global-map-portal-line--active", "global-map-portal-line--path", "global-map-portal-line--dim");
      });
    });

    const idEl = document.createElement("div");
    idEl.className = "zone-tile__id";
    idEl.textContent = `${zone.zoneId} - ${zone.visitedCount}`;
    tile.appendChild(idEl);

    const customName = zoneNames.get(zone.zoneId);
    const nameEl = document.createElement("div");
    nameEl.className = "zone-tile__name";
    nameEl.textContent = customName ?? "";
    tile.appendChild(nameEl);

    wrapper.appendChild(tile);
  }

  globalMapCanvas.appendChild(wrapper);

  if (currentZoneId != null) {
    const currentZone = zones.get(currentZoneId);
    if (currentZone) {
      const snapZone = currentZone;
      requestAnimationFrame(() => {
        const [cx, cy] = tileCenter(snapZone.gridX, snapZone.gridY);
        globalMapCanvas.scrollLeft = cx - globalMapCanvas.clientWidth / 2;
        globalMapCanvas.scrollTop = cy - globalMapCanvas.clientHeight / 2;
      });
    }
  }

  if (globalMapSearchQuery !== "") {
    applyGlobalMapSearch();
  }
}

function updateGlobalMapZoomLabel(): void {
  globalMapZoomLabel.textContent = `${Math.round(globalMapZoom * 100)}%`;
}

function applyGlobalMapSearch(): void {
  const query = globalMapSearch.value.trim().toLowerCase();
  globalMapSearchQuery = query;
  const tiles = Array.from(globalMapCanvas.querySelectorAll<HTMLElement>(".zone-tile"));
  for (const tile of tiles) {
    const zoneId = tile.getAttribute("data-zone-id") ?? "";
    const zoneName = (zoneNames.get(Number(zoneId)) ?? "").toLowerCase();
    const matches = query === "" || zoneId.includes(query) || zoneName.includes(query);
    tile.classList.toggle("zone-tile--dimmed", !matches);
  }
}

function closeGlobalMap(): void {
  globalMapOpen = false;
  globalMapModal.classList.add("global-map-modal--hidden");
  closeZoneRenamePopup();
  globalMapSearch.value = "";
  globalMapSearchQuery = "";
}

function openZoneRenamePopup(zoneId: number, clientX: number, clientY: number): void {
  globalMapZoneRenameId = zoneId;
  zoneRenameTitle.textContent = `Зона ${zoneId}`;
  zoneRenameInput.value = zoneNames.get(zoneId) ?? "";
  zoneRenamePopup.classList.remove("zone-rename-popup--hidden");

  const popupW = 220;
  const popupH = 100;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(clientX, vw - popupW - 8);
  const top = Math.min(clientY, vh - popupH - 8);
  zoneRenamePopup.style.left = `${left}px`;
  zoneRenamePopup.style.top = `${top}px`;
  requestAnimationFrame(() => zoneRenameInput.focus());
}

function closeZoneRenamePopup(): void {
  globalMapZoneRenameId = null;
  zoneRenamePopup.classList.add("zone-rename-popup--hidden");
}

function applyRename(zoneId: number, name: string | null): void {
  if (name) zoneNames.set(zoneId, name);
  else zoneNames.delete(zoneId);
  bus.emit("zone_name_set_local", { zoneId, name });
  send({ type: "zone_name_set", payload: { zoneId, name } });
}

function saveZoneRename(): void {
  if (globalMapZoneRenameId === null) return;
  const name = zoneRenameInput.value.trim();
  applyRename(globalMapZoneRenameId, name || null);
  closeZoneRenamePopup();
  if (globalMapOpen) renderZoneMap(latestFullSnapshot);
}

let initialized = false;
function init(): void {
  if (initialized) return;
  initialized = true;

  globalMapModalClose.addEventListener("click", closeGlobalMap);
  globalMapSearch.addEventListener("input", applyGlobalMapSearch);

  globalMapModal.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target === globalMapModal || target.classList.contains("global-map-modal__backdrop")) {
      closeGlobalMap();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && globalMapOpen) closeGlobalMap();
  });

  globalMapZoomIn.addEventListener("click", () => {
    globalMapZoom = Math.min(2.0, parseFloat((globalMapZoom + 0.2).toFixed(1)));
    updateGlobalMapZoomLabel();
    if (globalMapOpen) renderZoneMap(latestFullSnapshot);
  });

  globalMapZoomOut.addEventListener("click", () => {
    globalMapZoom = Math.max(0.2, parseFloat((globalMapZoom - 0.2).toFixed(1)));
    updateGlobalMapZoomLabel();
    if (globalMapOpen) renderZoneMap(latestFullSnapshot);
  });

  globalMapCanvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    globalMapDidDrag = false;
    globalMapDragOrigin = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: globalMapCanvas.scrollLeft,
      scrollTop: globalMapCanvas.scrollTop,
    };
    globalMapCanvas.setPointerCapture(e.pointerId);
    globalMapCanvas.classList.add("map-canvas--dragging");
  });

  globalMapCanvas.addEventListener("pointermove", (e) => {
    if (!globalMapDragOrigin) return;
    if (Math.abs(e.clientX - globalMapDragOrigin.x) > 4 || Math.abs(e.clientY - globalMapDragOrigin.y) > 4) {
      globalMapDidDrag = true;
    }
    globalMapCanvas.scrollLeft = globalMapDragOrigin.scrollLeft - (e.clientX - globalMapDragOrigin.x);
    globalMapCanvas.scrollTop = globalMapDragOrigin.scrollTop - (e.clientY - globalMapDragOrigin.y);
  });

  globalMapCanvas.addEventListener("pointerup", () => {
    globalMapDragOrigin = null;
    globalMapCanvas.classList.remove("map-canvas--dragging");
  });

  globalMapCanvas.addEventListener("pointercancel", () => {
    globalMapDragOrigin = null;
    globalMapCanvas.classList.remove("map-canvas--dragging");
  });

  globalMapCanvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (globalMapDidDrag) return;
    const target = e.target as HTMLElement;
    const tile = target.closest<HTMLElement>(".zone-tile");
    if (!tile) return;
    const zoneId = Number(tile.getAttribute("data-zone-id"));
    if (isNaN(zoneId)) return;
    openZoneRenamePopup(zoneId, e.clientX, e.clientY);
  });

  zoneRenameSave.addEventListener("click", saveZoneRename);
  zoneRenameClose.addEventListener("click", closeZoneRenamePopup);
  zoneRenameDelete.addEventListener("click", () => {
    if (globalMapZoneRenameId !== null) {
      applyRename(globalMapZoneRenameId, null);
    }
    closeZoneRenamePopup();
    if (globalMapOpen) renderZoneMap(latestFullSnapshot);
  });
  zoneRenameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveZoneRename();
    if (e.key === "Escape") closeZoneRenamePopup();
  });

  bus.on<MapSnapshotPayload>("map_full_snapshot", (snap) => {
    latestFullSnapshot = snap;
    if (globalMapOpen) renderZoneMap(latestFullSnapshot);
  });
  bus.on<Map<number, string>>("zone_names", (names) => {
    zoneNames = names;
    if (globalMapOpen) renderZoneMap(latestFullSnapshot);
  });
}

export function openGlobalMap(): void {
  init();
  globalMapOpen = true;
  globalMapModal.classList.remove("global-map-modal--hidden");
  renderZoneMap(latestFullSnapshot);
}
