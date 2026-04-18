import type { WsData, ConnectPayload } from "./events.type.ts";
import { runtimeConfig } from "./config.ts";
import { profiles } from "./profiles.ts";

type MudSocket = Awaited<ReturnType<typeof Bun.connect>>;
type BunServerWebSocket = Bun.ServerWebSocket<WsData>;

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;
const SB = 250;
const SE = 240;

const STARTUP_COMMAND_FALLBACK_MS = 1200;
const KEEPALIVE_INTERVAL_MS = 30_000;
const RECONNECT_DELAYS_MS = [5_000, 10_000, 20_000, 30_000, 60_000];
const RECONNECT_RETRY_INTERVAL_MS = 60_000;

interface ResolvedConnectConfig {
  host: string;
  port: number;
  tls: boolean;
  startupCommands: string[];
  commandDelayMs: number;
}

export interface Session {
  decoder: TextDecoder;
  tcpSocket?: MudSocket;
  connected: boolean;
  state: "idle" | "connecting" | "connected" | "disconnected" | "error";
  statusMessage: string;
  connectAttemptId: number;
  startupPlan?: StartupPlan;
  telnetState: TelnetState;
  mudTarget?: string;
  lastCommandAt: number;
  keepaliveTimer?: ReturnType<typeof setInterval>;
  disconnectedByUser: boolean;
  lastConnectConfig?: ResolvedConnectConfig;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  reconnectAttempt: number;
}

interface StartupPlan {
  commands: string[];
  delayMs: number;
  sent: boolean;
  fallbackTimer?: ReturnType<typeof setTimeout>;
}

export interface TelnetState {
  mode: "data" | "iac" | "iac_option" | "subnegotiation" | "subnegotiation_iac";
  negotiationCommand?: number;
}

export interface MudConnectionDeps {
  logEvent(
    ws: BunServerWebSocket | null,
    direction: "session" | "mud-in" | "mud-out" | "browser-in" | "browser-out" | "error",
    message: string,
    details?: Record<string, string | number | boolean | null | undefined>,
  ): void;
  sanitizeLogText(text: string): string;
  updateSessionStatus(state: Session["state"], message: string): void;
  onMudText(text: string, ws: BunServerWebSocket | null, session: Session, attemptId: number): void;
  onTcpError(ws: BunServerWebSocket | null, message: string): void;
  onSessionTeardown(): void;
  trackOutgoingCommand(command: string): void;
  lineEnding: string;
}

export function createMudConnection(deps: MudConnectionDeps) {
  function createTelnetState(): TelnetState {
    return { mode: "data" };
  }

  function createSession(): Session {
    return {
      decoder: new TextDecoder(),
      connected: false,
      state: "idle",
      statusMessage: runtimeConfig.autoConnect
        ? "Auto-connect is enabled. Waiting for MUD connection."
        : "Ready to connect.",
      connectAttemptId: 0,
      telnetState: createTelnetState(),
      lastCommandAt: 0,
      disconnectedByUser: false,
      reconnectAttempt: 0,
    };
  }

  function writeMudCommand(socket: MudSocket, command: string): void {
    socket.write(`${command}${deps.lineEnding}`);
  }

  function clearStartupFallback(session: Session): void {
    if (session.startupPlan?.fallbackTimer) {
      clearTimeout(session.startupPlan.fallbackTimer);
      session.startupPlan.fallbackTimer = undefined;
    }
  }

  function clearKeepalive(session: Session): void {
    if (session.keepaliveTimer) {
      clearInterval(session.keepaliveTimer);
      session.keepaliveTimer = undefined;
    }
  }

  function clearReconnect(session: Session): void {
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer);
      session.reconnectTimer = undefined;
    }
  }

  function isCurrentAttempt(session: Session, attemptId: number): boolean {
    return session.connectAttemptId === attemptId;
  }

  function respondToTelnetNegotiation(socket: MudSocket, command: number, option: number): void {
    const responseCommand = command === DO || command === DONT ? WONT : DONT;
    socket.write(Uint8Array.of(IAC, responseCommand, option));
  }

  function decodeMudData(session: Session, socket: MudSocket, data: string | ArrayBuffer | Uint8Array): string {
    const source =
      typeof data === "string"
        ? new TextEncoder().encode(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data);
    const decodedBytes: number[] = [];

    for (const byte of source) {
      switch (session.telnetState.mode) {
        case "data": {
          if (byte === IAC) {
            session.telnetState.mode = "iac";
          } else {
            decodedBytes.push(byte);
          }
          break;
        }
        case "iac": {
          if (byte === IAC) {
            decodedBytes.push(byte);
            session.telnetState.mode = "data";
          } else if (byte === DO || byte === DONT || byte === WILL || byte === WONT) {
            session.telnetState.negotiationCommand = byte;
            session.telnetState.mode = "iac_option";
          } else if (byte === SB) {
            session.telnetState.mode = "subnegotiation";
          } else {
            session.telnetState.mode = "data";
          }
          break;
        }
        case "iac_option": {
          if (session.telnetState.negotiationCommand !== undefined) {
            respondToTelnetNegotiation(socket, session.telnetState.negotiationCommand, byte);
          }
          session.telnetState.negotiationCommand = undefined;
          session.telnetState.mode = "data";
          break;
        }
        case "subnegotiation": {
          if (byte === IAC) {
            session.telnetState.mode = "subnegotiation_iac";
          }
          break;
        }
        case "subnegotiation_iac": {
          session.telnetState.mode = byte === SE ? "data" : "subnegotiation";
          break;
        }
      }
    }

    if (decodedBytes.length === 0) {
      return "";
    }

    return session.decoder.decode(Uint8Array.from(decodedBytes), { stream: true });
  }

  function beginAttempt(session: Session, commands: string[], delayMs: number): number {
    session.connectAttemptId += 1;
    session.connected = false;
    session.state = "connecting";
    session.statusMessage = session.mudTarget ? `Connecting to ${session.mudTarget}...` : "Connecting to MUD...";
    session.decoder = new TextDecoder();
    session.telnetState = createTelnetState();
    clearStartupFallback(session);
    session.startupPlan = { commands, delayMs, sent: false };
    return session.connectAttemptId;
  }

  async function flushStartupCommands(
    ws: BunServerWebSocket | null,
    session: Session,
    attemptId: number,
    reason?: string,
  ): Promise<void> {
    if (
      !isCurrentAttempt(session, attemptId) ||
      !session.connected ||
      !session.tcpSocket ||
      !session.startupPlan ||
      session.startupPlan.sent
    ) {
      return;
    }

    clearStartupFallback(session);
    session.startupPlan.sent = true;

    if (reason) {
      deps.updateSessionStatus("connected", reason);
    }

    for (const command of session.startupPlan.commands) {
      if (!isCurrentAttempt(session, attemptId) || !session.connected || !session.tcpSocket) {
        return;
      }

      writeAndLogMudCommand(ws, session, session.tcpSocket, command, "startup");
      deps.updateSessionStatus("connected", `Startup command sent: ${command}`);

      if (session.startupPlan.delayMs > 0) {
        await Bun.sleep(session.startupPlan.delayMs);
      }
    }
  }

  function scheduleStartupFallback(ws: BunServerWebSocket | null, session: Session, attemptId: number): void {
    if (!session.startupPlan || session.startupPlan.commands.length === 0) {
      return;
    }

    clearStartupFallback(session);
    session.startupPlan.fallbackTimer = setTimeout(() => {
      void flushStartupCommands(ws, session, attemptId, "No banner received yet; sending startup commands.");
    }, STARTUP_COMMAND_FALLBACK_MS);
  }

  function writeAndLogMudCommand(
    ws: BunServerWebSocket | null,
    s: Session,
    socket: MudSocket,
    command: string,
    source: string,
  ): void {
    s.lastCommandAt = Date.now();
    deps.trackOutgoingCommand(command);
    writeMudCommand(socket, command);
    deps.logEvent(ws, "mud-out", deps.sanitizeLogText(command), {
      source,
      target: s.mudTarget ?? null,
    });
  }

  function teardownSession(
    ws: BunServerWebSocket | null,
    session: Session,
    reason: string,
    options: { closeSocket?: boolean; state?: "disconnected" | "error"; byUser?: boolean } = {},
  ): void {
    const tcpSocket = session.tcpSocket;
    const wasConnected = session.connected;
    const lastConfig = session.lastConnectConfig;

    session.connectAttemptId += 1;
    session.tcpSocket = undefined;
    session.connected = false;
    session.state = options.state ?? "disconnected";
    session.statusMessage = reason;
    session.decoder = new TextDecoder();
    session.telnetState = createTelnetState();
    clearStartupFallback(session);
    clearKeepalive(session);
    clearReconnect(session);
    session.startupPlan = undefined;
    session.mudTarget = undefined;

    if (options.byUser) {
      session.disconnectedByUser = true;
    }

    if (options.closeSocket !== false && tcpSocket) {
      tcpSocket.close();
    }

    deps.onSessionTeardown();

    deps.logEvent(ws, options.state === "error" ? "error" : "session", reason, {
      state: options.state ?? "disconnected",
    });

    deps.updateSessionStatus(options.state ?? "disconnected", reason);

    if (!options.byUser && lastConfig) {
      const attempt = session.reconnectAttempt;
      const delay = RECONNECT_DELAYS_MS[attempt] ?? RECONNECT_RETRY_INTERVAL_MS;
      session.reconnectAttempt += 1;
      deps.logEvent(ws, "session", `Auto-reconnect in ${delay / 1000}s... (attempt ${session.reconnectAttempt})`);
      deps.updateSessionStatus("connecting", `Auto-reconnect in ${delay / 1000}s... (attempt ${session.reconnectAttempt})`);
      session.reconnectTimer = setTimeout(() => {
        session.reconnectTimer = undefined;
        session.disconnectedByUser = false;
        void connectToMud(ws, session, lastConfig);
      }, delay);
    }
  }

  function normalizeConnectPayload(payload: ConnectPayload | undefined) {
    const profile = payload?.profileId
      ? (profiles.find((p) => p.id === payload.profileId) ?? null)
      : null;

    const defaultStartupCommands = profile?.startupCommands ?? runtimeConfig.startupCommands;
    const defaultCommandDelayMs = profile?.commandDelayMs ?? runtimeConfig.commandDelayMs;

    return {
      host: payload?.host?.trim() || runtimeConfig.mudHost,
      port: Number.isFinite(payload?.port) ? Number(payload?.port) : runtimeConfig.mudPort,
      tls: payload?.tls ?? runtimeConfig.mudTls,
      startupCommands:
        payload?.startupCommands
          ?.map((command) => command.trim()) ?? defaultStartupCommands,
      commandDelayMs:
        typeof payload?.commandDelayMs === "number" && payload.commandDelayMs >= 0
          ? payload.commandDelayMs
          : defaultCommandDelayMs,
    };
  }

  async function connectToMud(
    ws: BunServerWebSocket | null,
    session: Session,
    payload: ConnectPayload | ResolvedConnectConfig | undefined,
  ): Promise<void> {
    const config = "host" in (payload ?? {}) && "startupCommands" in (payload ?? {})
      ? (payload as ResolvedConnectConfig)
      : normalizeConnectPayload(payload as ConnectPayload | undefined);
    session.lastConnectConfig = config;
    session.disconnectedByUser = false;
    session.mudTarget = `${config.host}:${config.port}${config.tls ? " (tls)" : ""}`;
    const existingSocket = session.tcpSocket;
    const attemptId = beginAttempt(session, config.startupCommands, config.commandDelayMs);

    if (existingSocket) {
      existingSocket.close();
    }

    deps.logEvent(ws, "session", "Connect requested.", {
      target: session.mudTarget,
      startupCommands: config.startupCommands.length,
      commandDelayMs: config.commandDelayMs,
    });

    deps.updateSessionStatus(
      "connecting",
      `Connecting to ${config.host}:${config.port}${config.tls ? " with TLS" : ""}...`,
    );

    try {
      const tcpSocket = await Bun.connect({
        hostname: config.host,
        port: config.port,
        tls: config.tls,
        socket: {
          open(socket) {
            if (!isCurrentAttempt(session, attemptId)) {
              socket.close();
              return;
            }

            session.tcpSocket = socket;
            session.connected = true;
            session.reconnectAttempt = 0;
            session.lastCommandAt = Date.now();
            scheduleStartupFallback(ws, session, attemptId);
            session.state = "connected";
            session.statusMessage = `Connected to ${config.host}:${config.port}.`;
            deps.logEvent(ws, "session", "Connected to MUD.", { target: session.mudTarget });
            deps.updateSessionStatus("connected", `Connected to ${config.host}:${config.port}.`);

            clearKeepalive(session);
            session.keepaliveTimer = setInterval(() => {
              if (!isCurrentAttempt(session, attemptId) || !session.connected || !session.tcpSocket) {
                clearKeepalive(session);
                return;
              }
              if (Date.now() - session.lastCommandAt >= KEEPALIVE_INTERVAL_MS) {
                writeAndLogMudCommand(ws, session, session.tcpSocket, "", "keepalive");
              }
            }, KEEPALIVE_INTERVAL_MS);
          },
          data(socket, data) {
            if (!isCurrentAttempt(session, attemptId)) {
              return;
            }

            const text = decodeMudData(session, socket, data);
            const byteLength =
              typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;

            deps.logEvent(
              ws,
              "mud-in",
              deps.sanitizeLogText(text.length > 0 ? text : `[control-bytes:${byteLength}]`),
              { bytes: byteLength, target: session.mudTarget ?? null },
            );

            if (text.length > 0) {
              deps.onMudText(text, ws, session, attemptId);
              void flushStartupCommands(ws, session, attemptId);
            }
          },
          end() {
            if (!isCurrentAttempt(session, attemptId)) return;
            teardownSession(ws, session, "MUD server closed the connection.", { closeSocket: false });
          },
          close(_socket, error) {
            if (!isCurrentAttempt(session, attemptId)) return;
            teardownSession(ws, session, error ? "MUD connection closed with an error." : "MUD connection closed.", {
              closeSocket: false,
              state: error ? "error" : "disconnected",
            });
          },
          error(_socket, error) {
            if (!isCurrentAttempt(session, attemptId)) return;
            deps.logEvent(ws, "error", `TCP error: ${error.message}`, { target: session.mudTarget ?? null });
            deps.onTcpError(ws, `TCP error: ${error.message}`);
          },
          connectError(_socket, error) {
            if (!isCurrentAttempt(session, attemptId)) return;
            teardownSession(ws, session, `Connect error: ${error.message}`, {
              state: "error",
              closeSocket: false,
            });
          },
          timeout() {
            if (!isCurrentAttempt(session, attemptId)) return;
            teardownSession(ws, session, "Connection to the MUD timed out.", { state: "error" });
          },
        },
      });

      if (!isCurrentAttempt(session, attemptId)) {
        tcpSocket.close();
        return;
      }

      session.tcpSocket = tcpSocket;
    } catch (error) {
      if (!isCurrentAttempt(session, attemptId)) return;
      teardownSession(
        ws,
        session,
        error instanceof Error ? `Unable to connect: ${error.message}` : "Unable to connect to the MUD.",
        { state: "error" },
      );
    }
  }

  const session = createSession();

  return {
    session,
    connectToMud: (ws: BunServerWebSocket | null, payload: ConnectPayload | undefined) =>
      connectToMud(ws, session, payload),
    teardownSession: (
      ws: BunServerWebSocket | null,
      reason: string,
      options?: { closeSocket?: boolean; state?: "disconnected" | "error" },
    ) => teardownSession(ws, session, reason, { ...options, byUser: true }),
    writeAndLogMudCommand: (
      ws: BunServerWebSocket | null,
      socket: MudSocket,
      command: string,
      source: string,
    ) => writeAndLogMudCommand(ws, session, socket, command, source),
  };
}

export type MudConnection = ReturnType<typeof createMudConnection>;
