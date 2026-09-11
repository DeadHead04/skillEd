"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/client-request";
import { ApiAction } from "./actions";
import { Spinner } from "./processing";

export function NewEvaluationForm({
  versions,
  skillId,
  selectedVersionId,
}: {
  selectedVersionId?: string;
  versions: Array<{ id: string; version: number }>;
  skillId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const form = new FormData(event.currentTarget);
        const response = await apiFetch("/api/v1/evals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(Object.fromEntries(form)),
        });
        const data = await response.json();
        setBusy(false);
        if (!response.ok)
          setError(data.detail ?? "Evaluation could not be created");
        else router.push(`/evals/${data.resourceId}?skill=${skillId}`);
      }}
    >
      <div className="field">
        <label htmlFor="evaluation-version">Skill version</label>
        <select
          id="evaluation-version"
          name="skillVersionId"
          defaultValue={selectedVersionId}
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              Version {v.version}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="evaluation-task">
          What should this evaluation prove?
        </label>
        <textarea
          id="evaluation-task"
          name="taskDescription"
          required
          maxLength={100_000}
        />
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      <button className="btn" disabled={busy} aria-busy={busy}>
        {busy ? "Creating…" : "New evaluation"}
      </button>
    </form>
  );
}

export function RunConfiguration({
  skillVersionId,
  evalVersionId,
  skillId,
  cases,
}: {
  skillVersionId: string;
  evalVersionId: string;
  skillId: string;
  cases: Array<{ case_id: string; title: string; enabled: boolean }>;
}) {
  const enabled = cases.filter((c) => c.enabled);
  const [selected, setSelected] = useState(enabled.map((c) => c.case_id));
  const [trials, setTrials] = useState(1);
  const [baseline, setBaseline] = useState(false);
  return (
    <div>
      <p>
        Select the approved checks to run. Each trial starts fresh. A baseline
        repeats the task without the Skill.
      </p>
      <fieldset>
        <legend>Cases ({selected.length} selected, maximum 50)</legend>
        {enabled.map((c) => (
          <label style={{ display: "block", marginBottom: 8 }} key={c.case_id}>
            <input
              type="checkbox"
              checked={selected.includes(c.case_id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, c.case_id]
                    : selected.filter((id) => id !== c.case_id),
                )
              }
            />{" "}
            {c.case_id} · {c.title}
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor="trials">Repeated trials</label>
        <select
          id="trials"
          value={trials}
          onChange={(e) => setTrials(Number(e.target.value))}
        >
          {[1, 2, 3].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <label>
        <input
          type="checkbox"
          checked={baseline}
          onChange={(e) => setBaseline(e.target.checked)}
        />{" "}
        Include a baseline without the Skill
      </label>
      <p>
        <b>{selected.length * trials * (baseline ? 2 : 1)} task executions</b>,
        plus the configured judges. Execution is sequential; model token usage
        varies by task.
      </p>
      {!!selected.length && (
        <ApiAction
          url="/api/v1/runs/launch"
          label="Launch evaluation"
          navigateTo={`/runs/:resourceId?skill=${skillId}`}
          body={{
            skillVersionId,
            evalVersionId,
            selectedCaseIds: selected,
            iterations: trials,
            baseline,
            model: "gpt-5.6-luna",
          }}
        />
      )}
    </div>
  );
}

export function MaterialManager({
  evalId,
  revision,
  editable,
  files,
}: {
  evalId: string;
  revision: number;
  editable: boolean;
  files: Array<any>;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function change(id: string, value: unknown) {
    setBusy(true);
    const response = await apiFetch(`/api/v1/evals/${evalId}/materials/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(value as object),
        expectedRevision: revision,
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) setError(data.detail);
    else router.refresh();
  }
  return (
    <section className="section">
      <div className="section-head">
        <h2>Task material</h2>
        <span className="section-note">
          {busy ? (
            <span className="processing-label">
              <Spinner /> Updating materials…
            </span>
          ) : editable ? (
            "Editable while this suite is a draft"
          ) : (
            "Frozen"
          )}
        </span>
      </div>
      <div>
        {files.map((file) => (
          <div className="field" key={file.id}>
            <b>{file.filename}</b> · {file.kind}
            {file.artifact_key ? (
              <>
                {" "}
                ·{" "}
                <a
                  href={`/api/v1/evals/${evalId}/materials/${file.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Preview or download
                </a>
              </>
            ) : (
              <p>{file.metadata?.text}</p>
            )}
            {editable && file.kind !== "task" && (
              <>
                <select
                  aria-label={`Category for ${file.filename}`}
                  value={file.kind}
                  disabled={busy}
                  aria-busy={busy}
                  onChange={(e) => change(file.id, { kind: e.target.value })}
                >
                  {[
                    "dataset",
                    "authority",
                    "example",
                    "expected",
                    "past_failure",
                  ].map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                </select>
                <label>
                  Who can read this file?
                  <select
                    aria-label={`Visibility for ${file.filename}`}
                    value={
                      file.metadata?.visibility ??
                      (file.kind === "dataset" ? "agent_input" : "judge_only")
                    }
                    disabled={busy || file.kind === "expected"}
                    aria-busy={busy}
                    onChange={(e) =>
                      change(file.id, { visibility: e.target.value })
                    }
                  >
                    <option value="agent_input">Tested agent and judges</option>
                    <option value="judge_only">Judges only</option>
                  </select>
                </label>
                <button
                  className="btn secondary"
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() => change(file.id, { remove: true })}
                >
                  Remove
                </button>
              </>
            )}
          </div>
        ))}
        {editable && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const form = new FormData(e.currentTarget);
              form.set("expectedRevision", String(revision));
              const response = await apiFetch(
                `/api/v1/evals/${evalId}/materials`,
                { method: "POST", body: form },
              );
              const data = await response.json();
              setBusy(false);
              if (!response.ok) setError(data.detail);
              else router.refresh();
            }}
          >
            <label htmlFor="additional-materials">Add task inputs</label>
            <input
              id="additional-materials"
              name="taskFile"
              type="file"
              multiple
              required
            />
            <button className="btn secondary" disabled={busy} aria-busy={busy}>
              Add materials
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="error-box">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
