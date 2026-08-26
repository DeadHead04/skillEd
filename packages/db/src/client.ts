import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

let sqlClient: ReturnType<typeof postgres> | undefined;
let database: PostgresJsDatabase<typeof schema> | undefined;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (database) return database;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");
  sqlClient = postgres(url, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
  });
  database = drizzle(sqlClient, { schema });
  return database;
}

export async function closeDb(): Promise<void> {
  if (sqlClient) await sqlClient.end();
  sqlClient = undefined;
  database = undefined;
}
