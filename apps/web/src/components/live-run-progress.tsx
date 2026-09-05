"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiAction } from "./actions";
import { Status } from "./ui";
import { type RunStatusExecution } from "../lib/run-progress";
import { createRunStatusPoller } from "../lib/run-status-poller";

type Snapshot = {
  runId: string;
  status: string;
  stage: string;
  completed: number;
  total: number;
  updatedAt: string;
  executions: RunStatusExecution[];
};

// The known stage sequence. No percentage is invented from it.
const STAGES = ["queued", "preparing", "running", "judging", "completed"];

function executionState(execution: RunStatusExecution) {
  if (!execution.provisional && execution.result)
    return { value: execution.result.toLowerCase(), label: execution.result };
  if (execution.reportedStatus)
    return {
      value: "active",
      label: `reported ${execution.reportedStatus.toLowerCase()}`,
    };
  if (execution.state === "active")
    return { value: "active", label: "running" };
  if (execution.state === "completed")
    return { value: "active", label: "completed" };
  return { value: "absent", label: "pending" };
}

export function LiveRunProgress({ runId }: { runId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [delayed, setDelayed] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const pollerRef = useRef<ReturnType<
    typeof createRunStatusPoller<Snapshot>
  > | null>(null);
  const router = useRouter();

  useEffect(() => {
    const poller = createRunStatusPoller<Snapshot>({
      fetchSnapshot: async (signal) => {
        const response = await fetch(`/api/v1/runs/${runId}/status`, {
          cache: "no-store",
          signal,
        });
        if (!response.ok)
          throw new Error(`Status request failed (${response.status})`);
        return response.json();
      },
      onSnapshot: (next) => {
        setSnapshot(next);
        setDelayed(false);
        setRefreshedAt(new Date());
      },
      onDelayed: () => setDelayed(true),
      onTerminal: () => router.refresh(),
    });
    pollerRef.current = poller;
    poller.start();
    const visible = () => {
      if (document.visibilityState === "visible") poller.refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
      document.removeEventListener("visibilitychange", visible);
    };
  }, [runId, router]);

  const stage = snapshot?.stage ?? "queued";
  const stageIndex = Math.max(
    0,
    STAGES.indexOf(stage === "cancelling" ? "running" : stage),
  );
  const manyIterations = Boolean(
    snapshot?.executions.some((item) => item.iteration > 1),
  );

  return (
    <>
      <ol className="steps" style={{ marginTop: 20 }}>
        {STAGES.map((item, index) => (
          <li
            key={item}
            className={
              index < stageIndex ? "done" : index === stageIndex ? "now" : ""
            }
            aria-current={index === stageIndex ? "step" : undefined}
          >
            <span className="glyph" aria-hidden="true">
              {index < stageIndex ? "✓" : index + 1}
            </span>
            {item}
          </li>
        ))}
      </ol>

      {delayed && (
        <p className="notice" role="status">
          <b>Waiting</b>
          The worker has not answered the last status check. Retrying.
        </p>
      )}

      <section className="section">
        <div className="progress-head">
          <h2>Executions</h2>
          <span className="section-note num">
            {snapshot
              ? `${snapshot.completed} of ${snapshot.total} complete`
              : "reading durable progress…"}
          </span>
        </div>
        <div className="rows" aria-live="polite">
          {snapshot?.executions.map((execution) => {
            const state = executionState(execution);
            return (
              <div
                className="row case"
                key={`${execution.caseId}-${execution.configuration}-${execution.iteration}`}
              >
                <span aria-hidden="true">
                  {execution.state === "active" ? (
                    <span className="spinner" />
                  ) : execution.state === "completed" ? (
                    "✓"
                  ) : (
                    "○"
                  )}
                </span>
                <span>
                  <span className="id">{execution.caseId}</span>
                  <span className="sub">
                    {execution.configuration === "without_skill"
                      ? "Baseline, without the Skill"
                      : "With the Skill installed"}
                    {manyIterations ? `, sample ${execution.iteration}` : ""}
                  </span>
                </span>
                <Status value={state.value} label={state.label} />
                <span />
              </div>
            );
          })}
          {snapshot && snapshot.executions.length === 0 && (
            <p className="hint">This run has no enabled executions planned.</p>
          )}
        </div>
      </section>

      <div className="decision">
        <div>
          <b>Running</b>
          <p>
            {refreshedAt
              ? `Last checked ${refreshedAt.toLocaleTimeString()}. Progress is rebuilt from durable worker events.`
              : "Progress is rebuilt from durable worker events."}
          </p>
        </div>
        <div className="decision-actions">
          <button
            className="btn secondary"
            type="button"
            onClick={() => pollerRef.current?.refresh()}
          >
            Check now
          </button>
          <ApiAction
            url={`/api/v1/runs/${runId}/cancel`}
            label="Cancel run"
            kind="danger"
          />
        </div>
      </div>
    </>
  );
}
