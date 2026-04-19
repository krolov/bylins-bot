// Port for sending raw MUD commands. Implementations wrap mud-connection.ts::writeAndLogMudCommand
// and bind the ws/socket context at composition time in server.ts.

export interface MudCommandSink {
  send(command: string, source: string): void;
}
