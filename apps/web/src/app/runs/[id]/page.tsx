import Link from "next/link";
import { currentEval, currentRun, currentSkill } from "../../../lib/data";
import { ApiAction } from "../../../components/actions";
import { RunConfiguration } from "../../../components/workflow-forms";
import { LiveRunProgress } from "../../../components/live-run-progress";
import {
  Assertions,
  Inspector,
  Metrics,
  Status,
  Verdict,
  Work,
} from "../../../components/ui";
import {
  dimensionLabels,
  dimensionMetrics,
  evidenceModeCopy,
  humanize,
} from "../../../lib/labels";

export const dynamic = "force-dynamic";

const severity: Record<string, number> = {
  PASS: 0,
  PARTIAL: 1,
  FAIL: 2,
  ERROR: 3,
};

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
  }>;
}) {
  const [route, query] = await Promise.all([params, searchParams]);
  // /runs/new always configures a fresh run rather than reopening the last one.
  const run =
    route.id === "new" ? null : await currentRun(route.id, query.skill);
  const skillId = run?.skill_id ?? query.skill;
  const [evaluation, skill] = await Promise.all([
    currentEval(query.eval, skillId),
    currentSkill(skillId),
  ]);

  /* ------------------------------------------------------------- launch */
  if (!run) {
    const ready = evaluation?.status === "approved" && skill?.version;
    const cases = evaluation?.cases?.length ?? 0;
    return (
      <Work>
        <Verdict
          title="Run a pinned evidence test"
          lede="Every case starts a fresh agent. The tested Skill never sees the authoring conversation, the coverage plan, or any expected answer you uploaded."
          status={
            <Status
              value={ready ? "pass" : "partial"}
              label={ready ? "Ready to run" : "Blocked"}
            />
          }
        />
        <dl className="kv" style={{ marginTop: 20 }}>
          <div>
            <dt>Skill</dt>
            <dd>
              {skill?.name ?? "None selected"}
              {skill?.version ? ` v${(skill.version as any).version}` : ""}
            </dd>
          </div>
          <div>
            <dt>Eval suite</dt>
            <dd>
              {evaluation?.version
                ? `Approved v${evaluation.version}`
                : "Approval required"}
            </dd>
          </div>
          <div>
            <dt>Engine</dt>
            <dd>Codex, gpt-5.6-luna</dd>
          </div>
          <div>
            <dt>Cases</dt>
            <dd className="num">{cases}</dd>
          </div>
          <div>
            <dt>Iterations</dt>
            <dd className="num">1</dd>
          </div>
          <div>
            <dt>Isolation</dt>
            <dd>Fresh execution per case</dd>
          </div>
        </dl>
        <div className="decision">
          <div>
            {ready ? (
              <>
                <b>This spends real model time</b>
                <p>
                  Skill and eval checksums are recorded, so the result stays
                  reproducible.
                </p>
              </>
            ) : (
              <>
                <b>Approve the eval suite first</b>
                <p>A run can only pin to a frozen, validated suite.</p>
              </>
            )}
          </div>
          <div className="decision-actions">
            {!ready && (
              <Link
                className="btn"
                href={`/evals/current?skill=${skillId ?? ""}`}
              >
                Open eval suite
              </Link>
            )}
          </div>
        </div>

        {ready && (
          <section className="section">
            <div className="section-head">
              <h2>Choose what to run</h2>
              <span className="section-note">Pinned when the run starts</span>
            </div>
            <RunConfiguration
              skillVersionId={(skill!.version as any).id}
              evalVersionId={evaluation!.id}
              skillId={skill!.id}
              cases={evaluation!.cases}
            />
          </section>
        )}
      </Work>
    );
  }

  const finished = ["completed", "failed", "cancelled"].includes(run.status);
  if (!finished)
    return (
      <Work>
        <Verdict
          title="Evaluation in progress"
          lede="Results are written durably as each case finishes. Leaving this page does not stop the run."
          status={<Status value="active" label={humanize(run.status)} />}
        />
        <LiveRunProgress runId={String(run.id)} />
      </Work>
    );

  if (run.status !== "completed")
    return (
      <Work>
        <Verdict
          title={`Run ${humanize(run.status).toLowerCase()}`}
          lede={
            run.status === "cancelled"
              ? "Cancellation stopped the remaining work. Case results recorded before it are kept and remain valid evidence."
              : "The run stopped before producing a complete report. Durable progress up to that point is preserved."
          }
          status={<Status value="absent" label={humanize(run.status)} />}
        />
        <div className="empty">
          <Link
            className="btn secondary"
            href={`/runs/current?skill=${run.skill_id}`}
          >
            Configure a new run
          </Link>
        </div>
      </Work>
    );

  /* ------------------------------------------------------------ results */
  const results = run.results as any[];
  const skillSamples = results.filter((r) =>
    ["skill", "with_skill"].includes(r.configuration),
  );
  const perCase = [...new Set(skillSamples.map((r) => r.case_id))].map(
    (caseId) => {
      const samples = skillSamples.filter((r) => r.case_id === caseId);
      const worst = [...samples].sort(
        (a, b) => (severity[b.result] ?? 3) - (severity[a.result] ?? 3),
      )[0];
      return {
        ...worst,
        sampleCount: samples.length,
        stable: new Set(samples.map((s) => s.result)).size === 1,
      };
    },
  );
  perCase.sort((a, b) => (severity[b.result] ?? 3) - (severity[a.result] ?? 3));

  const passing = perCase.filter((r) => r.result === "PASS").length;
  const actionable = perCase.filter((r) =>
    ["FAIL", "PARTIAL"].includes(r.result),
  ).length;
  const metrics = dimensionMetrics(perCase);
  const tokens = results.reduce(
    (n, r) => n + Number(r.tokens?.input ?? 0) + Number(r.tokens?.output ?? 0),
    0,
  );
  const duration = results.reduce((n, r) => n + Number(r.duration_ms ?? 0), 0);

  const base = `/runs/${run.id}?skill=${run.skill_id}`;
  const filter = (extra: string) => `${base}${extra}`;
  const visible = perCase.filter(
    (r) =>
      (!query.status || r.result === query.status) &&
      (!query.dim || r.dimensions?.[query.dim] === false),
  );

  const openCase = query.case
    ? perCase.find((r) => r.case_id === query.case)
    : null;
  const inspector = openCase ? (
    <Inspector
      title={openCase.case_id}
      subtitle={openCase.title ?? openCase.coverage_group}
      closeHref={
        base +
        (query.status ? `&status=${query.status}` : "") +
        (query.dim ? `&dim=${query.dim}` : "")
      }
    >
      <Status
        value={openCase.result}
        label={openCase.result}
        flaky={!openCase.stable}
      />
      {openCase.detail?.prompt && (
        <div>
          <div className="evidence-label">Prompt</div>
          <div className="evidence-text">{openCase.detail.prompt}</div>
        </div>
      )}
      {openCase.detail?.response && (
        <div>
          <div className="evidence-label">What the Skill answered</div>
          <div className="evidence-text">{openCase.detail.response}</div>
        </div>
      )}
      <div>
        <div className="evidence-label">Assertions</div>
        <Assertions assertions={(openCase.assertions ?? []) as any[]} />
      </div>
      <dl className="kv">
        <div>
          <dt>Samples</dt>
          <dd className="num">{openCase.sampleCount}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd className="num">
            {(Number(openCase.duration_ms ?? 0) / 1000).toFixed(1)}s
          </dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd className="num">
            {(
              Number(openCase.tokens?.input ?? 0) +
              Number(openCase.tokens?.output ?? 0)
            ).toLocaleString()}
          </dd>
        </div>
        {openCase.error_class && (
          <div>
            <dt>Error class</dt>
            <dd>{humanize(openCase.error_class)}</dd>
          </div>
        )}
      </dl>
    </Inspector>
  ) : undefined;

  return (
    <Work inspector={inspector}>
      <Verdict
        title="What the evidence shows"
        status={
          <Status
            value={actionable ? "fail" : "pass"}
            label={actionable ? "Action needed" : "No Skill failures"}
          />
        }
      />
      <div className="headline-figure">
        <b className="num">
          {passing}/{perCase.length}
        </b>
        <span>
          cases passing · Skill v{run.skill_version}, eval v{run.eval_version} ·{" "}
          {evidenceModeCopy(run.evidenceMode).label}
        </span>
      </div>

      <Metrics items={metrics} />

      <section className="section">
        <div className="section-head">
          <h2>Cases</h2>
          <span className="section-note num">
            {visible.length} of {perCase.length} · {results.length} samples
          </span>
        </div>

        <div className="filters">
          <Link
            className={`filter ${!query.status && !query.dim ? "on" : ""}`}
            href={base}
          >
            All
          </Link>
          {["FAIL", "PARTIAL", "ERROR", "PASS"].map((status) =>
            perCase.some((r) => r.result === status) ? (
              <Link
                key={status}
                className={`filter ${query.status === status ? "on" : ""}`}
                href={filter(`&status=${status}`)}
              >
                {status.charAt(0) + status.slice(1).toLowerCase()}
              </Link>
            ) : null,
          )}
          {metrics
            .filter((metric) => metric.measured > metric.passed)
            .map((metric) => (
              <Link
                key={metric.key}
                className={`filter ${query.dim === metric.key ? "on" : ""}`}
                href={filter(`&dim=${metric.key}`)}
              >
                {metric.label} broke
              </Link>
            ))}
        </div>

        <div className="rows">
          {visible.map((result) => {
            const failed = Object.entries(result.dimensions ?? {})
              .filter(([, ok]) => !ok)
              .map(([dimension]) => dimensionLabels[dimension] ?? dimension);
            return (
              <Link
                className={`row case ${query.case === result.case_id ? "selected" : ""}`}
                key={result.id}
                href={`${base}&case=${result.case_id}${query.status ? `&status=${query.status}` : ""}${query.dim ? `&dim=${query.dim}` : ""}`}
              >
                <Status
                  value={result.result}
                  label={result.result}
                  flaky={!result.stable}
                />
                <span>
                  <span className="id">{result.case_id}</span>
                  <span className="sub">
                    {result.title ?? result.coverage_group}
                  </span>
                </span>
                <span className="file-kind">
                  {failed.length ? failed.join(", ") : ""}
                </span>
                <span className="chevron" aria-hidden="true">
                  ▸
                </span>
              </Link>
            );
          })}
          {visible.length === 0 && (
            <p className="hint">No case matches this filter.</p>
          )}
        </div>
      </section>

      {run.baseline && (
        <section className="section">
          <div className="section-head">
            <h2>Without the Skill</h2>
            <span className="section-note">
              Baseline, kept out of the score above
            </span>
          </div>
          <div className="rows">
            {results
              .filter((sample) =>
                ["baseline", "without_skill"].includes(sample.configuration),
              )
              .map((sample) => (
                <div className="row case" key={sample.id}>
                  <Status value={sample.result} label={sample.result} />
                  <span>
                    <span className="id">{sample.case_id}</span>
                    <span className="sub">sample {sample.iteration}</span>
                  </span>
                  <span />
                  <span />
                </div>
              ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Run</h2>
          <span className="section-note">Pinned and reproducible</span>
        </div>
        <dl className="kv" style={{ marginTop: 12 }}>
          <div>
            <dt>Model</dt>
            <dd className="mono">{run.model}</dd>
          </div>
          <div>
            <dt>Iterations</dt>
            <dd className="num">{run.iterations}</dd>
          </div>
          <div>
            <dt>Tokens</dt>
            <dd className="num">{tokens.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd className="num">{(duration / 1000).toFixed(1)}s</dd>
          </div>
          <div>
            <dt>Skill checksum</dt>
            <dd className="mono">{String(run.skill_checksum).slice(0, 16)}</dd>
          </div>
          <div>
            <dt>Eval checksum</dt>
            <dd className="mono">{String(run.eval_checksum).slice(0, 16)}</dd>
          </div>
        </dl>
        <p style={{ marginTop: 14 }}>
          <a className="btn quiet" href={`/api/v1/runs/${run.id}/download`}>
            Download raw report
          </a>
          <Link
            className="btn quiet"
            href={`/runs/new?skill=${run.skill_id}&eval=${run.eval_version_id}`}
          >
            Start another run
          </Link>
        </p>
      </section>

      <div className="decision">
        <div>
          {actionable ? (
            <>
              <b>
                {actionable} case{actionable === 1 ? "" : "s"} the Skill should
                have handled
              </b>
              <p>
                Codex diagnoses them in a separate thread and proposes a patch
                you review before anything changes.
              </p>
            </>
          ) : (
            <>
              <b>No actionable Skill failures</b>
              <p>
                Errors, if any, are infrastructure and are not counted against
                the Skill.
              </p>
            </>
          )}
        </div>
        {actionable > 0 && (
          <div className="decision-actions">
            <ApiAction
              url="/api/v1/updates/generate"
              body={{ runId: run.id }}
              label="Suggest update"
              navigateTo={`/improve/:resourceId?skill=${run.skill_id}`}
            />
          </div>
        )}
      </div>
    </Work>
  );
}
