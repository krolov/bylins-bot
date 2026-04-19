import { describe, expect, test } from "bun:test";

import type { DatabaseClient } from "../../db.ts";
import { runMigrations, type MigrationRunnerDependencies } from "./runner.ts";

interface RecordedCall {
  kind: "tagged" | "unsafe" | "insert-schema-migration";
  text: string;
  values?: readonly unknown[];
}

interface MockDbOptions {
  schemaMigrationsRows: Array<{ id: string }>;
  mapRoomsExists: boolean;
  unsafeThrowsOn?: { id: string; message: string };
}

// Hand-rolled mock of the postgres.js tagged-template + .begin + .unsafe surface used by runner.ts.
// Recognizes queries by substring match on the joined template text. All calls record into `calls`.
// Sufficient for baseline-pump state-machine coverage; real-Postgres integration is deferred to
// Phase 4 (TEST-05).
function createMockDatabase(opts: MockDbOptions): { db: DatabaseClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  function runTagged(strings: TemplateStringsArray, values: readonly unknown[]): unknown {
    const text = strings.join("?").trim();
    calls.push({ kind: "tagged", text, values });

    if (text.includes("pg_advisory_xact_lock")) {
      return Promise.resolve([]);
    }
    if (text.includes("CREATE TABLE IF NOT EXISTS schema_migrations")) {
      return Promise.resolve([]);
    }
    if (text.includes("SELECT id FROM schema_migrations")) {
      return Promise.resolve(opts.schemaMigrationsRows);
    }
    if (text.includes("information_schema.tables") && text.includes("map_rooms")) {
      return Promise.resolve([{ exists: opts.mapRoomsExists }]);
    }
    if (text.includes("INSERT INTO schema_migrations")) {
      calls.push({ kind: "insert-schema-migration", text, values });
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }

  // Callable function acts as the tagged-template entry point; methods are attached after.
  interface MockShape {
    (strings: TemplateStringsArray, ...values: readonly unknown[]): unknown;
    unsafe(text: string): Promise<unknown>;
    begin(cb: (tx: MockShape) => Promise<unknown>): Promise<unknown>;
  }

  const taggedTemplate = ((strings: TemplateStringsArray, ...values: readonly unknown[]): unknown =>
    runTagged(strings, values)) as MockShape;

  taggedTemplate.unsafe = (text: string): Promise<unknown> => {
    calls.push({ kind: "unsafe", text });
    const matchedId = opts.unsafeThrowsOn;
    if (matchedId && text.includes(matchedId.id)) {
      throw new Error(matchedId.message);
    }
    return Promise.resolve([]);
  };

  taggedTemplate.begin = async (cb: (tx: MockShape) => Promise<unknown>): Promise<unknown> => {
    return cb(taggedTemplate);
  };

  return { db: taggedTemplate as unknown as DatabaseClient, calls };
}

// Second mock variant that overrides tx.unsafe behaviour by inspecting a "currentId"
// signalled by a preceding tagged call. Simpler approach: capture all INSERT values
// and attribute the most recent unsafe to the next INSERTed id.
// But since runner always applies in order (unsafe -> insert), the mapping is:
//   unsafe call N corresponds to the Nth pending id (files[*] minus applied)
// We override tx.unsafe per-test when we need id-specific error throwing.

function makeDeps(): { deps: MigrationRunnerDependencies; logs: string[] } {
  const logs: string[] = [];
  return {
    deps: { onLog: (message: string) => { logs.push(message); } },
    logs,
  };
}

describe("runMigrations", () => {
  test("fresh install: schema_migrations absent + map_rooms absent -> apply every migration", async () => {
    const { db, calls } = createMockDatabase({
      schemaMigrationsRows: [],
      mapRoomsExists: false,
    });
    const { deps, logs } = makeDeps();

    await runMigrations(db, deps);

    const taggedTexts = calls.filter((c) => c.kind === "tagged").map((c) => c.text);
    expect(taggedTexts.some((t) => t.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(taggedTexts.some((t) => t.includes("CREATE TABLE IF NOT EXISTS schema_migrations"))).toBe(true);

    const advisoryLockCount = taggedTexts.filter((t) => t.includes("pg_advisory_xact_lock")).length;
    expect(advisoryLockCount).toBe(1);

    const unsafeCalls = calls.filter((c) => c.kind === "unsafe");
    expect(unsafeCalls.length).toBeGreaterThan(0);

    const inserts = calls.filter((c) => c.kind === "insert-schema-migration");
    expect(inserts.length).toBe(unsafeCalls.length);

    expect(logs.every((m) => m.startsWith("[migrations] applied"))).toBe(true);
    expect(logs.some((m) => m.includes("baseline-pump"))).toBe(false);
  });

  test("baseline-pump: schema_migrations absent + map_rooms present -> seed without executing", async () => {
    const { db, calls } = createMockDatabase({
      schemaMigrationsRows: [],
      mapRoomsExists: true,
    });
    const { deps, logs } = makeDeps();

    await runMigrations(db, deps);

    const unsafeCalls = calls.filter((c) => c.kind === "unsafe");
    expect(unsafeCalls.length).toBe(0);

    const inserts = calls.filter((c) => c.kind === "insert-schema-migration");
    expect(inserts.length).toBeGreaterThan(0);

    const advisoryLockCount = calls
      .filter((c) => c.kind === "tagged")
      .filter((c) => c.text.includes("pg_advisory_xact_lock")).length;
    expect(advisoryLockCount).toBe(1);

    expect(logs.every((m) => m.includes("baseline-pump seeded"))).toBe(true);
    expect(logs.some((m) => m.startsWith("[migrations] applied"))).toBe(false);
  });

  test("normal re-run (no-op): all ids already in schema_migrations -> no unsafe, no inserts", async () => {
    const allIds = [
      "20260418180000-baseline",
      "20260418180100-add-has-wiki-data",
      "20260418180200-drop-farm-zone-settings",
    ];
    const { db, calls } = createMockDatabase({
      schemaMigrationsRows: allIds.map((id) => ({ id })),
      mapRoomsExists: true,
    });
    const { deps, logs } = makeDeps();

    await runMigrations(db, deps);

    const unsafeCalls = calls.filter((c) => c.kind === "unsafe");
    expect(unsafeCalls.length).toBe(0);

    const inserts = calls.filter((c) => c.kind === "insert-schema-migration");
    expect(inserts.length).toBe(0);

    expect(logs.length).toBe(0);
  });

  test("mid-migration error rolls back and re-throws with context", async () => {
    // Target the known last migration id so the mock reliably triggers the throw.
    const targetId = "20260418180200-drop-farm-zone-settings";
    const { db } = createMockDatabase({
      schemaMigrationsRows: [
        { id: "20260418180000-baseline" },
        { id: "20260418180100-add-has-wiki-data" },
      ],
      mapRoomsExists: true,
    });

    // Override db.unsafe to throw when invoked — runner applies in order, so the only
    // remaining unregistered migration is targetId; the first unsafe() call hits it.
    const dbWithThrow = db as unknown as { unsafe: (text: string) => Promise<unknown> };
    dbWithThrow.unsafe = (_text: string): Promise<unknown> => {
      throw new Error("syntax error at line 5");
    };

    const { deps } = makeDeps();

    let caught: unknown = null;
    try {
      await runMigrations(db, deps);
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).not.toBeNull();
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toContain("[migrations] failed applying");
    expect(message).toContain(targetId);
    expect(message).toContain("syntax error at line 5");
  });
});
