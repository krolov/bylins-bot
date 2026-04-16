// ---------------------------------------------------------------------------
// Thin wrappers for triggering the MUD's container / inventory inspection
// and waiting for the containerTracker to deliver the parsed result.
// ---------------------------------------------------------------------------

import type { Session } from "../mud-connection.ts";
import type { BunServerWebSocket } from "./constants.ts";

export interface ContainerInspectorDeps {
  session: Session;
  writeAndLogMudCommand(
    ws: BunServerWebSocket | null,
    socket: NonNullable<Session["tcpSocket"]>,
    command: string,
    origin: string,
  ): void;
  waitForInspectResult(timeoutMs: number): Promise<string>;
}

export function createContainerInspector(deps: ContainerInspectorDeps) {
  return {
    async inspectContainer(ws: BunServerWebSocket | null, container: string): Promise<string> {
      if (!deps.session.tcpSocket || !deps.session.connected) return "";
      const result = deps.waitForInspectResult(2000);
      deps.writeAndLogMudCommand(ws, deps.session.tcpSocket, `осм ${container}`, "inspect-container");
      return result;
    },

    async inspectInventory(ws: BunServerWebSocket | null): Promise<string> {
      if (!deps.session.tcpSocket || !deps.session.connected) return "";
      const result = deps.waitForInspectResult(2000);
      deps.writeAndLogMudCommand(ws, deps.session.tcpSocket, "инв", "inspect-inventory");
      return result;
    },
  };
}
