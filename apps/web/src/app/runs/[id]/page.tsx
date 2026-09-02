import { currentEval, currentRun, currentSkill } from "../../../lib/data";
import { ApiAction } from "../../../components/actions";
export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = (await params).id;
  const [run, evaluation, skill] = await Promise.all([
    currentRun(id),
    currentEval(),
    currentSkill(),
  ]);
  if (!run) {
    const ready = evaluation?.status === "approved" && skill?.version;
    return (
      <div className="content">
        <div className="page-head">
          <div>
            <div className="eyebrow">Evaluation</div>
            <h1>Run a pinned evidence test</h1>
            <p className="lede">
              Every case starts fresh. The tested agent receives the selected
              Skill, never the authoring conversation or hidden expected
              answers.
            </p>
          </div>
        </div>
        <div className="grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Run configuration</h2>
              <span className={`badge ${ready ? "pass" : "provisional"}`}>
                {ready ? "Ready" : "Blocked"}
              </span>
            </div>
            <div className="panel-body">
              <dl className="facts">
                <div className="fact">
                  <dt>Skill</dt>
                  <dd>
                    {skill?.name ?? "Missing"}{" "}
                    {skill?.version ? `v${(skill.version as any).version}` : ""}
                  </dd>
                </div>
                <div className="fact">
                  <dt>Eval</dt>
                  <dd>
                    {evaluation?.version
                      ? `Approved v${evaluation.version}`
                      : "Approval required"}
                  </dd>
                </div>
                <div className="fact">
                  <dt>Engine</dt>
                  <dd>Codex · gpt-5.4</dd>
                </div>
                <div className="fact">
                  <dt>Isolation</dt>
                  <dd>Fresh execution per case</dd>
                </div>
                <div className="fact">
                  <dt>Parallelism</dt>
                  <dd>1 · sequential</dd>
                </div>
                <div className="fact">
                  <dt>Estimated calls</dt>
                  <dd>{evaluation?.cases?.length ?? 0} agent + judges</dd>
                </div>
              </dl>
            </div>
            <div className="decision-bar">
              <span>
                {ready
                  ? "Pinned checksums will be recorded."
                  : "Approve the eval suite first."}
              </span>
              {ready && (
                <ApiAction
                  url="/api/v1/runs/launch"
                  body={{
                    skillVersionId: (skill!.version as any).id,
                    evalVersionId: evaluation!.id,
                    model: "gpt-5.4",
                    iterations: 1,
                    baseline: false,
                  }}
                  label="Launch evaluation"
                  navigateTo="/runs/:resourceId"
                />
              )}
            </div>
          </section>
          <aside className="panel">
            <div className="panel-head">
              <h2>Correctness policy</h2>
            </div>
            <div className="panel-body">
              <ul className="list">
                <li>No retry for correctness failure</li>
                <li>One retry for classified infrastructure errors</li>
                <li>Result JSON is authoritative</li>
                <li>Unmapped required assertions become ERROR</li>
                <li>Flakiness never averages into PASS</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    );
  }
  const results = run.results as any[];
  const severity: Record<string, number> = {
    PASS: 0,
    PARTIAL: 1,
    FAIL: 2,
    ERROR: 3,
  };
  const displayResults = [
    ...new Set(results.map((result) => result.case_id)),
  ].map((caseId) => {
    const samples = results.filter((result) => result.case_id === caseId);
    const worst = [...samples].sort(
      (a, b) => (severity[b.result] ?? 3) - (severity[a.result] ?? 3),
    )[0];
    return {
      ...worst,
      sampleCount: samples.length,
      stable: new Set(samples.map((sample) => sample.result)).size === 1,
    };
  });
  const counts = Object.fromEntries(
    ["PASS", "PARTIAL", "FAIL", "ERROR"].map((status) => [
      status,
      displayResults.filter((r) => r.result === status).length,
    ]),
  ) as Record<"PASS" | "PARTIAL" | "FAIL" | "ERROR", number>;
  const tokens = results.reduce(
    (n, r) => n + Number(r.tokens?.input ?? 0) + Number(r.tokens?.output ?? 0),
    0,
  );
  const duration = results.reduce((n, r) => n + Number(r.duration_ms ?? 0), 0);
  return (
    <div className="content">
      <div className="page-head">
        <div>
          <div className="eyebrow">Run · {String(run.id).slice(0, 8)}</div>
          <h1>
            {run.status === "completed"
              ? "Evidence, without the false green"
              : "Evaluation in progress"}
          </h1>
          <p className="lede">
            Skill v{run.skill_version} and eval v{run.eval_version} are pinned
            by checksum. Required dimensions stay separate all the way to the
            case evidence.
          </p>
        </div>
        <span
          className={`badge ${run.status === "completed" ? "pass" : "info"}`}
        >
          {run.status}
        </span>
      </div>
      <div className="metric-row">
        <div className="metric">
          <span>Pass</span>
          <b>{counts.PASS}</b>
        </div>
        <div className="metric">
          <span>Partial</span>
          <b>{counts.PARTIAL}</b>
        </div>
        <div className="metric">
          <span>Fail</span>
          <b>{counts.FAIL}</b>
        </div>
        <div className="metric">
          <span>Error</span>
          <b>{counts.ERROR}</b>
        </div>
        <div className="metric">
          <span>Tokens</span>
          <b>{tokens.toLocaleString()}</b>
        </div>
        <div className="metric">
          <span>Duration</span>
          <b>{(duration / 1000).toFixed(1)}s</b>
        </div>
      </div>
      {run.status !== "completed" ? (
        <section className="panel">
          <div className="empty">
            <h2>Worker stage: {run.status}</h2>
            <p>
              Progress is based on completed cases, never an invented
              percentage.
            </p>
            {run.job_id && (
              <ApiAction
                url={`/api/v1/runs/${run.id}/cancel`}
                label="Cancel run"
                kind="danger"
              />
            )}
          </div>
        </section>
      ) : (
        <div className="grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Failure-first case results</h2>
              <span>
                {displayResults.length} cases · {results.length} samples
              </span>
            </div>
            <div className="panel-body" style={{ padding: 0 }}>
              <table className="case-table">
                <thead>
                  <tr>
                    <th>Result</th>
                    <th>Case</th>
                    <th>Coverage group</th>
                    <th>Failed dimensions</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {displayResults.map((result) => {
                    const failed = Object.entries(result.dimensions ?? {})
                      .filter(([, ok]) => !ok)
                      .map(([d]) => d);
                    return (
                      <tr
                        key={result.id}
                        className={result.result !== "PASS" ? "failure" : ""}
                      >
                        <td>
                          <span
                            className={`badge ${String(result.result).toLowerCase()}`}
                          >
                            {result.result}
                          </span>
                        </td>
                        <td>
                          <b>{result.case_id}</b>
                          <br />
                          {result.title} · {result.sampleCount} samples
                          {!result.stable && (
                            <>
                              <br />
                              <b>Flaky</b>
                            </>
                          )}
                        </td>
                        <td>{result.coverage_group}</td>
                        <td>{failed.length ? failed.join(" · ") : "—"}</td>
                        <td>
                          {result.result === "PARTIAL" ? (
                            <b>Target passed; scope failed</b>
                          ) : (
                            result.detail?.response
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="decision-bar">
              <span>
                {counts.FAIL + counts.PARTIAL > 0
                  ? "Actionable Skill failures found."
                  : "No actionable failures."}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <a
                  className="btn secondary"
                  href={`/api/v1/runs/${run.id}/download`}
                >
                  Raw report
                </a>
                {counts.FAIL + counts.PARTIAL > 0 && (
                  <ApiAction
                    url="/api/v1/updates/generate"
                    body={{ runId: run.id }}
                    label="Suggest update"
                    navigateTo="/improve/:resourceId"
                  />
                )}
              </div>
            </div>
          </section>
          <aside>
            <section className="panel">
              <div className="panel-head">
                <h2>Evidence boundaries</h2>
              </div>
              <div className="panel-body">
                <div className="callout">
                  Agent, judge, timeout, cancellation, and ingestion errors
                  remain distinct. A Python validator checks exact artifacts; it
                  never performs the task on Codex’s behalf.
                </div>
              </div>
            </section>
            <div style={{ height: 18 }} />
            <section className="panel">
              <div className="panel-head">
                <h2>Reproducibility</h2>
              </div>
              <div className="panel-body mono">
                model {run.model}
                <br />
                skill {String(run.skill_checksum).slice(0, 16)}
                <br />
                eval {String(run.eval_checksum).slice(0, 16)}
                <br />
                iterations {run.iterations}
                <br />
                parallelism 1
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
