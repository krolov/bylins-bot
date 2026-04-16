// ---------------------------------------------------------------------------
// Room-auto-commands subscription — when the tracker detects the player
// entered a new vnum, check if there is an auto-command configured for that
// room and dispatch each line via sendCommand. Mostly used for auto-hide,
// auto-heal, or other room-specific canned actions.
//
// Extracted from server.ts so the wiring reads as one named call instead
// of an inline roomChangedListeners.add(...) block.
// ---------------------------------------------------------------------------
import type { RoomChangedListener } from "./listeners.ts";

export interface RoomAutoCommandsDeps {
  roomChangedListeners: Set<RoomChangedListener>;
  /** Returns the newline-separated command script for a room, if any. */
  getRoomAutoCommand: (vnum: number) => Promise<string | null>;
  /**
   * Dispatches one MUD command. Usually created via
   * `sendMudCommand("room-auto-cmd")` so lines are tagged consistently.
   */
  sendCommand: (command: string) => void;
}

export function subscribeRoomAutoCommands(deps: RoomAutoCommandsDeps): void {
  deps.roomChangedListeners.add((vnum) => {
    void deps.getRoomAutoCommand(vnum).then((command) => {
      if (!command) return;
      for (const line of command.split("\n").map((l) => l.trim()).filter(Boolean)) {
        deps.sendCommand(line);
      }
    });
  });
}
