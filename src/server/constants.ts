// ---------------------------------------------------------------------------
// Server-side constants: log file paths, output caps, shared regexes.
// ---------------------------------------------------------------------------

import type { WsData } from "../events.type.ts";

export type BunServerWebSocket = Bun.ServerWebSocket<WsData>;

export const LOG_DIR = "/var/log/bylins-bot";
export const LOG_FILE = `${LOG_DIR}/mud-traffic.log`;
export const DEBUG_LOG_FILE = `${LOG_DIR}/debug.log`;
export const LAST_PROFILE_FILE = `${LOG_DIR}/last-profile.txt`;

export const MAX_OUTPUT_CHUNKS = 200;
export const NAVIGATION_STEP_TIMEOUT_MS = 3000;

export const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*m/g;
