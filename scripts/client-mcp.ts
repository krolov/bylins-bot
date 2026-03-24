import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BOT_URL = process.env.BYLINS_BOT_URL ?? "ws://127.0.0.1:3211/ws";

type ConnectionState = "idle" | "connecting" | "connected" | "disconnected" | "error";

interface Stats {
  hp: number;
  hpMax: number;
  energy: number;
  energyMax: number;
}

interface NavigationState {
  active: boolean;
  targetVnum: number | null;
  totalSteps: number;
  currentStep: number;
}

interface FarmState {
  enabled: boolean;
  zoneId: number | null;
  pendingActivation: boolean;
  targetValues: string[];
  healCommands: string[];
  healThresholdPercent: number;
  lootValues: string[];
}

interface SurvivalStatus {
  foodEmpty: boolean;
  flaskEmpty: boolean;
}

interface StoredEvent {
  ts: number;
  type: string;
  data: unknown;
}

const state = {
  wsState: "idle" as "idle" | "connecting" | "open" | "closed" | "error",
  mudState: "idle" as ConnectionState,
  mudMessage: "",
  stats: null as Stats | null,
  navigation: null as NavigationState | null,
  farm: null as FarmState | null,
  survivalStatus: null as SurvivalStatus | null,
  outputChunks: [] as string[],
  statusLog: [] as Array<{ ts: number; state: ConnectionState; message: string }>,
  recentEvents: [] as StoredEvent[],
};

const MAX_OUTPUT_CHUNKS = 500;
const MAX_STATUS_LOG = 200;
const MAX_RECENT_EVENTS = 100;

type SendFn = (msg: unknown) => void;

let wsSend: SendFn | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function pushEvent(type: string, data: unknown): void {
  state.recentEvents.push({ ts: Date.now(), type, data });
  if (state.recentEvents.length > MAX_RECENT_EVENTS) {
    state.recentEvents.shift();
  }
}

function connectToBot(): void {
  if (wsReconnectTimer !== null) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }

  state.wsState = "connecting";
  console.error(`[client-mcp] connecting to ${BOT_URL}`);

  let ws: WebSocket;
  try {
    ws = new WebSocket(BOT_URL);
  } catch (err) {
    state.wsState = "error";
    console.error("[client-mcp] failed to create WebSocket:", err);
    scheduleReconnect();
    return;
  }

  ws.addEventListener("open", () => {
    state.wsState = "open";
    console.error("[client-mcp] connected to bot");
    wsSend = (msg) => ws.send(JSON.stringify(msg));
  });

  ws.addEventListener("message", (ev) => {
    let parsed: { type: string; payload?: unknown };
    try {
      parsed = JSON.parse(String(ev.data)) as { type: string; payload?: unknown };
    } catch {
      return;
    }

    pushEvent(parsed.type, parsed.payload);

    switch (parsed.type) {
      case "status": {
        const p = parsed.payload as { state: ConnectionState; message: string };
        state.mudState = p.state;
        state.mudMessage = p.message;
        state.statusLog.push({ ts: Date.now(), state: p.state, message: p.message });
        if (state.statusLog.length > MAX_STATUS_LOG) state.statusLog.shift();
        break;
      }
      case "output": {
        const p = parsed.payload as { text: string };
        state.outputChunks.push(p.text);
        if (state.outputChunks.length > MAX_OUTPUT_CHUNKS) state.outputChunks.shift();
        break;
      }
      case "stats_update": {
        state.stats = parsed.payload as Stats;
        break;
      }
      case "navigation_state": {
        state.navigation = parsed.payload as NavigationState;
        break;
      }
      case "farm_state": {
        const p = parsed.payload as FarmState;
        state.farm = p;
        break;
      }
      case "survival_status": {
        state.survivalStatus = parsed.payload as SurvivalStatus;
        break;
      }
    }
  });

  ws.addEventListener("close", () => {
    state.wsState = "closed";
    wsSend = null;
    console.error("[client-mcp] disconnected from bot, reconnecting…");
    scheduleReconnect();
  });

  ws.addEventListener("error", (ev) => {
    state.wsState = "error";
    wsSend = null;
    console.error("[client-mcp] ws error:", ev);
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (wsReconnectTimer !== null) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectToBot();
  }, 3000);
}

function requireConnected(): string | null {
  if (state.wsState !== "open" || wsSend === null) {
    return `Нет подключения к bylins-bot (состояние WS: ${state.wsState}). Убедись что сервер запущен на ${BOT_URL}.`;
  }
  return null;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[mGKHF]/g, "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}

function formatTs(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 23);
}

const server = new McpServer({ name: "bylins-client", version: "1.0.0" });

server.registerTool(
  "get_status",
  {
    title: "Статус подключения и персонажа",
    description:
      "Возвращает текущий статус: подключён ли MCP к bylins-bot серверу, " +
      "подключён ли бот к MUD, HP/энергию персонажа, статус фарма и навигации.",
    inputSchema: z.object({}),
  },
  async () => {
    const lines: string[] = [
      `=== Статус bylins-client MCP ===`,
      ``,
      `MCP → Bot WS: ${state.wsState} (${BOT_URL})`,
      `Bot → MUD:    ${state.mudState}${state.mudMessage ? ` — ${state.mudMessage}` : ""}`,
    ];

    if (state.stats) {
      lines.push(
        ``,
        `Персонаж:`,
        `  HP:     ${state.stats.hp} / ${state.stats.hpMax}`,
        `  Энергия: ${state.stats.energy} / ${state.stats.energyMax}`,
      );
    } else {
      lines.push(``, `Персонаж: данные не получены (отправь "score" чтобы обновить)`);
    }

    if (state.farm) {
      lines.push(
        ``,
        `Фарм: ${state.farm.enabled ? "✅ включён" : "⛔ выключен"}${state.farm.zoneId ? ` (зона ${state.farm.zoneId})` : ""}`,
        state.farm.pendingActivation ? `  ожидает активации…` : "",
      );
    }

    if (state.navigation) {
      const nav = state.navigation;
      lines.push(
        ``,
        nav.active
          ? `Навигация: идёт → vnum ${nav.targetVnum} (шаг ${nav.currentStep}/${nav.totalSteps})`
          : `Навигация: не активна`,
      );
    }

    if (state.survivalStatus) {
      const sv = state.survivalStatus;
      lines.push(
        ``,
        `Выживание: еда ${sv.foodEmpty ? "❌ пусто" : "✅ есть"}, фляга ${sv.flaskEmpty ? "❌ пуста" : "✅ есть"}`,
      );
    }

    return { content: [{ type: "text" as const, text: lines.filter((l) => l !== undefined).join("\n") }] };
  },
);

server.registerTool(
  "send_command",
  {
    title: "Отправить команду в MUD",
    description:
      "Отправляет произвольную команду в MUD через бот. " +
      "После отправки ждёт указанное количество секунд и возвращает " +
      "весь MUD-вывод за это время. Удобно для дебага: отправил — увидел ответ.",
    inputSchema: z.object({
      command: z.string().describe("Команда для MUD, например: look, score, инвентарь"),
      wait_seconds: z
        .number()
        .min(0.5)
        .max(30)
        .default(2)
        .describe("Сколько секунд ждать ответа от MUD (0.5–30, default 2)"),
    }),
  },
  async ({ command, wait_seconds }) => {
    const err = requireConnected();
    if (err) return { content: [{ type: "text" as const, text: err }] };

    const startIdx = state.outputChunks.length;
    wsSend!({ type: "send", payload: { command } });
    await new Promise<void>((resolve) => setTimeout(resolve, wait_seconds * 1000));
    const newChunks = state.outputChunks.slice(startIdx);
    const rawText = newChunks.join("");
    const clean = stripAnsi(rawText).trim();

    if (!clean) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Команда «${command}» отправлена. За ${wait_seconds}с MUD вывода не получено.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Команда «${command}» отправлена. Ответ MUD (${wait_seconds}с):\n\n${clean}`,
        },
      ],
    };
  },
);

server.registerTool(
  "get_output",
  {
    title: "Последний вывод MUD",
    description:
      "Возвращает последние N строк сырого вывода MUD (ANSI-коды убраны). " +
      "Используй для просмотра текущего состояния без отправки команд.",
    inputSchema: z.object({
      lines: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(50)
        .describe("Количество последних строк (1–500, default 50)"),
      strip_empty: z
        .boolean()
        .default(true)
        .describe("Убирать пустые строки (default true)"),
    }),
  },
  async ({ lines, strip_empty }) => {
    if (state.outputChunks.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Буфер вывода пуст. Бот ещё не получал данных от MUD.",
          },
        ],
      };
    }

    const raw = state.outputChunks.join("");
    let allLines = stripAnsi(raw).split("\n");

    if (strip_empty) {
      allLines = allLines.filter((l) => l.trim().length > 0);
    }

    const tail = allLines.slice(-lines);

    return {
      content: [
        {
          type: "text" as const,
          text: `Последние ${tail.length} строк вывода MUD:\n\n${tail.join("\n")}`,
        },
      ],
    };
  },
);

server.registerTool(
  "get_logs",
  {
    title: "Логи скриптов (farm, survival, triggers)",
    description:
      "Возвращает последние N сообщений от скриптов бота: фарма, выживания, триггеров. " +
      "Это status-события, которые скрипты логируют через onLog(). " +
      "Полезно для дебага — видно что делал скрипт в последние секунды.",
    inputSchema: z.object({
      count: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(30)
        .describe("Количество последних сообщений (1–200, default 30)"),
      filter: z
        .string()
        .optional()
        .describe("Подстрока для фильтрации сообщений (опционально)"),
    }),
  },
  async ({ count, filter }) => {
    let logs = state.statusLog.slice(-count * 3);

    if (filter) {
      const lf = filter.toLowerCase();
      logs = logs.filter((e) => e.message.toLowerCase().includes(lf));
    }

    logs = logs.slice(-count);

    if (logs.length === 0) {
      const msg = filter
        ? `Нет сообщений с фильтром «${filter}».`
        : "Логов пока нет. Включи фарм или другой скрипт.";
      return { content: [{ type: "text" as const, text: msg }] };
    }

    const lines = logs.map((e) => `[${formatTs(e.ts)}] [${e.state}] ${e.message}`);

    return {
      content: [
        {
          type: "text" as const,
          text: `Последние ${lines.length} лог-сообщений скриптов:\n\n${lines.join("\n")}`,
        },
      ],
    };
  },
);

server.registerTool(
  "toggle_farm",
  {
    title: "Включить / выключить фарм-скрипт",
    description:
      "Управляет фарм-скриптом бота. Можно включить/выключить, " +
      "а также задать цели и команды лечения. " +
      "Возвращает новое состояние фарма.",
    inputSchema: z.object({
      enabled: z.boolean().describe("true = включить фарм, false = выключить"),
      target_values: z
        .array(z.string())
        .optional()
        .describe("Список целей для атаки (опционально)"),
      heal_commands: z
        .array(z.string())
        .optional()
        .describe("Команды лечения (опционально)"),
      heal_threshold_percent: z
        .number()
        .min(1)
        .max(99)
        .optional()
        .describe("Процент HP для лечения (1–99, опционально)"),
      loot_values: z
        .array(z.string())
        .optional()
        .describe("Список предметов для подбора (опционально)"),
    }),
  },
  async ({ enabled, target_values, heal_commands, heal_threshold_percent, loot_values }) => {
    const err = requireConnected();
    if (err) return { content: [{ type: "text" as const, text: err }] };

    const payload: Record<string, unknown> = { enabled };
    if (target_values !== undefined) payload.targetValues = target_values;
    if (heal_commands !== undefined) payload.healCommands = heal_commands;
    if (heal_threshold_percent !== undefined) payload.healThresholdPercent = heal_threshold_percent;
    if (loot_values !== undefined) payload.lootValues = loot_values;

    wsSend!({ type: "farm_toggle", payload });

    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    const f = state.farm;
    const statusLine = f
      ? `Фарм: ${f.enabled ? "✅ включён" : "⛔ выключен"}${f.zoneId ? ` (зона ${f.zoneId})` : ""}\n` +
        `  Цели: ${f.targetValues.join(", ") || "(не заданы)"}\n` +
        `  Порог лечения: ${f.healThresholdPercent}%\n` +
        `  Команды лечения: ${f.healCommands.join(", ") || "(не заданы)"}\n` +
        `  Лут: ${f.lootValues.join(", ") || "(не задан)"}`
      : "Состояние фарма не получено.";

    return { content: [{ type: "text" as const, text: statusLine }] };
  },
);

server.registerTool(
  "get_events",
  {
    title: "Последние события от сервера",
    description:
      "Возвращает последние N событий любого типа от bylins-bot (map_update, " +
      "stats_update, navigation_state, farm_state, gear_scan_progress и т.д.). " +
      "Удобно для отслеживания что происходит в реальном времени.",
    inputSchema: z.object({
      count: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Количество последних событий (1–100, default 20)"),
      type_filter: z
        .string()
        .optional()
        .describe(
          "Фильтр по типу события: status, output, map_update, stats_update, " +
            "navigation_state, farm_state, gear_scan_progress, gear_scan_result, … (опционально)",
        ),
    }),
  },
  async ({ count, type_filter }) => {
    let events = state.recentEvents;

    if (type_filter) {
      events = events.filter((e) => e.type === type_filter);
    }

    const tail = events.slice(-count);

    if (tail.length === 0) {
      const msg = type_filter
        ? `Нет событий типа «${type_filter}».`
        : "Событий пока нет.";
      return { content: [{ type: "text" as const, text: msg }] };
    }

    const lines = tail.map((e) => {
      const dataStr =
        e.type === "output"
          ? `"${stripAnsi(String((e.data as { text?: string }).text ?? "")).slice(0, 120)}…"`
          : JSON.stringify(e.data);
      return `[${formatTs(e.ts)}] ${e.type}: ${dataStr}`;
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `${tail.length} событий${type_filter ? ` (тип: ${type_filter})` : ""}:\n\n${lines.join("\n")}`,
        },
      ],
    };
  },
);

connectToBot();

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("bylins-client MCP server запущен (stdio)");
