import { describe, expect, test } from "bun:test";
import { createTrackerState, processParsedEvents, trackOutgoingCommand } from "./tracker";
import type { ParsedEvent } from "./types";

describe("trackOutgoingCommand", () => {
  test("tracks russian abbreviations", () => {
    const state = createTrackerState();
    state.currentRoomId = 6000;

    trackOutgoingCommand(state, "с");
    expect(state.pendingMove?.direction).toBe("north");

    trackOutgoingCommand(state, "ю");
    expect(state.pendingMove?.direction).toBe("south");

    trackOutgoingCommand(state, "в");
    expect(state.pendingMove?.direction).toBe("east");

    trackOutgoingCommand(state, "з");
    expect(state.pendingMove?.direction).toBe("west");

    trackOutgoingCommand(state, "вв");
    expect(state.pendingMove?.direction).toBe("up");

    trackOutgoingCommand(state, "вн");
    expect(state.pendingMove?.direction).toBe("down");
  });

  test("ignores non-directional commands", () => {
    const state = createTrackerState();

    trackOutgoingCommand(state, "look");

    expect(state.pendingMove).toBeNull();
  });
});

describe("processParsedEvents", () => {
  test("creates edge when room changes after a move", () => {
    const state = createTrackerState();
    state.currentRoomId = 6000;
    trackOutgoingCommand(state, "с");

    const result = processParsedEvents(state, [
      {
        kind: "room",
        room: {
          vnum: 6001,
          name: "Перед трактиром",
          exits: ["east", "south", "west"],
          closedExits: [],
        },
      },
    ] satisfies ParsedEvent[]);

    expect(result.edges).toEqual([
      {
        fromVnum: 6000,
        toVnum: 6001,
        direction: "north",
        isPortal: false,
      },
    ]);
    expect(result.currentVnum).toBe(6001);
    expect(state.pendingMove).toBeNull();
  });

  test("does not create edge without known source room", () => {
    const state = createTrackerState();
    trackOutgoingCommand(state, "с");

    const result = processParsedEvents(state, [
      {
        kind: "room",
        room: {
          vnum: 6001,
          name: "Перед трактиром",
          exits: ["east", "south", "west"],
          closedExits: [],
        },
      },
    ] satisfies ParsedEvent[]);

    expect(result.edges).toEqual([]);
    expect(result.currentVnum).toBe(6001);
  });

  test("does not create self-loop edge", () => {
    const state = createTrackerState();
    state.currentRoomId = 6000;
    trackOutgoingCommand(state, "с");

    const result = processParsedEvents(state, [
      {
        kind: "room",
        room: {
          vnum: 6000,
          name: "В трактире",
          exits: ["north", "up"],
          closedExits: [],
        },
      },
    ] satisfies ParsedEvent[]);

    expect(result.edges).toEqual([]);
    expect(result.currentVnum).toBe(6000);
  });

  test("clears pending move when movement is blocked", () => {
    const state = createTrackerState();
    state.currentRoomId = 6000;
    trackOutgoingCommand(state, "в");

    const result = processParsedEvents(state, [{ kind: "movement_blocked" }] satisfies ParsedEvent[]);

    expect(result.edges).toEqual([]);
    expect(state.pendingMove).toBeNull();
    expect(result.currentVnum).toBe(6000);
  });

  test("updates pending move from movement confirmation", () => {
    const state = createTrackerState();
    state.currentRoomId = 6000;

    const result = processParsedEvents(state, [
      { kind: "movement", direction: "down" },
      {
        kind: "room",
        room: {
          vnum: 6049,
          name: "Комната отдыха",
          exits: ["down"],
          closedExits: [],
        },
      },
    ] satisfies ParsedEvent[]);

    expect(result.edges).toEqual([
      {
        fromVnum: 6000,
        toVnum: 6049,
        direction: "down",
        isPortal: false,
      },
    ]);
  });

  test("marks cross-zone transitions as portals", () => {
    const state = createTrackerState();
    state.currentRoomId = 6040;
    trackOutgoingCommand(state, "с");

    const result = processParsedEvents(state, [
      {
        kind: "room",
        room: {
          vnum: 6240,
          name: "Портальная комната",
          exits: ["south"],
          closedExits: [],
        },
      },
    ] satisfies ParsedEvent[]);

    expect(result.edges).toEqual([
      {
        fromVnum: 6040,
        toVnum: 6240,
        direction: "north",
        isPortal: true,
      },
    ]);
  });
});
