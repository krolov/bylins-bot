import type { Direction } from "./types.ts";

const MOVE_TIMEOUT_MS = 5_000;

const DIRECTION_TO_COMMAND: Record<Direction, string> = {
  north: "с",
  south: "ю",
  east: "в",
  west: "з",
  up: "вв",
  down: "вн",
};

export type MoveResult = "ok" | "blocked" | "timeout";

interface PendingMovePromise {
  direction: Direction;
  fromRoomId: number | null;
  resolve: (result: MoveResult) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

interface MoverDependencies {
  sendCommand(command: string): void;
  onLog(message: string): void;
}

export interface MoverTrackerFeedback {
  currentVnum: number | null;
  previousVnum: number | null;
  movementBlocked: boolean;
}

export function createMover(deps: MoverDependencies) {
  let pending: PendingMovePromise | null = null;

  function onTrackerResult(feedback: MoverTrackerFeedback): void {
    if (!pending) {
      return;
    }

    const { currentVnum, previousVnum, movementBlocked } = feedback;

    if (movementBlocked) {
      const { resolve, timeoutHandle } = pending;
      clearTimeout(timeoutHandle);
      pending = null;
      resolve("blocked");
      return;
    }

    if (currentVnum !== null && currentVnum !== previousVnum) {
      const { resolve, timeoutHandle } = pending;
      clearTimeout(timeoutHandle);
      pending = null;
      resolve("ok");
      return;
    }
  }

  function move(direction: Direction, fromRoomId: number | null): Promise<MoveResult> {
    // Cancel any previous pending move (should not normally happen)
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      pending.resolve("timeout");
      pending = null;
    }

    return new Promise<MoveResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (pending?.resolve === resolve) {
          pending = null;
          deps.onLog(`[mover] Таймаут ожидания результата движения (${direction}).`);
          resolve("timeout");
        }
      }, MOVE_TIMEOUT_MS);

      pending = { direction, fromRoomId, resolve, timeoutHandle };
      deps.sendCommand(DIRECTION_TO_COMMAND[direction]);
    });
  }

  return { move, onTrackerResult };
}
