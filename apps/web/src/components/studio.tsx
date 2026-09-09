import Link from "next/link";
import type { PackageAssessment } from "@skilled/core";

export function ReadMore({ text }: { text: string }) {
  return (
    <details className="read-more">
      <summary>
        <span>{text}</span>
        <small>Read more</small>
      </summary>
      <p>{text}</p>
    </details>
  );
}
export function FileTree({
  entries,
  base,
}: {
  entries: Array<{ path: string; size?: number }>;
  base: string;
}) {
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const folder = entry.path.includes("/") ? entry.path.split("/")[0]! : "";
    groups.set(folder, [...(groups.get(folder) ?? []), entry]);
  }
  return (
    <div className="package-tree">
      {[...groups]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([folder, files]) =>
          folder ? (
            <details key={folder} open={groups.size < 5}>
              <summary>
                ▱ {folder}
                <small>{files.length}</small>
              </summary>
              {files.map((file) => (
                <Link
                  key={file.path}
                  href={`${base}&file=${encodeURIComponent(file.path)}`}
                >
                  <span aria-hidden="true">↳</span>
                  {file.path.slice(folder.length + 1)}
                </Link>
              ))}
            </details>
          ) : (
            files.map((file) => (
              <Link
                key={file.path}
                href={`${base}&file=${encodeURIComponent(file.path)}`}
              >
                <span aria-hidden="true">◇</span>
                {file.path}
              </Link>
            ))
          ),
        )}
    </div>
  );
}
export function PackageFindings({
  assessment,
  base,
}: {
  assessment: PackageAssessment;
  base: string;
}) {
  return (
    <section className="studio-panel">
      <div className="panel-heading">
        <h2>Package findings</h2>
        <span className="section-note">Static inspection</span>
      </div>
      {!assessment.findings.length && (
        <div className="studio-empty compact">
          <span className="status pass">✓ Structure checked</span>
          <p>
            No structural issues found. Task fitness still needs approved tests.
          </p>
        </div>
      )}
      {assessment.findings.map((f, i) => (
        <div className={`finding-card ${f.severity}`} key={i}>
          <div>
            <span
              className={`status ${f.severity === "blocker" ? "fail" : "partial"}`}
            >
              {f.severity === "blocker"
                ? "! Needs attention"
                : "◇ Recommendation"}
            </span>
            <small>{f.category}</small>
          </div>
          <p>{f.message}</p>
          {f.path && (
            <Link href={`${base}&file=${encodeURIComponent(f.path)}`}>
              {f.path}
              {f.line ? `:${f.line}` : ""} ↗
            </Link>
          )}
          <p className="hint">{f.action}</p>
        </div>
      ))}
      {assessment.references.length > 0 && (
        <details className="resource-links" open>
          <summary>Resource map · {assessment.references.length} links</summary>
          {assessment.references.slice(0, 50).map((r, i) => (
            <div key={i}>
              <Link href={`${base}&file=${encodeURIComponent(r.from)}`}>
                {r.from}:{r.line}
              </Link>
              <span>→</span>
              <span className={r.present ? "status pass" : "status fail"}>
                {r.to} {r.present ? "✓" : "missing"}
              </span>
            </div>
          ))}
          {assessment.references.length > 50 && (
            <p className="hint">
              Showing the first 50 links. Download the assessment for all
              connections.
            </p>
          )}
        </details>
      )}
    </section>
  );
}
