#!/usr/bin/env bun
// Debug script: runs the same BFS layout algorithm as client.ts and prints ASCII map
// Usage: bun scripts/debug-zone-map.ts [zoneId]
// Example: bun scripts/debug-zone-map.ts 270

import postgres from "postgres";

const DATABASE_URL = Bun.env.DATABASE_URL ?? "postgres://bylins:bylins@localhost:5432/bylins_bot";
const db = postgres(DATABASE_URL);

const ZONE_ARG = parseInt(process.argv[2] ?? "270", 10);
const VNUM_MIN = ZONE_ARG * 100;
const VNUM_MAX = VNUM_MIN + 99;

const DIR_DELTA: Record<string, [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  east:  [1, 0],
  west:  [-1, 0],
};

const REVERSE: Record<string, string> = {
  north: "south", south: "north", east: "west", west: "east",
};

const DIRECTION_PRIORITY: Record<string, number> = {
  north: 0, south: 1, east: 2, west: 3,
};

const COMPONENT_GAP = 4;

function cellKey(x: number, y: number): string { return `${x},${y}`; }

async function main() {
  const roomRows = await db<{ vnum: number }[]>`
    SELECT vnum FROM map_rooms WHERE vnum >= ${VNUM_MIN} AND vnum <= ${VNUM_MAX} ORDER BY vnum
  `;
  const edgeRows = await db<{ from_vnum: number; direction: string; to_vnum: number; is_portal: boolean }[]>`
    SELECT from_vnum, direction, to_vnum, is_portal
    FROM map_edges
    WHERE from_vnum >= ${VNUM_MIN} AND from_vnum <= ${VNUM_MAX}
    ORDER BY from_vnum, direction
  `;

  const vnums = roomRows.map(r => r.vnum);
  if (vnums.length === 0) { console.log("No rooms found for zone", ZONE_ARG); process.exit(1); }

  console.log(`Zone ${ZONE_ARG}: ${vnums.length} rooms, ${edgeRows.length} edges`);

  // Build adjacency (same as integrateSnapshot)
  const adj = new Map<number, { toVnum: number; direction: string }[]>();
  for (const v of vnums) adj.set(v, []);

  for (const e of edgeRows) {
    if (e.is_portal) continue;
    const delta = DIR_DELTA[e.direction];
    if (!delta) continue;
    if (e.to_vnum < VNUM_MIN || e.to_vnum > VNUM_MAX) continue;
    adj.get(e.from_vnum)?.push({ toVnum: e.to_vnum, direction: e.direction });
    const reverseDir = REVERSE[e.direction];
    if (reverseDir && adj.has(e.to_vnum)) {
      const toNeighbors = adj.get(e.to_vnum)!;
      if (!toNeighbors.some(n => n.toVnum === e.from_vnum)) {
        toNeighbors.push({ toVnum: e.from_vnum, direction: reverseDir });
      }
    }
  }

  for (const neighbors of adj.values()) {
    neighbors.sort((a, b) => {
      const pa = DIRECTION_PRIORITY[a.direction] ?? 99;
      const pb = DIRECTION_PRIORITY[b.direction] ?? 99;
      return pa !== pb ? pa - pb : a.toVnum - b.toVnum;
    });
  }

  const upDownEdges = edgeRows.filter(e => e.direction === "up" || e.direction === "down");
  const preHorizAdj = new Map<number, number[]>();
  for (const e of edgeRows) {
    if (!DIR_DELTA[e.direction] || e.is_portal) continue;
    const fa = preHorizAdj.get(e.from_vnum) ?? []; fa.push(e.to_vnum); preHorizAdj.set(e.from_vnum, fa);
    const ta = preHorizAdj.get(e.to_vnum) ?? []; ta.push(e.from_vnum); preHorizAdj.set(e.to_vnum, ta);
  }
  const preCompOf = new Map<number, number>();
  for (const v of vnums) {
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
  for (const e of upDownEdges) {
    const delta = e.direction === "up" ? 1 : -1;
    const fa = preUpDownAdj.get(e.from_vnum) ?? []; fa.push({ toVnum: e.to_vnum, delta }); preUpDownAdj.set(e.from_vnum, fa);
    const ta = preUpDownAdj.get(e.to_vnum) ?? []; ta.push({ toVnum: e.from_vnum, delta: -delta }); preUpDownAdj.set(e.to_vnum, ta);
  }
  const preCompZLevel = new Map<number, number>();
  for (const v of [...vnums].sort((a, b) => a - b)) {
    const compId = preCompOf.get(v)!;
    if (preCompZLevel.has(compId)) continue;
    let inferredZ = 0;
    outer: for (const vv of vnums) {
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
  for (const v of vnums) preVnumZLevel.set(v, preCompZLevel.get(preCompOf.get(v)!) ?? 0);

  const occupiedByLevel = new Map<number, Map<string, number>>();
  const getOccupied = (zl: number) => {
    if (!occupiedByLevel.has(zl)) occupiedByLevel.set(zl, new Map());
    return occupiedByLevel.get(zl)!;
  };

  const localCoords = new Map<number, { x: number; y: number }>();
  const unplaced = new Set(vnums);
  let localMaxX = 0;
  let localMinY = 0;
  let localMaxY = 0;

  const findFreeCell = (px: number, py: number, dx: number, dy: number, zl: number): { x: number; y: number } => {
    const perpStep = 2;
    const isHorizontal = dx !== 0;
    const occ = getOccupied(zl);
    for (let offset = perpStep; offset <= 8; offset += perpStep) {
      for (const sign of [1, -1]) {
        const cx = px + (isHorizontal ? 0 : sign * offset);
        const cy = py + (isHorizontal ? sign * offset : 0);
        if (!occ.has(cellKey(cx, cy))) return { x: cx, y: cy };
      }
    }
    for (let radius = 1; radius <= 20; radius++) {
      for (let sx = -radius; sx <= radius; sx++) {
        for (let sy = -radius; sy <= radius; sy++) {
          if (Math.abs(sx) !== radius && Math.abs(sy) !== radius) continue;
          const cx = px + sx * 2;
          const cy = py + sy * 2;
          if (!occ.has(cellKey(cx, cy))) return { x: cx, y: cy };
        }
      }
    }
    return { x: px, y: py };
  };

  const componentOriginByLevel = new Map<number, number>();

  const dbOnlyAdj = new Map<number, { toVnum: number; direction: string }[]>();
  for (const v of vnums) dbOnlyAdj.set(v, []);
  for (const e of edgeRows) {
    if (e.is_portal) continue;
    const delta = DIR_DELTA[e.direction];
    if (!delta) continue;
    if (e.to_vnum < VNUM_MIN || e.to_vnum > VNUM_MAX) continue;
    dbOnlyAdj.get(e.from_vnum)?.push({ toVnum: e.to_vnum, direction: e.direction });
  }

  const doubleStepPairs = new Set<string>();
  for (const [vnum, neighbors] of adj) {
    for (const { toVnum, direction } of neighbors) {
      const reverseDir = REVERSE[direction];
      if (!reverseDir) continue;
      const toNeighbors = adj.get(toVnum) ?? [];
      const dbNeighbors = dbOnlyAdj.get(vnum) ?? [];
      for (const { toVnum: middleVnum } of toNeighbors) {
        if (middleVnum === vnum) continue;
        if (dbNeighbors.some(n => n.toVnum === middleVnum)) continue;
        const middleNeighbors = adj.get(middleVnum) ?? [];
        const linksBack = middleNeighbors.some(n => n.toVnum === vnum && n.direction === reverseDir);
        const linksForward = middleNeighbors.some(n => n.toVnum === toVnum);
        if (linksBack && linksForward) {
          doubleStepPairs.add(`${vnum}:${direction}:${toVnum}`);
          doubleStepPairs.add(`${toVnum}:${reverseDir}:${vnum}`);
        }
      }
    }
  }
  if (doubleStepPairs.size > 0) console.log(`  doubleStepPairs: ${[...doubleStepPairs].join(", ")}`);

  while (unplaced.size > 0) {
    const componentRoot = Math.min(...unplaced);
    const rootZL = preVnumZLevel.get(componentRoot) ?? 0;
    const occ = getOccupied(rootZL);
    const originX = componentOriginByLevel.get(rootZL) ?? 0;

    localCoords.set(componentRoot, { x: originX, y: 0 });
    occ.set(cellKey(originX, 0), componentRoot);
    unplaced.delete(componentRoot);

    let compSize = 1;
    const queue = [componentRoot];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentCoord = localCoords.get(current)!;
      const currentZL = preVnumZLevel.get(current) ?? 0;
      const currentOcc = getOccupied(currentZL);

      for (const neighbor of adj.get(current) ?? []) {
        if (localCoords.has(neighbor.toVnum)) continue;
        const delta = DIR_DELTA[neighbor.direction];
        if (!delta) continue;

        const step = doubleStepPairs.has(`${current}:${neighbor.direction}:${neighbor.toVnum}`) ? 2 : 1;
        const px = currentCoord.x + delta[0] * step;
        const py = currentCoord.y + delta[1] * step;

        let nextCoord: { x: number; y: number };
        const existing = currentOcc.get(cellKey(px, py));
        if (existing !== undefined && existing !== neighbor.toVnum) {
          nextCoord = findFreeCell(px, py, delta[0], delta[1], currentZL);
          console.log(`  COLLISION: vnum ${neighbor.toVnum} (zl=${currentZL}) wants (${px},${py}) occupied by ${existing} → moved to (${nextCoord.x},${nextCoord.y})`);
        } else {
          nextCoord = { x: px, y: py };
        }

        localCoords.set(neighbor.toVnum, nextCoord);
        currentOcc.set(cellKey(nextCoord.x, nextCoord.y), neighbor.toVnum);
        unplaced.delete(neighbor.toVnum);
        queue.push(neighbor.toVnum);
        compSize++;

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

  console.log(`\nTotal rooms placed: ${localCoords.size}`);

  // Check for rooms NOT placed (isolated)
  const unconnected = vnums.filter(v => !localCoords.has(v));
  if (unconnected.length > 0) console.log(`\nUnconnected (no edges): ${unconnected.join(", ")}`);

  // Find bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const { x, y } of localCoords.values()) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Build ASCII grid
  const W = maxX - minX + 1;
  const H = maxY - minY + 1;
  // cells are spaced by 1, but coordinates can be odd (collision-displaced)
  // Use a map for sparse rendering
  const grid = new Map<string, string>();

  for (const [vnum, { x, y }] of localCoords) {
    const gx = x - minX;
    const gy = y - minY;
    const label = String(vnum).slice(-2); // last 2 digits
    grid.set(`${gx},${gy}`, label);
  }

  // Draw edges as connectors between cells
  const connectors = new Map<string, string>();
  const drawnEdges = new Set<string>();
  for (const e of edgeRows) {
    if (e.is_portal) continue;
    if (e.to_vnum < VNUM_MIN || e.to_vnum > VNUM_MAX) continue;
    const edgeKey = [Math.min(e.from_vnum, e.to_vnum), Math.max(e.from_vnum, e.to_vnum), e.direction].join(",");
    if (drawnEdges.has(edgeKey)) continue;
    drawnEdges.add(edgeKey);

    const delta = DIR_DELTA[e.direction];
    if (!delta) continue;
    const fc = localCoords.get(e.from_vnum);
    const tc = localCoords.get(e.to_vnum);
    if (!fc || !tc) continue;

    const fx = fc.x - minX;
    const fy = fc.y - minY;
    const tx2 = tc.x - minX;
    const ty2 = tc.y - minY;

    // midpoint connector (only if cells are exactly 1 apart in one axis)
    const ddx = tx2 - fx;
    const ddy = ty2 - fy;
    if (Math.abs(ddx) === 1 && ddy === 0) {
      const mx = fx + (ddx > 0 ? 1 : 0);
      // connector between fx and tx at half-cell — just mark horizontal dash
      connectors.set(`${Math.min(fx, tx2) * 2 + 1},${fy * 2}`, "-");
    } else if (Math.abs(ddy) === 1 && ddx === 0) {
      connectors.set(`${fx * 2},${Math.min(fy, ty2) * 2 + 1}`, "|");
    }
  }

  // Render using 2x grid (rooms on even, connectors on odd positions)
  const RENDER_W = (W - 1) * 2 + 1;
  const RENDER_H = (H - 1) * 2 + 1;

  // Use sparse rendering
  const renderGrid: string[][] = Array.from({ length: RENDER_H }, () => Array(RENDER_W).fill("  "));

  for (const [key, label] of grid) {
    const [gx, gy] = key.split(",").map(Number);
    renderGrid[gy * 2][gx * 2] = label.padEnd(2);
  }
  for (const [key, sym] of connectors) {
    const [rx, ry] = key.split(",").map(Number);
    if (ry < RENDER_H && rx < RENDER_W) renderGrid[ry][rx] = sym + " ";
  }

  console.log(`\nASCII map (zone ${ZONE_ARG}, ${W}×${H} grid):\n`);
  console.log("   " + Array.from({ length: RENDER_W }, (_, i) => (i % 2 === 0 ? String(Math.floor(i/2) + Math.floor(minX)).slice(-1) : " ")).join(""));
  for (let row = 0; row < RENDER_H; row++) {
    const yLabel = row % 2 === 0 ? String(Math.floor(row/2) + Math.floor(minY)).padStart(3) : "   ";
    console.log(yLabel + renderGrid[row].join(""));
  }

  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
