import { currentEval, currentRun, currentSkill } from "../../../lib/data";
import { ApiAction } from "../../../components/actions";
import { LiveRunProgress } from "../../../components/live-run-progress";
import { RunConfiguration } from "../../../components/workflow-forms";
export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ skill?: string; eval?: string }>;
}) {
  const [route, query] = await Promise.all([params, searchParams]);
  const id = route.id;
  const run = id === "new" ? null : await currentRun(id, query.skill);
  const skillId = run?.skill_id ?? query.skill;
  const [evaluation, skill] = await Promise.all([
    currentEval(query.eval, skillId),
    currentSkill(skillId),
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
                  <dd>Codex · gpt-5.6-luna</dd>
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
                <RunConfiguration
                  skillVersionId={(skill!.version as any).id}
                  evalVersionId={evaluation!.id}
                  skillId={skill!.id}
                  cases={evaluation!.cases}
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
    ...new Set(
      results
        .filter((result) =>
          ["skill", "with_skill"].includes(result.configuration),
        )
        .map((result) => result.case_id),
    ),
  ].map((caseId) => {
    const samples = results.filter(
      (result) =>
        result.case_id === caseId &&
        ["skill", "with_skill"].includes(result.configuration),
    );
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
          <div className="eyebrow">
            Run · {String(run.id).slice(0, 8)} ·{" "}
            {run.evidenceMode === "real"
              ? "Real Codex"
              : run.evidenceMode === "demo"
                ? "Demo adapter"
                : "Unverified legacy"}
          </div>
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
        <a
          className="btn secondary"
          href={`/runs/new?skill=${run.skill_id}&eval=${run.eval_version_id}`}
        >
          New run
        </a>
      </div>
      {(run.evidenceMode !== "real" ||
        run.provenance_status === "legacy_unverified") && (
        <div className="mode-banner demo" role="status">
          <b>
            {run.evidenceMode === "demo"
              ? "Demo evidence"
              : "Imported history — not reverified"}
          </b>
          {run.evidenceMode === "demo"
            ? "These results were generated by the deterministic test adapter, not by Codex."
            : "This run predates adapter provenance, so SkillEd will not present it as a real Codex run."}
        </div>
      )}
      {run.baseline && (
        <details className="panel">
          <summary className="panel-head">
            Baseline benefit — results without the Skill
          </summary>
          <div className="panel-body">
            <p>
              Baseline samples are separate from the Skill score and
              repeated-trial stability.
            </p>
            <table className="case-table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Trial</th>
                  <th>Without Skill</th>
                </tr>
              </thead>
              <tbody>
                {results
                  .filter((sample) =>
                    ["baseline", "without_skill"].includes(
                      sample.configuration,
                    ),
                  )
                  .map((sample) => (
                    <tr key={sample.id}>
                      <td>{sample.case_id}</td>
                      <td>{sample.iteration}</td>
                      <td>{sample.result}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {!["completed", "failed", "cancelled", "interrupted"].includes(
        run.status,
      ) ? (
        <LiveRunProgress runId={String(run.id)} />
      ) : run.status === "completed" ? (
        <>
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
                          <td data-label="Result">
                            <span
                              className={`badge ${String(result.result).toLowerCase()}`}
                            >
                              {result.result}
                            </span>
                          </td>
                          <td data-label="Case">
                            <div>
                              <b>{result.case_id}</b>
                              <br />
                              {result.title} · {result.sampleCount} samples
                              {!result.stable && (
                                <>
                                  <br />
                                  <b>Flaky</b>
                                </>
                              )}
                            </div>
                          </td>
                          <td data-label="Coverage group">
                            {result.coverage_group}
                          </td>
                          <td data-label="Failed dimensions">
                            {failed.length ? failed.join(" · ") : "—"}
                          </td>
                          <td data-label="Evidence">
                            <details>
                              <summary>
                                {failed.length
                                  ? `Failed: ${failed.join(", ")}`
                                  : "Assertion evidence"}
                              </summary>
                              {results
                                .filter(
                                  (sample) => sample.case_id === result.case_id,
                                )
                                .map((sample) => (
                                  <div key={sample.id}>
                                    <b>
                                      {sample.configuration} · trial{" "}
                                      {sample.iteration} · {sample.result}
                                    </b>
                                    <ul>
                                      {sample.assertions?.map(
                                        (assertion: any, n: number) => (
                                          <li key={assertion.id ?? n}>
                                            {assertion.id} ·{" "}
                                            {assertion.dimension} ·{" "}
                                            {assertion.passed ? "PASS" : "FAIL"}
                                            <pre
                                              style={{ whiteSpace: "pre-wrap" }}
                                            >
                                              {assertion.evidence ??
                                                assertion.error}
                                            </pre>
                                          </li>
                                        ),
                                      )}
                                    </ul>
                                    <p>{sample.detail?.error}</p>
                                    <ul>
                                      {sample.artifacts?.map(
                                        (artifact: any) => (
                                          <li key={artifact.key}>
                                            <a
                                              href={`/api/v1/runs/${run.id}/artifact?key=${encodeURIComponent(artifact.key)}`}
                                            >
                                              {artifact.key.split("/").pop()}
                                            </a>{" "}
                                            · {artifact.size} bytes
                                          </li>
                                        ),
                                      )}
                                    </ul>
                                    <pre style={{ whiteSpace: "pre-wrap" }}>
                                      {sample.detail?.response}
                                    </pre>
                                  </div>
                                ))}
                            </details>
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
                      navigateTo={`/improve/:resourceId?skill=${run.skill_id}`}
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
                    remain distinct. A Python validator checks exact artifacts;
                    it never performs the task on Codex’s behalf.
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
        </>
      ) : (
        <section className="panel">
          <div className="empty">
            <h2>Evaluation {run.status}</h2>
            <p>
              Evidence recorded before the run stopped remains available for
              inspection and download.
            </p>
            {run.raw_report_key && (
              <a
                className="btn secondary"
                href={`/api/v1/runs/${run.id}/download`}
              >
                Download partial evidence
              </a>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
