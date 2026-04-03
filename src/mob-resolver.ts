const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const TARGET_PREFIX_REGEXP = /^\([^)]*\)\s*/;

export const MOB_PROBE_DELAY_MS = 700;

const PROBE_STOPWORD_REGEXP =
  /^(?:вы|вас|вам|ваш|ваши|ваших|его|её|ее|их|им|с|со|по|на|в|во|за|из|к|у|при|обводя|мимо|здесь|стоит|лежит|сидит|ходит|бродит|парит|летит|стоя|проходит|пробегает|проезжает|ползет|ползёт|крадется|крадётся)$/i;

export interface MobProbeState {
  combatNames: string[];
  index: number;
  singleRoomName: string | null;
  lastAttemptAt: number;
}

export function createMobProbeState(): MobProbeState {
  return { combatNames: [], index: 0, singleRoomName: null, lastAttemptAt: 0 };
}

export function resetMobProbeState(probe: MobProbeState): void {
  probe.combatNames = [];
  probe.index = 0;
  probe.singleRoomName = null;
  probe.lastAttemptAt = 0;
}

export interface MobResolverDeps {
  getMobCombatNamesByZone(zoneId: number): Promise<string[]>;
  getCombatNameByRoomName(roomName: string): Promise<string | null>;
  isRoomNameBlacklisted(roomName: string): Promise<boolean>;
  linkMobRoomAndCombatName(roomName: string, combatName: string, vnum: number | null): Promise<void>;
  onDebugLog(message: string): void;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE_REGEXP, "");
}

export function extractTargetName(line: string, targetValues: string[]): string | null {
  const cleaned = line.replace(TARGET_PREFIX_REGEXP, "").trim().toLowerCase();
  for (const value of targetValues) {
    if (cleaned.includes(value)) return value;
  }
  return null;
}

export function parseMobsFromRoomDescription(lines: string[], targetValues: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of lines) {
    const stripped = stripAnsi(line).trim();
    const target = extractTargetName(stripped, targetValues);
    if (target !== null) result.set(stripped.toLowerCase(), stripped);
  }
  return result;
}

function splitWords(name: string): string[] {
  return name.trim().split(/\s+/).filter((w) => w.length > 0);
}

function lastWord(name: string): string | null {
  const words = splitWords(name);
  return words[words.length - 1] ?? null;
}

function buildProbeList(roomLine: string): string[] {
  const words = splitWords(roomLine.replace(/[,.!?;:()]/g, ""))
    .map((w) => w.toLowerCase())
    .filter((w) => !PROBE_STOPWORD_REGEXP.test(w));

  const result: string[] = [];
  for (const word of words) {
    if (word.includes("-")) {
      for (const part of word.split("-")) {
        if (part.length > 0 && !result.includes(part)) result.push(part);
      }
      if (!result.includes(word)) result.push(word);
    } else {
      if (!result.includes(word)) result.push(word);
    }
  }
  return result;
}

function truncateForProbe(raw: string): string {
  return raw.length <= 2 ? raw : raw.slice(0, Math.max(3, raw.length - 2));
}

export async function resolveAttackTarget(
  probe: MobProbeState,
  visibleTargets: Map<string, string>,
  currentRoomId: number,
  deps: MobResolverDeps,
): Promise<string | null> {
  const log = (msg: string) => deps.onDebugLog(msg);

  if (visibleTargets.size === 0) {
    log("resolveAttackTarget: no visible targets");
    return null;
  }

  log(`resolveAttackTarget: visibleTargets=[${[...visibleTargets.keys()].join(", ")}]`);

  const zoneId = Math.floor(currentRoomId / 100);
  const allMobNames = await deps.getMobCombatNamesByZone(zoneId);
  const mobNamesLower = allMobNames.map((n) => n.toLowerCase());

  log(`resolveAttackTarget: zone=${zoneId} knownMobs=[${allMobNames.join(", ")}]`);

  for (const [lowerName, roomLine] of visibleTargets) {
    const matchIdx = mobNamesLower.findIndex(
      (mobName) => lowerName === mobName || lowerName.startsWith(mobName + " "),
    );
    if (matchIdx !== -1) {
      resetMobProbeState(probe);
      const target = lastWord(allMobNames[matchIdx] ?? "");
      log(`resolveAttackTarget: matched by zone list "${lowerName}" → attack "${target}"`);
      return target;
    }

    const combatName = await deps.getCombatNameByRoomName(roomLine);
    if (combatName) {
      resetMobProbeState(probe);
      const target = lastWord(combatName);
      log(`resolveAttackTarget: matched by db link "${roomLine}" → attack "${target}"`);
      return target;
    }

    log(`resolveAttackTarget: no db link for roomLine="${roomLine}"`);
  }

  if (probe.combatNames.length === 0) {
    const expanded: string[] = [];
    for (const roomLine of visibleTargets.values()) {
      if (roomLine.startsWith("...")) {
        log(`resolveAttackTarget: skipping aura line="${roomLine}"`);
        continue;
      }
      const isBlacklisted = await deps.isRoomNameBlacklisted(roomLine);
      if (isBlacklisted) {
        log(`resolveAttackTarget: skipping blacklisted roomLine="${roomLine}"`);
        continue;
      }
      for (const probe of buildProbeList(roomLine)) {
        if (!expanded.includes(probe)) expanded.push(probe);
      }
    }
    probe.combatNames = expanded;
    probe.index = 0;
    probe.singleRoomName = visibleTargets.size === 1 ? ([...visibleTargets.values()][0] ?? null) : null;
    log(`resolveAttackTarget: built probe list=[${expanded.join(", ")}]`);
  }

  if (probe.index >= probe.combatNames.length) {
    log("resolveAttackTarget: probe list exhausted, giving up");
    resetMobProbeState(probe);
    return null;
  }

  const now = Date.now();
  if (now - probe.lastAttemptAt < MOB_PROBE_DELAY_MS) {
    log(`resolveAttackTarget: probe throttled (${now - probe.lastAttemptAt}ms < ${MOB_PROBE_DELAY_MS}ms)`);
    return null;
  }

  const rawWord = probe.combatNames[probe.index] ?? "";
  probe.index += 1;
  probe.lastAttemptAt = now;

  const combatWord = truncateForProbe(rawWord);
  log(`resolveAttackTarget: probing word="${combatWord}" (raw="${rawWord}", index ${probe.index - 1})`);

  return combatWord || null;
}
