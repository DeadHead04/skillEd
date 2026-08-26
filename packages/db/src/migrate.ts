import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "./client";

const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);
await migrate(getDb(), { migrationsFolder: directory });
await closeDb();
