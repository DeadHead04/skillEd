"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { JobStream } from "./job-stream";
export function ApiAction({
  url,
  label,
  body,
  kind = "primary",
  navigateTo,
}: {
  url: string;
  label: string;
  body?: unknown;
  kind?: "primary" | "secondary" | "danger";
  navigateTo?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [job, setJob] = useState<string>();
  const router = useRouter();
  async function act() {
    setBusy(true);
    setError("");
    const response = await fetch(url, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.detail ?? "Request failed");
      setBusy(false);
      return;
    }
    if (data.jobId) setJob(data.jobId);
    const target = navigateTo?.replace(":resourceId", data.resourceId ?? "");
    if (target) router.push(target);
    else router.refresh();
    setBusy(false);
  }
  return (
    <>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <button
        className={`btn ${kind === "secondary" ? "secondary" : kind === "danger" ? "danger" : ""}`}
        disabled={busy}
        onClick={act}
      >
        {busy ? "Working…" : label}
      </button>
      <JobStream jobId={job} />
    </>
  );
}

export function UploadForm() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [roots, setRoots] = useState<string[]>([]),
    [root, setRoot] = useState(""),
    [materials, setMaterials] = useState<string[]>([]);
  const router = useRouter();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    if (root) form.set("selectedRoot", root);
    const response = await fetch("/api/v1/skill/upload", {
      method: "POST",
      body: form,
    });
    const data = await response.json();
    if (response.status === 409 && data.code === "ROOT_SELECTION_REQUIRED") {
      setRoots(data.candidates);
      setError("Choose which SKILL.md is the package root, then upload again.");
      setBusy(false);
      return;
    }
    if (!response.ok) {
      setError(data.detail ?? "Upload failed");
      setBusy(false);
      return;
    }
    router.push(`/evals/${data.evalId}`);
    router.refresh();
  }
  return (
    <form onSubmit={submit}>
      <div className="upload">
        <div className="eyebrow">Skill package</div>
        <h2>Drop in one installable ZIP</h2>
        <p>Archive contents are inspected without executing uploaded code.</p>
        <input
          required
          name="skill"
          type="file"
          accept=".zip,application/zip"
          aria-label="Skill ZIP"
        />
        <div className="field">
          <label htmlFor="task">
            What should this Skill reliably accomplish?
          </label>
          <textarea
            id="task"
            required
            name="taskDescription"
            placeholder="Describe the real task, required output, hard rules, and what a dangerous false PASS looks like."
          />
        </div>
        <div className="field">
          <label htmlFor="materials">
            Task materials (dataset, authority, examples, or expected outputs)
          </label>
          <input
            id="materials"
            name="taskFile"
            type="file"
            multiple
            onChange={(event) =>
              setMaterials(
                Array.from(event.target.files ?? []).map((file) => file.name),
              )
            }
          />
        </div>
        {materials.map((filename) => (
          <div className="field" key={filename}>
            <label htmlFor={`kind-${filename}`}>{filename} provides</label>
            <select
              id={`kind-${filename}`}
              name={`kind:${filename}`}
              defaultValue="dataset"
            >
              <option value="dataset">Dataset / coverage</option>
              <option value="authority">Authoritative rules</option>
              <option value="expected">Expected outputs</option>
              <option value="example">Behavioral examples</option>
              <option value="past_failure">Recorded failures</option>
            </select>
          </div>
        ))}
        {roots.length > 0 && (
          <div className="field">
            <label htmlFor="root">Skill root</label>
            <select
              id="root"
              value={root}
              onChange={(e) => setRoot(e.target.value)}
              required
            >
              <option value="">Select a root</option>
              {roots.map((value) => (
                <option key={value} value={value}>
                  {value || "Archive root"}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <button className="btn" disabled={busy}>
          {busy ? "Inspecting package…" : "Upload and inspect"}
        </button>
      </div>
    </form>
  );
}
