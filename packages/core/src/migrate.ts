import { db, migrate } from "./db";

const sql = db(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL);
await migrate(sql);
await sql.end();
