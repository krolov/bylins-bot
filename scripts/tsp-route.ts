/**
 * tsp-route.ts — Nearest-neighbour TSP solver for MUD zone rooms.
 *
 * Builds a graph from map_edges, then finds a route that visits all requested
 * vnums at least once using a nearest-neighbour heuristic. When direct edges
 * don't exist between nodes, BFS finds the shortest connecting path and
 * inserts intermediate rooms (so the array represents every step the bot
 * must actually take, including duplicates).
 *
 * Usage:
 *   bun scripts/tsp-route.ts --vnums 28000-28057 --exclude 28033
 *   bun scripts/tsp-route.ts --vnums 28000,28001,28005,28010
 *   bun scripts/tsp-route.ts --vnums 28000-28057 --exclude 28033 --start 28000
 *
 * Output: a TypeScript array literal ready to paste into routeVnums.
 */

import postgres from "postgres";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = Bun.argv.slice(2);

function getArg(name: string): string | null {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

const vnumsArg = getArg("vnums");
const excludeArg = getArg("exclude");
const startArg = getArg("start");

if (!vnumsArg) {
  console.error("Usage: bun scripts/tsp-route.ts --vnums <range|list> [--exclude <vnum,...>] [--start <vnum>]");
  console.error("  --vnums  28000-28057  or  28000,28001,28005");
  console.error("  --exclude  28033,28048");
  console.error("  --start  28000  (starting vnum, defaults to first in list)");
  process.exit(1);
}

function parseVnums(s: string): number[] {
  if (s.includes("-")) {
    const [lo, hi] = s.split("-").map(Number);
    const result: number[] = [];
    for (let i = lo; i <= hi; i++) result.push(i);
    return result;
  }
  return s.split(",").map(Number);
}

const excludeSet = new Set(excludeArg ? parseVnums(excludeArg) : []);
const requestedVnums = parseVnums(vnumsArg).filter((v) => !excludeSet.has(v));

if (requestedVnums.length === 0) {
  console.error("No vnums after exclusion.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

const DATABASE_URL =
  Bun.env.DATABASE_URL ?? "postgres://bylins:bylins@localhost:5432/bylins_bot";

const db = postgres(DATABASE_URL);

// ---------------------------------------------------------------------------
// Load graph from map_edges
// ---------------------------------------------------------------------------

type Graph = Map<number, Map<number, number>>; // vnum → (neighbour → cost=1)

async function loadGraph(vnums: number[]): Promise<Graph> {
  // Load all edges that touch any vnum in our set (both directions).
  const vnumSet = new Set(vnums);
  const rows = await db<{ from_vnum: number; to_vnum: number }[]>`
    SELECT from_vnum, to_vnum
    FROM map_edges
    WHERE from_vnum = ANY(${vnums}) OR to_vnum = ANY(${vnums})
  `;

  const graph: Graph = new Map();
  for (const v of vnums) graph.set(v, new Map());

  for (const { from_vnum, to_vnum } of rows) {
    // Only add edge if both endpoints are in our allowed set
    // (or at least from_vnum is — to_vnum may be outside zone and that's ok
    //  for pathfinding through corridors)
    if (!graph.has(from_vnum)) graph.set(from_vnum, new Map());
    if (!graph.has(to_vnum)) graph.set(to_vnum, new Map());
    graph.get(from_vnum)!.set(to_vnum, 1);
    // Assume bidirectional (MUD maps usually are)
    graph.get(to_vnum)!.set(from_vnum, 1);
  }

  return graph;
}

// ---------------------------------------------------------------------------
// BFS shortest path between two vnums
// ---------------------------------------------------------------------------

function bfsPath(graph: Graph, from: number, to: number): number[] | null {
  if (from === to) return [from];
  const prev = new Map<number, number>();
  const queue: number[] = [from];
  prev.set(from, -1);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of graph.get(cur)?.keys() ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, cur);
      if (next === to) {
        // Reconstruct
        const path: number[] = [];
        let node: number = to;
        while (node !== -1) {
          path.unshift(node);
          node = prev.get(node)!;
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

// BFS distance only (no path reconstruction, faster)
function bfsDist(graph: Graph, from: number, to: number): number {
  if (from === to) return 0;
  const dist = new Map<number, number>([[from, 0]]);
  const queue: number[] = [from];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    for (const next of graph.get(cur)?.keys() ?? []) {
      if (dist.has(next)) continue;
      dist.set(next, d + 1);
      if (next === to) return d + 1;
      queue.push(next);
    }
  }
  return Infinity;
}

// ---------------------------------------------------------------------------
// Nearest-neighbour TSP
// ---------------------------------------------------------------------------

function nearestNeighbourTSP(
  graph: Graph,
  targets: number[],
  startVnum: number,
): number[] {
  const unvisited = new Set(targets);
  const route: number[] = [startVnum];
  unvisited.delete(startVnum);

  let current = startVnum;

  while (unvisited.size > 0) {
    let bestDist = Infinity;
    let bestNext: number | null = null;

    for (const candidate of unvisited) {
      const d = bfsDist(graph, current, candidate);
      if (d < bestDist) {
        bestDist = d;
        bestNext = candidate;
      }
    }

    if (bestNext === null) {
      console.warn(`Cannot reach remaining ${unvisited.size} nodes from ${current}. Skipping.`);
      break;
    }

    // Insert full path (including intermediate rooms)
    const path = bfsPath(graph, current, bestNext);
    if (path) {
      // Skip first element (already in route as `current`)
      for (let i = 1; i < path.length; i++) route.push(path[i]);
    } else {
      console.warn(`No path from ${current} to ${bestNext}, skipping.`);
    }

    unvisited.delete(bestNext);
    current = bestNext;
  }

  return route;
}

// ---------------------------------------------------------------------------
// Format output as TS array
// ---------------------------------------------------------------------------

function formatAsTypescript(route: number[], lineWidth = 10): string {
  const lines: string[] = [];
  for (let i = 0; i < route.length; i += lineWidth) {
    lines.push("      " + route.slice(i, i + lineWidth).join(", ") + ",");
  }
  return "    routeVnums: [\n" + lines.join("\n") + "\n    ],";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.error(`Loading graph for ${requestedVnums.length} vnums...`);
  const graph = await loadGraph(requestedVnums);

  // Verify which requested vnums are actually reachable in the graph
  const reachableVnums = requestedVnums.filter((v) => graph.has(v) && (graph.get(v)?.size ?? 0) > 0);
  const unreachable = requestedVnums.filter((v) => !reachableVnums.includes(v));
  if (unreachable.length > 0) {
    console.error(`Warning: ${unreachable.length} vnums have no edges and will be skipped: ${unreachable.join(", ")}`);
  }
  console.error(`Graph has ${graph.size} nodes. Solving TSP for ${reachableVnums.length} targets...`);

  const startVnum = startArg ? Number(startArg) : reachableVnums[0];
  if (!reachableVnums.includes(startVnum)) {
    console.error(`Start vnum ${startVnum} is not in reachable set.`);
    process.exit(1);
  }

  const route = nearestNeighbourTSP(graph, reachableVnums, startVnum);

  console.error(`Route: ${route.length} steps covering ${reachableVnums.length} targets.`);
  console.error(`Unique vnums in route: ${new Set(route).size}`);
  console.log(formatAsTypescript(route));

  await db.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
