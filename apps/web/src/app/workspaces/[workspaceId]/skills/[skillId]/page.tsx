import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  Download,
  File,
  FileText,
  Folder,
  Info,
  PackageOpen,
  ShieldCheck,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileSystemArtifactStore } from "@skilled/artifact-store";
import { fileCounts } from "@skilled/domain";
import { getSkillDetail } from "@skilled/db";
import {
  isInlineImage,
  isPreviewableText,
  parseSkillDocument,
} from "@skilled/skill-package";
import { StatusBadge } from "../../../../../components/status-badge";

export const dynamic = "force-dynamic";

type Tab = "overview" | "files" | "tests" | "runs" | "statistics";

function detailHref(
  workspaceId: string,
  skillId: string,
  tab: Tab,
  file?: string,
) {
  const search = new URLSearchParams();
  if (tab !== "overview") search.set("tab", tab);
  if (file) search.set("file", file);
  const suffix = search.toString();
  return `/workspaces/${workspaceId}/skills/${skillId}${suffix ? `?${suffix}` : ""}`;
}

export default async function SkillDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; skillId: string }>;
  searchParams: Promise<{ tab?: string; file?: string }>;
}) {
  const { workspaceId, skillId } = await params;
  const search = await searchParams;
  const tab: Tab = ["files", "tests", "runs", "statistics"].includes(
    search.tab ?? "",
  )
    ? (search.tab as Tab)
    : "overview";
  const detail = await getSkillDetail(workspaceId, skillId);
  if (!detail) notFound();
  const { skill, version, findings, importer } = detail;
  const counts = fileCounts(version.packageManifest);
  const firstFile =
    version.packageManifest.files.find(
      (item) => item.relativePath === "SKILL.md",
    ) ?? version.packageManifest.files[0];
  const selectedPath = version.packageManifest.files.some(
    (item) => item.relativePath === search.file,
  )
    ? search.file!
    : firstFile?.relativePath;
  const selectedFile = version.packageManifest.files.find(
    (item) => item.relativePath === selectedPath,
  );
  const store = new FileSystemArtifactStore();
  let preview: Buffer | null = null;
  if (
    selectedFile &&
    selectedFile.byteSize <= 512 * 1024 &&
    isPreviewableText(selectedFile.mediaType)
  ) {
    preview = await store.readFile(
      version.artifactKey,
      selectedFile.relativePath,
    );
  }
  const skillDocument = await store
    .readFile(version.artifactKey, "SKILL.md")
    .catch(() => null);
  const body = skillDocument
    ? parseSkillDocument(skillDocument.toString("utf8")).body
    : "";
  const sourceLabel =
    skill.sourceType === "github" ? "GitHub repository" : "Uploaded package";
  const fileUrl = selectedFile
    ? `/api/v1/workspaces/${workspaceId}/skills/${skill.id}/versions/${version.id}/files/${selectedFile.relativePath.split("/").map(encodeURIComponent).join("/")}`
    : "";

  return (
    <main className="page">
      <header className="detail-header">
        <div className="breadcrumb">
          <Link href={`/workspaces/${workspaceId}/skills`}>Skills</Link>
          <span>/</span>
          <span>{skill.name}</span>
        </div>
        <div className="detail-title-row">
          <div className="skill-icon">
            <PackageOpen size={31} />
          </div>
          <div className="detail-heading">
            <h1>{skill.name}</h1>
            <p>{skill.description}</p>
            <div className="badge-row">
              <StatusBadge status={version.validationStatus} />
              <span className="version-badge">
                {version.versionKey.slice(0, 12)}
              </span>
            </div>
          </div>
        </div>
        <nav className="tabs" aria-label="Skill detail">
          {(["overview", "files", "tests", "runs", "statistics"] as const).map(
            (item) => (
              <Link
                className={`tab ${tab === item ? "active" : ""}`}
                href={detailHref(workspaceId, skill.id, item)}
                key={item}
              >
                {item[0]!.toUpperCase() + item.slice(1)}
                {["tests", "runs", "statistics"].includes(item) && (
                  <span className="later">Coming later</span>
                )}
              </Link>
            ),
          )}
        </nav>
      </header>

      <div className="detail-body">
        {tab === "overview" && (
          <div className="overview-grid">
            <section className="panel">
              <h2>Instructions overview</h2>
              <div className="notice warning" style={{ marginBottom: 18 }}>
                <AlertTriangle size={18} />
                Scripts, references, and assets are inspected but never executed
                in Phase 1.
              </div>
              <div className="markdown-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                  {body}
                </ReactMarkdown>
              </div>
            </section>
            <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
              <section className="panel">
                <h2>Provenance</h2>
                <dl className="provenance-grid">
                  <dt>Source</dt>
                  <dd>{sourceLabel}</dd>
                  <dt>
                    {skill.sourceType === "github" ? "Repository" : "Upload"}
                  </dt>
                  <dd>{skill.sourceLocator}</dd>
                  <dt>Source identity</dt>
                  <dd>{skill.sourceIdentity}</dd>
                  <dt>Source path</dt>
                  <dd>{skill.sourcePath}</dd>
                  <dt>Version</dt>
                  <dd>{version.sourceCommit ?? version.versionKey}</dd>
                  <dt>Package checksum</dt>
                  <dd>sha256:{version.packageChecksum}</dd>
                  <dt>Imported by</dt>
                  <dd>{importer?.name ?? "Unknown user"}</dd>
                  <dt>Imported at</dt>
                  <dd>{version.importedAt.toLocaleString()}</dd>
                </dl>
              </section>
              <section className="panel">
                <h2>Package</h2>
                <dl className="provenance-grid">
                  {Object.entries(counts).map(([key, value]) => (
                    <div style={{ display: "contents" }} key={key}>
                      <dt>{key}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="panel">
                <h2>Validation</h2>
                <div className="validation-list">
                  {findings.length === 0 ? (
                    <div className="status valid">
                      <ShieldCheck size={16} />
                      No findings
                    </div>
                  ) : (
                    findings.map((finding) => (
                      <div
                        className={`finding ${finding.severity}`}
                        key={finding.id}
                      >
                        {finding.message}
                        <div style={{ opacity: 0.75 }}>
                          {finding.relativePath}
                          {finding.line ? `:${finding.line}` : ""}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        )}

        {tab === "files" && (
          <div className="files-layout">
            <section className="panel">
              <h2>Package files</h2>
              <ul className="file-tree">
                {version.packageManifest.files.map((item) => (
                  <li key={item.relativePath}>
                    <Link
                      className={`file-link ${selectedPath === item.relativePath ? "active" : ""}`}
                      href={detailHref(
                        workspaceId,
                        skill.id,
                        "files",
                        item.relativePath,
                      )}
                    >
                      {item.relativePath.includes("/") ? (
                        <Folder size={15} />
                      ) : item.relativePath.endsWith(".md") ? (
                        <FileText size={15} />
                      ) : (
                        <File size={15} />
                      )}
                      {item.relativePath}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="notice warning" style={{ marginTop: 18 }}>
                <AlertTriangle size={16} />
                Files are read-only and never executed.
              </div>
            </section>
            <section className="panel preview-panel">
              <div className="panel-titlebar">
                <span>
                  Safe preview · {selectedFile?.relativePath ?? "No file"}
                </span>
                {selectedFile && (
                  <a href={`${fileUrl}?download=1`}>
                    <Download size={16} aria-label="Download file" />
                  </a>
                )}
              </div>
              {!selectedFile ? (
                <div className="preview-fallback">No file selected.</div>
              ) : preview ? (
                <pre className="code-preview">{preview.toString("utf8")}</pre>
              ) : isInlineImage(selectedFile.mediaType) &&
                selectedFile.byteSize <= 5 * 1024 * 1024 ? (
                <div className="image-preview">
                  <img
                    src={fileUrl}
                    alt={`Preview of ${selectedFile.relativePath}`}
                  />
                </div>
              ) : (
                <div className="preview-fallback">
                  <div>
                    <Info size={28} />
                    <h3>Preview unavailable</h3>
                    <p>
                      This binary or oversized file is available only as a safe
                      attachment.
                    </p>
                    <a className="button" href={`${fileUrl}?download=1`}>
                      <Download size={16} />
                      Download
                    </a>
                  </div>
                </div>
              )}
            </section>
            <aside className="panel files-meta">
              <h2>File metadata</h2>
              {selectedFile ? (
                <dl className="provenance-grid">
                  <dt>Path</dt>
                  <dd>{selectedFile.relativePath}</dd>
                  <dt>Category</dt>
                  <dd>{selectedFile.category}</dd>
                  <dt>Media type</dt>
                  <dd>{selectedFile.mediaType}</dd>
                  <dt>Size</dt>
                  <dd>{selectedFile.byteSize.toLocaleString()} bytes</dd>
                  <dt>Checksum</dt>
                  <dd>{selectedFile.checksum}</dd>
                </dl>
              ) : (
                <p>No file selected.</p>
              )}
              <h3 style={{ marginTop: 24 }}>Validation</h3>
              <div className="validation-list">
                {findings
                  .filter(
                    (finding) =>
                      !selectedFile ||
                      finding.relativePath === selectedFile.relativePath ||
                      finding.relativePath === `${selectedFile.category}/`,
                  )
                  .map((finding) => (
                    <div
                      className={`finding ${finding.severity}`}
                      key={finding.id}
                    >
                      {finding.message}
                    </div>
                  ))}
              </div>
            </aside>
          </div>
        )}

        {["tests", "runs", "statistics"].includes(tab) && (
          <section className="panel future-empty">
            <div className="empty-icon">
              <Info />
            </div>
            <h2>{tab[0]!.toUpperCase() + tab.slice(1)} are coming later</h2>
            <p>
              Phase 1 only imports, validates, catalogs, and safely inspects
              Skill packages.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
