import Link from "next/link";
import {
  currentSkill,
  currentEval,
  readSkillFile,
  readTaskMaterial,
  skillVersions,
  taskMaterials,
  packageAssessment,
  latestRunForVersion,
} from "../../lib/data";
import { NewEvaluationForm } from "../../components/workflow-forms";
import { UploadForm, ApiAction } from "../../components/actions";
import {
  FileView,
  Inspector,
  Status,
  Verdict,
  Work,
  bytes,
} from "../../components/ui";
import { FileTree, PackageFindings, ReadMore } from "../../components/studio";

export const dynamic = "force-dynamic";
export default async function SkillPage({
  searchParams,
}: {
  searchParams: Promise<{
    skill?: string;
    version?: string;
    new?: string;
    file?: string;
    material?: string;
  }>;
}) {
  const query = await searchParams;
  const skill = query.new
    ? null
    : await currentSkill(query.skill, query.version);
  if (!skill?.version)
    return (
      <Work>
        <div className="eyebrow">START A WORKSPACE</div>
        <Verdict
          title="Add a Skill package"
          lede="Bring a Skill ZIP, a task, and the files it needs to work with."
        />
        <UploadForm />
      </Work>
    );
  const version = skill.version;
  const [evaluation, versions, assessment, latestRun] = await Promise.all([
    currentEval(undefined, skill.id, version.id),
    skillVersions(skill.id),
    packageAssessment(version),
    latestRunForVersion(version.id),
  ]);
  const materials = evaluation ? await taskMaterials(evaluation.id) : [];
  const entries = version.manifest?.entries ?? [];
  const base = `/skill?skill=${skill.id}&version=${version.id}`;
  const openFile = query.file
    ? await readSkillFile(version.id, query.file)
    : null;
  const openMaterial =
    query.material && materials.some((m) => m.id === query.material)
      ? await readTaskMaterial(query.material)
      : null;
  const inspector =
    query.file || query.material ? (
      <Inspector
        title={query.file ?? openMaterial?.filename ?? "File"}
        subtitle={`Version ${version.version} · ${bytes((openFile ?? openMaterial)?.size ?? 0)}`}
        closeHref={base}
      >
        <FileView
          file={query.file ? openFile : openMaterial}
          downloadHref={`/api/v1/skill/download/${version.id}`}
        />
      </Inspector>
    ) : undefined;
  const selectedActive = version.id === skill.active_version_id;
  return (
    <Work inspector={inspector}>
      <div className="eyebrow">
        PACKAGE WORKSPACE · VERSION {version.version}
      </div>
      <Verdict
        title={skill.name}
        status={
          <Status
            value={selectedActive ? "pass" : "absent"}
            label={
              selectedActive
                ? `Active v${version.version}`
                : version.status === "candidate"
                  ? `Candidate v${version.version}`
                  : `Uploaded v${version.version}`
            }
          />
        }
      />
      <ReadMore text={version.description} />
      {version.importedHistory && (
        <p className="notice" role="status">
          <b>Imported history — not reverified</b> Original version history is
          preserved. Run approved tests before relying on it.
        </p>
      )}
      <div className="assessment-strip">
        <div>
          <small>PACKAGE VALIDITY</small>
          <strong>
            {!assessment.valid
              ? "Needs attention"
              : assessment.inspectionComplete === false
                ? "Partial inspection"
                : "Structure checked"}
          </strong>
        </div>
        <div>
          <small>RUNTIME</small>
          <strong>
            {assessment.runtime === "unsupported"
              ? "Unsupported dependency"
              : "Check at launch"}
          </strong>
        </div>
        <div>
          <small>TASK COVERAGE</small>
          <strong>
            {evaluation?.status === "approved"
              ? "Approved test plan"
              : "Approval needed"}
          </strong>
        </div>
        <div>
          <small>PERFORMANCE</small>
          {latestRun ? (
            <Link href={`/runs/${latestRun.id}?skill=${skill.id}`}>
              {latestRun.engine_versions?.adapter === "demo"
                ? "Inspect demo results"
                : "Inspect run evidence"}{" "}
              ↗
            </Link>
          ) : (
            <span>Not evaluated</span>
          )}
        </div>
      </div>
      <div className="package-layout">
        <section className="studio-panel">
          <div className="panel-heading">
            <h2>Package contents</h2>
            <span className="section-note">{entries.length} files</span>
          </div>
          <FileTree entries={entries} base={base} />
          <div className="chart-caption">
            Optional folders are assessed only when the task needs them.
          </div>
          <a
            className="btn quiet"
            href={`/api/v1/skill/download/${version.id}`}
          >
            Download package ↓
          </a>
        </section>
        <PackageFindings assessment={assessment} base={base} />
      </div>
      <section className="section">
        <div className="section-head">
          <h2>Task material</h2>
          <span className="section-note">
            Inputs, rules, and expected results
          </span>
        </div>
        {materials.length ? (
          <div className="rows">
            {materials.map((m) => (
              <Link
                className="row plain"
                key={m.id}
                href={`${base}&material=${m.id}`}
              >
                <span className="title">{m.filename}</span>
                <span className="file-kind">
                  {m.kind === "expected"
                    ? "Judge-only expected output"
                    : m.kind}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="hint">Add task material when creating an evaluation.</p>
        )}
      </section>
      <div className="decision">
        <div>
          <b>
            {evaluation?.status === "collecting"
              ? "Next: define what good looks like"
              : evaluation?.status === "approved"
                ? "Next: run the approved checks"
                : "Continue your test plan"}
          </b>
          <p>
            Codex proposes judging areas and checks. You review them before
            execution.
          </p>
        </div>
        <div className="decision-actions">
          {evaluation?.status === "approved" ? (
            <Link
              className="btn"
              href={`/runs/new?skill=${skill.id}&eval=${evaluation.id}`}
            >
              New run
            </Link>
          ) : !evaluation ? (
            <a className="btn" href="#new-evaluation">
              Create test plan
            </a>
          ) : evaluation?.status === "collecting" ? (
            <ApiAction
              url={`/api/v1/evals/${evaluation.id}/author`}
              label="Create evals"
              navigateTo={`/evals/:resourceId?skill=${skill.id}`}
            />
          ) : (
            <Link
              className="btn"
              href={`/evals/${evaluation?.id ?? "current"}?skill=${skill.id}`}
            >
              Open test plan
            </Link>
          )}
        </div>
      </div>
      <section className="section">
        <div className="section-head">
          <h2>Versions</h2>
          <Link className="section-note" href={`/release?skill=${skill.id}`}>
            Release history ↗
          </Link>
        </div>
        <div className="filters">
          {versions.map((v) => (
            <Link
              key={v.id}
              className={`filter ${v.id === version.id ? "on" : ""}`}
              href={`/skill?skill=${skill.id}&version=${v.id}`}
            >
              v{v.version}
              {v.id === skill.active_version_id
                ? " · active"
                : v.status === "candidate"
                  ? " · candidate"
                  : " · uploaded"}
            </Link>
          ))}
        </div>
      </section>
      <details className="section" id="new-evaluation" open={!evaluation}>
        <summary>New evaluation</summary>
        <div style={{ marginTop: 16 }}>
          <NewEvaluationForm
            skillId={skill.id}
            versions={versions}
            selectedVersionId={version.id}
          />
        </div>
      </details>
      <details className="section">
        <summary>Upload a new version</summary>
        <div style={{ marginTop: 16 }}>
          <UploadForm compact skillId={skill.id} />
        </div>
      </details>
      <details className="section">
        <summary>Package provenance</summary>
        <dl className="kv">
          <div>
            <dt>Skill root</dt>
            <dd>{version.selected_root || "Archive root"}</dd>
          </div>
          <div>
            <dt>Original checksum</dt>
            <dd className="mono">{version.checksum}</dd>
          </div>
          <div>
            <dt>Normalized checksum</dt>
            <dd className="mono">
              {version.installable_checksum ?? "Not recorded"}
            </dd>
          </div>
        </dl>
        <a
          className="btn quiet"
          href={`/api/v1/skill/download/${version.id}?kind=original`}
        >
          Download original upload
        </a>
      </details>
    </Work>
  );
}
