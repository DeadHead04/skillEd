import Link from "next/link";
import { currentSkill, skillVersions, currentProposal } from "../../lib/data";
import { Work, Verdict, Status } from "../../components/ui";
import { ApiAction } from "../../components/actions";
export default async function ReleasePage({
  searchParams,
}: {
  searchParams: Promise<{ skill?: string }>;
}) {
  const q = await searchParams,
    skill = await currentSkill(q.skill);
  if (!skill)
    return (
      <Work>
        <Verdict title="No package to release" />
        <Link className="btn" href="/skill?new=1">
          Add Skill package
        </Link>
      </Work>
    );
  const [versions, proposal] = await Promise.all([
    skillVersions(skill.id),
    currentProposal(undefined, skill.id),
  ]);
  return (
    <Work>
      <div className="eyebrow">RELEASE · {skill.name}</div>
      <Verdict
        title="Choose what your team uses."
        lede="Activation follows verification. Every earlier version and its evidence stays available."
      />
      <section className="studio-panel">
        <div className="panel-heading">
          <h2>Current release</h2>
          <Status
            value={skill.active_version_id ? "pass" : "absent"}
            label={
              skill.active_version_id
                ? `Active v${skill.version.version}`
                : "Not activated"
            }
          />
        </div>
        <p className="hint">
          {skill.active_version_id
            ? "This is the version used by default for new work."
            : "An upload does not become active automatically."}
        </p>
        {proposal && (
          <div className="decision">
            <div>
              <b>
                {proposal.status === "verified"
                  ? "Candidate verification complete"
                  : "Candidate needs verification"}
              </b>
              <p>Review the matched trials and any remaining failures.</p>
            </div>
            <Link
              className="btn secondary"
              href={`/improve/${proposal.id}?skill=${skill.id}`}
            >
              Review evidence
            </Link>
            {proposal.status === "verified" && !proposal.activated_at && (
              <ApiAction
                url={`/api/v1/updates/${proposal.id}/activate`}
                body={{
                  expectedRevision: proposal.revision,
                  expectedActiveVersionId: skill.active_version_id,
                }}
                label="Activate candidate"
              />
            )}
          </div>
        )}
      </section>
      <section className="section">
        <div className="section-head">
          <h2>Version history</h2>
          <span className="section-note">
            {versions.length} retained versions
          </span>
        </div>
        {versions.map((v) => (
          <div className="attention-row" key={v.id}>
            <span className="package-icon">{v.version}</span>
            <span>
              <Link href={`/skill?skill=${skill.id}&version=${v.id}`}>
                <strong>Version {v.version}</strong>
              </Link>
              <small>
                {v.id === skill.active_version_id
                  ? "Active"
                  : v.status === "candidate"
                    ? "Candidate"
                    : "Uploaded"}
                {v.imported_history
                  ? " · Imported history — not reverified"
                  : ""}
              </small>
            </span>
            <a className="btn quiet" href={`/api/v1/skill/download/${v.id}`}>
              Download ↓
            </a>
          </div>
        ))}
      </section>
    </Work>
  );
}
