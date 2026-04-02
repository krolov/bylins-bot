// ---------------------------------------------------------------------------
// Zone Script — shared types
// ---------------------------------------------------------------------------

/**
 * A single step in a zone script. Each step is a discriminated union so the
 * executor can switch on `kind` and handle it appropriately.
 */
export type ScriptStep =
  | {
      /** Navigate to a specific room vnum via pathfinder. */
      kind: "navigate";
      label: string;
      targetVnum: number;
    }
  | {
      /** Send a raw MUD command (e.g. "открыть дверь", "двигать лавочку"). */
      kind: "command";
      label: string;
      command: string;
      /** Optional delay in ms to wait after sending before proceeding. Default 0. */
      delayAfterMs?: number;
    }
  | {
      /**
       * Wait until a line matching the given regexp appears in the MUD output.
       * Times out after `timeoutMs` (default 30 000 ms).
       */
      kind: "wait_text";
      label: string;
      pattern: RegExp;
      timeoutMs?: number;
    }
  | {
      /**
       * Send a command AND wait for the matching text response.
       * Equivalent to command + wait_text but more convenient for dialogue.
       */
      kind: "command_and_wait";
      label: string;
      command: string;
      pattern: RegExp;
      timeoutMs?: number;
    }
  | {
      /** Navigate to a vnum using a special movement command (e.g. "нырнуть в озеро"). */
      kind: "special_move";
      label: string;
      command: string;
      targetVnum: number;
      timeoutMs?: number;
    };

// ---------------------------------------------------------------------------
// Step status — what the UI displays per step
// ---------------------------------------------------------------------------

export type StepStatus = "pending" | "active" | "done" | "error" | "skipped";

export interface StepState {
  index: number;
  label: string;
  status: StepStatus;
  error?: string;
}

// ---------------------------------------------------------------------------
// Snapshot broadcast to browser
// ---------------------------------------------------------------------------

export interface ZoneScriptStateSnapshot {
  /** Whether the script runner is active. */
  enabled: boolean;
  /** Zone ID currently running (null when idle). */
  zoneId: number | null;
  /** Human-readable name of the current zone script. */
  zoneName: string | null;
  /** Current step index (null when idle or finished). */
  currentStepIndex: number | null;
  /** Full step list with statuses. Empty when idle. */
  steps: StepState[];
  /** Overall error message when the script aborted. */
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Dependencies injected via constructor
// ---------------------------------------------------------------------------

export interface ZoneScriptDeps {
  /** Current room vnum, or null if unknown. */
  getCurrentRoomId(): number | null;
  /** Whether the MUD connection is up. */
  isConnected(): boolean;
  /**
   * Navigate to a target vnum using the pathfinder.
   * Resolves when the player arrives, rejects on failure.
   */
  navigateTo(targetVnum: number): Promise<void>;
  /** Send a raw command to MUD. */
  sendCommand(command: string): void;
  /**
   * Register a one-shot MUD text listener.
   * The callback is called once when a line matching the pattern appears.
   * Returns a cleanup function that cancels the listener.
   */
  onMudTextOnce(pattern: RegExp, timeoutMs: number): Promise<void>;
  /** Called whenever script state changes — broadcast to browser. */
  onStateChange(state: ZoneScriptStateSnapshot): void;
  /** Logging (English only). */
  onLog(message: string): void;
}
