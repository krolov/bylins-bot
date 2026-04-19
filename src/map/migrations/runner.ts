// Postgres migration runner with baseline-pump support (per CONTEXT D-31).
//
// State machine on first call:
//   - schema_migrations ABSENT && map_rooms PRESENT  -> PRODUCTION-UNMIGRATED:
//     seed all known migration ids as applied WITHOUT executing their SQL.
//     Prevents re-applying destructive guards against a DB that already ran
//     them via pre-Phase-1 initialize(). See PITFALLS.md Pitfall 5.
//   - schema_migrations ABSENT && map_rooms ABSENT   -> FRESH-INSTALL:
//     create schema_migrations, apply every migration in lexicographic order.
//   - schema_migrations PRESENT                      -> NORMAL:
//     apply only unregistered migrations in lexicographic order.
//
// All work happens inside a single transaction holding pg_advisory_xact_lock(727465)
// to serialize concurrent runners. Fail-fast: any error aborts the tx (rolls back)
// and re-throws; schema_migrations is not updated for the failed id.

import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DatabaseClient } from "../../db.ts";

const ADVISORY_LOCK_ID = 727465;
const MIGRATION_FILENAME_REGEXP = /^\d{14}-[a-z0-9-]+\.sql$/;
const MIGRATIONS_DIR = dirname(fileURLToPath(import.meta.url));

export interface MigrationRunnerDependencies {
  onLog: (message: string) => void;
}

const NOOP_DEPS: MigrationRunnerDependencies = {
  onLog: () => {},
};

async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries
    .filter((name) => MIGRATION_FILENAME_REGEXP.test(name))
    .sort();
}

export async function runMigrations(
  database: DatabaseClient,
  deps: MigrationRunnerDependencies = NOOP_DEPS,
): Promise<void> {
  const files = await listMigrationFiles();

  await database.begin(async (rawTx) => {
    // postgres.js v3 types TransactionSql via Omit<Sql, ...>, which drops the callable
    // tagged-template signature even though runtime behaviour is identical. Single
    // boundary cast restores the callable shape; no `any` used.
    const tx = rawTx as unknown as DatabaseClient;

    await tx`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_ID})`;

    await tx`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    const appliedRows = await tx<{ id: string }[]>`SELECT id FROM schema_migrations`;
    const appliedIds = new Set(appliedRows.map((r) => r.id));

    if (appliedIds.size === 0) {
      const roomsExistsRows = await tx<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'map_rooms'
        ) AS exists
      `;
      const mapRoomsExists = roomsExistsRows[0]?.exists === true;

      if (mapRoomsExists) {
        // PRODUCTION-UNMIGRATED path: seed every known migration id as applied; do NOT execute.
        // Sequential by design — migrations apply in order; Promise.all would race.
        for (const filename of files) {
          const id = filename.replace(/\.sql$/, "");
          await tx`INSERT INTO schema_migrations (id) VALUES (${id})`;
          deps.onLog(`[migrations] baseline-pump seeded ${id} (not executed)`);
          appliedIds.add(id);
        }
        return;
      }
      // else FRESH-INSTALL: fall through to NORMAL apply loop
    }

    // NORMAL path: apply each unregistered migration in lexicographic order.
    // Sequential by design — migrations apply in order; Promise.all would race.
    for (const filename of files) {
      const id = filename.replace(/\.sql$/, "");
      if (appliedIds.has(id)) {
        continue;
      }
      const sqlText = await readFile(join(MIGRATIONS_DIR, filename), "utf8");
      try {
        await tx.unsafe(sqlText);
      } catch (error: unknown) {
        throw new Error(`[migrations] failed applying ${id}: ${error instanceof Error ? error.message : "unknown"}`);
      }
      await tx`INSERT INTO schema_migrations (id) VALUES (${id})`;
      deps.onLog(`[migrations] applied ${id}`);
    }
  });
}
