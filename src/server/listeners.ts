// ---------------------------------------------------------------------------
// Listener hub: registries for async subscribers that live across the whole
// server process (not per WS connection).
//
// Four sets are owned here:
//   - mudTextHandlers        raw MUD text feed listeners (used by zone
//                            scripts and one-shot waits)
//   - roomChangedListeners   called when tracker detects a new current vnum
//   - roomRefreshListeners   called when the parser re-processes the current
//                            room description (vnum may be unchanged)
//   - sessionTeardownHooks   run once when the MUD session closes
//
// Two promise helpers are exposed: `onceMudText` waits for a regex match in
// the text feed (or rejects on timeout), and `onceRoomChanged` waits for the
// next room-change event (resolves with `null` on timeout).
// ---------------------------------------------------------------------------

export type MudTextHandler = (text: string) => void;
export type RoomChangedListener = (vnum: number) => void;
export type RoomRefreshListener = (vnum: number | null) => void;
export type SessionTeardownHook = () => void;

export interface ListenerHub {
  readonly mudTextHandlers: Set<MudTextHandler>;
  readonly roomChangedListeners: Set<RoomChangedListener>;
  readonly roomRefreshListeners: Set<RoomRefreshListener>;
  readonly sessionTeardownHooks: Set<SessionTeardownHook>;
  onceMudText(pattern: RegExp, timeoutMs: number): Promise<void>;
  onceRoomChanged(timeoutMs: number): Promise<number | null>;
}

export function createListenerHub(): ListenerHub {
  const mudTextHandlers = new Set<MudTextHandler>();
  const roomChangedListeners = new Set<RoomChangedListener>();
  const roomRefreshListeners = new Set<RoomRefreshListener>();
  const sessionTeardownHooks = new Set<SessionTeardownHook>();

  function onceMudText(pattern: RegExp, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        mudTextHandlers.delete(handler);
        reject(new Error(`wait_text timeout: ${pattern.source}`));
      }, timeoutMs);
      const handler: MudTextHandler = (text) => {
        if (done) return;
        if (pattern.test(text)) {
          done = true;
          clearTimeout(timer);
          mudTextHandlers.delete(handler);
          resolve();
        }
      };
      mudTextHandlers.add(handler);
    });
  }

  function onceRoomChanged(timeoutMs: number): Promise<number | null> {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        roomChangedListeners.delete(listener);
        resolve(null);
      }, timeoutMs);
      const listener: RoomChangedListener = (vnum) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        roomChangedListeners.delete(listener);
        resolve(vnum);
      };
      roomChangedListeners.add(listener);
    });
  }

  return {
    mudTextHandlers,
    roomChangedListeners,
    roomRefreshListeners,
    sessionTeardownHooks,
    onceMudText,
    onceRoomChanged,
  };
}
