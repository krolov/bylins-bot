// ---------------------------------------------------------------------------
// Browser-sent command handling.
//
// `normalizeTextMessage` converts an incoming WebSocket payload (string or
// binary) to a plain string. `createSendCommandHandler` builds the
// `handleSendCommand(ws, command)` function with two shortcuts baked in:
//   - "#go <dir>"  → "беж <dir>" while in combat, otherwise "краст <dir>"
//   - "дсу"        → posts a guild chat line with the character's razb,
//                    level, and DSU formatted in ru-RU
// Any other command is forwarded verbatim to the MUD.
// ---------------------------------------------------------------------------

import type { CombatState } from "../combat-state.ts";
import type { Session } from "../mud-connection.ts";
import type { ServerEvent } from "../events.type.ts";
import type { BunServerWebSocket } from "./constants.ts";

export function normalizeTextMessage(message: string | ArrayBuffer | Uint8Array): string {
  if (typeof message === "string") return message;
  return new TextDecoder().decode(message);
}

export interface SendCommandHandlerDeps {
  session: Session;
  combatState: CombatState;
  writeAndLogMudCommand(
    ws: BunServerWebSocket | null,
    socket: NonNullable<Session["tcpSocket"]>,
    command: string,
    origin: string,
  ): void;
  sendServerEvent(ws: BunServerWebSocket, event: ServerEvent): void;
  getStats(): { dsu: number; level: number; razb: number };
}

export function createSendCommandHandler(deps: SendCommandHandlerDeps) {
  return function handleSendCommand(ws: BunServerWebSocket, command: string | undefined): void {
    const session = deps.session;

    if (!session?.tcpSocket || !session.connected) {
      deps.sendServerEvent(ws, {
        type: "error",
        payload: { message: "You are not connected to a MUD yet." },
      });
      return;
    }

    const trimmedCommand = command?.trim();
    if (!trimmedCommand) return;

    if (trimmedCommand.startsWith("#go ")) {
      const dir = trimmedCommand.slice(4).trim();
      const mudCmd = deps.combatState.getInCombat() ? `беж ${dir}` : `краст ${dir}`;
      deps.writeAndLogMudCommand(ws, session.tcpSocket, mudCmd, "browser");
      return;
    }

    if (trimmedCommand.toLowerCase() === "дсу") {
      const s = deps.getStats();
      const dsuFormatted = s.dsu.toLocaleString("ru-RU");
      deps.writeAndLogMudCommand(
        ws,
        session.tcpSocket,
        `гг [ Разбег: ${s.razb} -+- Уровень: ${s.level} -+- ДСУ: ${dsuFormatted} ]`,
        "browser",
      );
      return;
    }

    deps.writeAndLogMudCommand(ws, session.tcpSocket, trimmedCommand, "browser");
  };
}
