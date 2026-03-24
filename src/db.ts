import postgres from "postgres";
import { runtimeConfig } from "./config";

export type DatabaseClient = ReturnType<typeof postgres>;

export const sql: DatabaseClient = postgres(runtimeConfig.databaseUrl);
