const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const AFFECTS_LINE_REGEXP = /^Аффекты:\s*(.*)$/im;
const AFFECT_EXPIRED_REGEXP = /^Заклинание ['"]?(.+?)['"]? (?:перестало|больше не)/im;

const DEFAULT_CHECK_INTERVAL_MS = 60_000;
const MIN_CHECK_INTERVAL_MS = 10_000;
const CAST_COOLDOWN_MS = 3_000;
const AFFECTS_RESPONSE_TIMEOUT_MS = 3_000;
const RECAST_DELAY_MS = 1_500;
const INITIAL_CHECK_DELAY_MS = 500;

export interface AutoSpellEntry {
  name: string;
  command: string;
  enabled: boolean;
}

export interface SpellControllerConfig {
  enabled: boolean;
  spells: AutoSpellEntry[];
  checkIntervalMs: number;
}

export interface SpellControllerDependencies {
  sendCommand(command: string): void;
  isInCombat(): boolean;
  onLog(message: string): void;
}

interface SpellControllerState {
  config: SpellControllerConfig;
  activeAffects: Set<string>;
  awaitingAffResponse: boolean;
  lastCastAt: number;
  checkTimer: ReturnType<typeof setTimeout> | null;
}

export function createSpellController(deps: SpellControllerDependencies): {
  handleMudText(text: string): void;
  updateConfig(config: SpellControllerConfig): void;
  getConfig(): SpellControllerConfig;
  reset(): void;
} {
  const state: SpellControllerState = {
    config: {
      enabled: false,
      spells: [],
      checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
    },
    activeAffects: new Set(),
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

    const now = Date.now();
    const enabledSpells = state.config.spells.filter((s) => s.enabled);

    for (const spell of enabledSpells) {
      const affectName = spell.name.toLowerCase().trim();
      const isActive = [...state.activeAffects].some(
        (a) => a.toLowerCase().trim() === affectName,
      );

      if (!isActive) {
        if (now - state.lastCastAt >= CAST_COOLDOWN_MS) {
          deps.onLog(`[spell-script] Аффект "${spell.name}" не активен, колдую: ${spell.command}`);
          deps.sendCommand(spell.command);
          state.lastCastAt = Date.now();
        } else {
          deps.onLog(`[spell-script] Аффект "${spell.name}" не активен, но кулдаун ещё не прошёл`);
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
      const clean = stripAnsi(text);

      if (AFFECTS_LINE_REGEXP.test(clean)) {
        const affects = parseAffectsLine(clean);
        state.activeAffects = new Set(affects.map((a) => a.toLowerCase().trim()));

        if (state.awaitingAffResponse) {
          state.awaitingAffResponse = false;
          if (state.checkTimer !== null) {
            clearTimeout(state.checkTimer);
            state.checkTimer = null;
          }
          castMissing();
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
          deps.onLog(`[spell-script] Аффект "${watched.name}" спал, перепроверяю`);
          state.activeAffects.delete(expiredName);
          scheduleCheck(RECAST_DELAY_MS);
        }
      }
    },

    updateConfig(config: SpellControllerConfig): void {
      const wasEnabled = state.config.enabled;
      state.config = {
        ...config,
        checkIntervalMs: Math.max(config.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS, MIN_CHECK_INTERVAL_MS),
      };

      if (state.config.enabled && !wasEnabled) {
        deps.onLog("[spell-script] Авто-заклинания включены");
        scheduleCheck(INITIAL_CHECK_DELAY_MS);
      } else if (!state.config.enabled && wasEnabled) {
        deps.onLog("[spell-script] Авто-заклинания выключены");
        if (state.checkTimer !== null) {
          clearTimeout(state.checkTimer);
          state.checkTimer = null;
        }
      } else if (state.config.enabled) {
        scheduleCheck(INITIAL_CHECK_DELAY_MS);
      }
    },

    getConfig(): SpellControllerConfig {
      return state.config;
    },

    reset(): void {
      if (state.checkTimer !== null) {
        clearTimeout(state.checkTimer);
        state.checkTimer = null;
      }
      state.awaitingAffResponse = false;
      state.activeAffects = new Set();
      state.lastCastAt = 0;
    },
  };
}
