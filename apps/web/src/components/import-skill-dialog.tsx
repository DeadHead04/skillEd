"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertCircle,
  CheckCircle2,
  FileArchive,
  FolderOpen,
  Github,
  Import,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportCandidateView, ImportState } from "@skilled/domain";
import { StatusBadge } from "./status-badge";

interface ImportJobView {
  id: string;
  state: ImportState;
  errorCode: string | null;
  errorMessage: string | null;
  candidates: ImportCandidateView[];
}

type SourceChoice = "github" | "zip" | "folder";

const PROGRESS_LABELS: Partial<Record<ImportState, string>> = {
  queued: "Queued",
  acquiring: "Acquiring package",
  scanning: "Scanning safely",
  persisting: "Saving immutable versions",
};

export function ImportSkillDialog({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<SourceChoice>("github");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [reference, setReference] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [connection, setConnection] = useState<{
    connected: boolean;
    accountLogin: string | null;
  } | null>(null);
  const [job, setJob] = useState<ImportJobView | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void fetch(`/api/v1/workspaces/${workspaceId}/connections/github`)
      .then((response) => response.json())
      .then((data) =>
        setConnection(
          data as { connected: boolean; accountLogin: string | null },
        ),
      )
      .catch(() => setConnection({ connected: false, accountLogin: null }));
  }, [open, workspaceId]);

  useEffect(() => {
    if (
      !job ||
      ["awaiting_selection", "completed", "failed", "expired"].includes(
        job.state,
      )
    )
      return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/v1/workspaces/${workspaceId}/imports/${job.id}`,
          {
            cache: "no-store",
          },
        );
        if (!response.ok) throw new Error("Unable to read import progress.");
        const next = (await response.json()) as ImportJobView;
        setJob(next);
        if (next.state === "awaiting_selection") {
          setSelected(
            new Set(next.candidates.map((candidate) => candidate.id)),
          );
        }
        if (next.state === "completed") router.refresh();
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to read import progress.",
        );
      }
    }, 850);
    return () => window.clearTimeout(timer);
  }, [job, router, workspaceId]);

  function reset() {
    setSource("github");
    setRepositoryUrl("");
    setReference("");
    setZipFile(null);
    setFolderFiles([]);
    setJob(null);
    setSelected(new Set());
    setBusy(false);
    setMessage(null);
  }

  async function connectGithub() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/v1/workspaces/${workspaceId}/connections/github`,
        { method: "POST" },
      );
      if (!response.ok)
        throw new Error("GitHub App installation is not configured.");
      const result = (await response.json()) as { installUrl: string };
      window.location.assign(result.installUrl);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to connect GitHub.",
      );
      setBusy(false);
    }
  }

  async function startImport() {
    setBusy(true);
    setMessage(null);
    try {
      let response: Response;
      if (source === "github") {
        response = await fetch(
          `/api/v1/workspaces/${workspaceId}/imports/github`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              repositoryUrl,
              ...(reference.trim() ? { ref: reference.trim() } : {}),
            }),
          },
        );
      } else {
        const form = new FormData();
        form.set("mode", source);
        if (source === "zip") {
          if (!zipFile) throw new Error("Choose a ZIP file.");
          form.set("uploadName", zipFile.name.replace(/\.zip$/i, ""));
          form.set("file", zipFile);
        } else {
          if (folderFiles.length === 0) throw new Error("Choose a folder.");
          const firstPath =
            folderFiles[0]?.webkitRelativePath ||
            folderFiles[0]?.name ||
            "folder";
          form.set("uploadName", firstPath.split("/")[0] ?? "folder");
          for (const file of folderFiles) {
            form.append("files", file);
            form.append("paths", file.webkitRelativePath || file.name);
          }
        }
        response = await fetch(
          `/api/v1/workspaces/${workspaceId}/imports/upload`,
          {
            method: "POST",
            body: form,
          },
        );
      }
      const data = (await response.json()) as
        | { importId: string; status: ImportState }
        | { error: { message: string } };
      if (!response.ok || !("importId" in data)) {
        throw new Error(
          "error" in data ? data.error.message : "Import could not start.",
        );
      }
      setJob({
        id: data.importId,
        state: data.status,
        errorCode: null,
        errorMessage: null,
        candidates: [],
      });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Import could not start.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function importSelection() {
    if (!job || selected.size === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/v1/workspaces/${workspaceId}/imports/${job.id}/selections`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateIds: [...selected] }),
        },
      );
      const data = (await response.json()) as
        | { importId: string; status: ImportState }
        | { error: { message: string } };
      if (!response.ok || !("importId" in data)) {
        throw new Error(
          "error" in data
            ? data.error.message
            : "Selection could not be saved.",
        );
      }
      setJob({ ...job, state: "persisting" });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Selection could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  const step = job?.state === "awaiting_selection" ? 3 : job ? 2 : 1;
  const selectedCount = selected.size;
  const progressLabel = job ? PROGRESS_LABELS[job.state] : undefined;
  const uploadSummary = useMemo(() => {
    if (source === "zip") return zipFile?.name ?? "No ZIP selected";
    if (source === "folder")
      return folderFiles.length
        ? `${folderFiles.length} files selected`
        : "No folder selected";
    return null;
  }, [folderFiles.length, source, zipFile]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Dialog.Trigger asChild>
        <button className="button primary">
          <Import size={18} />
          Import Skill
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content"
          aria-describedby="import-description"
        >
          <div className="dialog-header">
            <div>
              <Dialog.Title className="dialog-title">
                {step === 3 ? "Review detected Skills" : "Import Skill"}
              </Dialog.Title>
              <Dialog.Description
                id="import-description"
                style={{ color: "var(--ink-500)", marginTop: 5 }}
              >
                Packages are scanned and validated without executing their
                contents.
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close import">
              <X />
            </Dialog.Close>
          </div>

          <div className="stepper" aria-label={`Import step ${step} of 3`}>
            <div className={`step ${step >= 1 ? "active" : ""}`}>1. Source</div>
            <div className={`step ${step >= 2 ? "active" : ""}`}>2. Scan</div>
            <div className={`step ${step >= 3 ? "active" : ""}`}>3. Select</div>
          </div>

          <div
            aria-live="polite"
            className={message ? "finding error" : undefined}
          >
            {message}
          </div>

          {!job && (
            <>
              <section
                className={`source-card ${source === "github" ? "selected" : ""}`}
              >
                <button
                  className="source-heading"
                  style={{
                    border: 0,
                    background: "transparent",
                    width: "100%",
                  }}
                  onClick={() => setSource("github")}
                >
                  <Github size={21} /> GitHub repository
                </button>
                {source === "github" && (
                  <div className="form-grid">
                    {connection?.connected ? (
                      <div className="status valid">
                        <CheckCircle2 size={15} />
                        Connected as {connection.accountLogin}
                      </div>
                    ) : (
                      <div className="notice warning">
                        <AlertCircle size={18} />
                        <span>
                          Install the GitHub App to authorize public and private
                          repository access.
                        </span>
                        <button
                          className="button"
                          onClick={() => void connectGithub()}
                          disabled={busy}
                        >
                          Connect
                        </button>
                      </div>
                    )}
                    <label className="form-label">
                      Repository URL
                      <input
                        className="field"
                        type="url"
                        placeholder="https://github.com/acme/skills"
                        value={repositoryUrl}
                        onChange={(event) =>
                          setRepositoryUrl(event.target.value)
                        }
                      />
                    </label>
                    <label className="form-label">
                      Optional branch, tag, or commit
                      <input
                        className="field"
                        placeholder="Defaults to the repository's default branch"
                        value={reference}
                        onChange={(event) => setReference(event.target.value)}
                      />
                    </label>
                    <div className="notice">
                      <ShieldCheck size={17} />
                      Credentials are never copied into Skill packages.
                    </div>
                  </div>
                )}
              </section>

              <section
                className={`source-card ${source !== "github" ? "selected" : ""}`}
              >
                <div className="source-heading">
                  <FileArchive size={21} /> ZIP or folder
                </div>
                <div className="dropzone">
                  <p style={{ margin: 0 }}>
                    Choose a bounded ZIP archive or browser folder.
                  </p>
                  <div className="dropzone-actions">
                    <label className="button">
                      <FileArchive size={17} />
                      Choose ZIP
                      <input
                        hidden
                        type="file"
                        accept=".zip,application/zip"
                        onChange={(event) => {
                          setSource("zip");
                          setZipFile(event.target.files?.[0] ?? null);
                        }}
                      />
                    </label>
                    <label className="button">
                      <FolderOpen size={17} />
                      Choose folder
                      <input
                        ref={(element) =>
                          element?.setAttribute("webkitdirectory", "")
                        }
                        hidden
                        type="file"
                        multiple
                        onChange={(event) => {
                          setSource("folder");
                          setFolderFiles(Array.from(event.target.files ?? []));
                        }}
                      />
                    </label>
                  </div>
                  {uploadSummary && (
                    <p style={{ color: "var(--ink-500)", fontSize: 12 }}>
                      {uploadSummary}
                    </p>
                  )}
                </div>
              </section>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  className="button primary"
                  disabled={
                    busy ||
                    (source === "github"
                      ? !connection?.connected || !repositoryUrl
                      : source === "zip"
                        ? !zipFile
                        : folderFiles.length === 0)
                  }
                  onClick={() => void startImport()}
                >
                  {busy
                    ? "Starting…"
                    : source === "github"
                      ? "Scan repository"
                      : "Scan upload"}
                </button>
              </div>
            </>
          )}

          {job && progressLabel && (
            <section className="progress-panel" aria-live="polite">
              <div className="spinner" aria-hidden="true" />
              <h2>{progressLabel}</h2>
              <p style={{ color: "var(--ink-500)" }}>
                This page can be closed; the import continues in the worker.
              </p>
            </section>
          )}

          {job?.state === "failed" && (
            <section className="empty-state">
              <AlertCircle size={34} color="var(--red)" />
              <h2>Import failed</h2>
              <p>{job.errorMessage ?? "The package could not be imported."}</p>
              <button className="button" onClick={() => setJob(null)}>
                Try again
              </button>
            </section>
          )}

          {job?.state === "expired" && (
            <section className="empty-state">
              <AlertCircle size={34} color="var(--amber)" />
              <h2>Import expired</h2>
              <p>
                The 24-hour selection window ended and staged files were
                removed.
              </p>
              <button className="button" onClick={() => setJob(null)}>
                Start again
              </button>
            </section>
          )}

          {job?.state === "awaiting_selection" && (
            <>
              <div className="notice" style={{ marginBottom: 14 }}>
                <CheckCircle2 size={18} />
                Scan completed. Select the Skills to catalog.
              </div>
              {job.candidates.map((candidate) => (
                <article className="candidate" key={candidate.id}>
                  <div className="candidate-head">
                    <input
                      aria-label={`Select ${candidate.name}`}
                      type="checkbox"
                      checked={selected.has(candidate.id)}
                      onChange={() =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (next.has(candidate.id)) next.delete(candidate.id);
                          else next.add(candidate.id);
                          return next;
                        })
                      }
                    />
                    <div>
                      <h3>{candidate.name}</h3>
                      <div className="candidate-path">
                        {candidate.sourcePath}
                      </div>
                    </div>
                    <StatusBadge status={candidate.validationStatus} />
                  </div>
                  <p className="candidate-description">
                    {candidate.description}
                  </p>
                  {candidate.duplicateVersionId && (
                    <div className="notice">
                      Duplicate version detected; the existing immutable version
                      will be reused.
                    </div>
                  )}
                  <div className="file-counts">
                    {Object.entries(candidate.fileCounts).map(
                      ([category, count]) => (
                        <div className="file-count" key={category}>
                          {category}
                          <strong>{count}</strong>
                        </div>
                      ),
                    )}
                  </div>
                  {candidate.findings.slice(0, 4).map((finding, index) => (
                    <div
                      className={`finding ${finding.severity}`}
                      key={`${finding.code}-${index}`}
                    >
                      {finding.message}
                    </div>
                  ))}
                </article>
              ))}
              <div className="dialog-footer">
                <span>
                  {selectedCount} of {job.candidates.length} selected
                </span>
                <div style={{ display: "flex", gap: 9 }}>
                  <button className="button" onClick={() => setJob(null)}>
                    Back
                  </button>
                  <button
                    className="button primary"
                    disabled={busy || selectedCount === 0}
                    onClick={() => void importSelection()}
                  >
                    Import selected Skills
                  </button>
                </div>
              </div>
            </>
          )}

          {job?.state === "completed" && (
            <section className="empty-state">
              <CheckCircle2 size={38} color="var(--green)" />
              <h2>Skills imported</h2>
              <p>The catalog now points to immutable package versions.</p>
              <Dialog.Close className="button primary">
                View catalog
              </Dialog.Close>
            </section>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
