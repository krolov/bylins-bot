import type { Direction, ParsedEvent, ParsedRoom, ParserState } from "./types";

const ANSI_SEQUENCE_REGEXP = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ROOM_HEADER_REGEXP = /^(.+?)\s+\[(\d{3,})\]\s*$/;
const EXITS_LINE_REGEXP = /^\[\s*(?:exits?|выходы?)\s*:\s*(.*?)\s*\]\s*$/i;
const MOVEMENT_BLOCKED_REGEXP = /Вы не сможете туда пройти|Вам сюда нельзя|Нет такого выхода|Вы не можете идти/i;
const FLEE_REGEXP = /Вы быстро убежали с поля битвы|ПАНИКА ОВЛАДЕЛА ВАМИ|Ни за что! Вы сражаетесь за свою жизнь/i;
const DARK_ROOM_REGEXP = /^Слишком темно\b/i;
const MOVEMENT_REGEXP = /Вы\s+(?:поплелись|пошли|побежали|полетели|поехали|поскакали|побрели|поплыли)(?:\s+следом\s+за\s+\S+)?\s+(?:на\s+)?(север|юг|восток|запад|вверх|вниз)\.?/i;

const MOB_ANSI_BLOCK_REGEXP = /\u001b\[1;31m([\s\S]*?)\u001b\[(?:0;0|0)m/g;
const PROMPT_MANA_ANSI_REGEXP = /\u001b\[1;31m\d+M\u001b\[0;37m/g;
const TARGET_PREFIX_REGEXP = /^\([^)]*\)\s*/;

const ITEM_ANSI_BLOCK_REGEXP = /\u001b\[1;33m([\s\S]*?)\u001b\[(?:0;0|0)m/g;
const CORPSE_LINE_REGEXP = /^Труп\s+.+лежит\s+здесь\.?\s*(?:\[(\d+)\])?\s*$/i;

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
    rawLineBuffer: "",
    pendingRoomHeader: null,
    pendingMobs: [],
    pendingCorpseCount: 0,
  };
}

export function feedText(state: ParserState, text: string): ParsedEvent[] {
  // Extract mob ANSI blocks from raw text BEFORE stripping ANSI
  const rawChunk = `${state.rawLineBuffer}${text}`;
  extractMobsFromRaw(rawChunk, state.pendingMobs);
  state.pendingCorpseCount += extractCorpseCountFromRaw(rawChunk);

  state.rawLineBuffer = extractUnfinishedAnsiTail(rawChunk);

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
      flushPendingRoomHeader(state, events, [], []);
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

    if (MOVEMENT_BLOCKED_REGEXP.test(line) || FLEE_REGEXP.test(line)) {
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

function extractUnfinishedAnsiTail(rawText: string): string {
  const lastMobStart = rawText.lastIndexOf("\u001b[1;31m");
  const lastItemStart = rawText.lastIndexOf("\u001b[1;33m");
  const lastStart = Math.max(lastMobStart, lastItemStart);
  if (lastStart === -1) {
    return "";
  }

  const tail = rawText.slice(lastStart);
  if (/\u001b\[(?:0;0|0)m/.test(tail)) {
    return "";
  }

  return tail;
}

function sanitizeRoomName(name: string): string {
  return name.replace(ROOM_NAME_STATUS_PREFIX_REGEXP, "").trim();
}

function extractMobsFromRaw(rawText: string, mobs: string[]): void {
  const sanitizedRawText = rawText.replace(PROMPT_MANA_ANSI_REGEXP, "");
  MOB_ANSI_BLOCK_REGEXP.lastIndex = 0;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = MOB_ANSI_BLOCK_REGEXP.exec(sanitizedRawText)) !== null) {
    const blockContent = blockMatch[1];
    const blockLines = blockContent
      .split(/\r?\n/)
      .map((line) => stripAnsi(line).trim())
      .filter((line) => line.length > 0);

    for (const line of blockLines) {
      const mobName = extractTargetName(line);
      if (mobName && !mobs.includes(mobName)) {
        mobs.push(mobName);
      }
    }
  }
}

function extractCorpseCountFromRaw(rawText: string): number {
  ITEM_ANSI_BLOCK_REGEXP.lastIndex = 0;
  let total = 0;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = ITEM_ANSI_BLOCK_REGEXP.exec(rawText)) !== null) {
    const blockContent = blockMatch[1];
    const blockLines = blockContent
      .split(/\r?\n/)
      .map((line) => stripAnsi(line).trim())
      .filter((line) => line.length > 0);
    for (const line of blockLines) {
      const m = CORPSE_LINE_REGEXP.exec(line);
      if (m) {
        total += m[1] ? parseInt(m[1], 10) : 1;
      }
    }
  }
  return total;
}

function extractTargetName(line: string): string | null {
  const candidate = line
    .replace(TARGET_PREFIX_REGEXP, "")
    .replace(/\.$/, "")
    .trim();

  if (!candidate || candidate.length < 2) {
    return null;
  }

  if (/^(?:вы|вас|вам|ваших|ваш)\b/i.test(candidate)) {
    return null;
  }

  if (/\bсражается\s+с\s+ВАМИ\b/i.test(candidate)) {
    return null;
  }

  // Filter out combat lines like "Белая утка ударила вас" / "Белая утка слегка ударила вас".
  // Only null-out when a combat verb is present — greeting lines like "Мобыч встречает вас" must pass.
  // Note: \b does not work for Cyrillic in JS, so use (?:^|\s) to anchor the word boundary.
  if (
    /(?:ударил|ударила|укусил|укусила|лягнул|лягнула|царапнул|царапнула|атаковал|атаковала|попал|попала|промахнул|промахнулась|нанёс|нанесла)/.test(candidate) &&
    /(?:^|\s)(?:вас|вам)\s*[.!]?\s*$/.test(candidate)
  ) {
    return null;
  }

  // Lines starting with '[' are prompt status blocks like [моб:Тяжело ранен], never mob descriptions
  if (candidate.startsWith("[")) {
    return null;
  }

  return candidate;
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

  // Emit mobs_in_room event if any mobs were captured since last room flush
  const mobs = state.pendingMobs.splice(0);
  if (mobs.length > 0) {
    events.push({ kind: "mobs_in_room", mobs });
  }

  // Emit corpses_in_room event if any corpses were counted since last room flush
  if (state.pendingCorpseCount > 0) {
    events.push({ kind: "corpses_in_room", count: state.pendingCorpseCount });
    state.pendingCorpseCount = 0;
  }

  state.pendingRoomHeader = null;
}
