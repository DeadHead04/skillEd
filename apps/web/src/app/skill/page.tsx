import Link from "next/link";
import {
  currentSkill,
  currentEval,
  readSkillFile,
  readTaskMaterial,
  skillRuns,
  skillVersions,
  taskMaterials,
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
import { humanize } from "../../lib/labels";

export const dynamic = "force-dynamic";

const MATERIAL_LABEL: Record<string, string> = {
  task: "Task description",
  authority: "Authoritative rules",
  expected: "Expected output",
  example: "Behavioural example",
  dataset: "Dataset",
  past_failure: "Recorded failure",
};

export default async function SkillPage({
  searchParams,
}: {
  searchParams: Promise<{
    skill?: string;
    new?: string;
    file?: string;
    material?: string;
  }>;
}) {
  const query = await searchParams;
  const skill = query.new ? null : await currentSkill(query.skill);
  const evaluation = skill ? await currentEval(undefined, skill.id) : null;
  const version = skill?.version as any;

  if (!skill || !version) {
    return (
      <Work>
        <Verdict
          title="Add a Skill package"
          lede="Upload the ZIP you would hand to an agent, plus the material that decides whether its output is right. Nothing inside the archive is executed."
        />
        <div style={{ marginTop: 22 }}>
          <UploadForm />
        </div>
      </Work>
    );
  }

  const [runs, materials, versions] = await Promise.all([
    skillRuns(skill.id),
    evaluation ? taskMaterials(evaluation.id) : Promise.resolve([]),
    skillVersions(skill.id),
  ]);
  const entries = (version.manifest?.entries ?? []) as Array<{
    path: string;
    size: number;
  }>;
  const findings = (version.readiness?.findings ?? []) as Array<{
    message?: string;
    path?: string;
  }>;
  const ready = Boolean(version.readiness?.ready);
  const base = `/skill?skill=${skill.id}`;

  // The inspector is the one level deeper: the actual bytes of a file.
  const openFile = query.file
    ? await readSkillFile(version.id, query.file)
    : null;
  const openMaterial = query.material
    ? await readTaskMaterial(query.material)
    : null;

  const inspector =
    query.file || query.material ? (
      <Inspector
        title={query.file ?? openMaterial?.filename ?? "File"}
        subtitle={
          query.file
            ? `Installed with the Skill · ${bytes(openFile?.size ?? 0)}`
            : `${MATERIAL_LABEL[openMaterial?.kind ?? ""] ?? "Task material"} · ${bytes(openMaterial?.size ?? 0)}`
        }
        closeHref={base}
      >
        <FileView
          file={query.file ? openFile : openMaterial}
          downloadHref={`/api/v1/skill/download/${version.id}`}
        />
      </Inspector>
    ) : undefined;

  return (
    <Work inspector={inspector}>
      <Verdict
        title={skill.name}
        lede={
          version.description ||
          "These are the exact bytes the tested agent receives. Open any file to read it."
        }
        status={
          <Status
            value={ready ? "pass" : "partial"}
            label={ready ? "Ready to test" : "Needs attention"}
          />
        }
      />

      {version.importedHistory && (
        <p className="notice" role="status">
          <b>Imported history</b>
          This version's pointer is preserved history that was never reverified.
          Run the evaluation pipeline before relying on it.
        </p>
      )}

      <dl className="kv" style={{ marginTop: 18 }}>
        <div>
          <dt>Version</dt>
          <dd className="num">v{version.version}</dd>
        </div>
        <div>
          <dt>Skill root</dt>
          <dd>{version.selected_root || "Archive root"}</dd>
        </div>
        <div>
          <dt>Checksum</dt>
          <dd className="mono">{String(version.checksum).slice(0, 12)}</dd>
        </div>
        <div>
          <dt>Task evidence</dt>
          <dd>{evaluation?.evidence_level ?? "Provisional"}</dd>
        </div>
      </dl>

      <section className="section" style={{ marginTop: 28 }}>
        <div className="section-head">
          <h2>Active package</h2>
          <span className="section-note num">
            {entries.length} {entries.length === 1 ? "file" : "files"}
          </span>
        </div>
        <div className="rows">
          {entries.map((entry) => (
            <Link
              className={`row file ${query.file === entry.path ? "selected" : ""}`}
              href={`${base}&file=${encodeURIComponent(entry.path)}`}
              key={entry.path}
            >
              <span className="chevron" aria-hidden="true">
                ▸
              </span>
              <span className="title mono">{entry.path}</span>
              <span className="file-kind">
                {entry.path.endsWith("SKILL.md") ? "instructions" : "file"}
              </span>
              <span className="file-size">{bytes(Number(entry.size))}</span>
            </Link>
          ))}
        </div>
      </section>

      {materials.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Task material</h2>
            <span className="section-note">What decides a correct answer</span>
          </div>
          <div className="rows">
            {materials.map((material) => (
              <Link
                className={`row file ${query.material === String(material.id) ? "selected" : ""}`}
                href={`${base}&material=${material.id}`}
                key={String(material.id)}
              >
                <span className="chevron" aria-hidden="true">
                  ▸
                </span>
                <span className="title">{material.filename}</span>
                <span className="file-kind">
                  {MATERIAL_LABEL[String(material.kind)] ?? material.kind}
                </span>
                <span className="file-size" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {findings.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Findings</h2>
            <span className="section-note num">{findings.length}</span>
          </div>
          <div className="rows">
            {findings.map((finding, index) => (
              <div className="row finding" key={index}>
                <span className="glyph" aria-hidden="true">
                  !
                </span>
                <span>
                  <span className="title">{finding.message}</span>
                  {finding.path && (
                    <span className="sub mono">{finding.path}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {runs.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Evidence runs</h2>
            <span className="section-note num">{runs.length} retained</span>
          </div>
          <div className="rows">
            {runs.map((run) => (
              <Link
                className="row plain"
                href={`/runs/${run.id}?skill=${skill.id}`}
                key={run.id}
              >
                <span>
                  <span className="id">{String(run.id).slice(0, 8)}</span>
                  <span className="sub">
                    Skill v{run.skill_version}, eval v{run.eval_version} —{" "}
                    {humanize(run.status).toLowerCase()}
                  </span>
                </span>
                <Status
                  value={
                    run.summary.fail || run.summary.error
                      ? "fail"
                      : run.summary.partial
                        ? "partial"
                        : "pass"
                  }
                  label={`${run.summary.pass}/${run.summary.total} passing`}
                />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2>Package files</h2>
          <span className="section-note">Downloads</span>
        </div>
        <div className="rows">
          <a
            className="row plain"
            href={`/api/v1/skill/download/${version.id}`}
          >
            <span>
              <span className="title">Installable ZIP</span>
              <span className="sub">Exactly what the agent receives</span>
            </span>
            <span className="chevron" aria-hidden="true">
              ↓
            </span>
          </a>
          <a
            className="row plain"
            href={`/api/v1/skill/download/${version.id}?kind=original`}
          >
            <span>
              <span className="title">Original upload</span>
              <span className="sub">The bytes you sent, untouched</span>
            </span>
            <span className="chevron" aria-hidden="true">
              ↓
            </span>
          </a>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Versions</h2>
          <span className="section-note num">
            {versions.length} {versions.length === 1 ? "version" : "versions"}
          </span>
        </div>
        <div className="rows">
          {versions.map((entry: any) => (
            <div className="row plain" key={entry.id}>
              <span>
                <span className="title">Version {entry.version}</span>
                <span className="sub">
                  {entry.id === skill.active_version_id
                    ? "Active"
                    : entry.status === "candidate"
                      ? "Candidate"
                      : "Inactive"}
                  {entry.imported_history
                    ? " — imported history, not reverified"
                    : ""}
                </span>
              </span>
              <a
                className="btn quiet"
                href={`/api/v1/skill/download/${entry.id}`}
              >
                Download
              </a>
            </div>
          ))}
        </div>
      </section>

      <details className="section">
        <summary className="section-note" style={{ cursor: "pointer" }}>
          Start a new evaluation, or upload a new version
        </summary>
        <div style={{ marginTop: 16 }}>
          <NewEvaluationForm skillId={skill.id} versions={versions} />
          <div style={{ marginTop: 20 }}>
            <UploadForm compact skillId={skill.id} />
          </div>
        </div>
      </details>

      <div className="decision">
        <div>
          {evaluation?.status === "collecting" ? (
            <>
              <b>Next: build the eval suite</b>
              <p>
                Codex reads this package and your task material, then asks only
                what it cannot infer.
              </p>
            </>
          ) : (
            <>
              <b>Eval suite {humanize(evaluation?.status).toLowerCase()}</b>
              <p>Open it to continue where the workflow stopped.</p>
            </>
          )}
        </div>
        <div className="decision-actions">
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
      </div>
    </Work>
  );
}
