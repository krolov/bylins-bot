// ---------------------------------------------------------------------------
// Farm — unified types for the merged farming system.
//
// The farm system has two runtime flavours that share one public API:
//   - "loop": stats-driven tick loop for dynamic zones (from former src/farm2/).
//     Picks visible targets on the fly, uses per-zone settings from DB.
//   - "script": typed step runner for hardcoded zone walkthroughs (from former
//     src/zone-scripts/). Each zone has a ScriptStep[] describing the route.
//
// Legacy snapshot types (Farm2StateSnapshot, ZoneScriptStateSnapshot) are
// re-exported as-is so the WS contract in events.type.ts stays unchanged.
// ---------------------------------------------------------------------------

import type { Farm2StateSnapshot, Farm2Stats } from "../farm2/types.ts";
import type {
  ScriptStep,
  StepState,
  StepStatus,
  ZoneScriptStateSnapshot,
} from "../zone-scripts/types.ts";

export type { Farm2StateSnapshot, Farm2Stats, ScriptStep, StepState, StepStatus, ZoneScriptStateSnapshot };

/**
 * Which subsystem a FarmController delegates to for the current zone.
 *  - "loop": reactive tick loop (old farm2).
 *  - "script": hardcoded step runner (old zone-scripts).
 *  - "idle": nothing running.
 */
export type FarmMode = "loop" | "script" | "idle";
