import type { Direction, ParsedEvent, ParsedRoom, ParserState } from "./types";

const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ROOM_HEADER_REGEXP = /^(.+?)\s+\[(\d{3,})\]\s*$/;
const EXITS_LINE_REGEXP = /^\[\s*(?:exits?|выходы?)\s*:\s*(.*?)\s*\]\s*$/i;
const MOVEMENT_BLOCKED_REGEXP = /Вы не сможете туда пройти|Вам сюда нельзя|Нет такого выхода|Вы не можете идти/i;
const DARK_ROOM_REGEXP = /^Слишком темно\b/i;
const MOVEMENT_REGEXP = /Вы\s+(?:поплелись|пошли|побежали|полетели|поехали|поскакали|побрели|поплыли)\s+(?:на\s+)?(север|юг|восток|запад|вверх|вниз)\.?/i;

const EXIT_TOKEN_TO_DIRECTION: Record<string, Direction> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
  u: "up",
  d: "down",
  с: "north",
  ю: "south",
  в: "east",
  з: "west",
  вв: "up",
  вн: "down",
};

const MOVEMENT_WORD_TO_DIRECTION: Record<string, Direction> = {
  север: "north",
  юг: "south",
  восток: "east",
  запад: "west",
  вверх: "up",
  вниз: "down",
};

const ROOM_NAME_STATUS_PREFIX_REGEXP = /^\d+H\s+\d+M\s+\d+o\b.*?>\s*/;

export function createParserState(): ParserState {
  return {
    lineBuffer: "",
    pendingRoomHeader: null,
  };
}

export function feedText(state: ParserState, text: string): ParsedEvent[] {
  const normalized = `${state.lineBuffer}${stripAnsi(text).replace(/\r/g, "")}`;
  const lines = normalized.split("\n");
  state.lineBuffer = lines.pop() ?? "";

  const events: ParsedEvent[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0) {
      continue;
    }

    const roomHeaderMatch = ROOM_HEADER_REGEXP.exec(line);

    if (roomHeaderMatch) {
      flushPendingRoomHeader(state, events, []);
      state.pendingRoomHeader = {
        name: sanitizeRoomName(roomHeaderMatch[1]),
        vnum: Number(roomHeaderMatch[2]),
      };
      continue;
    }

    const exitsMatch = EXITS_LINE_REGEXP.exec(line);

    if (exitsMatch) {
      const { exits, closedExits } = parseExits(exitsMatch[1]);
      flushPendingRoomHeader(state, events, exits, closedExits);
      continue;
    }

    if (MOVEMENT_BLOCKED_REGEXP.test(line)) {
      events.push({ kind: "movement_blocked" });
      continue;
    }

    if (DARK_ROOM_REGEXP.test(line)) {
      flushPendingRoomHeader(state, events, [], []);
      events.push({ kind: "dark_room" });
      continue;
    }

    const movementMatch = MOVEMENT_REGEXP.exec(line);

    if (movementMatch) {
      const direction = MOVEMENT_WORD_TO_DIRECTION[movementMatch[1].toLowerCase()];

      if (direction) {
        events.push({ kind: "movement", direction });
      }
    }
  }

  return events;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI_SEQUENCE_REGEXP, "");
}

function sanitizeRoomName(name: string): string {
  return name.replace(ROOM_NAME_STATUS_PREFIX_REGEXP, "").trim();
}

function parseExits(rawExits: string): { exits: Direction[]; closedExits: Direction[] } {
  const exits: Direction[] = [];
  const closedExits: Direction[] = [];

  for (const token of rawExits.split(/\s+/g)) {
    const normalizedToken = token.trim().toLowerCase();

    if (!normalizedToken) {
      continue;
    }

    const closedMatch = normalizedToken.match(/^\((.+)\)$/);
    if (closedMatch) {
      const direction = EXIT_TOKEN_TO_DIRECTION[closedMatch[1]];
      if (direction) {
        if (!closedExits.includes(direction)) closedExits.push(direction);
        if (!exits.includes(direction)) exits.push(direction);
      }
      continue;
    }

    const direction = EXIT_TOKEN_TO_DIRECTION[normalizedToken];

    if (direction && !exits.includes(direction)) {
      exits.push(direction);
    }
  }

  return { exits, closedExits };
}

function flushPendingRoomHeader(state: ParserState, events: ParsedEvent[], exits: Direction[], closedExits: Direction[]): void {
  if (!state.pendingRoomHeader) {
    return;
  }

  const room: ParsedRoom = {
    vnum: state.pendingRoomHeader.vnum,
    name: state.pendingRoomHeader.name,
    exits,
    closedExits,
  };

  events.push({ kind: "room", room });
  state.pendingRoomHeader = null;
}
