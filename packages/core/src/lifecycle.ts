import type { Db } from "./db";
import { sha256 } from "./artifacts";
export async function inTransaction<T>(
  sql: Db,
  operation: (tx: Db) => Promise<T>,
): Promise<T> {
  const nested = sql as unknown as {
    savepoint?: (fn: (tx: Db) => Promise<T>) => Promise<T>;
  };
  if (nested.savepoint) return nested.savepoint(operation);
  return sql.begin((tx) =>
    operation(tx as unknown as Db),
  ) as unknown as Promise<T>;
}
export async function recordDecision(
  sql: Db,
  actor: string | null,
  resource: string,
  action: string,
  detail: unknown,
  revision?: number,
) {
  await sql`INSERT INTO decision_records(actor_user_id,resource_id,action,revision,input_hashes,detail) VALUES(${actor},${resource},${action},${revision ?? null},${sql.json({ request: sha256(JSON.stringify(detail)) })},${sql.json(detail as never)})`;
}
