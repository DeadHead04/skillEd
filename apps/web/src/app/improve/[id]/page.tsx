import Link from "next/link";
import { currentProposal } from "../../../lib/data";
import { ApiAction, ConversationForm } from "../../../components/actions";
import { ProposalDecision } from "../../../components/proposal-decision";
import {
  DiffViewer,
  Inspector,
  Status,
  Verdict,
  Work,
} from "../../../components/ui";
import { JobStream } from "../../../components/job-stream";
import { ProposalRecovery } from "../../../components/proposal-recovery";
import { humanize } from "../../../lib/labels";

export const dynamic = "force-dynamic";

export default async function ImprovePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ skill?: string; panel?: string }>;
}) {
  const [route, query] = await Promise.all([params, searchParams]);
  const proposal = await currentProposal(route.id, query.skill);

  if (!proposal)
    return (
      <Work>
        <Verdict
          title="No proposed change"
          lede="Improvements start from evidence: run an approved suite, then ask Codex to diagnose the cases that failed."
        />
        <div className="empty">
          <p>
            When a run reports a failing or partial case, Suggest update opens a
            separate Codex thread bound to that exact run and Skill version.
          </p>
          <Link
            className="btn"
            href={`/runs/current${query.skill ? `?skill=${query.skill}` : ""}`}
          >
            Go to runs
          </Link>
        </div>
      </Work>
    );

  const summary = proposal.summary as any;
  const comparison = proposal.comparison as any;
  const status = String(proposal.status);
  const activated = Boolean(proposal.activated_at);
  const skillChanges = (proposal.skill_changes ?? []) as any[];
  const evalChanges = (proposal.eval_changes ?? []) as any[];
  const base = `/improve/${proposal.id}?skill=${proposal.skill_id}`;

  if (status === "generating")
    return (
      <Work>
        <Verdict
          title="Diagnosing the failed run"
          lede="Codex receives the immutable base Skill and the selected failure evidence — not the authoring conversation, and no ability to edit files directly."
          status={<Status value="active" label="Working" />}
        />
        {/* Without this the page would sit on "diagnosing" forever: the stream
            refreshes the route when the worker finishes the job. */}
        <JobStream jobId={proposal.activeJob?.id} />
        <ProposalRecovery id={proposal.id} status={status} />
      </Work>
    );

  if (status === "failed" && !proposal.candidate_version_id)
    return (
      <Work>
        <Verdict
          title="Improvement proposal was not created"
          lede={`The worker stopped before it produced a reviewable patch. Base v${proposal.base_version} is unchanged and no candidate exists.`}
          status={<Status value="fail" label="Generation failed" />}
        />
        <div className="error-box" role="alert">
          <b>Why it stopped</b>
          <p>
            {proposal.failureDetail ??
              "The proposal job ended without a usable error description. Check Diagnostics for the worker record."}
          </p>
        </div>
        <div className="decision">
          <div>
            <b>No Skill or eval changes were applied</b>
            <p>
              Rerun the approved suite to produce trustworthy failure evidence,
              then request a new improvement from those results.
            </p>
          </div>
          <div className="decision-actions">
            <Link
              className="btn"
              href={`/runs/${proposal.source_run_id}?skill=${proposal.skill_id}`}
            >
              Return to results
            </Link>
          </div>
        </div>
      </Work>
    );

  const inspector =
    query.panel === "diff" ? (
      <Inspector
        title="Proposed changes"
        subtitle={`Base v${proposal.base_version} · nothing applied yet`}
        closeHref={base}
      >
        <DiffViewer patch={proposal.skillPatch} />
        {proposal.evalPatch && (
          <div>
            <div className="evidence-label">Eval changes</div>
            <DiffViewer patch={proposal.evalPatch} />
          </div>
        )}
      </Inspector>
    ) : query.panel === "conversation" ? (
      <Inspector
        title="Update conversation"
        subtitle="A separate thread from authoring"
        closeHref={base}
      >
        <div className="conversation">
          {proposal.messages?.length ? (
            proposal.messages.map((message: any) => (
              <div className={`message ${message.role}`} key={message.id}>
                <span className="who">
                  {message.role === "assistant" ? "Codex" : "You"}
                </span>
                <p>{message.content}</p>
              </div>
            ))
          ) : (
            <p className="hint">No messages yet.</p>
          )}
        </div>
        {status === "review" && (
          <ConversationForm
            url={`/api/v1/updates/${proposal.id}/messages`}
            placeholder="Ask Codex to narrow the change, explain the risk, or revise the patch…"
          />
        )}
      </Inspector>
    ) : undefined;

  return (
    <Work inspector={inspector}>
      <Verdict
        title="Change the Skill, keep the evidence fixed"
        lede="The proposal touches neither the active Skill nor the approved suite. Nothing takes effect until you approve it and the candidate is verified."
        status={
          <Status
            value={status === "failed" ? "fail" : activated ? "pass" : "active"}
            label={activated ? "Activated" : humanize(status)}
          />
        }
      />

      <JobStream jobId={proposal.activeJob?.id} />
      <ProposalRecovery id={proposal.id} status={status} />

      <section className="section" style={{ marginTop: 22 }}>
        <div className="section-head">
          <h2>Diagnosis</h2>
          <Link className="section-note" href={`${base}&panel=conversation`}>
            Conversation ▸
          </Link>
        </div>
        <dl className="kv" style={{ marginTop: 12 }}>
          <div>
            <dt>Root cause</dt>
            <dd>{summary?.rootCause}</dd>
          </div>
          <div>
            <dt>Intended effect</dt>
            <dd>{summary?.intendedEffect}</dd>
          </div>
          <div>
            <dt>Stated risk</dt>
            <dd>{proposal.risks?.join(", ") || "None stated"}</dd>
          </div>
          <div>
            <dt>How it gets verified</dt>
            <dd>{summary?.verification}</dd>
          </div>
        </dl>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Changed files</h2>
          <Link className="section-note" href={`${base}&panel=diff`}>
            Read the diff ▸
          </Link>
        </div>
        <div className="rows">
          {skillChanges.map((change: any) => (
            <Link
              className="row plain"
              href={`${base}&panel=diff`}
              key={change.path}
            >
              <span>
                <span className="title mono">{change.path}</span>
                <span className="sub">{change.reason}</span>
              </span>
              <span className="file-kind">{change.action}</span>
            </Link>
          ))}
          {evalChanges.map((change: any) => (
            <Link
              className="row plain"
              href={`${base}&panel=diff`}
              key={change.caseId}
            >
              <span>
                <span className="title">{change.caseId}</span>
                <span className="sub">{change.reason}</span>
              </span>
              <span className="file-kind">eval case</span>
            </Link>
          ))}
        </div>
      </section>

      {skillChanges.some((c: any) => c.targetAssertionIds?.length) && (
        <section className="section">
          <div className="section-head">
            <h2>Evidence behind each change</h2>
          </div>
          {skillChanges.map((change: any) => (
            <div className="finding-card" key={change.path}>
              <strong>{change.path}</strong>
              {(change.targetAssertionIds ?? []).map((id: string) => {
                const target = proposal.targetedEvidence[id];
                return target ? (
                  <p key={id}>
                    <Link
                      href={`/runs/${proposal.source_run_id}?skill=${proposal.skill_id}&case=${target.caseId}`}
                    >
                      {target.title} · {target.text} ↗
                    </Link>
                  </p>
                ) : (
                  <p key={id}>Evidence reference unavailable</p>
                );
              })}
            </div>
          ))}
        </section>
      )}
      <section className="section">
        <div className="section-head">
          <h2>Review the actual changes</h2>
          <span className="section-note">Base v{proposal.base_version}</span>
        </div>
        <DiffViewer patch={proposal.skillPatch} />
        {proposal.evalPatch && (
          <details>
            <summary>Separate evaluation changes</summary>
            <DiffViewer patch={proposal.evalPatch} />
          </details>
        )}
      </section>

      {proposal.candidate_version_id && (
        <section className="section">
          <div className="section-head">
            <h2>Candidate</h2>
            <span className="section-note">
              {activated ? "Active" : "Created, not active"}
            </span>
          </div>
          <div className="rows">
            <a
              className="row plain"
              href={`/api/v1/skill/download/${proposal.candidate_version_id}`}
            >
              <span>
                <span className="title">Download candidate package</span>
                <span className="sub">Inspect it before activating</span>
              </span>
              <span className="chevron" aria-hidden="true">
                ↓
              </span>
            </a>
            <Link
              className="row plain"
              href={`/evals/${proposal.eval_version_id}?skill=${proposal.skill_id}`}
            >
              <span>
                <span className="title">Review the verification suite</span>
                <span className="sub">
                  The same frozen eval both versions ran
                </span>
              </span>
              <span className="chevron" aria-hidden="true">
                ▸
              </span>
            </Link>
          </div>
        </section>
      )}

      {comparison?.reasons?.length > 0 && (
        <div className="error-box" role="alert">
          <b>Verification needs attention</b>
          {comparison.reasons.map((reason: string, i: number) => (
            <p key={i}>{reason}</p>
          ))}
        </div>
      )}
      {comparison && (
        <section className="section">
          <div className="section-head">
            <h2>Current against candidate</h2>
            <Status
              value={comparison.blocked ? "fail" : "pass"}
              label={comparison.blocked ? "Activation blocked" : "Verified"}
            />
          </div>
          <div className="rows">
            {[...(comparison.cases ?? [])]
              .sort((a: any, b: any) =>
                a.category === "Regressed"
                  ? -1
                  : b.category === "Regressed"
                    ? 1
                    : 0,
              )
              .map((item: any) => (
                <div className="row case" key={item.caseId}>
                  <Status
                    value={
                      item.category === "Regressed"
                        ? "fail"
                        : item.category === "Fixed"
                          ? "pass"
                          : "absent"
                    }
                    label={item.category}
                  />
                  <span>
                    <span className="id">{item.caseId}</span>
                    <span className="sub">
                      {item.current} → {item.candidate}
                    </span>
                  </span>
                  <span />
                  <span />
                </div>
              ))}
          </div>
        </section>
      )}

      {status === "review" ? (
        <section className="section">
          <div className="section-head">
            <h2>Decide</h2>
            <span className="section-note">Groups are independent</span>
          </div>
          <ProposalDecision
            proposalId={proposal.id}
            expectedRevision={proposal.revision}
            skillChangeCount={skillChanges.length}
            evalChangeCount={evalChanges.length}
          />
        </section>
      ) : (
        <div className="decision">
          <div>
            {status === "candidate_created" ? (
              <>
                <b>Candidate created; active bytes unchanged</b>
                <p>
                  Verification runs the current and candidate Skills against the
                  identical frozen suite.
                </p>
              </>
            ) : status === "verified" && !activated ? (
              <>
                <b>Verified with no new regression</b>
                <p>
                  Activation switches which version future runs and downloads
                  use. Base v{proposal.base_version} stays available.
                </p>
              </>
            ) : status === "failed" ? (
              <>
                <b>Activation blocked</b>
                <p>
                  Verification found a regression or an errored case. The active
                  Skill is unchanged.
                </p>
              </>
            ) : activated ? (
              <>
                <b>Candidate is now the active Skill</b>
                <p>Earlier versions and their evidence remain intact.</p>
              </>
            ) : (
              <>
                <b>{humanize(status)}</b>
                <p>Nothing to decide at this stage.</p>
              </>
            )}
          </div>
          <div className="decision-actions">
            {(status === "candidate_created" ||
              (status === "failed" && proposal.candidate_version_id)) && (
              <ApiAction
                url={`/api/v1/updates/${proposal.id}/verify`}
                body={{ expectedRevision: proposal.revision }}
                label="Verify candidate"
              />
            )}
            {status === "verified" && !activated && (
              <ApiAction
                url={`/api/v1/updates/${proposal.id}/activate`}
                body={{
                  expectedRevision: proposal.revision,
                  expectedActiveVersionId: proposal.activeVersionId,
                }}
                label="Activate candidate"
              />
            )}
          </div>
        </div>
      )}
    </Work>
  );
}
