"use client";
import { useState } from "react";
import { apiFetch } from "../lib/client-request";
import { useRouter } from "next/navigation";
import { JobStream } from "./job-stream";
import { Spinner } from "./processing";

export function ApiAction({
  url,
  label,
  body,
  kind = "primary",
  navigateTo,
  pendingLabel,
}: {
  url: string;
  label: string;
  body?: unknown;
  kind?: "primary" | "secondary" | "danger";
  navigateTo?: string;
  pendingLabel?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [job, setJob] = useState<string>();
  const router = useRouter();
  async function act() {
    setBusy(true);
    setError("");
    const response = await apiFetch(url, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.detail ?? "The request could not be completed.");
      if (data.code === "EXECUTION_UNAVAILABLE") router.refresh();
      setBusy(false);
      return;
    }
    if (data.jobId) setJob(data.jobId);
    const target = navigateTo?.replace(":resourceId", data.resourceId ?? "");
    if (target) router.push(target);
    else router.refresh();
    if (!pendingLabel) setBusy(false);
  }
  if (busy && pendingLabel)
    return (
      <span className="processing-label" role="status" aria-live="polite">
        <Spinner />
        {pendingLabel}
      </span>
    );
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
        aria-busy={busy}
        onClick={act}
      >
        {busy ? "Working…" : label}
      </button>
      <JobStream jobId={job} />
    </>
  );
}

/**
 * Enable or disable one case in a draft suite. The API has always supported
 * this; it simply had no control until now. Disabling is blocked once a suite
 * is approved, because an approved version is immutable.
 */
export function CaseToggle({
  evalId,
  caseId,
  enabled,
  locked,
}: {
  evalId: string;
  caseId: string;
  enabled: boolean;
  locked: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  if (locked)
    return (
      <span className="file-kind">{enabled ? "enabled" : "disabled"}</span>
    );
  return (
    <button
      className="btn quiet"
      disabled={busy}
      aria-busy={busy}
      aria-pressed={enabled}
      onClick={async () => {
        setBusy(true);
        await apiFetch(`/api/v1/evals/${evalId}/cases/${caseId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: !enabled }),
        });
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? "Saving…" : enabled ? "Disable" : "Enable"}
    </button>
  );
}

export function UploadForm({
  compact = false,
  skillId,
}: {
  compact?: boolean;
  skillId?: string;
}) {
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
    if (roots.length)
      form.set("selectedRoot", root === "__archive_root__" ? "" : root);
    if (skillId) form.set("skillId", skillId);
    const response = await apiFetch("/api/v1/skill/upload", {
      method: "POST",
      body: form,
    });
    const data = await response.json();
    if (response.status === 409 && data.code === "ROOT_SELECTION_REQUIRED") {
      setRoots(data.candidates);
      setError(
        "This archive contains more than one SKILL.md. Choose which one is the package root, then upload again.",
      );
      setBusy(false);
      return;
    }
    if (!response.ok) {
      setError(data.detail ?? "The package could not be read.");
      setBusy(false);
      return;
    }
    router.push(`/skill?skill=${data.skillId}&version=${data.resourceId}`);
    router.refresh();
  }
  return (
    <form className="upload" onSubmit={submit}>
      {!compact && (
        <p className="lede">
          The ZIP is inspected, never executed. Task material is what lets
          SkillEd tell a correct answer from a confident one.
        </p>
      )}

      <div className="dropzone">
        <label htmlFor={compact ? "skill-new" : "skill-zip"}>Skill ZIP</label>
        <input
          id={compact ? "skill-new" : "skill-zip"}
          required
          name="skill"
          type="file"
          accept=".zip,application/zip"
        />
      </div>

      <div className="field">
        <label htmlFor={compact ? "task-new" : "task"}>
          What should this Skill reliably accomplish?
        </label>
        <textarea
          id={compact ? "task-new" : "task"}
          required
          name="taskDescription"
          placeholder="Describe the real task, the required output, the rules that cannot be broken, and what a dangerous false pass would look like."
        />
      </div>

      <div className="field">
        <label htmlFor={compact ? "materials-new" : "materials"}>
          Task materials (dataset, authority, examples, or expected outputs)
        </label>
        <input
          id={compact ? "materials-new" : "materials"}
          name="taskFile"
          type="file"
          multiple
          onChange={(event) =>
            setMaterials(
              Array.from(event.target.files ?? []).map((file) => file.name),
            )
          }
        />
        <small>
          Datasets, authoritative rules, expected outputs, examples, or recorded
          failures. Stronger material produces stronger evidence.
        </small>
      </div>

      {materials.map((filename) => (
        <div className="field" key={filename}>
          <label htmlFor={`kind-${filename}`}>{filename} provides</label>
          <select
            id={`kind-${filename}`}
            name={`kind:${filename}`}
            defaultValue="dataset"
          >
            <option value="dataset">Dataset or coverage</option>
            <option value="authority">Authoritative rules</option>
            <option value="expected">Expected outputs</option>
            <option value="example">Behavioural examples</option>
            <option value="past_failure">Recorded failures</option>
          </select>
          <label htmlFor={`visibility-${filename}`}>
            Who can read {filename}?
          </label>
          <select
            id={`visibility-${filename}`}
            name={`visibility:${filename}`}
            defaultValue=""
          >
            <option value="">
              Automatic: datasets to agent; other material to judges
            </option>
            <option value="agent_input">Tested agent and judges</option>
            <option value="judge_only">Judges only</option>
          </select>
        </div>
      ))}

      {roots.length > 0 && (
        <div className="field">
          <label htmlFor={compact ? "root-new" : "root"}>Skill root</label>
          <select
            id={compact ? "root-new" : "root"}
            value={root}
            onChange={(event) => setRoot(event.target.value)}
            required
          >
            <option value="">Select a root</option>
            {roots.map((value) => (
              <option key={value} value={value || "__archive_root__"}>
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

      <button className="btn" disabled={busy} aria-busy={busy}>
        {busy ? "Inspecting package…" : "Upload and inspect"}
      </button>
    </form>
  );
}

export function EvalQuestionsForm({
  evalId,
  questions,
}: {
  evalId: string;
  questions: Array<{
    id: string;
    prompt: string;
    whyItMatters: string;
    required: boolean;
    answerType: "text" | "choice";
    choices: string[];
  }>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [job, setJob] = useState<string>();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const answers = Object.fromEntries(
      questions.map((question) => [
        question.id,
        String(form.get(question.id) ?? "").trim(),
      ]),
    );
    const response = await apiFetch(`/api/v1/evals/${evalId}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    const data = await response.json();
    if (!response.ok)
      setError(data.detail ?? "The answers could not be saved.");
    else setJob(data.jobId);
    setBusy(false);
  }
  return (
    <form className="question-form" onSubmit={submit}>
      {questions.map((question) => (
        <fieldset key={question.id}>
          <legend>{question.prompt}</legend>
          <p className="why">{question.whyItMatters}</p>
          {question.answerType === "choice" && question.choices.length ? (
            <select name={question.id} required={question.required}>
              <option value="">Select an answer</option>
              {question.choices.map((choice) => (
                <option key={choice}>{choice}</option>
              ))}
            </select>
          ) : (
            <textarea
              name={question.id}
              required={question.required}
              placeholder="Give the rule Codex should apply when it designs the cases."
            />
          )}
        </fieldset>
      ))}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <button className="btn" disabled={busy} aria-busy={busy}>
        {busy ? "Saving answers…" : "Save answers"}
      </button>
      <JobStream jobId={job} />
    </form>
  );
}

export function ConversationForm({
  url,
  placeholder = "Ask Codex to explain or revise this work…",
  initialMessage = "",
}: {
  url: string;
  placeholder?: string;
  initialMessage?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [job, setJob] = useState<string>();
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = String(new FormData(form).get("message") ?? "").trim();
    if (!message) return;
    setBusy(true);
    setError("");
    const response = await apiFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await response.json();
    if (!response.ok) setError(data.detail ?? "The message was not delivered.");
    else {
      form.reset();
      setJob(data.jobId);
    }
    setBusy(false);
  }
  return (
    <form className="conversation-form" onSubmit={submit}>
      <label className="sr-only" htmlFor={`message-${url}`}>
        Message Codex
      </label>
      <textarea
        id={`message-${url}`}
        name="message"
        defaultValue={initialMessage}
        placeholder={placeholder}
      />
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <button className="btn secondary" disabled={busy} aria-busy={busy}>
        {busy ? "Sending…" : "Send to Codex"}
      </button>
      <JobStream jobId={job} />
    </form>
  );
}
