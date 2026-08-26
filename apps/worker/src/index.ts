import { claimImportJob, closeDb, expireStaleImports } from "@skilled/db";
import { processImportJob, removeExpiredStaging } from "./processor";

let stopping = false;
const stop = () => {
  stopping = true;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function pause(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

while (!stopping) {
  const expired = await expireStaleImports();
  if (expired.length > 0) await removeExpiredStaging(expired);
  const job = await claimImportJob();
  if (job) await processImportJob(job);
  else await pause(750);
}

await closeDb();
