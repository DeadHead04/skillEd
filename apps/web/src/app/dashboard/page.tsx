import Link from "next/link";
import { listSkills, studioHealth } from "../../lib/data";
import { Work, Verdict } from "../../components/ui";
export default async function DashboardPage() {
  const [skills, health] = await Promise.all([listSkills(), studioHealth()]);
  const attention = skills.flatMap((s) => {
    const stages = s.stages;
    if (
      stages.improve.id &&
      !stages.improve.activated &&
      [
        "review",
        "verified",
        "candidate_created",
        "verification_failed",
      ].includes(stages.improve.status)
    )
      return [
        {
          skill: s,
          label:
            stages.improve.status === "verified"
              ? "Candidate ready for release"
              : "Review the proposed improvement",
          href: `/improve/${stages.improve.id}?skill=${s.id}`,
          category: "Improvement",
        },
      ];
    if (stages.evals.id && stages.evals.status !== "approved")
      return [
        {
          skill: s,
          label:
            stages.evals.status === "failed"
              ? "Evaluation needs attention"
              : "Continue your test plan",
          href: `/evals/${stages.evals.id}?skill=${s.id}`,
          category: "Test plan",
        },
      ];
    if (s.latestRun)
      return [
        {
          skill: s,
          label:
            s.latestRun.status === "completed"
              ? "Inspect the latest evidence"
              : "Check execution progress",
          href: `/runs/${s.latestRun.id}?skill=${s.id}`,
          category: "Results",
        },
      ];
    return [];
  });
  return (
    <Work>
      <div className="eyebrow">EVALUATION STUDIO</div>
      <Verdict
        title="Make your Skills work better."
        lede="Understand the gaps. Test the task. Release with evidence."
        status={
          <Link className="btn" href="/skill?new=1">
            ＋ Add Skill package
          </Link>
        }
      />
      <div className="dashboard-overview">
        <div>
          <span>YOUR WORKSPACE</span>
          <b>{skills.length}</b>
          <p>Skill packages</p>
        </div>
        <div>
          <span>IN PROGRESS</span>
          <b>{health.queue?.running ?? 0}</b>
          <p>Active operations · {health.queue?.queued ?? 0} queued</p>
        </div>
        <div className="runtime-summary">
          <span>EXECUTION</span>
          <strong>
            {health.execution === "demo"
              ? "Demo evidence"
              : health.execution === "ready"
                ? "Available"
                : "Execution unavailable"}
          </strong>
          <p>
            {health.execution === "demo"
              ? "Deterministic testing; no model calls."
              : health.execution === "ready"
                ? "One model operation at a time."
                : "History remains available. Check runtime diagnostics."}
          </p>
        </div>
      </div>
      <div className="dashboard-columns">
        <section className="studio-panel">
          <div className="panel-heading">
            <h2>Continue your work</h2>
            <span className="section-note">{attention.length} workspaces</span>
          </div>
          {attention.slice(0, 8).map((a) => (
            <Link className="attention-row" key={a.skill.id} href={a.href}>
              <span className="attention-icon">↗</span>
              <span>
                <strong>{a.skill.name}</strong>
                <small>{a.label}</small>
              </span>
              <span className="section-note">{a.category}</span>
            </Link>
          ))}
          {!attention.length && (
            <div className="studio-empty compact">
              <h3>Nothing waiting for review</h3>
              <p>Upload a Skill to start an evaluation.</p>
            </div>
          )}
        </section>
        <section className="studio-panel">
          <div className="panel-heading">
            <h2>Recent Skills</h2>
            <Link href="/skills">View all ↗</Link>
          </div>
          {skills.slice(0, 5).map((s) => (
            <Link
              className="attention-row"
              key={s.id}
              href={`/skill?skill=${s.id}`}
            >
              <span className="package-icon">◇</span>
              <span>
                <strong>{s.name}</strong>
                <small>
                  {s.active_version_id
                    ? `Active v${s.active_version}`
                    : "Not activated"}
                </small>
              </span>
            </Link>
          ))}
          {!skills.length && <p className="hint">Your library is empty.</p>}
        </section>
      </div>
      <section className="journey-panel">
        <div className="eyebrow">FROM PACKAGE TO PROOF</div>
        <h2>One workflow. Every decision visible.</h2>
        <div className="journey-steps">
          {[
            "Inspect the package",
            "Approve the checks",
            "Run the task",
            "Explore the evidence",
            "Review a fix",
            "Verify and release",
          ].map((s, i) => (
            <div key={s}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <p>{s}</p>
            </div>
          ))}
        </div>
      </section>
    </Work>
  );
}
