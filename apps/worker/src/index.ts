import { db, ensureSchema } from "@skilled/core";
import { randomUUID } from "node:crypto";
import { reconcileJobs } from "./jobs.js";
import { stopExecutions } from "./process.js";
import { codexAppServer } from "./app-server.js";
import { isTickBusy, stopTicking, tick } from "./tick/index.js";

const sql = db();
const workerId = `worker-${randomUUID()}`;
let shuttingDown = false;

await ensureSchema(sql);

await reconcileJobs(sql);

const reconcileTimer = setInterval(
  () =>
    void reconcileJobs(sql).catch((error) =>
      console.error("Job reconciliation failed", error),
    ),
  10_000,
);

const tickTimer = setInterval(() => void tick(sql, workerId), 1000);

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  stopTicking();
  clearInterval(tickTimer);
  clearInterval(reconcileTimer);
  stopExecutions();
  await codexAppServer.stop();
  const deadline = Date.now() + 90_000;
  while (isTickBusy() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 200));
  stopExecutions("SIGKILL");
  await sql.end({ timeout: 5 });
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());

process.on("SIGINT", () => void shutdown());

await tick(sql, workerId);
