import { describe, expect, test } from "bun:test";
import { createParserState, feedText } from "./parser";

describe("feedText", () => {
  test("parses room header and exits from one chunk", () => {
    const state = createParserState();
    const events = feedText(state, "Комната отдыха [6049]\n[ Exits: n s d ]\n");

    expect(events).toEqual([
      {
        kind: "room",
        room: {
          vnum: 6049,
          name: "Комната отдыха",
          exits: ["north", "south", "down"],
        },
      },
    ]);
  });

  test("parses room header and exits across chunks", () => {
    const state = createParserState();

    expect(feedText(state, "Комната отдыха [6049]\n")).toEqual([]);
    expect(feedText(state, "[ Exits: n s d ]\n")).toEqual([
      {
        kind: "room",
        room: {
          vnum: 6049,
          name: "Комната отдыха",
          exits: ["north", "south", "down"],
        },
      },
    ]);
  });

  test("parses movement confirmation", () => {
    const state = createParserState();

    expect(feedText(state, "Вы поплелись на север.\n")).toEqual([
      {
        kind: "movement",
        direction: "north",
      },
    ]);
  });

  test("parses movement upward variant", () => {
    const state = createParserState();

    expect(feedText(state, "Вы полетели вверх.\n")).toEqual([
      {
        kind: "movement",
        direction: "up",
      },
    ]);
  });

  test("parses movement following an NPC", () => {
    const state = createParserState();

    expect(feedText(state, "Вы поплелись следом за Арнольдом на восток.\n")).toEqual([
      {
        kind: "movement",
        direction: "east",
      },
    ]);
  });

  test("parses blocked movement", () => {
    const state = createParserState();

    expect(feedText(state, "Вы не сможете туда пройти...\n")).toEqual([
      {
        kind: "movement_blocked",
      },
    ]);
  });

  test("ignores unrelated text", () => {
    const state = createParserState();

    expect(feedText(state, "Вы отдыхаете у очага.\n")).toEqual([]);
  });

  test("keeps partial line in buffer", () => {
    const state = createParserState();

    expect(feedText(state, "Комната от")).toEqual([]);
    expect(state.lineBuffer).toBe("Комната от");
  });

  test("parses multiple rooms in one chunk", () => {
    const state = createParserState();
    const events = feedText(state, "Комната отдыха [6049]\n[ Exits: d ]\nВ трактире [6000]\n[ Exits: n u ]\n");

    expect(events).toEqual([
      {
        kind: "room",
        room: {
          vnum: 6049,
          name: "Комната отдыха",
          exits: ["down"],
        },
      },
      {
        kind: "room",
        room: {
          vnum: 6000,
          name: "В трактире",
          exits: ["north", "up"],
        },
      },
    ]);
  });

  test("parses russian exits line", () => {
    const state = createParserState();
    const events = feedText(state, "Комната отдыха [6049]\n[ Выходы: с ю в з вв вн ]\n");

    expect(events).toEqual([
      {
        kind: "room",
        room: {
          vnum: 6049,
          name: "Комната отдыха",
          exits: ["north", "south", "east", "west", "up", "down"],
        },
      },
    ]);
  });

  test("flushes previous room header when a new header arrives", () => {
    const state = createParserState();
    const events = feedText(state, "Комната отдыха [6049]\nВ трактире [6000]\n[ Exits: n u ]\n");

    expect(events).toEqual([
      {
        kind: "room",
        room: {
          vnum: 6049,
          name: "Комната отдыха",
          exits: [],
        },
      },
      {
        kind: "room",
        room: {
          vnum: 6000,
          name: "В трактире",
          exits: ["north", "up"],
        },
      },
    ]);
  });

  test("strips ansi sequences before parsing", () => {
    const state = createParserState();
    const events = feedText(state, "\u001b[1;36mКомната отдыха [6049]\u001b[0;37m\r\n\u001b[0;36m[ Exits: d ]\u001b[0;37m\r\n");

    expect(events).toEqual([
      {
        kind: "room",
        room: {
          vnum: 6049,
          name: "Комната отдыха",
          exits: ["down"],
        },
      },
    ]);
  });

  test("strips prompt prefix from room name", () => {
    const state = createParserState();
    const events = feedText(state, "25H 84M 2499o Зауч:0 Вых:ВЮЗ> Перед трактиром [6001]\n[ Exits: e s w ]\n");

    expect(events).toEqual([
      {
        kind: "room",
        room: {
          vnum: 6001,
          name: "Перед трактиром",
          exits: ["east", "south", "west"],
        },
      },
    ]);
  });

  test("strips combat prompt prefix (with mob status) from room name", () => {
    const state = createParserState();
    const events = feedText(
      state,
      "195H 117M 9377o Зауч:0 ОЗ:0 [Воинмир:Невредим] [журавль:Ранен] > Заводь [4312]\n[ Exits: n ]\n",
    );

    expect(events).toEqual([
      {
        kind: "room",
        room: {
          vnum: 4312,
          name: "Заводь",
          exits: ["north"],
        },
      },
    ]);
  });
});
