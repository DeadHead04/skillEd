import Link from "next/link";
import { currentSkill, currentEval, skillRuns } from "../../lib/data";
import { UploadForm, ApiAction } from "../../components/actions";
export const dynamic = "force-dynamic";
export default async function SkillPage({
  searchParams,
}: {
  searchParams: Promise<{ skill?: string; new?: string }>;
}) {
  const query = await searchParams;
  const skill = query.new ? null : await currentSkill(query.skill);
  const evaluation = skill ? await currentEval(undefined, skill.id) : null;
  const runs = skill ? await skillRuns(skill.id) : [];
  const version = skill?.version as any;
  return (
    <div className="content">
      <div className="page-head">
        <div>
          <div className="eyebrow">Package intake</div>
          <h1>{skill ? skill.name : "Add a Skill package"}</h1>
          <p className="lede">
            Inspect an uploaded Skill, bind task evidence, then create a
            rigorous eval suite, then keep its evidence and versions isolated
            from every other package.
          </p>
        </div>
        {version && (
          <span className="badge pass">Ready · v{version.version}</span>
        )}
      </div>
      {!skill ? (
        <UploadForm />
      ) : (
        <div className="grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Active package</h2>
              <span className="mono">
                {String(version.checksum).slice(0, 12)}
              </span>
            </div>
            <div className="panel-body">
              <dl className="facts">
                <div className="fact">
                  <dt>Selected root</dt>
                  <dd>{version.selected_root || "Archive root"}</dd>
                </div>
                <div className="fact">
                  <dt>Readiness</dt>
                  <dd>
                    {version.readiness?.ready
                      ? "All static checks passed"
                      : "Needs attention"}
                  </dd>
                </div>
                <div className="fact">
                  <dt>Installable files</dt>
                  <dd>{version.manifest?.entries?.length ?? 0}</dd>
                </div>
                <div className="fact">
                  <dt>Task evidence</dt>
                  <dd>{evaluation?.evidence_level ?? "Provisional"}</dd>
                </div>
              </dl>
              <h2 style={{ marginTop: 24 }}>Manifest</h2>
              <div className="tree">
                {version.manifest?.entries?.slice(0, 16).map((entry: any) => (
                  <div key={entry.path}>
                    └─ {entry.path}{" "}
                    <span style={{ color: "#8a8f91" }}>({entry.size} B)</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="decision-bar">
              <span>Original bytes remain immutable.</span>
              {evaluation?.status === "collecting" ? (
                <ApiAction
                  url={`/api/v1/evals/${evaluation.id}/author`}
                  label="Create evals"
                  navigateTo="/evals/:resourceId"
                />
              ) : (
                <Link
                  className="btn"
                  href={`/evals/${evaluation?.id ?? "current"}?skill=${skill.id}`}
                >
                  Open evals
                </Link>
              )}
            </div>
          </section>
          <aside>
            <section className="panel">
              <div className="panel-head">
                <h2>Readiness</h2>
                <span className="badge pass">Passed</span>
              </div>
              <div className="panel-body">
                <ul className="list">
                  <li>SKILL.md discovered and selected</li>
                  <li>Archive paths and file types safe</li>
                  <li>Runtime: Node 24 · Python 3.12 · Go 1.25</li>
                  <li>No package content executed</li>
                </ul>
                <p>
                  <a href={`/api/v1/skill/download/${version.id}`}>
                    Download installable ZIP →
                  </a>
                </p>
                <p>
                  <a
                    href={`/api/v1/skill/download/${version.id}?kind=original`}
                  >
                    Download original ZIP →
                  </a>
                </p>
              </div>
            </section>
            <div style={{ height: 18 }} />
            <section className="panel">
              <div className="panel-head">
                <h2>Upload new version</h2>
              </div>
              <div className="panel-body">
                <UploadForm />
              </div>
            </section>
          </aside>
          {runs.length > 0 && (
            <section className="panel run-history">
              <div className="panel-head">
                <h2>Recent evidence runs</h2>
                <span>{runs.length} retained</span>
              </div>
              <div className="run-list">
                {runs.map((run) => (
                  <Link
                    className="run-row"
                    href={`/runs/${run.id}?skill=${skill.id}`}
                    key={run.id}
                  >
                    <span>
                      <b>Run {String(run.id).slice(0, 8)}</b>
                      <small>
                        Skill v{run.skill_version} · eval v{run.eval_version} ·{" "}
                        {run.status}
                      </small>
                    </span>
                    <span className="outcome-summary">
                      <b>
                        {run.summary.pass}/{run.summary.total} passing
                      </b>
                      <small>
                        {run.summary.fail} failed · {run.summary.partial}{" "}
                        partial · {run.summary.error} errors
                      </small>
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
