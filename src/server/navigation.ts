// ---------------------------------------------------------------------------
// Navigation controller — step-by-step pathfinding execution.
//
// Owns:
//   - navigationState: active flag, target vnum, planned path, step cursor,
//                      AbortController for cancellation.
//
// Flow: startNavigation() picks a path via findPath, then walks it one
// direction at a time, using onceRoomChanged (from the listener hub) to
// await each step's arrival. If the player ends up in an unexpected room
// or times out, navigation stops with a status message.
//
// startNavigationToNearest() picks the closest vnum from a candidate list
// and delegates to startNavigation().
// ---------------------------------------------------------------------------

import { findPath } from "../map/pathfinder.ts";
import type { PathStep } from "../map/pathfinder.ts";
import type { Direction, MapSnapshot } from "../map/types.ts";
import type { Session } from "../mud-connection.ts";
import type { ServerEvent } from "../events.type.ts";
import type { BunServerWebSocket } from "./constants.ts";
import { NAVIGATION_STEP_TIMEOUT_MS } from "./constants.ts";

const DIRECTION_TO_COMMAND: Record<Direction, string> = {
  north: "с",
  south: "ю",
  east: "в",
  west: "з",
  up: "вв",
  down: "вн",
};

export interface NavigationState {
  active: boolean;
  targetVnum: number | null;
  steps: PathStep[];
  currentStep: number;
  abortController: AbortController | null;
}

export interface NavigationSnapshot {
  active: boolean;
  targetVnum: number | null;
  totalSteps: number;
  currentStep: number;
}

export interface NavigationControllerDeps {
  mapStore: { getSnapshot(currentVnum: number | null): Promise<MapSnapshot> };
  broadcastServerEvent(event: ServerEvent): void;
  getCurrentRoomId(): number | null;
  session: Session;
  writeAndLogMudCommand(
    ws: BunServerWebSocket | null,
    socket: NonNullable<Session["tcpSocket"]>,
    command: string,
    origin: string,
  ): void;
  onceRoomChanged(timeoutMs: number): Promise<number | null>;
}

export interface NavigationController {
  state: NavigationState;
  getSnapshot(): NavigationSnapshot;
  isActive(): boolean;
  broadcastNavigationState(): void;
  stopNavigation(): void;
  startNavigation(ws: BunServerWebSocket | null, targetVnum: number): Promise<void>;
  startNavigationToNearest(ws: BunServerWebSocket | null, targetVnums: number[]): Promise<void>;
}

export function createNavigationController(deps: NavigationControllerDeps): NavigationController {
  const state: NavigationState = {
    active: false,
    targetVnum: null,
    steps: [],
    currentStep: 0,
    abortController: null,
  };

  function getSnapshot(): NavigationSnapshot {
    return {
      active: state.active,
      targetVnum: state.targetVnum,
      totalSteps: state.steps.length,
      currentStep: state.currentStep,
    };
  }

  function broadcastNavigationState(): void {
    deps.broadcastServerEvent({ type: "navigation_state", payload: getSnapshot() });
  }

  function stopNavigation(): void {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
    state.active = false;
    state.targetVnum = null;
    state.steps = [];
    state.currentStep = 0;
    broadcastNavigationState();
  }

  async function startNavigation(ws: BunServerWebSocket | null, targetVnum: number): Promise<void> {
    stopNavigation();

    const currentVnum = deps.getCurrentRoomId();
    if (currentVnum === null) {
      deps.broadcastServerEvent({
        type: "status",
        payload: { state: deps.session.state, message: "Навигация: текущая комната неизвестна." },
      });
      return;
    }

    const snapshot = await deps.mapStore.getSnapshot(currentVnum);
    const path = findPath(snapshot, currentVnum, targetVnum);

    if (!path || path.length === 0) {
      deps.broadcastServerEvent({
        type: "status",
        payload: { state: deps.session.state, message: "Навигация: путь не найден." },
      });
      return;
    }

    const abort = new AbortController();
    state.active = true;
    state.targetVnum = targetVnum;
    state.steps = path;
    state.currentStep = 0;
    state.abortController = abort;
    broadcastNavigationState();

    for (let i = 0; i < path.length; i++) {
      if (abort.signal.aborted) return;

      const step = path[i]!;
      state.currentStep = i;
      broadcastNavigationState();

      if (!deps.session.tcpSocket || !deps.session.connected) {
        stopNavigation();
        return;
      }

      deps.writeAndLogMudCommand(ws, deps.session.tcpSocket, DIRECTION_TO_COMMAND[step.direction], "navigation");

      const arrived = await deps.onceRoomChanged(NAVIGATION_STEP_TIMEOUT_MS);

      if (abort.signal.aborted) return;

      if (arrived === null) {
        stopNavigation();
        deps.broadcastServerEvent({
          type: "status",
          payload: { state: deps.session.state, message: "Навигация: нет ответа от сервера, остановлено." },
        });
        return;
      }

      if (arrived !== step.expectedVnum) {
        stopNavigation();
        deps.broadcastServerEvent({
          type: "status",
          payload: {
            state: deps.session.state,
            message: `Навигация: ожидалась комната ${step.expectedVnum}, оказались в ${arrived}. Остановлено.`,
          },
        });
        return;
      }
    }

    if (!abort.signal.aborted) {
      state.currentStep = path.length;
      broadcastNavigationState();
      deps.broadcastServerEvent({
        type: "status",
        payload: { state: deps.session.state, message: "Навигация: цель достигнута." },
      });
      state.active = false;
      state.abortController = null;
      broadcastNavigationState();
    }
  }

  async function startNavigationToNearest(ws: BunServerWebSocket | null, targetVnums: number[]): Promise<void> {
    const currentVnum = deps.getCurrentRoomId();
    if (currentVnum === null) {
      deps.broadcastServerEvent({
        type: "status",
        payload: { state: deps.session.state, message: "Навигация: текущая комната неизвестна." },
      });
      return;
    }
    if (targetVnums.includes(currentVnum)) {
      deps.broadcastServerEvent({
        type: "status",
        payload: { state: deps.session.state, message: "Навигация: уже в целевой комнате." },
      });
      return;
    }
    const snapshot = await deps.mapStore.getSnapshot(currentVnum);
    let bestVnum: number | null = null;
    let bestLen = Infinity;
    for (const vnum of targetVnums) {
      const path = findPath(snapshot, currentVnum, vnum);
      if (path !== null && path.length < bestLen) {
        bestLen = path.length;
        bestVnum = vnum;
      }
    }
    if (bestVnum === null) {
      deps.broadcastServerEvent({
        type: "status",
        payload: { state: deps.session.state, message: "Навигация: путь не найден." },
      });
      return;
    }
    await startNavigation(ws, bestVnum);
  }

  return {
    state,
    getSnapshot,
    isActive: () => state.active,
    broadcastNavigationState,
    stopNavigation,
    startNavigation,
    startNavigationToNearest,
  };
}
