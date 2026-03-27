const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const AFFECTS_LINE_REGEXP = /^Аффекты:\s*(.*)$/im;
const AFFECT_EXPIRED_REGEXP = /^Заклинание ['"]?(.+?)['"]? (?:перестало|больше не)/im;
const STATE_LINE_REGEXP = /^Состояние\s*:\s*(.+)$/im;

const DEFAULT_CHECK_INTERVAL_MS = 20_000;
const MIN_CHECK_INTERVAL_MS = 5_000;
const CAST_COOLDOWN_MS = 3_000;
const AFFECTS_RESPONSE_TIMEOUT_MS = 3_000;
const RECAST_DELAY_MS = 1_500;
const INITIAL_CHECK_DELAY_MS = 500;
const POST_COMBAT_DELAY_MS = 800;

export interface SneakSpellEntry {
  name: string;
  command: string;
  enabled: boolean;
}

export interface SneakControllerConfig {
  enabled: boolean;
  spells: SneakSpellEntry[];
  checkIntervalMs: number;
}

export interface SneakControllerDependencies {
  sendCommand(command: string): void;
  onLog(message: string): void;
  isInCombat(): boolean;
}

interface SneakControllerState {
  config: SneakControllerConfig;
  activeAffects: Set<string>;
  sneakActive: boolean;
  awaitingAffResponse: boolean;
  lastCastAt: number;
  checkTimer: ReturnType<typeof setTimeout> | null;
}

export function createSneakController(deps: SneakControllerDependencies): {
  handleMudText(text: string): void;
  updateConfig(config: SneakControllerConfig): void;
  onCombatEnd(): void;
  getConfig(): SneakControllerConfig;
  reset(): void;
} {
  const state: SneakControllerState = {
    config: {
      enabled: false,
      spells: [],
      checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
    },
    activeAffects: new Set(),
    sneakActive: false,
    awaitingAffResponse: false,
    lastCastAt: 0,
    checkTimer: null,
  };

  function scheduleCheck(delayMs: number): void {
    if (state.checkTimer !== null) {
      clearTimeout(state.checkTimer);
    }
    state.checkTimer = setTimeout(() => {
      state.checkTimer = null;
      void runCheck();
    }, delayMs);
  }

  function stripAnsi(text: string): string {
    return text.replace(ANSI_SEQUENCE_REGEXP, "");
  }

  async function runCheck(): Promise<void> {
    if (!state.config.enabled || state.config.spells.length === 0) {
      return;
    }

    if (deps.isInCombat()) {
      scheduleCheck(getCheckIntervalMs());
      return;
    }

    const enabledSpells = state.config.spells.filter((s) => s.enabled);
    if (enabledSpells.length === 0) {
      scheduleCheck(getCheckIntervalMs());
      return;
    }

    state.awaitingAffResponse = true;
    deps.sendCommand("афф");

    const fallbackTimer = setTimeout(() => {
      if (state.awaitingAffResponse) {
        state.awaitingAffResponse = false;
        castMissing();
      }
    }, AFFECTS_RESPONSE_TIMEOUT_MS);

    const prevTimer = state.checkTimer;
    state.checkTimer = fallbackTimer;
    if (prevTimer !== null) {
      clearTimeout(prevTimer);
    }
  }

  function castMissing(): void {
    if (!state.config.enabled) return;
    if (deps.isInCombat()) return;

    const now = Date.now();
    const enabledSpells = state.config.spells.filter((s) => s.enabled);

    for (const spell of enabledSpells) {
      const affectName = spell.name.toLowerCase().trim();
      const isSneakSpell = affectName === "!крадется!";
      const isActive = isSneakSpell
        ? state.sneakActive
        : [...state.activeAffects].some((a) => a.toLowerCase().trim() === affectName);

      if (!isActive) {
        if (now - state.lastCastAt >= CAST_COOLDOWN_MS) {
          deps.sendCommand(spell.command);
          state.lastCastAt = Date.now();
        }
      }
    }

    scheduleCheck(getCheckIntervalMs());
  }

  function getCheckIntervalMs(): number {
    return Math.max(state.config.checkIntervalMs, MIN_CHECK_INTERVAL_MS);
  }

  function parseAffectsLine(line: string): string[] {
    const match = AFFECTS_LINE_REGEXP.exec(line);
    if (!match) return [];
    const raw = match[1] ?? "";
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  return {
    handleMudText(text: string): void {
      const clean = stripAnsi(text).replace(/\r/g, "");

      const stateMatch = STATE_LINE_REGEXP.exec(clean);
      if (stateMatch) {
        state.sneakActive = (stateMatch[1] ?? "").includes("!крадется!");
      }

      if (AFFECTS_LINE_REGEXP.test(clean)) {
        const affects = parseAffectsLine(clean);
        state.activeAffects = new Set(affects.map((a) => a.toLowerCase().trim()));

        if (state.awaitingAffResponse) {
          state.awaitingAffResponse = false;
          if (state.checkTimer !== null) {
            clearTimeout(state.checkTimer);
            state.checkTimer = null;
          }
          state.checkTimer = setTimeout(() => {
            state.checkTimer = null;
            castMissing();
          }, 50);
        }
        return;
      }

      const expiredMatch = AFFECT_EXPIRED_REGEXP.exec(clean);
      if (expiredMatch) {
        const expiredName = (expiredMatch[1] ?? "").toLowerCase().trim();
        const watched = state.config.spells.find(
          (s) => s.enabled && s.name.toLowerCase().trim() === expiredName,
        );
        if (watched) {
          state.activeAffects.delete(expiredName);
          scheduleCheck(RECAST_DELAY_MS);
        }
      }
    },

    updateConfig(config: SneakControllerConfig): void {
      const wasEnabled = state.config.enabled;
      state.config = {
        ...config,
        checkIntervalMs: Math.max(config.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS, MIN_CHECK_INTERVAL_MS),
      };

      if (state.config.enabled && !wasEnabled) {
        deps.onLog("[sneak-script] Авто-подкрадывание включено");
        scheduleCheck(INITIAL_CHECK_DELAY_MS);
      } else if (!state.config.enabled && wasEnabled) {
        deps.onLog("[sneak-script] Авто-подкрадывание выключено");
        if (state.checkTimer !== null) {
          clearTimeout(state.checkTimer);
          state.checkTimer = null;
        }
      } else if (state.config.enabled) {
        scheduleCheck(INITIAL_CHECK_DELAY_MS);
      }
    },

    onCombatEnd(): void {
      if (!state.config.enabled) return;
      scheduleCheck(POST_COMBAT_DELAY_MS);
    },

    getConfig(): SneakControllerConfig {
      return state.config;
    },

    reset(): void {
      if (state.checkTimer !== null) {
        clearTimeout(state.checkTimer);
        state.checkTimer = null;
      }
      state.awaitingAffResponse = false;
      state.sneakActive = false;
      state.activeAffects = new Set();
      state.lastCastAt = 0;
    },
  };
}
