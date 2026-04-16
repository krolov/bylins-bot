// ---------------------------------------------------------------------------
// WebSocket broadcast helpers.
//
// Owns two pieces of shared state:
//   - browserClients      — the set of every connected browser socket
//   - recentOutputChunks  — ring buffer of recent MUD output lines, replayed
//                           to new clients on connect so they do not arrive
//                           to a blank terminal.
// ---------------------------------------------------------------------------

import type { BunServerWebSocket } from "./constants.ts";
import { MAX_OUTPUT_CHUNKS } from "./constants.ts";
import type { ServerEvent } from "../events.type.ts";

/** Serialize a ServerEvent and send it to a single WebSocket client. */
export function sendServerEvent(ws: BunServerWebSocket, event: ServerEvent): void {
  ws.send(JSON.stringify(event));
}

export interface Broadcaster {
  readonly browserClients: Set<BunServerWebSocket>;
  readonly recentOutputChunks: string[];
  sendServerEvent(ws: BunServerWebSocket, event: ServerEvent): void;
  broadcastServerEvent(event: ServerEvent): void;
  rememberOutput(text: string): void;
}

/**
 * Create the shared broadcaster instance. The returned object owns the
 * connected-clients set and the recent-output ring buffer; callers wire
 * new sockets in and out via `browserClients.add(ws)` / `.delete(ws)`.
 */
export function createBroadcaster(): Broadcaster {
  const browserClients = new Set<BunServerWebSocket>();
  const recentOutputChunks: string[] = [];

  function broadcastServerEvent(event: ServerEvent): void {
    for (const client of browserClients) {
      sendServerEvent(client, event);
    }
  }

  function rememberOutput(text: string): void {
    if (text.length === 0) return;
    recentOutputChunks.push(text);
    if (recentOutputChunks.length > MAX_OUTPUT_CHUNKS) {
      recentOutputChunks.splice(0, recentOutputChunks.length - MAX_OUTPUT_CHUNKS);
    }
  }

  return {
    browserClients,
    recentOutputChunks,
    sendServerEvent,
    broadcastServerEvent,
    rememberOutput,
  };
}
