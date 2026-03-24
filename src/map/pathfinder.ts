import type { Direction, MapSnapshot } from "./types";

export interface PathStep {
  direction: Direction;
  expectedVnum: number;
}

export function findPath(snapshot: MapSnapshot, fromVnum: number, toVnum: number): PathStep[] | null {
  if (fromVnum === toVnum) {
    return [];
  }

  const adjacency = new Map<number, Array<{ toVnum: number; direction: Direction }>>();

  const addEdge = (from: number, to: number, dir: Direction) => {
    const list = adjacency.get(from) ?? [];
    list.push({ toVnum: to, direction: dir });
    adjacency.set(from, list);
  };

  const nodeSet = new Set(snapshot.nodes.map((n) => n.vnum));

  for (const edge of snapshot.edges) {
    if (!nodeSet.has(edge.fromVnum) || !nodeSet.has(edge.toVnum)) continue;
    addEdge(edge.fromVnum, edge.toVnum, edge.direction);
  }

  const visited = new Set<number>([fromVnum]);
  const queue: Array<{ vnum: number; path: PathStep[] }> = [{ vnum: fromVnum, path: [] }];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const neighbor of adjacency.get(current.vnum) ?? []) {
      if (visited.has(neighbor.toVnum)) continue;

      const newPath = [...current.path, { direction: neighbor.direction, expectedVnum: neighbor.toVnum }];

      if (neighbor.toVnum === toVnum) {
        return newPath;
      }

      visited.add(neighbor.toVnum);
      queue.push({ vnum: neighbor.toVnum, path: newPath });
    }
  }

  return null;
}
