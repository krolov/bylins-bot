import type { Direction, MapSnapshot } from "../map/types.ts";
import type { MoveResult } from "../map/mover.ts";
import type { CombatState } from "../combat-state.ts";
import type { FarmZoneSettings } from "../map/store.ts";
import type { TickTimer } from "../utils/timer.ts";

export type { Direction, MapSnapshot, MoveResult, CombatState, FarmZoneSettings, TickTimer };

export const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
export const ROOM_PROMPT_REGEXP = /Вых:[^>]*>/i;
export const TARGET_NOT_VISIBLE_REGEXP = /Вы не видите цели\.?|Кого вы так сильно ненавидите/i;
export const MOB_ARRIVAL_REGEXP =
  /^(.+?)\s+(?:приполз|приползла|приползли|прибежал|прибежала|прибежали|пришел|пришла|пришли|прилетел|прилетела|прилетели|прошмыгнул|прошмыгнула|прошмыгнули|прошмыгнуло)\s+с\s+\S+\.?$/i;
export const TARGET_PREFIX_REGEXP = /^\([^)]*\)\s*/;
export const DARK_ROOM_REGEXP = /^Слишком темно\b/i;
export const MOB_DEATH_REGEXP = /мертв[аео]?,\s+(?:его|её|ее|ее)\s+душа/i;

export const DEFAULT_RETRY_DELAY_MS = 600;
export const DARK_ROOM_RETRY_DELAY_MS = 2000;
export const MOVE_TIMEOUT_RETRY_DELAY_MS = 2000;
export const MOB_PROBE_DELAY_MS = 700;

export const OPPOSITE_DIRECTION: Record<Direction, Direction> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
  up: "down",
  down: "up",
};

export interface Farm2StateSnapshot {
  enabled: boolean;
  zoneId: number | null;
  pendingActivation: boolean;
  attackCommand: string;
  targetValues: string[];
}

export interface Farm2ControllerDependencies {
  getCurrentRoomId(): number | null;
  isConnected(): boolean;
  getSnapshot(currentVnum: number | null): Promise<MapSnapshot>;
  sendCommand(command: string): void;
  reinitRoom(): void;
  move(direction: Direction): Promise<MoveResult>;
  combatState: CombatState;
  getZoneSettings(zoneId: number): Promise<FarmZoneSettings | null>;
  getMobCombatNamesByZone(zoneId: number): Promise<string[]>;
  getCombatNameByRoomName(roomName: string): Promise<string | null>;
  isRoomNameBlacklisted(roomName: string): Promise<boolean>;
  linkMobRoomAndCombatName(roomName: string, combatName: string, vnum: number | null): Promise<void>;
  onStateChange(state: Farm2StateSnapshot): void;
  onLog(message: string): void;
  onDebugLog(message: string): void;
}

export interface Farm2Config {
  attackCommand: string;
  targetValues: string[];
  skinningSalvoEnabled: boolean;
  skinningSkinVerb: string;
  lootMeatCommand: string;
  lootHideCommand: string;
}

export interface Farm2Stats {
  hp: number;
  hpMax: number;
  energy: number;
  energyMax: number;
}

export interface Farm2State {
  enabled: boolean;
  zoneId: number | null;
  pendingActivation: boolean;
  timer: TickTimer;
  tickInFlight: boolean;
  nextActionAt: number;
  currentVisibleTargets: Map<string, string>;
  pendingRoomScanAfterKill: boolean;
  roomVisitOrder: Map<number, number>;
  visitSequence: number;
  lastRecordedRoomId: number | null;
  lastMoveFromRoomId: number | null;
  isDark: boolean;
  config: Farm2Config;
  stats: Farm2Stats;
  probeCombatNames: string[];
  probeIndex: number;
  probeSingleRoomName: string | null;
  probeLastAttemptAt: number;
  pendingRoomScanSetAt: number;
  lastRoomCorpseCount: number;
  attackSentAt: number;
}
