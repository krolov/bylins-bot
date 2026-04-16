// ---------------------------------------------------------------------------
// Structured file-backed logging + session-status broadcasting.
//
// Three responsibilities live here:
//   1. Pure helpers (sanitizeLogText, appendLogLine, appendDebugLog) that
//      append a line to the traffic log or debug log on disk.
//   2. createLogEvent(): factory for the `logEvent(ws, direction, message,
//      details)` function used throughout the server. Needs the current
//      debug-log toggle state via deps.
//   3. createStatusUpdater(): factory for `updateSessionStatus(state,
//      message)` which mutates the shared Session object AND broadcasts a
//      `status` ServerEvent to every browser.
// ---------------------------------------------------------------------------

import { appendFileSync } from "node:fs";

import type { BunServerWebSocket } from "./constants.ts";
import { LOG_FILE, DEBUG_LOG_FILE } from "./constants.ts";
import type { Session } from "../mud-connection.ts";
import type { ServerEvent } from "../events.type.ts";

export type LogDirection = "session" | "mud-in" | "mud-out" | "browser-in" | "browser-out" | "error";

export function sanitizeLogText(text: string): string {
  return text.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}

export function appendLogLine(line: string): void {
  appendFileSync(LOG_FILE, `${line}\n`, "utf8");
}

export function appendDebugLog(line: string): void {
  appendFileSync(DEBUG_LOG_FILE, `${line}\n`, "utf8");
}

export interface LogEventDeps {
  /** Current value of the runtime debug-log toggle. */
  getDebugLogEnabled(): boolean;
}

export type LogEventFn = (
  ws: BunServerWebSocket | null,
  direction: LogDirection,
  message: string,
  details?: Record<string, string | number | boolean | null | undefined>,
) => void;

export function createLogEvent(deps: LogEventDeps): LogEventFn {
  return function logEvent(ws, direction, message, details) {
    const timestamp = new Date().toISOString();
    const sessionId = ws?.data.sessionId ?? "system";
    const suffix = details
      ? Object.entries(details)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join(" ")
      : "";

    appendLogLine(`[${timestamp}] session=${sessionId} direction=${direction} message=${JSON.stringify(message)}${suffix ? ` ${suffix}` : ""}`);

    if (deps.getDebugLogEnabled() && (direction === "mud-in" || direction === "mud-out")) {
      appendDebugLog(`[${timestamp}] direction=${direction} message=${JSON.stringify(message)}${suffix ? ` ${suffix}` : ""}`);
    }
  };
}

export interface StatusUpdaterDeps {
  session: Session;
  broadcastServerEvent(event: ServerEvent): void;
}

export type UpdateSessionStatusFn = (state: Session["state"], message: string) => void;

export function createStatusUpdater(deps: StatusUpdaterDeps): UpdateSessionStatusFn {
  return function updateSessionStatus(state, message) {
    deps.session.state = state;
    deps.session.statusMessage = message;
    deps.broadcastServerEvent({
      type: "status",
      payload: { state, message },
    });
  };
}
