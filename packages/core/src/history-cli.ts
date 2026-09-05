import { db, migrate } from "./db";
import { ArtifactStore } from "./artifacts";
import { exportHistory, importHistory } from "./history";
const [operation, directory] = process.argv.slice(2);
if (!directory || !["export", "import"].includes(operation ?? ""))
  throw new Error("Usage: history-cli.ts export|import DIRECTORY");
const sql = db(process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL);
try {
  if (operation === "import") await migrate(sql);
  console.log(
    JSON.stringify(
      await (operation === "export"
        ? exportHistory(sql, new ArtifactStore(), directory)
        : importHistory(sql, new ArtifactStore(), directory)),
      null,
      2,
    ),
  );
} finally {
  await sql.end();
}
