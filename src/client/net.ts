import type { ClientEvent, ServerEvent } from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket lifecycle: createSocket + reconnect backoff + pending queue.
//
// The dispatcher (big switch over ServerEvent) lives in main.ts and is passed
// in as `onMessage`; net.ts stays agnostic of UI state. On connect we always
// send the same three warm-up commands (осм склад1, осм склад2, инв) so
// container panels have data right away.
// ─────────────────────────────────────────────────────────────────────────────

const RECONNECT_DELAY_MAX = 30000;

export interface NetDeps {
  onMessage: (event: ServerEvent) => void;
}

export interface Net {
  sendClientEvent(message: ClientEvent): void;
  ensureSocketOpen(): Promise<void>;
  enableReconnect(): void;
}

function getSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function createNet({ onMessage }: NetDeps): Net {
  let socket: WebSocket | null = null;
  let pendingOpenPromise: Promise<void> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = 1000;
  let reconnectEnabled = false;
  const pendingQueue: ClientEvent[] = [];

  function scheduleReconnect(): void {
    if (reconnectTimer !== null || !reconnectEnabled) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      socket = createSocket();
    }, reconnectDelay);

    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_DELAY_MAX);
  }

  function flushPendingQueue(): void {
    while (pendingQueue.length > 0 && socket?.readyState === WebSocket.OPEN) {
      const event = pendingQueue.shift()!;
      socket.send(JSON.stringify(event));
    }
  }

  function createSocket(): WebSocket {
    const nextSocket = new WebSocket(getSocketUrl());

    nextSocket.addEventListener("open", () => {
      reconnectDelay = 1000;
      flushPendingQueue();
      sendClientEvent({ type: "send", payload: { command: "осм склад1" } });
      sendClientEvent({ type: "send", payload: { command: "осм склад2" } });
      sendClientEvent({ type: "send", payload: { command: "инв" } });
    });

    nextSocket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as ServerEvent;
      onMessage(message);
    });

    nextSocket.addEventListener("close", () => {
      socket = null;
      pendingOpenPromise = null;
      scheduleReconnect();
    });

    nextSocket.addEventListener("error", () => {
      // errors are surfaced through close/message paths; nothing to do here.
    });

    return nextSocket;
  }

  function sendClientEvent(message: ClientEvent): void {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return;
    }

    pendingQueue.push(message);

    if (!socket || socket.readyState === WebSocket.CLOSED) {
      socket = createSocket();
    }
  }

  function ensureSocketOpen(): Promise<void> {
    if (socket && socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (!socket || socket.readyState === WebSocket.CLOSED) {
      socket = createSocket();
    }

    if (socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    if (!pendingOpenPromise) {
      pendingOpenPromise = new Promise<void>((resolve, reject) => {
        if (!socket) {
          reject(new Error("Socket was not created."));
          return;
        }

        const handleOpen = () => {
          cleanup();
          pendingOpenPromise = null;
          resolve();
        };

        const handleClose = () => {
          cleanup();
          pendingOpenPromise = null;
          reject(new Error("Socket closed before opening."));
        };

        const cleanup = () => {
          socket?.removeEventListener("open", handleOpen);
          socket?.removeEventListener("close", handleClose);
        };

        socket.addEventListener("open", handleOpen);
        socket.addEventListener("close", handleClose);
      });
    }

    return pendingOpenPromise;
  }

  function enableReconnect(): void {
    reconnectEnabled = true;
  }

  return { sendClientEvent, ensureSocketOpen, enableReconnect };
}
