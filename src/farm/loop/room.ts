import { ANSI_SEQUENCE_REGEXP } from "./types.ts";

export function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE_REGEXP, "");
}

export function getZoneId(vnum: number): number {
  return Math.floor(vnum / 100);
}
