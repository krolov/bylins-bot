import { startupConnectionScript } from "./startup-script";
import type { CharacterProfile } from "./profiles";
import { profiles, defaultProfileId } from "./profiles";

export interface RuntimeConfig {
  host: string;
  port: number;
  autoConnect: boolean;
  mudHost: string;
  mudPort: number;
  mudTls: boolean;
  startupCommands: string[];
  commandDelayMs: number;
  lineEnding: "\n" | "\r\n";
  databaseUrl: string;
  wikiProxies: string[];
  profiles: CharacterProfile[];
  defaultProfileId: string;
  telegramBotToken: string;
  telegramChatId: string;
}

function readString(name: string, fallback: string): string {
  return Bun.env[name]?.trim() || fallback;
}

function readNumber(name: string, fallback: number): number {
  const raw = Bun.env[name];

  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = Bun.env[name]?.trim().toLowerCase();

  if (!raw) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }

  return fallback;
}

function readLineEnding(): "\n" | "\r\n" {
  const raw = Bun.env.MUD_LINE_ENDING?.trim().toLowerCase();
  return raw === "lf" ? "\n" : "\r\n";
}

function readStartupCommands(): string[] {
  const raw = Bun.env.MUD_STARTUP_COMMANDS?.trim();

  if (!raw) {
    return [];
  }

  return raw
    .split(/;;|\r?\n/g)
    .map((command) => command.trim())
    .filter((command) => command.length > 0);
}

function readWikiProxies(): string[] {
  const raw = Bun.env.WIKI_PROXIES?.trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((entry) => {
      const parts = entry.split(":");
      if (parts.length === 4) {
        const [host, port, user, pass] = parts;
        return `http://${user}:${pass}@${host}:${port}`;
      }
      return entry;
    });
}

export const runtimeConfig: RuntimeConfig = {
  host: readString("HOST", "0.0.0.0"),
  port: readNumber("PORT", 3000),
  autoConnect: readBoolean("MUD_AUTO_CONNECT", true),
  mudHost: readString("MUD_HOST", startupConnectionScript.host),
  mudPort: readNumber("MUD_PORT", startupConnectionScript.port),
  mudTls: readBoolean("MUD_TLS", startupConnectionScript.tls),
  startupCommands: readStartupCommands().length > 0 ? readStartupCommands() : startupConnectionScript.startupCommands,
  commandDelayMs: readNumber("MUD_COMMAND_DELAY_MS", startupConnectionScript.commandDelayMs),
  lineEnding: readLineEnding(),
  databaseUrl: readString("DATABASE_URL", ""),
  wikiProxies: readWikiProxies(),
  profiles,
  defaultProfileId,
  telegramBotToken: readString("TELEGRAM_BOT_TOKEN", ""),
  telegramChatId: readString("TELEGRAM_CHAT_ID", ""),
};

if (!runtimeConfig.databaseUrl) {
  throw new Error("DATABASE_URL is required. Refusing to start without persistent automapper storage.");
}
