export interface StartupConnectionScript {
  host: string;
  port: number;
  tls: boolean;
  startupCommands: string[];
  commandDelayMs: number;
}

export const startupConnectionScript: StartupConnectionScript = {
  host: "bylins.su",
  port: 7000,
  tls: false,
  startupCommands: ["5", "воинмир", "respect1"],
  commandDelayMs: 150,
};
