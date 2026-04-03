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

export type StealthMoveResult =
  | { kind: "ok"; roomId: number; mobs: string[] }
  | { kind: "blocked" }
  | { kind: "timeout" };

interface PendingMoveBase {
  direction: Direction;
  fromRoomId: number | null;
  timeoutHandle: ReturnType<typeof setTimeout>;
  landedRoomId: number | null;
}

interface PendingBasicMove extends PendingMoveBase {
  kind: "basic";
  resolve: (result: MoveResult) => void;
}

interface PendingStealthMove extends PendingMoveBase {
  kind: "stealth";
  resolve: (result: StealthMoveResult) => void;
}

type PendingMovePromise = PendingBasicMove | PendingStealthMove;

interface MoverDependencies {
  sendCommand(command: string): void;
  onLog(message: string): void;
}

export interface MoverTrackerFeedback {
  currentVnum: number | null;
  previousVnum: number | null;
  movementBlocked: boolean;
  roomDescriptionReceived: boolean;
  visibleMobNames: string[];
}

export function createMover(deps: MoverDependencies) {
  let pending: PendingMovePromise | null = null;

  function clearPendingTimeout(timeoutHandle: ReturnType<typeof setTimeout>): void {
    clearTimeout(timeoutHandle);
  }

  function resolveTimeout(): void {
    if (!pending) {
      return;
    }
    const current = pending;
    clearPendingTimeout(current.timeoutHandle);
    pending = null;
    if (current.kind === "basic") {
      deps.onLog(`[mover] Таймаут ожидания результата движения (${current.direction}).`);
      current.resolve("timeout");
      return;
    }
    deps.onLog(`[mover] Timeout waiting for stealth movement result (${current.direction}).`);
    current.resolve({ kind: "timeout" });
  }

  function resolveBlocked(): void {
    if (!pending) {
      return;
    }
    const current = pending;
    clearPendingTimeout(current.timeoutHandle);
    pending = null;
    if (current.kind === "basic") {
      current.resolve("blocked");
      return;
    }
    current.resolve({ kind: "blocked" });
  }

  function onTrackerResult(feedback: MoverTrackerFeedback): void {
    if (!pending) {
      return;
    }

    const { currentVnum, previousVnum, movementBlocked } = feedback;

    if (movementBlocked) {
      resolveBlocked();
      return;
    }

    if (pending.kind === "basic") {
      if (currentVnum !== null && currentVnum !== previousVnum) {
        const current = pending;
        clearPendingTimeout(current.timeoutHandle);
        pending = null;
        current.resolve("ok");
      }
      return;
    }

    if (currentVnum !== null && currentVnum !== pending.fromRoomId) {
      pending.landedRoomId = currentVnum;
    }

    if (!feedback.roomDescriptionReceived || pending.landedRoomId === null) {
      return;
    }

    if (currentVnum !== pending.landedRoomId) {
      return;
    }

    const current = pending;
    clearPendingTimeout(current.timeoutHandle);
    pending = null;
    deps.onLog(
      `[mover] stealthMove resolved roomId=${current.landedRoomId ?? currentVnum} mobs=[${feedback.visibleMobNames.join(" | ")}]`,
    );
    current.resolve({
      kind: "ok",
      roomId: current.landedRoomId ?? currentVnum,
      mobs: [...feedback.visibleMobNames],
    });
  }

  function move(direction: Direction, fromRoomId: number | null): Promise<MoveResult> {
    if (pending) {
      resolveTimeout();
    }

    return new Promise<MoveResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (pending?.kind === "basic" && pending.resolve === resolve) {
          resolveTimeout();
        }
      }, MOVE_TIMEOUT_MS);

      pending = { kind: "basic", direction, fromRoomId, resolve, timeoutHandle, landedRoomId: null };
      deps.sendCommand(DIRECTION_TO_COMMAND[direction]);
    });
  }

  function stealthMove(direction: Direction, fromRoomId: number | null): Promise<StealthMoveResult> {
    if (pending) {
      resolveTimeout();
    }

    deps.onLog(`[mover] stealthMove start direction=${direction} fromRoomId=${fromRoomId}`);

    return new Promise<StealthMoveResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (pending?.kind === "stealth" && pending.resolve === resolve) {
          resolveTimeout();
        }
      }, MOVE_TIMEOUT_MS);

      pending = { kind: "stealth", direction, fromRoomId, resolve, timeoutHandle, landedRoomId: null };
      deps.sendCommand(`краст ${DIRECTION_TO_COMMAND[direction]}`);
    });
  }

  return { move, stealthMove, onTrackerResult };
}
