import Link from "next/link";
import { currentEval, readEvalFile } from "../../../lib/data";
import {
  ApiAction,
  CaseToggle,
  ConversationForm,
  EvalQuestionsForm,
} from "../../../components/actions";
import {
  FileView,
  Inspector,
  Status,
  Verdict,
  Work,
} from "../../../components/ui";
import { MaterialManager } from "../../../components/workflow-forms";
import { JobStream } from "../../../components/job-stream";
import { humanize } from "../../../lib/labels";

export const dynamic = "force-dynamic";

/** The authoring sequence, named as the screen blueprint names it. */
const STEPS = [
  { name: "Understand", statuses: ["collecting", "understanding"] },
  { name: "Questions", statuses: ["awaiting_answers"] },
  { name: "Eval plan", statuses: ["planning", "awaiting_plan_approval"] },
  {
    name: "Review",
    statuses: ["generating", "validating", "ready", "approved"],
  },
];

export default async function EvalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ skill?: string; case?: string; panel?: string }>;
}) {
  const [route, query] = await Promise.all([params, searchParams]);
  const evaluation = await currentEval(route.id, query.skill);

  if (!evaluation)
    return (
      <Work>
        <Verdict
          title="No eval suite yet"
          lede="An eval suite is built from one Skill package and the material that decides what a correct answer looks like."
        />
        <div className="empty">
          <p>Upload a Skill package and describe the real task to begin.</p>
          <Link className="btn" href="/skill?new=1">
            Add Skill package
          </Link>
        </div>
      </Work>
    );

  const status = String(evaluation.status);
  const understanding = evaluation.task_understanding as any;
  const plan = evaluation.coverage_plan as any;
  const cases = evaluation.cases as any[];
  const base = `/evals/${evaluation.id}?skill=${evaluation.skill_id}`;
  const activeStep = Math.max(
    0,
    STEPS.findIndex((step) => step.statuses.includes(status)),
  );

  const grouped = cases.reduce((all: Record<string, any[]>, item: any) => {
    (all[item.coverage_group] ??= []).push(item);
    return all;
  }, {});
  const groupNames = Object.keys(grouped);
  const planned =
    plan?.groups?.reduce((n: number, g: any) => n + g.caseCount, 0) ?? 0;

  const openCase = query.case
    ? cases.find((item) => item.case_id === query.case)
    : null;
  const caseFile = openCase
    ? await readEvalFile(evaluation.id, openCase.yaml_path)
    : null;

  let inspector: React.ReactNode = undefined;
  if (openCase) {
    inspector = (
      <Inspector
        title={openCase.case_id}
        subtitle={openCase.title}
        closeHref={base}
      >
        <dl className="kv">
          <div>
            <dt>Coverage group</dt>
            <dd>{openCase.coverage_group}</dd>
          </div>
          <div>
            <dt>Judge</dt>
            <dd>
              {openCase.judge_type === "script"
                ? "Script — exact check"
                : "Agent — semantic"}
            </dd>
          </div>
          <div>
            <dt>Required dimensions</dt>
            <dd>{(openCase.required_dimensions as string[]).join(", ")}</dd>
          </div>
          <div>
            <dt>Grounded in</dt>
            <dd>{(openCase.evidence_provenance as string[]).join(", ")}</dd>
          </div>
        </dl>
        {openCase.source?.prompt && (
          <div>
            <div className="evidence-label">Prompt sent to the agent</div>
            <div className="evidence-text">{openCase.source.prompt}</div>
          </div>
        )}
        {openCase.assertion_mapping &&
          Object.keys(openCase.assertion_mapping).length > 0 && (
            <div>
              <div className="evidence-label">
                Required assertions and the dimension each one proves
              </div>
              <div className="rows">
                {Object.entries(
                  openCase.assertion_mapping as Record<string, any>,
                ).map(([text, meta]) => (
                  <div className="row finding" key={text}>
                    <span className="glyph" aria-hidden="true">
                      ·
                    </span>
                    <span>
                      <span className="title">{text}</span>
                      <span className="sub">
                        {meta?.dimension ?? "unmapped"}
                        {meta?.required === false ? ", optional" : ", required"}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        <div>
          <div className="evidence-label">
            Exact file — <span className="mono">{openCase.yaml_path}</span>
          </div>
          <FileView file={caseFile} />
        </div>
      </Inspector>
    );
  } else if (query.panel === "conversation") {
    inspector = (
      <Inspector
        title="Authoring conversation"
        subtitle="One durable Codex thread"
        closeHref={base}
      >
        <div className="conversation">
          {evaluation.messages.length ? (
            evaluation.messages.map((message: any) => (
              <div className={`message ${message.role}`} key={message.id}>
                <span className="who">
                  {message.role === "assistant" ? "Codex" : "You"}
                </span>
                <p>{message.content}</p>
              </div>
            ))
          ) : (
            <p className="hint">
              No completed messages yet. Streaming text becomes history only
              once a turn finishes.
            </p>
          )}
        </div>
        {evaluation.conversation && (
          <ConversationForm url={`/api/v1/evals/${evaluation.id}/messages`} />
        )}
      </Inspector>
    );
  }

  return (
    <Work inspector={inspector}>
      <Verdict
        title="Turn task knowledge into evidence"
        lede="Codex proposes the coverage. Every case stays tied to a source, a required dimension, and a regression purpose."
        status={
          <Status
            value={status === "approved" ? "pass" : "active"}
            label={humanize(status)}
          />
        }
      />

      <JobStream jobId={evaluation.activeJob?.id} />

      <ol className="steps" style={{ marginTop: 20 }}>
        {STEPS.map((step, index) => (
          <li
            key={step.name}
            className={
              index < activeStep ? "done" : index === activeStep ? "now" : ""
            }
            aria-current={index === activeStep ? "step" : undefined}
          >
            <span className="glyph" aria-hidden="true">
              {index < activeStep ? "✓" : index + 1}
            </span>
            {step.name}
          </li>
        ))}
      </ol>

      {status === "failed" && (
        <div className="error-box" role="alert" style={{ marginBottom: 20 }}>
          {evaluation.validation?.error ?? "Evaluation preparation stopped."}
        </div>
      )}

      {status === "collecting" ? (
        <div className="empty">
          <h2>Ready to read the task</h2>
          <p>
            Codex will inspect the Skill and your uploaded material, then return
            a structured understanding plus any question it genuinely cannot
            answer on its own.
          </p>
        </div>
      ) : (
        <>
          {status === "awaiting_answers" && (
            <section className="section">
              <div className="section-head">
                <h2>Answer before the plan is built</h2>
                <span className="section-note num">
                  {evaluation.questions.length} blocking
                </span>
              </div>
              <p className="lede" style={{ margin: "10px 0 16px" }}>
                Each answer changes how correctness is judged, so the plan waits
                until they are resolved.
              </p>
              <EvalQuestionsForm
                evalId={evaluation.id}
                questions={evaluation.questions}
              />
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <h2>What the task is</h2>
              <Link
                className="section-note"
                href={`${base}&panel=conversation`}
              >
                Conversation ▸
              </Link>
            </div>
            <dl className="kv" style={{ marginTop: 12 }}>
              <div>
                <dt>Inputs</dt>
                <dd>{understanding?.inputs?.join(", ")}</dd>
              </div>
              <div>
                <dt>Outputs</dt>
                <dd>{understanding?.outputs?.join(", ")}</dd>
              </div>
              <div>
                <dt>Deciding authority</dt>
                <dd>{understanding?.authorities?.join(", ")}</dd>
              </div>
              <div>
                <dt>Must never change</dt>
                <dd>{understanding?.invariants?.join(", ")}</dd>
              </div>
            </dl>
          </section>

          <MaterialManager
            evalId={evaluation.id}
            revision={evaluation.revision}
            files={evaluation.files ?? []}
            editable={[
              "collecting",
              "awaiting_answers",
              "awaiting_plan_approval",
              "ready",
              "failed",
            ].includes(status)}
          />

          <section className="section">
            <div className="section-head">
              <h2>{cases.length ? "Cases" : "Planned coverage"}</h2>
              <span className="section-note num">
                {cases.length || planned} cases
                {groupNames.length ? ` · ${groupNames.length} groups` : ""}
              </span>
            </div>

            {groupNames.map((group) => (
              <div key={group}>
                <h3 style={{ margin: "16px 0 2px" }}>{group}</h3>
                <div className="rows">
                  {grouped[group]!.map((item: any) => (
                    <div
                      className={`row case ${query.case === item.case_id ? "selected" : ""}`}
                      key={item.case_id}
                    >
                      {/* Judge type is a property, not a state — it gets no
                          colour, so colour keeps meaning "needs a human". */}
                      <span className="file-kind">
                        {item.judge_type === "script" ? "script" : "agent"}
                      </span>
                      <Link
                        href={`${base}&case=${item.case_id}`}
                        style={{ minWidth: 0 }}
                      >
                        <span className="id">{item.case_id}</span>
                        <span className="sub">{item.title}</span>
                      </Link>
                      <CaseToggle
                        evalId={evaluation.id}
                        caseId={item.case_id}
                        enabled={item.enabled !== false}
                        locked={status === "approved"}
                      />
                      <Link
                        className="chevron"
                        href={`${base}&case=${item.case_id}`}
                        aria-label={`Open ${item.case_id}`}
                      >
                        ▸
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {cases.length === 0 &&
              plan?.groups?.map((group: any) => (
                <div className="row plain" key={group.name}>
                  <span>
                    <span className="title">{group.name}</span>
                    <span className="sub">{group.purpose}</span>
                  </span>
                  <span className="section-note num">
                    {group.caseCount} cases, {group.judge} judge
                  </span>
                </div>
              ))}
          </section>
        </>
      )}

      <div className="decision">
        <div>
          {status === "failed" && (
            <div
              className="error-box"
              role="alert"
              style={{ marginBottom: 20 }}
            >
              {evaluation.validation?.error ??
                "Evaluation preparation stopped."}
            </div>
          )}

          {status === "collecting" ? (
            <>
              <b>Start by reading the task</b>
              <p>Nothing is created until the understanding comes back.</p>
            </>
          ) : status === "awaiting_plan_approval" ? (
            <>
              <b>Approve this coverage to generate cases</b>
              <p>Generation writes real Skill-Up files and validates them.</p>
            </>
          ) : status === "ready" ? (
            <>
              <b>Approving freezes this suite</b>
              <p>
                The cases and their checksums become immutable, and every run
                pins to them.
              </p>
            </>
          ) : status === "failed" ? (
            <>
              <b>Generation failed</b>
              <p>Nothing was frozen. Retrying starts from the approved plan.</p>
            </>
          ) : status === "approved" ? (
            <>
              <b>Suite approved and frozen</b>
              <p>Run it against the active Skill to produce evidence.</p>
            </>
          ) : (
            <>
              <b>{humanize(status)}</b>
              <p>Codex is working. Progress is recorded durably.</p>
            </>
          )}
        </div>
        <div className="decision-actions">
          {status === "collecting" && (
            <ApiAction
              url={`/api/v1/evals/${evaluation.id}/author`}
              label="Start understanding"
            />
          )}
          {status === "awaiting_plan_approval" && (
            <ApiAction
              url={`/api/v1/evals/${evaluation.id}/approve-plan`}
              label="Generate evals"
            />
          )}
          {status === "ready" && (
            <ApiAction
              url={`/api/v1/evals/${evaluation.id}/approve`}
              label="Approve evals"
            />
          )}
          {status === "failed" && (
            <ApiAction
              url={`/api/v1/evals/${evaluation.id}/retry`}
              label="Retry generation"
            />
          )}
          {status === "approved" && (
            <>
              <ApiAction
                url={`/api/v1/evals/${evaluation.id}/clone`}
                label="Clone as new draft"
                kind="secondary"
                navigateTo={`/evals/:resourceId?skill=${evaluation.skill_id}`}
              />
              <Link
                className="btn"
                href={`/runs/new?skill=${evaluation.skill_id}&eval=${evaluation.id}`}
              >
                Configure run
              </Link>
            </>
          )}
        </div>
      </div>
    </Work>
  );
}
