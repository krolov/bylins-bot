import type { Farm2ControllerDependencies } from "./types.ts";

export interface Farm2Logger {
  info(message: string): void;
  debug(message: string): void;
}

export function createLogger(deps: Pick<Farm2ControllerDependencies, "onLog" | "onDebugLog">): Farm2Logger {
  return {
    info(message: string): void {
      deps.onLog(`[farm2] ${message}`);
    },
    debug(message: string): void {
      deps.onDebugLog(`[farm2] ${message}`);
    },
  };
}
