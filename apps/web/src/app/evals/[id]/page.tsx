import { currentEval } from "../../../lib/data";
import {
  ApiAction,
  ConversationForm,
  EvalQuestionsForm,
} from "../../../components/actions";
export const dynamic = "force-dynamic";
export default async function EvalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ skill?: string }>;
}) {
  const [route, query] = await Promise.all([params, searchParams]);
  const evaluation = await currentEval(route.id, query.skill);
  if (!evaluation)
    return (
      <div className="content">
        <div className="empty">
          <h1>No eval draft</h1>
          <p>Upload a Skill package and task first.</p>
        </div>
      </div>
    );
  const understanding = evaluation.task_understanding as any,
    plan = evaluation.coverage_plan as any;
  const grouped = (evaluation.cases as any[]).reduce(
    (all: Record<string, any[]>, item: any) => {
      (all[item.coverage_group] ??= []).push(item);
      return all;
    },
    {},
  );
  return (
    <div className="content">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            Eval authoring · revision {evaluation.revision} ·{" "}
            {evaluation.evidenceMode === "real"
              ? "Real Codex"
              : evaluation.evidenceMode === "demo"
                ? "Demo adapter"
                : "Unverified legacy"}
          </div>
          <h1>Turn task knowledge into evidence</h1>
          <p className="lede">
            Codex develops the understanding and coverage plan. SkillEd keeps
            every case tied to a rule, source, dimension, and regression
            purpose.
          </p>
        </div>
        <span
          className={`badge ${String(evaluation.evidence_level).toLowerCase()}`}
        >
          {evaluation.evidence_level} evidence
        </span>
      </div>
      <div className="tabs">
        <a className={evaluation.status === "understanding" ? "active" : ""}>
          Understand
        </a>
        <a className={evaluation.status === "awaiting_answers" ? "active" : ""}>
          Questions
        </a>
        <a>Eval plan</a>
        <a>Review</a>
      </div>
      {evaluation.evidenceMode !== "real" && (
        <div className="mode-banner demo" role="status">
          <b>
            {evaluation.evidenceMode === "demo"
              ? "Demo evidence"
              : "Unverified legacy evidence"}
          </b>
          {evaluation.evidenceMode === "demo"
            ? "This workflow is deterministic and makes no model calls. Switch the worker to real mode before treating results as Codex evidence."
            : "This eval predates evidence-mode recording, so SkillEd will not label it as a real Codex result."}
        </div>
      )}
      {evaluation.status === "collecting" && (
        <div className="panel">
          <div className="empty">
            <h2>Ready to understand the task</h2>
            <ApiAction
              url={`/api/v1/evals/${evaluation.id}/author`}
              label="Start understanding"
            />
          </div>
        </div>
      )}
      {evaluation.status !== "collecting" && (
        <div className="grid">
          <section>
            {evaluation.status === "awaiting_answers" && (
              <div className="panel question-panel">
                <div className="panel-head">
                  <div>
                    <div className="eyebrow">Blocking material questions</div>
                    <h2>Resolve the source of truth</h2>
                  </div>
                  <span>{evaluation.questions.length} required</span>
                </div>
                <div className="panel-body">
                  <EvalQuestionsForm
                    evalId={evaluation.id}
                    questions={evaluation.questions}
                  />
                </div>
              </div>
            )}
            <div className="panel">
              <div className="panel-head">
                <h2>Durable task understanding</h2>
                <span className="badge info">Structured</span>
              </div>
              <div className="panel-body">
                <dl className="facts">
                  <div className="fact">
                    <dt>Inputs</dt>
                    <dd>{understanding?.inputs?.join(" · ")}</dd>
                  </div>
                  <div className="fact">
                    <dt>Outputs</dt>
                    <dd>{understanding?.outputs?.join(" · ")}</dd>
                  </div>
                  <div className="fact">
                    <dt>Authorities</dt>
                    <dd>{understanding?.authorities?.join(" · ")}</dd>
                  </div>
                  <div className="fact">
                    <dt>Hard invariants</dt>
                    <dd>{understanding?.invariants?.join(" · ")}</dd>
                  </div>
                </dl>
                <h2 style={{ marginTop: 22 }}>Likely failure modes</h2>
                <ul className="list">
                  {understanding?.failureModes?.map((item: string) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
            <div style={{ height: 18 }} />
            <div className="panel">
              <div className="panel-head">
                <h2>Coverage plan and cases</h2>
                <span>
                  {evaluation.cases.length ||
                    plan?.groups?.reduce(
                      (n: number, g: any) => n + g.caseCount,
                      0,
                    )}{" "}
                  cases
                </span>
              </div>
              <div className="panel-body">
                {Object.entries(grouped).map(([group, items]) => (
                  <div key={group} style={{ marginBottom: 22 }}>
                    <h3>{group}</h3>
                    <table className="case-table">
                      <thead>
                        <tr>
                          <th>Case</th>
                          <th>Judge</th>
                          <th>Required dimensions</th>
                          <th>Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(items as any[]).map((item) => (
                          <tr key={item.case_id}>
                            <td data-label="Case">
                              <div>
                                <b>{item.case_id}</b>
                                <br />
                                {item.title}
                              </div>
                            </td>
                            <td data-label="Judge">{item.judge_type}</td>
                            <td data-label="Required dimensions">
                              {item.required_dimensions.join(" · ")}
                            </td>
                            <td data-label="Evidence">
                              {item.evidence_provenance.join(" · ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                {evaluation.cases.length === 0 &&
                  plan?.groups?.map((group: any) => (
                    <div
                      className="callout"
                      key={group.name}
                      style={{ marginBottom: 10 }}
                    >
                      <b>{group.name}</b> · {group.caseCount} cases ·{" "}
                      {group.judge} judge
                      <br />
                      {group.purpose}
                    </div>
                  ))}
              </div>
              <div className="decision-bar">
                <span>
                  Status: {String(evaluation.status).replaceAll("_", " ")}
                </span>
                {evaluation.status === "awaiting_plan_approval" && (
                  <ApiAction
                    url={`/api/v1/evals/${evaluation.id}/approve-plan`}
                    label="Generate evals"
                  />
                )}
                {evaluation.status === "ready" && (
                  <ApiAction
                    url={`/api/v1/evals/${evaluation.id}/approve`}
                    label="Approve evals"
                  />
                )}
                {evaluation.status === "failed" && (
                  <ApiAction
                    url={`/api/v1/evals/${evaluation.id}/retry`}
                    label="Retry generation"
                  />
                )}
                {evaluation.status === "approved" && (
                  <a
                    className="btn"
                    href={`/runs/current?skill=${evaluation.skill_id}`}
                  >
                    Configure run
                  </a>
                )}
              </div>
            </div>
          </section>
          <aside>
            <section className="panel">
              <div className="panel-head">
                <h2>Authoring conversation</h2>
                <span className="badge info">Codex</span>
              </div>
              <div className="panel-body conversation">
                {evaluation.messages.length ? (
                  evaluation.messages.map((message: any) => (
                    <div className="message" key={message.id}>
                      <strong>{message.role}</strong>
                      {message.content}
                    </div>
                  ))
                ) : (
                  <p>No completed messages yet.</p>
                )}
                {evaluation.conversation && (
                  <ConversationForm
                    url={`/api/v1/evals/${evaluation.id}/messages`}
                  />
                )}
              </div>
            </section>
            <div style={{ height: 18 }} />
            <section className="panel">
              <div className="panel-head">
                <h2>Why this is testable</h2>
              </div>
              <div className="panel-body">
                <div className="callout warn">
                  A model opinion is not enough for exact file constraints.
                  Script judges prove protected fields and artifact invariants;
                  agent judges assess semantic omissions and invented claims.
                </div>
              </div>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
