import { db, ensureSchema } from "./db";

const sql = db();
await ensureSchema(sql);
await sql.end();
