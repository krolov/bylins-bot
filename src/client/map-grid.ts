import type { MapSnapshotPayload, GridCell, AliasPayload } from "./types.ts";
import { DIR_DELTA, OPPOSITE_DIR, DIRECTION_PRIORITY } from "./constants.ts";
import * as bus from "./bus.ts";

interface MapGridDeps {
  mapCanvasElement: HTMLDivElement;
  zLevelLabel: HTMLSpanElement;
  zLevelDownButton: HTMLButtonElement;
  zLevelUpButton: HTMLButtonElement;
  getAliases: () => AliasPayload[];
  onAliasPopup: (vnum: number, alias: string | undefined, nodeName: string) => void;
  onMapContextMenu: (vnum: number, clientX: number, clientY: number) => void;
  onMapUpdated: () => void;
}

export interface MapGridModule {
  updateMap: (snapshot: MapSnapshotPayload, fullReset: boolean) => void;
  forceFullRerender: () => void;
  getLatestSnapshot: () => MapSnapshotPayload;
  getLatestFullSnapshot: () => MapSnapshotPayload;
  getZoneNames: () => Map<number, string>;
  setZoneName: (zoneId: number, name: string | null) => void;
}

export function createMapGrid(deps: MapGridDeps): MapGridModule {
  const {
    mapCanvasElement,
    zLevelLabel,
    zLevelDownButton,
    zLevelUpButton,
    getAliases,
    onAliasPopup,
    onMapContextMenu,
    onMapUpdated,
  } = deps;

  const CELL = 56;
  const TILE = 40;
  const PAD = 2;
  const ZONE_GAP = 8;
  const COMPONENT_GAP = 4;

  const gridLayout = new Map<number, GridCell>();
  const collisionDisplacedVnums = new Set<number>();

  let currentZLevel = 0;
  let availableZLevels: number[] = [0];

  const mapRoomElements = new Map<number, HTMLDivElement>();
  let lastLayoutNodeCount = -1;
  let lastLayoutEdgeCount = -1;
  let lastRenderedZone: number | null = null;
  let lastRenderedZLevel = -999;
  let lastRenderedMinX = 0;
  let lastRenderedMaxY = 0;

  let latestMapSnapshot: MapSnapshotPayload = {
    currentVnum: null,
    nodes: [],
    edges: [],
    zoneNames: [],
  };
  let latestFullSnapshot: MapSnapshotPayload = latestMapSnapshot;

  let mapDragOrigin: { x: number; y: number; scrollLeft: number; scrollTop: number } | null = null;
  let mapDidDrag = false;

  function loadZoneNames(): Map<number, string> {
    try {
      const raw = localStorage.getItem("zoneNames");
      if (!raw) return new Map();
      return new Map(JSON.parse(raw) as [number, string][]);
    } catch {
      return new Map();
    }
  }

  function saveZoneNames(names: Map<number, string>): void {
    localStorage.setItem("zoneNames", JSON.stringify(Array.from(names.entries())));
  }

  const zoneNames: Map<number, string> = loadZoneNames();

  function cellKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  function placeRoom(vnum: number, x: number, y: number, zLevel: number): void {
    gridLayout.set(vnum, { vnum, gridX: x, gridY: y, zoneId: getZoneId(vnum), zLevel });
  }

  function resetGridLayout(): void {
    gridLayout.clear();
    collisionDisplacedVnums.clear();
  }

  function getZoneId(vnum: number): number {
    return Math.floor(vnum / 100);
  }

  function integrateSnapshot(snapshot: MapSnapshotPayload): void {
    const { nodes, edges } = snapshot;
    if (nodes.length === 0) return;

    const nodesByZone = new Map<number, number[]>();
    const zoneAdj = new Map<number, Map<number, { toVnum: number; direction: string }[]>>();

    for (const node of nodes) {
      const zoneId = getZoneId(node.vnum);
      const zoneNodes = nodesByZone.get(zoneId) ?? [];
      zoneNodes.push(node.vnum);
      nodesByZone.set(zoneId, zoneNodes);

      const adj = zoneAdj.get(zoneId) ?? new Map<number, { toVnum: number; direction: string }[]>();
      adj.set(node.vnum, adj.get(node.vnum) ?? []);
      zoneAdj.set(zoneId, adj);
    }

    for (const edge of edges) {
      const delta = DIR_DELTA[edge.direction];
      if (!delta || edge.isPortal) continue;

      const fromZoneId = getZoneId(edge.fromVnum);
      const toZoneId = getZoneId(edge.toVnum);
      if (fromZoneId !== toZoneId) continue;

      const adj = zoneAdj.get(fromZoneId);
      if (!adj) continue;

      adj.get(edge.fromVnum)?.push({ toVnum: edge.toVnum, direction: edge.direction });

      const reverseDir = OPPOSITE_DIR[edge.direction];
      if (reverseDir && adj.has(edge.toVnum)) {
        const toNeighbors = adj.get(edge.toVnum)!;
        if (!toNeighbors.some((n) => n.toVnum === edge.fromVnum)) {
          toNeighbors.push({ toVnum: edge.fromVnum, direction: reverseDir });
        }
      }
    }

    for (const entries of zoneAdj.values()) {
      for (const neighbors of entries.values()) {
        neighbors.sort((a, b) => {
          const aPriority = DIRECTION_PRIORITY[a.direction] ?? 99;
          const bPriority = DIRECTION_PRIORITY[b.direction] ?? 99;
          if (aPriority !== bPriority) return aPriority - bPriority;
          return a.toVnum - b.toVnum;
        });
      }
    }

    const rootVnum =
      (snapshot.currentVnum != null && nodes.some((node) => node.vnum === snapshot.currentVnum)
        ? snapshot.currentVnum
        : null) ?? Math.min(...nodes.map((node) => node.vnum));
    const rootZoneId = getZoneId(rootVnum);

    const orderedZoneIds = [
      rootZoneId,
      ...Array.from(nodesByZone.keys())
        .filter((zoneId) => zoneId !== rootZoneId)
        .sort((a, b) => a - b),
    ];

    let zoneCursorX = 0;
    let previousZoneMaxX = 0;
    let isFirstZone = true;

    for (const zoneId of orderedZoneIds) {
      const zoneNodes = [...(nodesByZone.get(zoneId) ?? [])].sort((a, b) => a - b);
      if (zoneNodes.length === 0) continue;

      const adj = zoneAdj.get(zoneId) ?? new Map<number, { toVnum: number; direction: string }[]>();
      const localCoords = new Map<number, { x: number; y: number }>();

      const zoneUpDownEdges = edges.filter(
        (e) => (e.direction === "up" || e.direction === "down") &&
          !e.isPortal &&
          getZoneId(e.fromVnum) === zoneId &&
          getZoneId(e.toVnum) === zoneId,
      );
      const preHorizAdj = new Map<number, number[]>();
      for (const e of edges) {
        if (!DIR_DELTA[e.direction] || e.isPortal || getZoneId(e.fromVnum) !== zoneId || getZoneId(e.toVnum) !== zoneId) continue;
        const fa = preHorizAdj.get(e.fromVnum) ?? []; fa.push(e.toVnum); preHorizAdj.set(e.fromVnum, fa);
        const ta = preHorizAdj.get(e.toVnum) ?? []; ta.push(e.fromVnum); preHorizAdj.set(e.toVnum, ta);
      }
      const preCompOf = new Map<number, number>();
      for (const v of zoneNodes) {
        if (preCompOf.has(v)) continue;
        const q = [v]; preCompOf.set(v, v);
        while (q.length > 0) {
          const c = q.shift()!;
          for (const nb of preHorizAdj.get(c) ?? []) {
            if (!preCompOf.has(nb)) { preCompOf.set(nb, v); q.push(nb); }
          }
        }
      }
      const preUpDownAdj = new Map<number, { toVnum: number; delta: number }[]>();
      for (const e of zoneUpDownEdges) {
        const delta = e.direction === "up" ? 1 : -1;
        const fa = preUpDownAdj.get(e.fromVnum) ?? []; fa.push({ toVnum: e.toVnum, delta }); preUpDownAdj.set(e.fromVnum, fa);
        const ta = preUpDownAdj.get(e.toVnum) ?? []; ta.push({ toVnum: e.fromVnum, delta: -delta }); preUpDownAdj.set(e.toVnum, ta);
      }
      const preCompZLevel = new Map<number, number>();
      for (const v of [...zoneNodes].sort((a, b) => a - b)) {
        const compId = preCompOf.get(v)!;
        if (preCompZLevel.has(compId)) continue;
        let inferredZ = 0;
        outer: for (const vv of zoneNodes) {
          if (preCompOf.get(vv) !== compId) continue;
          for (const { toVnum, delta } of preUpDownAdj.get(vv) ?? []) {
            const toComp = preCompOf.get(toVnum);
            if (toComp !== undefined && toComp !== compId && preCompZLevel.has(toComp)) {
              inferredZ = preCompZLevel.get(toComp)! - delta;
              break outer;
            }
          }
        }
        preCompZLevel.set(compId, inferredZ);
      }
      const preVnumZLevel = new Map<number, number>();
      for (const v of zoneNodes) {
        preVnumZLevel.set(v, preCompZLevel.get(preCompOf.get(v)!) ?? 0);
      }

      const occupiedByLevel = new Map<number, Map<string, number>>();
      const getOccupied = (zl: number): Map<string, number> => {
        if (!occupiedByLevel.has(zl)) occupiedByLevel.set(zl, new Map());
        return occupiedByLevel.get(zl)!;
      };

      const unplaced = new Set(zoneNodes);
      let componentOriginX = 0;
      let localMinX = 0;
      let localMaxX = 0;
      let localMinY = 0;
      let localMaxY = 0;

      const findFreeCell = (
        preferredX: number,
        preferredY: number,
        dx: number,
        dy: number,
        zl: number,
      ): { x: number; y: number } => {
        const perpStep = 2;
        const isHorizontal = dx !== 0;
        const occ = getOccupied(zl);
        for (let offset = perpStep; offset <= 8; offset += perpStep) {
          for (const sign of [1, -1]) {
            const cx = preferredX + (isHorizontal ? 0 : sign * offset);
            const cy = preferredY + (isHorizontal ? sign * offset : 0);
            if (!occ.has(cellKey(cx, cy))) return { x: cx, y: cy };
          }
        }
        for (let radius = 1; radius <= 20; radius++) {
          for (let sx = -radius; sx <= radius; sx++) {
            for (let sy = -radius; sy <= radius; sy++) {
              if (Math.abs(sx) !== radius && Math.abs(sy) !== radius) continue;
              const cx = preferredX + sx * 2;
              const cy = preferredY + sy * 2;
              if (!occ.has(cellKey(cx, cy))) return { x: cx, y: cy };
            }
          }
        }
        return { x: preferredX, y: preferredY };
      };

      const componentOriginByLevel = new Map<number, number>();

      const dbOnlyAdj = new Map<number, { toVnum: number; direction: string }[]>();
      for (const vnum of zoneNodes) dbOnlyAdj.set(vnum, []);
      for (const edge of edges) {
        if (!DIR_DELTA[edge.direction] || edge.isPortal) continue;
        if (getZoneId(edge.fromVnum) !== zoneId || getZoneId(edge.toVnum) !== zoneId) continue;
        dbOnlyAdj.get(edge.fromVnum)?.push({ toVnum: edge.toVnum, direction: edge.direction });
      }

      const doubleStepPairs = new Set<string>();
      for (const [vnum, neighbors] of adj) {
        for (const { toVnum, direction } of neighbors) {
          const reverseDir = OPPOSITE_DIR[direction];
          if (!reverseDir) continue;
          const toNeighbors = adj.get(toVnum) ?? [];
          const dbNeighbors = dbOnlyAdj.get(vnum) ?? [];
          for (const { toVnum: middleVnum } of toNeighbors) {
            if (middleVnum === vnum) continue;
            if (dbNeighbors.some((n) => n.toVnum === middleVnum)) continue;
            const middleNeighbors = adj.get(middleVnum) ?? [];
            const linksBack = middleNeighbors.some((n) => n.toVnum === vnum && n.direction === reverseDir);
            const linksForward = middleNeighbors.some((n) => n.toVnum === toVnum);
            if (linksBack && linksForward) {
              doubleStepPairs.add(`${vnum}:${direction}:${toVnum}`);
              doubleStepPairs.add(`${toVnum}:${reverseDir}:${vnum}`);
            }
          }
        }
      }

      while (unplaced.size > 0) {
        const componentRoot = Math.min(...unplaced);
        const rootZL = preVnumZLevel.get(componentRoot) ?? 0;
        const occ = getOccupied(rootZL);
        const originX = componentOriginByLevel.get(rootZL) ?? 0;

        localCoords.set(componentRoot, { x: originX, y: 0 });
        occ.set(cellKey(originX, 0), componentRoot);
        unplaced.delete(componentRoot);

        const queue = [componentRoot];
        while (queue.length > 0) {
          const current = queue.shift()!;
          const currentCoord = localCoords.get(current);
          if (!currentCoord) continue;
          const currentZL = preVnumZLevel.get(current) ?? 0;
          const currentOcc = getOccupied(currentZL);

          for (const neighbor of adj.get(current) ?? []) {
            if (localCoords.has(neighbor.toVnum)) continue;
            const delta = DIR_DELTA[neighbor.direction];
            if (!delta) continue;

            const step = doubleStepPairs.has(`${current}:${neighbor.direction}:${neighbor.toVnum}`) ? 2 : 1;
            const preferredX = currentCoord.x + delta[0] * step;
            const preferredY = currentCoord.y + delta[1] * step;

            let nextCoord: { x: number; y: number };
            const existingOccupant = currentOcc.get(cellKey(preferredX, preferredY));
            if (existingOccupant !== undefined && existingOccupant !== neighbor.toVnum) {
              nextCoord = findFreeCell(preferredX, preferredY, delta[0], delta[1], currentZL);
              collisionDisplacedVnums.add(neighbor.toVnum);
            } else {
              nextCoord = { x: preferredX, y: preferredY };
            }

            localCoords.set(neighbor.toVnum, nextCoord);
            currentOcc.set(cellKey(nextCoord.x, nextCoord.y), neighbor.toVnum);
            unplaced.delete(neighbor.toVnum);
            queue.push(neighbor.toVnum);

            if (nextCoord.x < localMinX) localMinX = nextCoord.x;
            if (nextCoord.x > localMaxX) localMaxX = nextCoord.x;
            if (nextCoord.y < localMinY) localMinY = nextCoord.y;
            if (nextCoord.y > localMaxY) localMaxY = nextCoord.y;
          }
        }

        const levelMaxX = Math.max(
          ...[...localCoords.entries()]
            .filter(([v]) => (preVnumZLevel.get(v) ?? 0) === rootZL)
            .map(([, c]) => c.x),
          componentOriginByLevel.get(rootZL) ?? 0,
        );
        componentOriginByLevel.set(rootZL, levelMaxX + COMPONENT_GAP);
      }

      const zoneOffsetX = isFirstZone ? 0 : previousZoneMaxX + ZONE_GAP - localMinX;
      for (const [vnum, coord] of localCoords) {
        placeRoom(vnum, coord.x + zoneOffsetX, coord.y, 0);
      }

      previousZoneMaxX = localMaxX + zoneOffsetX;
      zoneCursorX = previousZoneMaxX + ZONE_GAP;
      previousZoneMaxX = zoneCursorX - ZONE_GAP;
      isFirstZone = false;
    }

    const zLevelEdges = edges.filter(
      (e) => (e.direction === "up" || e.direction === "down") &&
        !e.isPortal &&
        getZoneId(e.fromVnum) === getZoneId(e.toVnum)
    );

    const zLevelAdj = new Map<number, { toVnum: number; delta: number }[]>();
    for (const e of zLevelEdges) {
      const delta = e.direction === "up" ? 1 : -1;
      const fwd = zLevelAdj.get(e.fromVnum) ?? [];
      fwd.push({ toVnum: e.toVnum, delta });
      zLevelAdj.set(e.fromVnum, fwd);
      const rev = zLevelAdj.get(e.toVnum) ?? [];
      rev.push({ toVnum: e.fromVnum, delta: -delta });
      zLevelAdj.set(e.toVnum, rev);
    }

    const zLevelMap = new Map<number, number>();

    const horizontalAdj = new Map<number, number[]>();
    for (const e of edges) {
      if (!DIR_DELTA[e.direction] || e.isPortal || getZoneId(e.fromVnum) !== getZoneId(e.toVnum)) continue;
      const fwd = horizontalAdj.get(e.fromVnum) ?? [];
      fwd.push(e.toVnum);
      horizontalAdj.set(e.fromVnum, fwd);
      const rev = horizontalAdj.get(e.toVnum) ?? [];
      rev.push(e.fromVnum);
      horizontalAdj.set(e.toVnum, rev);
    }

    const componentOf = new Map<number, number>();
    const componentSeeds: number[] = [];
    const allVnums = Array.from(gridLayout.keys()).sort((a, b) => a - b);
    for (const vnum of allVnums) {
      if (componentOf.has(vnum)) continue;
      const compId = vnum;
      componentSeeds.push(compId);
      const bfsQ = [vnum];
      componentOf.set(vnum, compId);
      while (bfsQ.length > 0) {
        const cur = bfsQ.shift()!;
        for (const nb of horizontalAdj.get(cur) ?? []) {
          if (!componentOf.has(nb) && gridLayout.has(nb)) {
            componentOf.set(nb, compId);
            bfsQ.push(nb);
          }
        }
      }
    }

    const compZLevel = new Map<number, number>();
    for (const compId of componentSeeds.sort((a, b) => a - b)) {
      if (compZLevel.has(compId)) continue;
      const inferredZ = (() => {
        for (const vnum of allVnums) {
          if (componentOf.get(vnum) !== compId) continue;
          for (const { toVnum, delta } of zLevelAdj.get(vnum) ?? []) {
            const toComp = componentOf.get(toVnum);
            if (toComp !== undefined && toComp !== compId && compZLevel.has(toComp)) {
              return compZLevel.get(toComp)! - delta;
            }
          }
        }
        return 0;
      })();
      compZLevel.set(compId, inferredZ);
    }

    for (const [vnum, cell] of gridLayout) {
      const compId = componentOf.get(vnum);
      cell.zLevel = compId !== undefined ? (compZLevel.get(compId) ?? 0) : 0;
      zLevelMap.set(vnum, cell.zLevel);
    }

    for (const [vnum, cell] of gridLayout) {
      cell.zLevel = zLevelMap.get(vnum) ?? 0;
    }

    availableZLevels = Array.from(new Set(Array.from(gridLayout.values()).map((c) => c.zLevel))).sort((a, b) => a - b);

    if (snapshot.currentVnum != null && gridLayout.has(snapshot.currentVnum)) {
      currentZLevel = gridLayout.get(snapshot.currentVnum)!.zLevel;
    } else if (!availableZLevels.includes(currentZLevel)) {
      currentZLevel = availableZLevels[0] ?? 0;
    }

    updateZLevelControls();
  }

  function updateZLevelControls(): void {
    zLevelLabel.textContent = `${currentZLevel >= 0 ? "+" : ""}${currentZLevel}`;
    zLevelDownButton.disabled = currentZLevel <= (availableZLevels[0] ?? 0);
    zLevelUpButton.disabled = currentZLevel >= (availableZLevels[availableZLevels.length - 1] ?? 0);
  }

  function renderGridMap(snapshot: MapSnapshotPayload, onlyCurrentChanged = false): void {
    if (onlyCurrentChanged && mapRoomElements.size > 0) {
      const nodeColorByVnum = new Map(snapshot.nodes.map((n) => [n.vnum, n.color ?? null]));
      for (const [vnum, el] of mapRoomElements) {
        const isCurrent = vnum === snapshot.currentVnum;
        el.className = isCurrent ? "map-room map-room--current" : "map-room";
        if (!isCurrent) {
          const color = nodeColorByVnum.get(vnum);
          el.style.background = color ?? "";
        } else {
          el.style.background = "";
        }
      }
      if (snapshot.currentVnum != null) {
        const cell = gridLayout.get(snapshot.currentVnum);
        if (cell) {
          requestAnimationFrame(() => {
            const cx = (cell.gridX - lastRenderedMinX + PAD) * CELL + TILE / 2;
            const cy = (lastRenderedMaxY - cell.gridY + PAD) * CELL + TILE / 2;
            const targetScrollLeft = cx - mapCanvasElement.clientWidth / 2;
            const targetScrollTop = cy - mapCanvasElement.clientHeight / 2;
            console.log("[scroll-fast] vnum=" + snapshot.currentVnum + " gridX=" + cell.gridX + " gridY=" + cell.gridY + " minX=" + lastRenderedMinX + " maxY=" + lastRenderedMaxY + " cx=" + cx + " cy=" + cy + " clientW=" + mapCanvasElement.clientWidth + " clientH=" + mapCanvasElement.clientHeight + " canvasH=" + mapCanvasElement.scrollHeight + " targetL=" + targetScrollLeft + " targetT=" + targetScrollTop);
            mapCanvasElement.scrollLeft = targetScrollLeft;
            mapCanvasElement.scrollTop = targetScrollTop;
            console.log("[scroll-fast-after] actualL=" + mapCanvasElement.scrollLeft + " actualT=" + mapCanvasElement.scrollTop);
          });
        } else {
          console.log("[scroll-fast] cell NOT FOUND for vnum=" + snapshot.currentVnum + " gridLayout.size=" + gridLayout.size);
        }
      }
      return;
    }

    mapRoomElements.clear();
    mapCanvasElement.innerHTML = "";

    if (snapshot.nodes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "map-empty";
      empty.textContent = "No map data yet";
      mapCanvasElement.appendChild(empty);
      return;
    }

    if (gridLayout.size === 0) return;

    const nodeByVnum = new Map(snapshot.nodes.map((n) => [n.vnum, n]));
    const currentZoneId = snapshot.currentVnum != null ? getZoneId(snapshot.currentVnum) : null;
    const levelCells = new Map(
      Array.from(gridLayout.entries()).filter(([, cell]) =>
        cell.zLevel === currentZLevel &&
        (currentZoneId === null || cell.zoneId === currentZoneId)
      )
    );
    const visibleVnums = new Set(
      Array.from(levelCells.keys()).filter((vnum) => nodeByVnum.has(vnum))
    );

    const cellByPos = new Map<string, GridCell>();
    for (const cell of levelCells.values()) {
      cellByPos.set(cellKey(cell.gridX, cell.gridY), cell);
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cell of levelCells.values()) {
      if (cell.gridX < minX) minX = cell.gridX;
      if (cell.gridY < minY) minY = cell.gridY;
      if (cell.gridX > maxX) maxX = cell.gridX;
      if (cell.gridY > maxY) maxY = cell.gridY;
    }

    for (const cell of levelCells.values()) {
      const node = nodeByVnum.get(cell.vnum);
      if (!node) continue;
      for (const dir of (node.exits ?? [])) {
        const delta = DIR_DELTA[dir];
        if (!delta) continue;
        const nx = cell.gridX + delta[0];
        const ny = cell.gridY + delta[1];
        const neighbor = cellByPos.get(cellKey(nx, ny));
        const matchingNeighbor = neighbor !== undefined && neighbor.vnum !== cell.vnum && visibleVnums.has(neighbor.vnum);
        if (matchingNeighbor) continue;
        if (nx < minX) minX = nx;
        if (ny < minY) minY = ny;
        if (nx > maxX) maxX = nx;
        if (ny > maxY) maxY = ny;
      }
    }

    const cols = maxX - minX + 1;
    const rows = maxY - minY + 1;
    const canvasW = (cols + PAD * 2) * CELL;
    const canvasH = (rows + PAD * 2) * CELL;

    lastRenderedMinX = minX;
    lastRenderedMaxY = maxY;

    function toRenderY(gy: number): number {
      return maxY - gy;
    }

    function tileCenter(gx: number, gy: number): [number, number] {
      return [(gx - minX + PAD) * CELL + TILE / 2, (toRenderY(gy) + PAD) * CELL + TILE / 2];
    }

    const wrapper = document.createElement("div");
    wrapper.className = "map-wrapper";
    wrapper.style.width = `${canvasW}px`;
    wrapper.style.height = `${canvasH}px`;
    wrapper.style.position = "relative";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(canvasW));
    svg.setAttribute("height", String(canvasH));
    svg.style.position = "absolute";
    svg.style.inset = "0";
    svg.style.pointerEvents = "none";

    const confirmedEdgeKeys = new Set<string>();
    const edgeDirectionsByVnum = new Map<number, Set<string>>();
    for (const edge of snapshot.edges) {
      confirmedEdgeKeys.add(`${edge.fromVnum}:${edge.direction}`);
      if (levelCells.has(edge.fromVnum)) {
        let dirs = edgeDirectionsByVnum.get(edge.fromVnum);
        if (!dirs) { dirs = new Set(); edgeDirectionsByVnum.set(edge.fromVnum, dirs); }
        dirs.add(edge.direction);
      }
    }

    const componentIdOf = new Map<number, number>();
    {
      const horizAdj = new Map<number, number[]>();
      for (const edge of snapshot.edges) {
        if (edge.isPortal || !DIR_DELTA[edge.direction]) continue;
        if (!levelCells.has(edge.fromVnum) || !levelCells.has(edge.toVnum)) continue;
        const fz = getZoneId(edge.fromVnum), tz = getZoneId(edge.toVnum);
        if (fz !== tz) continue;
        const fa = horizAdj.get(edge.fromVnum) ?? []; fa.push(edge.toVnum); horizAdj.set(edge.fromVnum, fa);
        const ta = horizAdj.get(edge.toVnum) ?? []; ta.push(edge.fromVnum); horizAdj.set(edge.toVnum, ta);
      }
      for (const vnum of levelCells.keys()) {
        if (componentIdOf.has(vnum)) continue;
        const q = [vnum];
        componentIdOf.set(vnum, vnum);
        while (q.length > 0) {
          const cur = q.shift()!;
          for (const nb of horizAdj.get(cur) ?? []) {
            if (!componentIdOf.has(nb) && levelCells.has(nb)) {
              componentIdOf.set(nb, vnum);
              q.push(nb);
            }
          }
        }
      }
    }

    const portalVnums = new Set<number>();
    const REVERSE_DIR: Record<string, string> = { north: "south", south: "north", east: "west", west: "east" };
    const drawIntraPortal = (cellA: { gridX: number; gridY: number }, dir: string): void => {
      const dirDelta = DIR_DELTA[dir];
      if (!dirDelta) return;
      const [cx, cy] = tileCenter(cellA.gridX, cellA.gridY);
      const reach = TILE / 2 + (CELL - TILE) / 2 + 10;
      const ex = cx + dirDelta[0] * reach;
      const ey = cy - dirDelta[1] * reach;
      const stem = document.createElementNS("http://www.w3.org/2000/svg", "line");
      stem.setAttribute("x1", String(cx));
      stem.setAttribute("y1", String(cy));
      stem.setAttribute("x2", String(ex));
      stem.setAttribute("y2", String(ey));
      stem.setAttribute("class", "map-edge map-edge--intra-portal-stem");
      svg.appendChild(stem);
      const crossHalf = 6;
      const [ppx, ppy] = dirDelta[0] !== 0 ? [0, crossHalf] : [crossHalf, 0];
      const cross = document.createElementNS("http://www.w3.org/2000/svg", "line");
      cross.setAttribute("x1", String(ex - ppx));
      cross.setAttribute("y1", String(ey - ppy));
      cross.setAttribute("x2", String(ex + ppx));
      cross.setAttribute("y2", String(ey + ppy));
      cross.setAttribute("class", "map-edge--intra-portal-cross");
      svg.appendChild(cross);
    };

    const drawnEdges = new Set<string>();
    for (const edge of snapshot.edges) {
      const fromCell = levelCells.get(edge.fromVnum);
      if (!fromCell) continue;
      const toCell = levelCells.get(edge.toVnum);

      if (edge.isPortal) {
        portalVnums.add(edge.fromVnum);
        if (!toCell) {
          if (!visibleVnums.has(edge.fromVnum)) continue;

          const [cx, cy] = tileCenter(fromCell.gridX, fromCell.gridY);
          const dirDelta = DIR_DELTA[edge.direction];
          if (!dirDelta) continue;

          const reach = TILE / 2 + (CELL - TILE) / 2 + 10;
          const ex = cx + dirDelta[0] * reach;
          const ey = cy - dirDelta[1] * reach;

          const stem = document.createElementNS("http://www.w3.org/2000/svg", "line");
          stem.setAttribute("x1", String(cx));
          stem.setAttribute("y1", String(cy));
          stem.setAttribute("x2", String(ex));
          stem.setAttribute("y2", String(ey));
          stem.setAttribute("class", "map-edge map-edge--portal-stem");
          svg.appendChild(stem);

          const crossHalf = 6;
          const [px, py] = dirDelta[0] !== 0 ? [0, crossHalf] : [crossHalf, 0];
          const cross = document.createElementNS("http://www.w3.org/2000/svg", "line");
          cross.setAttribute("x1", String(ex - px));
          cross.setAttribute("y1", String(ey - py));
          cross.setAttribute("x2", String(ex + px));
          cross.setAttribute("y2", String(ey + py));
          cross.setAttribute("class", "map-edge--portal-cross");
          svg.appendChild(cross);
          continue;
        }
      }

      if (!toCell) continue;
      if (!visibleVnums.has(edge.fromVnum) || !visibleVnums.has(edge.toVnum)) continue;

      const edgeKey = [edge.fromVnum, edge.toVnum].sort().join("-");
      if (drawnEdges.has(edgeKey)) continue;
      drawnEdges.add(edgeKey);

      const isCrossComponent =
        getZoneId(edge.fromVnum) === getZoneId(edge.toVnum) &&
        componentIdOf.get(edge.fromVnum) !== componentIdOf.get(edge.toVnum);

      const isCollisionEdge =
        collisionDisplacedVnums.has(edge.fromVnum) || collisionDisplacedVnums.has(edge.toVnum);

      const gridDist = Math.abs(fromCell.gridX - toCell.gridX) + Math.abs(fromCell.gridY - toCell.gridY);
      const isPhysicallyAdjacent = gridDist <= 2;

      if ((isCrossComponent || isCollisionEdge) && !isPhysicallyAdjacent) {
        drawIntraPortal(fromCell, edge.direction);
        if (toCell && REVERSE_DIR[edge.direction]) {
          drawIntraPortal(toCell, REVERSE_DIR[edge.direction]);
        }
        continue;
      }

      const [x1, y1] = tileCenter(fromCell.gridX, fromCell.gridY);
      const [x2, y2] = tileCenter(toCell.gridX, toCell.gridY);

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      line.setAttribute("class", "map-edge");
      svg.appendChild(line);
    }

    wrapper.appendChild(svg);

    const currentAliases = getAliases();

    for (const cell of levelCells.values()) {
      const node = nodeByVnum.get(cell.vnum);
      if (!node) continue;

      const isCurrent = cell.vnum === snapshot.currentVnum;
      const px = (cell.gridX - minX + PAD) * CELL;
      const py = (toRenderY(cell.gridY) + PAD) * CELL;

      const tile = document.createElement("div");
      tile.className = isCurrent ? "map-room map-room--current" : "map-room";
      tile.style.left = `${px}px`;
      tile.style.top = `${py}px`;
      tile.style.width = `${TILE}px`;
      tile.style.height = `${TILE}px`;
      tile.setAttribute("data-vnum", String(cell.vnum));

      if (!isCurrent && node.color) {
        tile.style.background = node.color;
      }

      const nameEl = document.createElement("span");
      nameEl.className = "map-room__name";
      nameEl.textContent = node.name;
      tile.appendChild(nameEl);

      const aliasEntry = currentAliases.find((a) => a.vnum === cell.vnum);
      if (aliasEntry) {
        const aliasBadge = document.createElement("div");
        aliasBadge.className = "map-alias-badge";
        aliasBadge.textContent = aliasEntry.alias;
        tile.appendChild(aliasBadge);
      }

      const upDownExits = (node.exits ?? []).filter((d) => d === "up" || d === "down");
      if (upDownExits.length > 0) {
        const edgeDirections = edgeDirectionsByVnum.get(cell.vnum) ?? new Set<string>();
        const closedSet = new Set(node.closedExits ?? []);

        for (const dir of upDownExits) {
          const explored = edgeDirections.has(dir);
          const closed = closedSet.has(dir);
          const badge = document.createElement("div");
          badge.className = explored
            ? "map-exit-vertical map-exit-vertical--explored"
            : "map-exit-vertical map-exit-vertical--unknown";
          let symbol = dir === "up" ? "↑" : "↓";
          if (closed) symbol += "(w)";
          badge.textContent = symbol;
          tile.appendChild(badge);
        }
      }

      wrapper.appendChild(tile);
      mapRoomElements.set(cell.vnum, tile);
    }

    const STUB = 14;
    const drawnUnconfirmed = new Set<string>();

    for (const cell of levelCells.values()) {
      const node = nodeByVnum.get(cell.vnum);
      if (!node) continue;

      for (const dir of (node.exits ?? [])) {
        const delta = DIR_DELTA[dir];
        if (!delta) continue;

        const nx = cell.gridX + delta[0];
        const ny = cell.gridY + delta[1];
        const candidate = cellByPos.get(cellKey(nx, ny));
        const neighborCell = (candidate !== undefined && candidate.vnum !== cell.vnum && visibleVnums.has(candidate.vnum))
          ? candidate
          : undefined;

        if (neighborCell) {
          const edgeConfirmed =
            confirmedEdgeKeys.has(`${cell.vnum}:${dir}`) ||
            confirmedEdgeKeys.has(`${neighborCell.vnum}:${OPPOSITE_DIR[dir] ?? ""}`);
          if (edgeConfirmed) continue;

          const pairKey = [cell.vnum, neighborCell.vnum].sort().join("-") + ":" + dir;
          if (drawnUnconfirmed.has(pairKey)) continue;
          drawnUnconfirmed.add(pairKey);

          const [x1, y1] = tileCenter(cell.gridX, cell.gridY);
          const [x2, y2] = tileCenter(neighborCell.gridX, neighborCell.gridY);
          const GAP_HALF = 3;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / len;
          const uy = dy / len;

          for (const [ax, ay, bx, by] of [
            [x1, y1, mx - ux * GAP_HALF, my - uy * GAP_HALF],
            [mx + ux * GAP_HALF, my + uy * GAP_HALF, x2, y2],
          ] as [number, number, number, number][]) {
            const seg = document.createElementNS("http://www.w3.org/2000/svg", "line");
            seg.setAttribute("x1", String(ax));
            seg.setAttribute("y1", String(ay));
            seg.setAttribute("x2", String(bx));
            seg.setAttribute("y2", String(by));
            seg.setAttribute("class", "map-edge map-edge--unconfirmed");
            svg.appendChild(seg);
          }
          continue;
        }

        const stubX = (nx - minX + PAD) * CELL + (TILE - STUB) / 2;
        const stubY = (toRenderY(ny) + PAD) * CELL + (TILE - STUB) / 2;

        const stub = document.createElement("div");
        stub.className = "map-room-stub";
        stub.style.left = `${stubX}px`;
        stub.style.top = `${stubY}px`;
        stub.style.width = `${STUB}px`;
        stub.style.height = `${STUB}px`;

        const isClosed = (node.closedExits ?? []).includes(dir);
        if (isClosed) {
          stub.className = "map-room-stub map-room-stub--door";
          const doorLabel = document.createElement("span");
          doorLabel.className = "map-stub-door-label";
          doorLabel.textContent = "(w)";
          stub.appendChild(doorLabel);
        } else {
          const stubSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          stubSvg.setAttribute("width", String(STUB));
          stubSvg.setAttribute("height", String(STUB));
          stubSvg.setAttribute("viewBox", `0 0 ${STUB} ${STUB}`);
          stubSvg.style.display = "block";
          const stubDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          stubDot.setAttribute("cx", String(STUB / 2));
          stubDot.setAttribute("cy", String(STUB / 2));
          stubDot.setAttribute("r", "2.5");
          stubDot.setAttribute("class", "map-stub-dot");
          stubSvg.appendChild(stubDot);
          stub.appendChild(stubSvg);
        }

        wrapper.appendChild(stub);

        const [x1, y1] = tileCenter(cell.gridX, cell.gridY);
        const stubCx = stubX + STUB / 2;
        const stubCy = stubY + STUB / 2;

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(stubCx));
        line.setAttribute("y2", String(stubCy));
        line.setAttribute("class", "map-edge map-edge--unknown");
        svg.appendChild(line);
      }
    }

    mapCanvasElement.appendChild(wrapper);

    const currentCell = snapshot.currentVnum != null ? levelCells.get(snapshot.currentVnum) : null;
    if (currentCell) {
      const snapCell = currentCell;
      requestAnimationFrame(() => {
        const [cx, cy] = tileCenter(snapCell.gridX, snapCell.gridY);
        console.log("[scroll-full] vnum=" + snapshot.currentVnum + " gridX=" + snapCell.gridX + " gridY=" + snapCell.gridY + " cx=" + cx + " cy=" + cy + " clientW=" + mapCanvasElement.clientWidth + " clientH=" + mapCanvasElement.clientHeight + " canvasH=" + mapCanvasElement.scrollHeight);
        mapCanvasElement.scrollLeft = cx - mapCanvasElement.clientWidth / 2;
        mapCanvasElement.scrollTop = cy - mapCanvasElement.clientHeight / 2;
      });
    }
  }

  function updateMap(snapshot: MapSnapshotPayload, fullReset: boolean): void {
    latestMapSnapshot = snapshot;
    if (fullReset) {
      latestFullSnapshot = snapshot;
    } else {
      latestFullSnapshot = {
        ...latestFullSnapshot,
        currentVnum: snapshot.currentVnum,
        zoneNames: snapshot.zoneNames.length > 0 ? snapshot.zoneNames : latestFullSnapshot.zoneNames,
      };
    }
    let zoneNamesChanged = false;
    for (const [zoneId, name] of snapshot.zoneNames) {
      if (zoneNames.get(zoneId) !== name) {
        zoneNames.set(zoneId, name);
        zoneNamesChanged = true;
      }
    }
    if (zoneNamesChanged) {
      saveZoneNames(zoneNames);
      bus.emit("zone_names", zoneNames);
    }
    bus.emit("map_full_snapshot", latestFullSnapshot);

    const currentZoneId = snapshot.currentVnum != null ? getZoneId(snapshot.currentVnum) : null;
    const expectedZLevel =
      snapshot.currentVnum != null && gridLayout.has(snapshot.currentVnum)
        ? gridLayout.get(snapshot.currentVnum)!.zLevel
        : currentZLevel;
    const graphUnchanged =
      !fullReset &&
      snapshot.nodes.length === lastLayoutNodeCount &&
      snapshot.edges.length === lastLayoutEdgeCount &&
      currentZoneId === lastRenderedZone &&
      expectedZLevel === lastRenderedZLevel;

    if (graphUnchanged) {
      renderGridMap(snapshot, true);
      onMapUpdated();
      return;
    }

    lastLayoutNodeCount = snapshot.nodes.length;
    lastLayoutEdgeCount = snapshot.edges.length;

    resetGridLayout();
    integrateSnapshot(snapshot);
    lastRenderedZone = currentZoneId;
    lastRenderedZLevel = currentZLevel;
    renderGridMap(snapshot, false);
    onMapUpdated();
  }

  mapCanvasElement.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    mapDidDrag = false;
    mapDragOrigin = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: mapCanvasElement.scrollLeft,
      scrollTop: mapCanvasElement.scrollTop,
    };
    mapCanvasElement.setPointerCapture(e.pointerId);
    mapCanvasElement.classList.add("map-canvas--dragging");
  });

  mapCanvasElement.addEventListener("pointermove", (e) => {
    if (!mapDragOrigin) return;
    if (Math.abs(e.clientX - mapDragOrigin.x) > 4 || Math.abs(e.clientY - mapDragOrigin.y) > 4) {
      mapDidDrag = true;
    }
    mapCanvasElement.scrollLeft = mapDragOrigin.scrollLeft - (e.clientX - mapDragOrigin.x);
    mapCanvasElement.scrollTop = mapDragOrigin.scrollTop - (e.clientY - mapDragOrigin.y);
  });

  mapCanvasElement.addEventListener("pointerup", () => {
    mapDragOrigin = null;
    mapCanvasElement.classList.remove("map-canvas--dragging");
  });

  mapCanvasElement.addEventListener("pointercancel", () => {
    mapDragOrigin = null;
    mapCanvasElement.classList.remove("map-canvas--dragging");
  });

  mapCanvasElement.addEventListener("dblclick", (e) => {
    if (mapDidDrag) return;
    const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
    if (!elementUnder) return;
    const tile = elementUnder.closest<HTMLElement>(".map-room");
    if (!tile) return;
    const vnumAttr = tile.getAttribute("data-vnum");
    if (!vnumAttr) return;
    const vnum = Number(vnumAttr);
    const snapshot = latestMapSnapshot;
    const node = snapshot.nodes.find((n) => n.vnum === vnum);
    const aliases = getAliases();
    onAliasPopup(vnum, aliases.find((a) => a.vnum === vnum)?.alias, node?.name ?? String(vnum));
  });

  mapCanvasElement.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
    if (!elementUnder) return;
    const tile = elementUnder.closest<HTMLElement>(".map-room");
    if (!tile) return;
    const vnumAttr = tile.getAttribute("data-vnum");
    if (!vnumAttr) return;
    onMapContextMenu(Number(vnumAttr), e.clientX, e.clientY);
  });

  zLevelDownButton.addEventListener("click", () => {
    const idx = availableZLevels.indexOf(currentZLevel);
    if (idx > 0) {
      currentZLevel = availableZLevels[idx - 1]!;
      lastRenderedZLevel = currentZLevel;
      updateZLevelControls();
      renderGridMap(latestMapSnapshot);
    }
  });

  zLevelUpButton.addEventListener("click", () => {
    const idx = availableZLevels.indexOf(currentZLevel);
    if (idx < availableZLevels.length - 1) {
      currentZLevel = availableZLevels[idx + 1]!;
      lastRenderedZLevel = currentZLevel;
      updateZLevelControls();
      renderGridMap(latestMapSnapshot);
    }
  });

  return {
    updateMap,
    forceFullRerender: () => {
      lastLayoutNodeCount = -1;
      renderGridMap(latestMapSnapshot);
    },
    getLatestSnapshot: () => latestMapSnapshot,
    getLatestFullSnapshot: () => latestFullSnapshot,
    getZoneNames: () => zoneNames,
    setZoneName: (zoneId: number, name: string | null) => {
      if (name) zoneNames.set(zoneId, name);
      else zoneNames.delete(zoneId);
      saveZoneNames(zoneNames);
    },
  };
}
