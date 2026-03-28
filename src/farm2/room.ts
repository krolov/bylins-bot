import { ANSI_SEQUENCE_REGEXP, TARGET_PREFIX_REGEXP } from "./types.ts";
import type { Farm2Config } from "./types.ts";

export function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE_REGEXP, "");
}

export function getZoneId(vnum: number): number {
  return Math.floor(vnum / 100);
}

export function extractTargetName(line: string, targetValues: Farm2Config["targetValues"]): string | null {
  const cleaned = line.replace(TARGET_PREFIX_REGEXP, "").trim().toLowerCase();

  for (const value of targetValues) {
    if (cleaned.includes(value)) {
      return value;
    }
  }

  return null;
}

export function parseMobsFromRoomDescription(
  lines: string[],
  targetValues: Farm2Config["targetValues"],
  onLog: (message: string) => void,
): Map<string, string> {
  const result = new Map<string, string>();

  for (const line of lines) {
    const stripped = stripAnsi(line).trim();
    const target = extractTargetName(stripped, targetValues);
    if (target !== null) {
      result.set(stripped.toLowerCase(), stripped);
      onLog(`[farm2/room] обнаружена цель: "${stripped}" (ключ: "${target}")`);
    }
  }

  return result;
}
