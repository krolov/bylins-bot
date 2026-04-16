import { OPPOSITE_DIRECTION } from "./types.ts";
import type { Direction, MapSnapshot } from "./types.ts";

export function pickVisibleTarget(visibleTargets: Map<string, string>, targetValues: string[]): string | null {
  if (targetValues.length === 0) {
    return null;
  }

  for (const target of visibleTargets.values()) {
    const normalizedTarget = target.toLowerCase();

    for (const value of targetValues) {
      if (normalizedTarget.includes(value)) {
        return value;
      }
    }
  }

  return null;
}

export function chooseNextDirection(
  snapshot: MapSnapshot,
  currentRoomId: number,
  roomVnums: number[],
  roomVisitOrder: Map<number, number>,
  lastMoveFromRoomId: number | null,
): Direction | null {
  const vnumSet = new Set(roomVnums);
  const zoneNodes = snapshot.nodes.filter((node) => vnumSet.has(node.vnum));
  const nodeByVnum = new Map(zoneNodes.map((node) => [node.vnum, node]));

  if (!nodeByVnum.has(currentRoomId)) {
    return null;
  }

  const adjacency = new Map<number, Array<{ toVnum: number; direction: Direction }>>();
  const seenEdges = new Set<string>();

  const pushEdge = (fromVnum: number, toVnum: number, direction: Direction) => {
    const key = `${fromVnum}:${toVnum}:${direction}`;

    if (seenEdges.has(key)) {
      return;
    }

    seenEdges.add(key);

    const existing = adjacency.get(fromVnum) ?? [];
    existing.push({ toVnum, direction });
    adjacency.set(fromVnum, existing);
  };

  for (const edge of snapshot.edges) {
    if (edge.isPortal || !vnumSet.has(edge.fromVnum) || !vnumSet.has(edge.toVnum)) {
      continue;
    }

    if (!nodeByVnum.has(edge.fromVnum) || !nodeByVnum.has(edge.toVnum)) {
      continue;
    }

    pushEdge(edge.fromVnum, edge.toVnum, edge.direction);

    const reverseDirection = OPPOSITE_DIRECTION[edge.direction];
    const destinationNode = nodeByVnum.get(edge.toVnum);

    if (destinationNode?.exits.includes(reverseDirection)) {
      pushEdge(edge.toVnum, edge.fromVnum, reverseDirection);
    }
  }

  const choices = adjacency.get(currentRoomId) ?? [];

  if (choices.length === 0) {
    return null;
  }

  choices.sort((left, right) => {
    const leftVisit = roomVisitOrder.get(left.toVnum) ?? Number.NEGATIVE_INFINITY;
    const rightVisit = roomVisitOrder.get(right.toVnum) ?? Number.NEGATIVE_INFINITY;
    const leftReturnsToPrevious = left.toVnum === lastMoveFromRoomId;
    const rightReturnsToPrevious = right.toVnum === lastMoveFromRoomId;

    if (leftReturnsToPrevious !== rightReturnsToPrevious) {
      return leftReturnsToPrevious ? 1 : -1;
    }

    if (leftVisit !== rightVisit) {
      return leftVisit - rightVisit;
    }

    return left.direction.localeCompare(right.direction);
  });

  return choices[0]?.direction ?? null;
}
