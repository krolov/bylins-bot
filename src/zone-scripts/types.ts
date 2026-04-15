// ---------------------------------------------------------------------------
// Zone Script — shared types
// ---------------------------------------------------------------------------

import type { Direction, MapSnapshot } from "../map/types.ts";
import type { MobResolverDeps } from "../mob-resolver.ts";
import type { CombatState } from "../combat-state.ts";
import type { MoveResult, StealthMoveResult } from "../map/mover.ts";

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
    }
  | {
      /**
       * Farm (sweep) a zone: navigate to entryVnum, roam all rooms, attack mobs
       * from targetValues. Completes when no combat has occurred for idleTimeoutMs.
       *
       * combatMode controls how movement and attacks work:
       *   - "normal" (default): move via plain direction commands, attack via "заколоть".
       *   - "stealth": move via "краст <dir>", attack via "закол", flee via retreatCommands
       *     on combat start, then return to the combat room once safe.
       */
      kind: "farm_zone";
      label: string;
      entryVnum: number;
      /** Concrete room vnums to sweep (e.g. [28001, 28002, ...]). */
      roomVnums?: number[];
      /**
       * Ordered route to follow in sequence, cycling back to index 0 when the
       * end is reached. When provided, overrides roomVnums-based BFS navigation.
       * After fleeing combat the bot returns to the previous vnum in the route
       * and then continues forward from that position.
       */
      routeVnums?: number[];
      targetValues: string[];
      /** Ms of no-combat idle before considering the zone cleared. Default 60 000. */
      idleTimeoutMs?: number;
    }
  | {
      /**
       * Farm a zone along a fixed ordered route (routeVnums), always moving via
       * "краст <dir>" (stealth), attacking all targetValues simultaneously via
       * "закол", looting on the death phrase, and fleeing on combat start.
       * Completes when no combat has occurred for idleTimeoutMs.
       */
      kind: "farm_zone2";
      label: string;
      entryVnum: number;
      /** Ordered route to cycle through. Required — must be non-empty. */
      routeVnums: number[];
      /**
       * Keywords to match against room description lines. Used as a filter by
       * parseMobsFromRoomDescription. Optional when mobNameMap is provided — in
       * that case the map keys serve as the filter instead.
       */
      targetValues?: string[];
      /**
       * Explicit mapping from room description line (lowercase) to combat keyword.
       * When provided, the executor uses this map instead of spamming all targetValues:
       * for each visible mob whose room line matches a key, the corresponding
       * combat keyword is sent as "закол <keyword>". Mobs with no matching key
       * are skipped (not attacked).
       *
       * Keys must be lowercase substrings of the room description line as returned
       * by parseMobsFromRoomDescription (after ANSI stripping and trimming).
       *
       * Example:
       *   mobNameMap: {
       *     "бобёр стоит здесь.": "бобёр",
       *     "кротенок роет землю здесь.": "кротенок",
       *   }
       */
      mobNameMap?: Record<string, string>;
      /**
       * Vnums to pass through without attacking. Useful for transit rooms that
       * contain dangerous mobs (e.g. охотник за черепами) — the bot moves through
       * them without engaging any targets.
       */
      skipVnums?: number[];
      /** Ms of no-combat idle before considering the zone cleared. Default 60 000. */
      idleTimeoutMs?: number;
      /**
       * Maximum number of full route passes before stopping.
       * One pass = one full cycle through routeVnums (index wraps back to 0).
       * When omitted, only idleTimeoutMs limits the run.
       */
      maxPassCount?: number;
      skinCorpses?: boolean;
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
  onceRoomChanged(timeoutMs: number): Promise<number | null>;
  refreshCurrentRoom(timeoutMs: number): Promise<number | null>;
  /** Called whenever script state changes — broadcast to browser. */
  onStateChange(state: ZoneScriptStateSnapshot): void;
  /** Logging (English only). */
  onLog(message: string): void;
  // ── farm_zone deps ──────────────────────────────────────────────────────
  getSnapshot(currentVnum: number | null): Promise<MapSnapshot>;
  move(direction: Direction): Promise<MoveResult>;
  stealthMove(direction: Direction): Promise<StealthMoveResult>;
  combatState: CombatState;
  getVisibleTargets(): Map<string, string>;
  getCorpseCount(): number;
  reinitRoom(): void;
  mobResolver: MobResolverDeps;
  isStealthProfile(): boolean;
  autoSortInventory(): Promise<void>;
}
