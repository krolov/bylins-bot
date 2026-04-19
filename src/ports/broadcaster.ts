import type { ServerEvent } from "../events.type.ts";

// Port for fan-out of ServerEvents to all connected browser WebSocket clients.
// The default implementation iterates the server.ts `browserClients` Set.

export interface Broadcaster {
  broadcast(event: ServerEvent): void;
}
