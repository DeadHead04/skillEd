// Private durable evaluation worker. Launched only by the MCP job manager.
import { executeJob } from "./jobs.js";
await executeJob(process.argv[2], process.argv[3]);
