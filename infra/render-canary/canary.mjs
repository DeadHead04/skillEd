import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
let report;
try {
  const result = await execute(
    "python3",
    ["/opt/skilled/isolation-canary.py"],
    { timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
  report = JSON.parse(result.stdout);
} catch (error) {
  try {
    report = JSON.parse(error.stdout);
  } catch {
    report = {
      status: "blocked",
      detail:
        "Isolation canary could not complete; inspect executor diagnostics.",
    };
  }
}
console.log(JSON.stringify(report));
if (process.env.SKILLED_CANARY_ONCE === "true") {
  // The preliminary probe measures isolation; authenticated acceptance is a
  // separate command and is the only producer of a ready execution report.
  process.exitCode = report.deterministicReady ? 0 : 1;
} else {
  createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.url === "/health"
          ? { status: "alive", execution: report.status }
          : report,
      ),
    );
  }).listen(Number(process.env.PORT ?? 10000), "0.0.0.0");
}
