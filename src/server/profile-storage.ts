// ---------------------------------------------------------------------------
// Thin file-backed persistence for the last-selected MUD character profile.
// Reads and writes LAST_PROFILE_FILE so the server can remember which
// profile the user picked last time the bot was running.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from "node:fs";

import { runtimeConfig } from "../config.ts";
import { LAST_PROFILE_FILE } from "./constants.ts";

export function readLastProfileId(): string {
  try {
    return readFileSync(LAST_PROFILE_FILE, "utf8").trim();
  } catch {
    return runtimeConfig.defaultProfileId;
  }
}

export function saveLastProfileId(profileId: string): void {
  try {
    writeFileSync(LAST_PROFILE_FILE, profileId, "utf8");
  } catch {
    // Best-effort persistence; errors are swallowed intentionally so a
    // missing log directory does not crash the server.
  }
}
