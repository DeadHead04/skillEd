import { headers } from "next/headers";
import {
  db,
  serviceEndpoint,
  TOOLCHAIN_CAPABILITIES,
  requireStorage,
} from "@skilled/core";
export const dynamic = "force-dynamic";
export default async function Diagnostics() {
  const context = await headers();
  if (context.get("x-skilled-user-role") !== "administrator")
    return (
      <div className="content">
        <h1>Administrator access required</h1>
      </div>
    );
  const sql = db();
  try {
    const [worker] =
      await sql`SELECT * FROM worker_heartbeats ORDER BY last_seen_at DESC LIMIT 1`;
    const queue =
      await sql`SELECT status,count(*)::integer count,extract(epoch FROM now()-min(created_at)) oldest_seconds FROM jobs GROUP BY status`;
    const [metrics] =
      await sql`SELECT count(*) FILTER(WHERE error_class IS NOT NULL)::integer validator_errors,avg(duration_ms) average_sample_ms FROM case_results`;
    const [jobMetrics] =
      await sql`SELECT avg(extract(epoch FROM completed_at-started_at)) FILTER(WHERE completed_at IS NOT NULL) average_execution_seconds, max(extract(epoch FROM completed_at-cancel_requested_at)) FILTER(WHERE cancel_requested_at IS NOT NULL) maximum_cancellation_seconds FROM jobs`;
    let storage: unknown;
    try {
      const remote = serviceEndpoint("ARTIFACT");
      storage = remote
        ? await (
            await fetch(remote + "/health", {
              signal: AbortSignal.timeout(5000),
              cache: "no-store",
            })
          ).json()
        : await requireStorage(
            process.env.ARTIFACT_ROOT ?? "/data/artifacts",
            0,
          );
    } catch {
      storage = { status: "unavailable" };
    }
    const fresh =
      worker && Date.now() - new Date(worker.last_seen_at).getTime() < 30_000;
    return (
      <div className="content">
        <h1>Installation diagnostics</h1>
        <p>
          The browser and saved history remain available when execution is
          blocked.
        </p>
        <section className="panel">
          <div className="panel-head">
            <h2>
              {fresh && worker.readiness.execution === "ready"
                ? "Execution ready"
                : fresh && worker.readiness.execution === "demo"
                  ? "Demo evidence"
                  : "Execution unavailable"}
            </h2>
          </div>
          <div className="panel-body">
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(
                {
                  worker: fresh ? "connected" : "missing or stale",
                  readiness: worker?.readiness,
                  versions: worker?.versions,
                  storage,
                  metrics,
                  jobMetrics,
                },
                null,
                2,
              )}
            </pre>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Queue</h2>
          </div>
          <div className="panel-body">
            <table className="case-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Jobs</th>
                  <th>Oldest age</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((row) => (
                  <tr key={row.status}>
                    <td>{row.status}</td>
                    <td>{row.count}</td>
                    <td>{Math.round(Number(row.oldest_seconds))} seconds</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <details className="panel">
          <summary className="panel-head">Toolchain and pilot limits</summary>
          <div className="panel-body">
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(TOOLCHAIN_CAPABILITIES, null, 2)}
            </pre>
            <p>
              Login recovery must use the official Codex login flow directly on
              the executor. No desktop credential file is imported.
            </p>
          </div>
        </details>
      </div>
    );
  } finally {
    await sql.end();
  }
}
