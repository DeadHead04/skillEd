import Link from "next/link";
import { ArtifactPreview } from "../../../components/artifact-preview";
import {
  summarizeAreaEvidence,
  worstResult,
  type Result,
  type JudgingArea,
} from "@skilled/core";
import {
  currentEval,
  currentRun,
  currentSkill,
  studioHealth,
} from "../../../lib/data";
import { ApiAction } from "../../../components/actions";
import { RunConfiguration } from "../../../components/workflow-forms";
import { LiveRunProgress } from "../../../components/live-run-progress";
import {
  Assertions,
  Inspector,
  Status,
  Verdict,
  Work,
} from "../../../components/ui";
import { EvidenceChart } from "../../../components/evidence-chart";
import {
  EvidenceNavigation,
  EvidenceOutcomeFilters,
} from "../../../components/evidence-navigation";
import { humanize } from "../../../lib/labels";
export const dynamic = "force-dynamic";
export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    skill?: string;
    eval?: string;
    case?: string;
    status?: string;
    dim?: string;
    trial?: string;
    configuration?: string;
    view?: string;
    evidenceTrial?: string;
  }>;
}) {
  const [route, query] = await Promise.all([params, searchParams]);
  const run =
    route.id === "new" ? null : await currentRun(route.id, query.skill);
  const skillId = run?.skill_id ?? query.skill;
  const evaluation = await currentEval(
    run?.eval_version_id ?? query.eval,
    skillId,
  );
  const skill = await currentSkill(
    skillId,
    run?.skill_version_id ?? evaluation?.skill_version_id,
  );
  if (!run) {
    const health = await studioHealth();
    const ready = evaluation?.status === "approved" && skill?.version;
    return (
      <Work>
        <div className="eyebrow">RUN CONFIGURATION</div>
        <Verdict
          title="Put your Skill to the test."
          lede="Choose approved cases, repeated trials, and an optional comparison without the Skill."
        />
        <div className="assessment-strip">
          <div>
            <small>PACKAGE</small>
            <strong>
              {skill?.name ?? "None selected"} · v
              {skill?.version?.version ?? "—"}
            </strong>
          </div>
          <div>
            <small>TEST PLAN</small>
            <strong>
              {evaluation?.version
                ? `Approved v${evaluation.version}`
                : "Approval needed"}
            </strong>
          </div>
          <div>
            <small>EXECUTION</small>
            <strong>
              {health.execution === "demo"
                ? "Demo evidence"
                : health.execution === "ready"
                  ? "Available"
                  : "Execution unavailable"}
            </strong>
          </div>
          <div>
            <small>MODEL</small>
            <strong>gpt-5.6-luna</strong>
          </div>
        </div>
        {health.execution === "demo" && (
          <p className="notice" role="status">
            <b>Demo evidence</b> This installation runs deterministic examples
            without model calls.
          </p>
        )}
        {ready ? (
          <section className="studio-panel">
            <div className="panel-heading">
              <h2>Choose what to run</h2>
              <span className="section-note">Up to 50 cases · 3 trials</span>
            </div>
            <RunConfiguration
              skillVersionId={skill.version.id}
              evalVersionId={evaluation.id}
              skillId={skill.id}
              cases={evaluation.cases}
            />
          </section>
        ) : (
          <div className="studio-empty">
            <h2>Approve a test plan first</h2>
            <p>Execution uses an immutable package and approved tests.</p>
            <Link
              className="btn"
              href={`/evals/current?skill=${skillId ?? ""}`}
            >
              Open test plan
            </Link>
          </div>
        )}
      </Work>
    );
  }
  if (!["completed", "failed", "cancelled", "interrupted"].includes(run.status))
    return (
      <Work>
        <Verdict
          title="Evaluation in progress"
          lede={`Skill v${run.skill_version} · Test plan v${run.eval_version}. Progress is saved as each case finishes.`}
          status={<Status value="active" label={humanize(run.status)} />}
        />
        <LiveRunProgress runId={String(run.id)} />
      </Work>
    );
  const results = run.results as any[];
  const cases = (evaluation?.cases ?? []).filter((c: any) =>
    (
      run.settings?.selectedCaseIds ??
      (evaluation?.cases ?? [])
        .filter((v: any) => v.enabled)
        .map((v: any) => v.case_id)
    ).includes(c.case_id),
  );
  const expected = cases.length * run.iterations * (run.baseline ? 2 : 1);
  const areas: JudgingArea[] = evaluation?.coverage_plan?.areas ?? [];
  const summary = summarizeAreaEvidence(areas, cases, results, run.iterations);
  const evidenceTrial = Number(query.evidenceTrial);
  const selectedTrial =
    Number.isInteger(evidenceTrial) &&
    evidenceTrial >= 1 &&
    evidenceTrial <= run.iterations
      ? evidenceTrial
      : undefined;
  const view =
    run.baseline && ["baseline", "compare"].includes(query.view ?? "")
      ? query.view!
      : "skill";
  const variant = view === "baseline" ? "baseline" : "skill";
  const selectedArea = summary.some((a) => a.id === query.dim)
    ? query.dim
    : undefined;
  const series = [
    0,
    ...Array.from({ length: run.iterations }, (_, i) => i + 1),
  ].map((trial) => ({
    trial,
    skill: summarizeAreaEvidence(
      areas,
      cases,
      results,
      run.iterations,
      "skill",
      trial || undefined,
    ),
    ...(run.baseline
      ? {
          baseline: summarizeAreaEvidence(
            areas,
            cases,
            results,
            run.iterations,
            "baseline",
            trial || undefined,
          ),
        }
      : {}),
  }));
  const activeSeries = series.find((s) => s.trial === (selectedTrial ?? 0))!;
  const displaySummary =
    variant === "baseline" ? activeSeries.baseline! : activeSeries.skill;
  const base = `/runs/${run.id}?skill=${run.skill_id}`;
  const evidenceHref = (
    patch: Record<string, string | number | undefined> = {},
  ) => {
    const values: Record<string, string | number | undefined> = {
      skill: run.skill_id,
      dim: selectedArea,
      status: query.status,
      view: view === "skill" ? undefined : view,
      evidenceTrial: selectedTrial,
      ...patch,
    };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (value !== undefined) params.set(key, String(value));
    return `/runs/${run.id}?${params}`;
  };
  const caseHref = (
    caseId: string,
    config = variant,
    trial = selectedTrial ?? 1,
  ) => evidenceHref({ case: caseId, configuration: config, trial });
  const skillSamples = results.filter((r) =>
    ["skill", "with_skill"].includes(r.configuration),
  );
  const perCase = cases.map((c: any) => {
    const rows = skillSamples.filter((r) => r.case_id === c.case_id);
    const complete =
      rows.length === run.iterations &&
      new Set(rows.map((r) => r.iteration)).size === run.iterations;
    const result: Result = complete
      ? worstResult(rows.map((r) => r.result))
      : "ERROR";
    const signatures = rows.map((r) =>
      JSON.stringify(
        (r.assertions ?? [])
          .filter((a: any) => a.required !== false)
          .map((a: any) => [a.id, a.passed, a.error ?? null])
          .sort((a: any, b: any) => String(a[0]).localeCompare(String(b[0]))),
      ),
    );
    return {
      ...c,
      rows,
      result,
      complete,
      stable:
        complete &&
        rows.every((r) => r.result !== "ERROR") &&
        new Set(signatures).size === 1,
    };
  });
  const passing = perCase.filter((c: any) => c.result === "PASS").length;
  const actionable = perCase.filter((c: any) =>
    ["FAIL", "PARTIAL"].includes(c.result),
  ).length;
  const scopedCases = cases.map((c: any) => {
    const rows = results.filter(
      (r) =>
        r.case_id === c.case_id &&
        (variant === "baseline"
          ? ["baseline", "without_skill"]
          : ["skill", "with_skill"]
        ).includes(r.configuration) &&
        (!selectedTrial || r.iteration === selectedTrial),
    );
    const trials = selectedTrial
      ? [selectedTrial]
      : Array.from({ length: run.iterations }, (_, i) => i + 1);
    const complete = trials.every(
      (n) => rows.filter((r) => r.iteration === n).length === 1,
    );
    const evidence = summarizeAreaEvidence(
      areas,
      [c],
      results,
      run.iterations,
      variant,
      selectedTrial,
    );
    return {
      ...c,
      rows,
      complete,
      result:
        complete && evidence.every((a) => !a.error && !a.missing)
          ? worstResult(rows.map((r) => r.result))
          : "ERROR",
      evidence,
      baselineEvidence:
        view === "compare"
          ? summarizeAreaEvidence(
              areas,
              [c],
              results,
              run.iterations,
              "baseline",
              selectedTrial,
            )
          : undefined,
    };
  });
  const visible = scopedCases.filter(
    (c: any) =>
      (!query.status || c.result === query.status) &&
      (!selectedArea ||
        c.evidence.some((a: any) => a.id === selectedArea && a.expected > 0)),
  );
  const caseAreaHref = (caseId: string, areaId: string, config: string) => {
    const testCase = cases.find((c: any) => c.case_id === caseId);
    const firstProblemTrial = Array.from(
      { length: run.iterations },
      (_, i) => i + 1,
    ).find((n) =>
      summarizeAreaEvidence(
        areas,
        [testCase],
        results,
        run.iterations,
        config,
        n,
      ).some((a) => a.id === areaId && a.fail + a.error + a.missing > 0),
    );
    return caseHref(caseId, config, selectedTrial ?? firstProblemTrial ?? 1);
  };
  const openCase = perCase.find((c: any) => c.case_id === query.case);
  const openRows = results.filter(
    (r) =>
      r.case_id === query.case &&
      (query.configuration === "baseline"
        ? ["baseline", "without_skill"]
        : ["skill", "with_skill"]
      ).includes(r.configuration),
  );
  const sample = openRows.find((r) => r.iteration === Number(query.trial ?? 1));
  const inspector = openCase ? (
    <Inspector
      title={openCase.title}
      subtitle={`${openCase.case_id} · Skill v${run.skill_version}`}
      closeHref={evidenceHref()}
    >
      <div className="filters">
        {Array.from({ length: run.iterations }, (_, i) => (
          <Link
            key={i}
            className={`filter ${Number(query.trial ?? 1) === i + 1 ? "on" : ""}`}
            href={caseHref(
              openCase.case_id,
              query.configuration === "baseline" ? "baseline" : "skill",
              i + 1,
            )}
          >
            Trial {i + 1}
          </Link>
        ))}
      </div>
      {run.baseline && (
        <div className="filters">
          <Link
            href={caseHref(openCase.case_id, "skill", Number(query.trial ?? 1))}
          >
            With Skill
          </Link>
          <Link
            href={caseHref(
              openCase.case_id,
              "baseline",
              Number(query.trial ?? 1),
            )}
          >
            Without Skill
          </Link>
        </div>
      )}
      {sample ? (
        <>
          <Status value={sample.result} />
          <div className="evidence-label">Assertion evidence</div>
          <Assertions assertions={sample.assertions ?? []} />
          <div className="evidence-label">Actual response</div>
          <pre className="file-view">
            {sample.detail?.response ?? "No response recorded"}
          </pre>
          {sample.error_class && (
            <div className="error-box">
              {sample.error_class}: {sample.detail?.error}
            </div>
          )}
          <details>
            <summary>Prompt and provenance</summary>
            <pre className="file-view">
              {sample.detail?.prompt ?? openCase.source?.prompt}
            </pre>
          </details>
          {(sample.artifacts ?? []).length > 0 && (
            <ArtifactPreview runId={run.id} artifacts={sample.artifacts} />
          )}
        </>
      ) : (
        <p className="hint">
          No evidence was recorded for this trial. It cannot count as passing.
        </p>
      )}
    </Inspector>
  ) : undefined;
  return (
    <EvidenceNavigation
      base={base}
      area={selectedArea}
      view={view}
      trial={selectedTrial ?? 0}
      status={query.status}
    >
      <Work inspector={inspector}>
        <div className="eyebrow">
          RESULTS · SKILL V{run.skill_version} · TEST PLAN V{run.eval_version}
        </div>
        <Verdict
          title="What the evidence shows"
          status={
            <Status
              value={
                run.status !== "completed"
                  ? "error"
                  : actionable
                    ? "partial"
                    : passing === cases.length && cases.length
                      ? "pass"
                      : "error"
              }
              label={
                run.status !== "completed"
                  ? humanize(run.status)
                  : actionable
                    ? "Action needed"
                    : passing === cases.length && cases.length
                      ? "Required checks passed"
                      : "Evidence needs attention"
              }
            />
          }
        />
        {(run.evidenceMode !== "real" ||
          run.provenance_status === "legacy_unverified") && (
          <p className="notice" role="status">
            <b>
              {run.provenance_status === "legacy_unverified"
                ? "Imported history — not reverified"
                : run.evidenceMode === "demo"
                  ? "Demo evidence"
                  : "Unverified evidence"}
            </b>
            {run.evidenceMode === "demo"
              ? "Deterministic fixture results. No Codex execution occurred."
              : "Rerun through the current pipeline before using this evidence for release."}
          </p>
        )}
        <div className="headline-figure">
          <b className="num">
            {passing}/{cases.length}
          </b>
          <span>
            cases passing across {run.iterations}{" "}
            {run.iterations === 1 ? "trial" : "trials"}
            <br />
            {results.length}/{expected} execution samples recorded ·{" "}
            {humanize(run.status)}
          </span>
        </div>
        {summary.length ? (
          <EvidenceChart series={series} />
        ) : (
          <div className="studio-empty compact">
            <h2>Not evaluated</h2>
            <p>No assertion definitions are available for this run.</p>
          </div>
        )}
        <section
          className="section"
          id="case-evidence"
          aria-label="Case evidence"
        >
          <div className="section-head">
            <h2>Case evidence</h2>
            <span className="section-note">
              {visible.length} of {cases.length} cases ·{" "}
              {view === "compare"
                ? "Both configurations"
                : variant === "baseline"
                  ? "Without Skill"
                  : "With Skill"}{" "}
              · {selectedTrial ? `Trial ${selectedTrial}` : "All trials"}
            </span>
          </div>
          <EvidenceOutcomeFilters />
          {view === "compare" && (
            <p className="chart-caption">
              Outcome filters use the Skill result. Each area shows both matched
              configurations.
            </p>
          )}
          <div className="evidence-scroll">
            <table className="matrix">
              <thead>
                <tr>
                  <th>Case</th>
                  {displaySummary
                    .filter((a) => !selectedArea || a.id === selectedArea)
                    .map((a) => (
                      <th key={a.id}>{a.label}</th>
                    ))}
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {!visible.length && (
                  <tr>
                    <td
                      colSpan={
                        displaySummary.filter(
                          (a) => !selectedArea || a.id === selectedArea,
                        ).length + 2
                      }
                    >
                      No cases match these filters. Choose another outcome or
                      reset the chart view.
                    </td>
                  </tr>
                )}
                {visible.map((c: any) => (
                  <tr key={c.case_id}>
                    <td>
                      <Link href={caseHref(c.case_id)}>{c.title}</Link>
                    </td>
                    {displaySummary
                      .filter((a) => !selectedArea || a.id === selectedArea)
                      .map((a) => (
                        <td key={a.id}>
                          {(view === "compare"
                            ? ["skill", "baseline"]
                            : [variant]
                          ).map((config) => {
                            const value = (
                              config === "baseline" && view === "compare"
                                ? c.baselineEvidence
                                : c.evidence
                            ).find((v: any) => v.id === a.id);
                            const label = !value.expected
                              ? "Not applicable"
                              : value.missing
                                ? `${value.missing} missing`
                                : value.error
                                  ? `${value.error} errors`
                                  : value.fail
                                    ? `${value.fail} failed`
                                    : `${value.pass}/${value.expected} passed`;
                            return (
                              <Link
                                key={config}
                                className={`matrix-observation ${!value.expected ? "untested" : value.missing || value.error ? "ERROR" : value.fail ? "FAIL" : "PASS"}`}
                                href={caseAreaHref(c.case_id, a.id, config)}
                                aria-label={`${a.label}, ${config === "baseline" ? "Without Skill" : "With Skill"}: ${label}`}
                              >
                                {view === "compare" && (
                                  <small>
                                    {config === "baseline" ? "Without" : "With"}{" "}
                                    Skill
                                  </small>
                                )}
                                {label}
                              </Link>
                            );
                          })}
                        </td>
                      ))}
                    <td>
                      <Status
                        value={c.result}
                        flaky={
                          !selectedTrial &&
                          run.iterations > 1 &&
                          c.complete &&
                          c.rows.every((r: any) => r.result !== "ERROR") &&
                          new Set(
                            c.rows.map((r: any) =>
                              JSON.stringify(
                                (r.assertions ?? [])
                                  .filter((a: any) => a.required !== false)
                                  .map((a: any) => [a.id, a.passed, a.error])
                                  .sort(),
                              ),
                            ),
                          ).size > 1
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="section" aria-label="Repeated-trial stability">
          <div className="section-head">
            <h2>Repeated-trial stability</h2>
            <span className="section-note">
              {run.iterations > 1
                ? "With Skill · all trials"
                : "Not measured — one trial"}
            </span>
          </div>
          {run.iterations > 1 && (
            <div className="evidence-scroll">
              <table className="matrix">
                <thead>
                  <tr>
                    <th>Case</th>
                    {Array.from({ length: run.iterations }, (_, i) => (
                      <th key={i}>Trial {i + 1}</th>
                    ))}
                    <th>Stability</th>
                  </tr>
                </thead>
                <tbody>
                  {perCase
                    .filter((c: any) =>
                      visible.some((v: any) => v.case_id === c.case_id),
                    )
                    .map((c: any) => (
                      <tr key={c.case_id}>
                        <td>{c.title}</td>
                        {Array.from({ length: run.iterations }, (_, i) => (
                          <td key={i}>
                            <Link href={caseHref(c.case_id, "skill", i + 1)}>
                              <Status
                                value={
                                  c.rows.find((r: any) => r.iteration === i + 1)
                                    ?.result ?? "absent"
                                }
                                label={
                                  c.rows.find((r: any) => r.iteration === i + 1)
                                    ?.result ?? "Missing"
                                }
                              />
                            </Link>
                          </td>
                        ))}
                        <td>
                          {!c.complete ||
                          c.rows.some((r: any) => r.result === "ERROR")
                            ? "Unknown"
                            : c.stable
                              ? "Stable"
                              : "Varied"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {run.baseline && (
          <section className="section">
            <div className="section-head">
              <h2>Benefit of using the Skill</h2>
              <span className="section-note">
                Matched cases ·{" "}
                {selectedTrial ? `Trial ${selectedTrial}` : "All trials"}
              </span>
            </div>
            <div className="evidence-scroll">
              <table className="matrix">
                <thead>
                  <tr>
                    <th>Judging area</th>
                    <th>With Skill</th>
                    <th>Without Skill</th>
                  </tr>
                </thead>
                <tbody>
                  {activeSeries
                    .baseline!.filter(
                      (a) => !selectedArea || a.id === selectedArea,
                    )
                    .map((a) => (
                      <tr key={a.id}>
                        <td>
                          <Link href={evidenceHref({ dim: a.id })}>
                            {a.label}
                          </Link>
                        </td>
                        <td>
                          {activeSeries.skill.find((v) => v.id === a.id)?.pass}/
                          {a.expected} passed
                        </td>
                        <td>
                          {a.pass}/{a.expected} passed · {a.error + a.missing}{" "}
                          unavailable
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <div className="decision">
          <div>
            <b>
              {actionable
                ? `${actionable} cases need an improvement`
                : "Continue testing or inspect the evidence"}
            </b>
            <p>
              {actionable
                ? "Review a proposed package change, then verify it against the same approved checks."
                : "Every run and its original evidence remain available."}
            </p>
          </div>
          {actionable > 0 && (
            <ApiAction
              url="/api/v1/updates/generate"
              body={{ runId: run.id }}
              label="Suggest update"
              navigateTo={`/improve/:resourceId?skill=${run.skill_id}`}
            />
          )}
          <Link
            className="btn secondary"
            href={`/runs/new?skill=${run.skill_id}&eval=${run.eval_version_id}`}
          >
            Start another run
          </Link>
        </div>
        {!skill?.active_version_id &&
          run.status === "completed" &&
          passing === cases.length &&
          cases.length > 0 &&
          run.iterations === 3 && (
            <div className="decision">
              <div>
                <b>Initial verification complete</b>
                <p>
                  All required checks passed in three trials. No improvement
                  comparison is claimed.
                </p>
              </div>
              <ApiAction
                url={`/api/v1/skill/versions/${run.skill_version_id}/activate-initial`}
                body={{ runId: run.id, expectedActiveVersionId: null }}
                label="Activate tested version"
                navigateTo={`/release?skill=${run.skill_id}`}
              />
            </div>
          )}
        <details className="section">
          <summary>Run provenance and downloads</summary>
          <dl className="kv">
            <div>
              <dt>Model</dt>
              <dd>{run.model}</dd>
            </div>
            <div>
              <dt>Skill checksum</dt>
              <dd className="mono">{run.skill_checksum}</dd>
            </div>
            <div>
              <dt>Eval checksum</dt>
              <dd className="mono">{run.eval_checksum}</dd>
            </div>
          </dl>
          <a className="btn quiet" href={`/api/v1/runs/${run.id}/download`}>
            Download raw report
          </a>
        </details>
      </Work>
    </EvidenceNavigation>
  );
}
