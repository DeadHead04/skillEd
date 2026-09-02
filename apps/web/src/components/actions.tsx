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
    router.push(
      data.evalId
        ? `/evals/${data.evalId}?skill=${data.skillId}`
        : `/skill?skill=${data.skillId}`,
    );
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
    const response = await fetch(`/api/v1/evals/${evalId}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers }),
    });
    const data = await response.json();
    if (!response.ok) setError(data.detail ?? "Answers could not be saved");
    else setJob(data.jobId);
    setBusy(false);
  }
  return (
    <form className="question-form" onSubmit={submit}>
      {questions.map((question, index) => (
        <fieldset key={question.id}>
          <legend>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {question.prompt}
          </legend>
          <p>{question.whyItMatters}</p>
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
              placeholder="Give the rule Codex should use when designing the evals."
            />
          )}
        </fieldset>
      ))}
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <button className="btn" disabled={busy}>
        {busy ? "Saving answers…" : "Save answers and build plan"}
      </button>
      <JobStream jobId={job} />
    </form>
  );
}

export function ConversationForm({
  url,
  placeholder = "Ask Codex to explain or revise this work…",
}: {
  url: string;
  placeholder?: string;
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
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await response.json();
    if (!response.ok) setError(data.detail ?? "Message failed");
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
        placeholder={placeholder}
      />
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      <button className="btn secondary" disabled={busy}>
        {busy ? "Sending…" : "Send to Codex"}
      </button>
      <JobStream jobId={job} />
    </form>
  );
}
