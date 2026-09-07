"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiAction } from "./actions";
import {
  runConfigurationLabel,
  type RunStatusExecution,
} from "../lib/run-progress";
import {
  createRunStatusPoller,
  RUN_STATUS_POLL_INTERVAL_MS,
} from "../lib/run-status-poller";

type Snapshot = {
  runId: string;
  status: string;
  stage: string;
  completed: number;
  total: number;
  updatedAt: string;
  executions: RunStatusExecution[];
};

const stages = ["queued", "preparing", "running", "finalizing", "completed"];
const statusCopy: Record<string, string> = {
  PASS: "Reported pass",
  FAIL: "Reported fail",
  ERROR: "Reported error",
  SKIP: "Reported skip",
};

function executionStatus(execution: RunStatusExecution) {
  if (!execution.provisional && execution.result) return execution.result;
  if (execution.reportedStatus)
    return statusCopy[execution.reportedStatus] ?? execution.reportedStatus;
  if (execution.state === "active") return "Running";
  if (execution.state === "completed") return "Completed";
  return "Pending";
}

export function LiveRunProgress({ runId }: { runId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [delayed, setDelayed] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [refreshCycle, setRefreshCycle] = useState(0);
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
      onScheduled: () => setRefreshCycle((cycle) => cycle + 1),
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
    stages.indexOf(stage === "cancelling" ? "running" : stage),
  );
  return (
    <section className="panel live-run" aria-labelledby="live-run-title">
      <div className="panel-head">
        <div>
          <h2 id="live-run-title">Live execution progress</h2>
          <span className="progress-count">
            {snapshot
              ? `${snapshot.completed} of ${snapshot.total} executions complete`
              : "Loading durable progress…"}
          </span>
        </div>
        <span className="badge info">● {snapshot?.status ?? "Connecting"}</span>
      </div>
      <div className="panel-body">
        <ol className="stage-rail" aria-label="Run stages">
          {stages.map((item, index) => {
            const state =
              index < stageIndex
                ? "done"
                : index === stageIndex
                  ? "current"
                  : "next";
            return (
              <li
                key={item}
                className={state}
                aria-current={state === "current" ? "step" : undefined}
              >
                <span aria-hidden="true">
                  {state === "done" ? "✓" : index + 1}
                </span>
                {item}
              </li>
            );
          })}
        </ol>
        {delayed && (
          <div className="callout warn" role="status">
            Status update delayed; retrying
          </div>
        )}
        <div className="refresh-timer" aria-label="Automatic refresh timer">
          <div>
            <b>Auto-refresh</b>
            <span>
              Next status check in {RUN_STATUS_POLL_INTERVAL_MS / 1_000} seconds
            </span>
          </div>
          <div className="refresh-track" aria-hidden="true">
            <span
              key={refreshCycle}
              style={{
                animationDuration: `${RUN_STATUS_POLL_INTERVAL_MS}ms`,
              }}
            />
          </div>
        </div>
        <div className="execution-list" aria-live="polite">
          <div className="execution-list-head" aria-hidden="true">
            <span>Execution</span>
            <span>Configuration</span>
            <span>Status</span>
          </div>
          {snapshot?.executions.map((execution) => {
            const label = executionStatus(execution);
            const key = `${execution.caseId}-${execution.configuration}-${execution.iteration}`;
            return (
              <div className={`execution-row ${execution.state}`} key={key}>
                <span className="execution-state" aria-hidden="true">
                  {execution.state === "completed" ? (
                    "✓"
                  ) : execution.state === "active" ? (
                    <span className="execution-spinner">
                      <span />
                    </span>
                  ) : (
                    "○"
                  )}
                </span>
                <div className="execution-identity">
                  <b>{execution.caseId}</b>
                  {snapshot &&
                    snapshot.executions.some((item) => item.iteration > 1) && (
                      <small>Iteration {execution.iteration}</small>
                    )}
                </div>
                <span
                  className={`configuration-label ${execution.configuration.replace("_", "-")}`}
                >
                  <span aria-hidden="true">
                    {execution.configuration === "with_skill"
                      ? "+"
                      : execution.configuration === "without_skill"
                        ? "−"
                        : "?"}
                  </span>
                  {runConfigurationLabel(execution.configuration)}
                </span>
                <span
                  className={`badge ${execution.provisional ? "provisional" : String(execution.result ?? "info").toLowerCase()}`}
                >
                  {label}
                </span>
              </div>
            );
          })}
          {snapshot && snapshot.executions.length === 0 && (
            <p className="progress-empty">
              No enabled executions are planned for this run.
            </p>
          )}
        </div>
      </div>
      <div className="decision-bar">
        <span>
          {refreshedAt
            ? `Last refreshed ${refreshedAt.toLocaleTimeString()}`
            : "Progress is reconstructed from durable worker events."}
        </span>
        <div className="run-progress-actions">
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
    </section>
  );
}
