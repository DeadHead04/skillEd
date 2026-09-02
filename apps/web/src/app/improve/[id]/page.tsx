import { currentProposal, currentRun } from "../../../lib/data";
import { ApiAction } from "../../../components/actions";
export const dynamic = "force-dynamic";
export default async function ImprovePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const proposal = await currentProposal((await params).id),
    run = await currentRun();
  if (!proposal)
    return (
      <div className="content">
        <div className="empty">
          <h1>No update proposal</h1>
          <p>
            Run an approved eval and select Suggest update from actionable
            failures.
          </p>
        </div>
      </div>
    );
  const summary = proposal.summary as any,
    comparison = proposal.comparison as any;
  return (
    <div className="content">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            Improvement proposal · base v{proposal.base_version}
          </div>
          <h1>Change the Skill, keep the evidence fixed</h1>
          <p className="lede">
            The proposal is separate from both the active Skill and the approved
            eval. Nothing activates until you approve the patch and verify the
            candidate.
          </p>
        </div>
        <span
          className={`badge ${proposal.status === "failed" ? "fail" : "info"}`}
        >
          {String(proposal.status).replaceAll("_", " ")}
        </span>
      </div>
      {proposal.status === "generating" ? (
        <div className="panel">
          <div className="empty">
            <h2>Analyzing the failed run</h2>
            <p>
              Codex receives only the immutable base Skill and selected failure
              evidence.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid">
          <section>
            <div className="panel">
              <div className="panel-head">
                <h2>Problem and intended effect</h2>
                <span className="badge info">Structured proposal</span>
              </div>
              <div className="panel-body">
                <dl className="facts">
                  <div className="fact">
                    <dt>Root cause</dt>
                    <dd>{summary?.rootCause}</dd>
                  </div>
                  <div className="fact">
                    <dt>Intended effect</dt>
                    <dd>{summary?.intendedEffect}</dd>
                  </div>
                  <div className="fact">
                    <dt>Risk</dt>
                    <dd>{proposal.risks?.join(" · ")}</dd>
                  </div>
                  <div className="fact">
                    <dt>Verification</dt>
                    <dd>{summary?.verification}</dd>
                  </div>
                </dl>
                <h2 style={{ marginTop: 24 }}>Skill patch</h2>
                <pre className="diff">
                  <span className="add">{proposal.skillPatch}</span>
                </pre>
              </div>
              {proposal.status === "review" && (
                <div className="decision-bar">
                  <span>Skill and eval decisions are independent.</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <ApiAction
                      url={`/api/v1/updates/${proposal.id}/decide`}
                      body={{
                        skillDecision: "rejected",
                        evalDecision: "rejected",
                      }}
                      label="Reject"
                      kind="secondary"
                    />
                    <ApiAction
                      url={`/api/v1/updates/${proposal.id}/decide`}
                      body={{
                        skillDecision: "approved",
                        evalDecision: "rejected",
                      }}
                      label="Approve Skill only"
                    />
                  </div>
                </div>
              )}
              {proposal.status === "candidate_created" && (
                <div className="decision-bar">
                  <span>Candidate created; active bytes are unchanged.</span>
                  <ApiAction
                    url={`/api/v1/updates/${proposal.id}/verify`}
                    label="Verify candidate"
                  />
                </div>
              )}
              {proposal.status === "verified" && (
                <div className="decision-bar">
                  <span>No new required-dimension regression.</span>
                  <ApiAction
                    url={`/api/v1/updates/${proposal.id}/activate`}
                    label="Activate candidate"
                  />
                </div>
              )}
            </div>
            {comparison && (
              <div className="panel" style={{ marginTop: 18 }}>
                <div className="panel-head">
                  <h2>Current vs candidate</h2>
                  <span
                    className={`badge ${comparison.blocked ? "fail" : "pass"}`}
                  >
                    {comparison.blocked ? "Activation blocked" : "Verified"}
                  </span>
                </div>
                <div className="panel-body">
                  <table className="case-table">
                    <thead>
                      <tr>
                        <th>Case</th>
                        <th>Current</th>
                        <th>Candidate</th>
                        <th>Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {comparison.cases?.map((item: any) => (
                        <tr
                          key={item.caseId}
                          className={
                            item.category === "Regressed" ? "failure" : ""
                          }
                        >
                          <td>{item.caseId}</td>
                          <td>{item.current}</td>
                          <td>{item.candidate}</td>
                          <td>
                            <b>{item.category}</b>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
          <aside>
            <section className="panel">
              <div className="panel-head">
                <h2>Version integrity</h2>
              </div>
              <div className="panel-body timeline">
                <div>
                  <b>Base v{proposal.base_version}</b>
                  <br />
                  <small>Immutable active package</small>
                </div>
                <div>
                  <b>Proposed patch</b>
                  <br />
                  <small>Reviewable, not applied</small>
                </div>
                <div>
                  <b>Candidate</b>
                  <br />
                  <small>
                    {proposal.candidate_version_id
                      ? "Immutable candidate created"
                      : "Waiting for approval"}
                  </small>
                </div>
                <div>
                  <b>Activation</b>
                  <br />
                  <small>
                    {proposal.status === "verified"
                      ? "Available explicitly"
                      : "Blocked until verified"}
                  </small>
                </div>
              </div>
            </section>
            <div style={{ height: 18 }} />
            <section className="panel">
              <div className="panel-head">
                <h2>Bound evidence</h2>
              </div>
              <div className="panel-body mono">
                source run {String(proposal.source_run_id).slice(0, 8)}
                <br />
                eval {String(proposal.eval_version_id).slice(0, 8)}
                <br />
                current run {run ? String(run.id).slice(0, 8) : "—"}
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
