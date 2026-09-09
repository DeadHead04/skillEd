import { headers } from "next/headers";
import {
  db,
  serviceEndpoint,
  TOOLCHAIN_CAPABILITIES,
  requireStorage,
} from "@skilled/core";
import { Status, Verdict, Work } from "../../components/ui";
import { humanize } from "../../lib/labels";
import { executionAvailability } from "../../lib/execution-availability";

export const dynamic = "force-dynamic";

export default async function Diagnostics() {
  const context = await headers();
  if (context.get("x-skilled-user-role") !== "administrator")
    return (
      <Work>
        <Verdict
          title="Administrator access required"
          lede="Diagnostics expose worker, queue and storage state, so they are limited to administrators."
        />
      </Work>
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
    let storage: any;
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
    const execution = fresh ? worker.readiness?.execution : null;
    const availability = executionAvailability(worker as any);

    return (
      <Work>
        <Verdict
          title="Installation diagnostics"
          lede="The browser and saved history stay available even when execution is blocked, so a failure here never loses evidence."
          status={
            <Status
              value={
                execution === "ready"
                  ? "pass"
                  : execution === "demo"
                    ? "partial"
                    : "fail"
              }
              label={
                execution === "ready"
                  ? "Execution ready"
                  : execution === "demo"
                    ? "Demo evidence only"
                    : "Execution unavailable"
              }
            />
          }
        />

        {!availability.available && (
          <section className="section" aria-label="Execution setup blocker">
            <h2>Execution setup needs attention</h2>
            <p className="error-box" role="status">
              {availability.detail}
            </p>
            <p className="hint">
              Reason: {availability.code}. Retrying generation cannot repair
              this prerequisite.
            </p>
            <p>
              Run <code>./scripts/check-execution.sh</code> from the same
              Compose project, or{" "}
              <code>node --import tsx apps/worker/src/readiness-cli.ts</code>{" "}
              inside the executor. This only checks setup and login status; it
              does not call a model.
            </p>
          </section>
        )}
        {fresh && worker.readiness?.checks?.length > 0 && (
          <section className="section" aria-label="Isolation acceptance checks">
            <h2>Isolation acceptance</h2>
            <p className="hint">
              Checked {worker.readiness.checkedAt ?? "Unknown"} · Expires{" "}
              {worker.readiness.expiresAt ?? "Unknown"}
            </p>
            <div className="rows">
              {worker.readiness.checks.map(
                (check: { name: string; status: string }) => (
                  <div className="row plain" key={check.name}>
                    <span>{humanize(check.name)}</span>
                    <span>{humanize(check.status)}</span>
                  </div>
                ),
              )}
            </div>
          </section>
        )}

        <section className="section" style={{ marginTop: 22 }}>
          <div className="section-head">
            <h2>Worker</h2>
            <span className="section-note">
              {fresh ? "Connected" : "Missing or stale"}
            </span>
          </div>
          <dl className="kv" style={{ marginTop: 12 }}>
            <div>
              <dt>Skill-Up</dt>
              <dd>
                {worker?.versions?.executor && execution !== "ready"
                  ? "Not checked on executor"
                  : worker?.readiness?.skillUp
                    ? "Available"
                    : "Missing"}
              </dd>
            </div>
            <div>
              <dt>Codex login</dt>
              <dd>
                {worker?.readiness?.codexLogin === "not_checked"
                  ? "Not checked — isolation is blocked"
                  : humanize(worker?.readiness?.codexLogin ?? "Unknown")}
              </dd>
            </div>
            <div>
              <dt>Node</dt>
              <dd className="mono">{worker?.versions?.node ?? "—"}</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>{humanize(String(storage?.status ?? "ready"))}</dd>
            </div>
            <div>
              <dt>Validator errors</dt>
              <dd className="num">{metrics?.validator_errors ?? 0}</dd>
            </div>
            <div>
              <dt>Average sample</dt>
              <dd className="num">
                {metrics?.average_sample_ms
                  ? `${(Number(metrics.average_sample_ms) / 1000).toFixed(1)}s`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Average execution</dt>
              <dd className="num">
                {jobMetrics?.average_execution_seconds
                  ? `${Number(jobMetrics.average_execution_seconds).toFixed(1)}s`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Slowest cancellation</dt>
              <dd className="num">
                {jobMetrics?.maximum_cancellation_seconds
                  ? `${Number(jobMetrics.maximum_cancellation_seconds).toFixed(1)}s`
                  : "—"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Queue</h2>
            <span className="section-note num">
              {queue.reduce((n, row) => n + Number(row.count), 0)} jobs
            </span>
          </div>
          <div className="rows">
            {queue.map((row) => (
              <div className="row plain" key={row.status}>
                <span>
                  <span className="title">{humanize(String(row.status))}</span>
                  <span className="sub">
                    oldest {Math.round(Number(row.oldest_seconds))} seconds
                  </span>
                </span>
                <span className="file-size num">{row.count}</span>
              </div>
            ))}
            {queue.length === 0 && <p className="hint">The queue is empty.</p>}
          </div>
        </section>

        <details className="section">
          <summary className="section-note" style={{ cursor: "pointer" }}>
            Toolchain and pilot limits
          </summary>
          <div style={{ marginTop: 12 }}>
            <pre className="file-view">
              {JSON.stringify(TOOLCHAIN_CAPABILITIES, null, 2)}
            </pre>
            <p className="hint" style={{ marginTop: 12 }}>
              Login recovery must use the official Codex login flow directly on
              the executor. No desktop credential file is imported.
            </p>
          </div>
        </details>
      </Work>
    );
  } finally {
    await sql.end();
  }
}
