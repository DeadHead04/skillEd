export type RunStatusExecution = {
  caseId: string;
  configuration: "with_skill" | "without_skill" | "unknown";
  iteration: number;
  state: "pending" | "active" | "completed";
  reportedStatus?: "PASS" | "FAIL" | "ERROR" | "SKIP";
  result?: "PASS" | "PARTIAL" | "FAIL" | "ERROR";
  provisional?: boolean;
};

type RunRow = {
  id: string;
  status: string;
  baseline: boolean;
  iterations: number;
  created_at: string | Date;
  started_at?: string | Date | null;
  completed_at?: string | Date | null;
};

type EventRow = {
  sequence: number | string;
  type: string;
  data: any;
  occurred_at: string | Date;
};

const terminalStatuses = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
const keyFor = (value: {
  caseId: string;
  configuration: string;
  iteration: number;
}) => `${value.caseId}\u0000${value.configuration}\u0000${value.iteration}`;

function normalizeConfiguration(value: unknown) {
  if (value === "without_skill" || value === "baseline")
    return "without_skill" as const;
  if (value === "unknown") return "unknown" as const;
  return "with_skill" as const;
}

export function reconstructRunStatus(
  run: RunRow,
  caseIds: string[],
  events: EventRow[],
  results: Array<{
    case_id: string;
    configuration: string;
    iteration: number;
    result: "PASS" | "PARTIAL" | "FAIL" | "ERROR";
  }> = [],
) {
  const executions = new Map<string, RunStatusExecution>();
  for (let iteration = 1; iteration <= Number(run.iterations); iteration++) {
    for (const caseId of caseIds) {
      const configurations = run.baseline
        ? (["with_skill", "without_skill"] as const)
        : (["with_skill"] as const);
      for (const configuration of configurations) {
        const execution: RunStatusExecution = {
          caseId,
          configuration,
          iteration,
          state: "pending",
        };
        executions.set(keyFor(execution), execution);
      }
    }
  }

  let stage = run.status;
  let updatedAt = new Date(
    run.completed_at ?? run.started_at ?? run.created_at,
  ).toISOString();
  for (const event of events) {
    updatedAt = new Date(event.occurred_at).toISOString();
    if (event.type === "stage_changed" && event.data?.stage) {
      stage = String(event.data.stage);
      continue;
    }
    if (event.type !== "case_started" && event.type !== "case_completed")
      continue;
    const data = event.data ?? {};
    if (!data.caseId || !data.iteration || !data.configuration) continue;
    const incoming: RunStatusExecution = {
      caseId: String(data.caseId),
      configuration: normalizeConfiguration(data.configuration),
      iteration: Number(data.iteration),
      state: event.type === "case_completed" ? "completed" : "active",
      reportedStatus: data.reportedStatus,
      provisional: true,
    };
    const key = keyFor(incoming);
    const prior = executions.get(key);
    if (prior?.state === "completed" && incoming.state === "active") continue;
    executions.set(key, { ...prior, ...incoming });
  }

  for (const result of results) {
    const authoritative: RunStatusExecution = {
      caseId: String(result.case_id),
      configuration: normalizeConfiguration(result.configuration),
      iteration: Number(result.iteration),
      state: "completed",
      result: result.result,
      provisional: false,
    };
    executions.set(keyFor(authoritative), authoritative);
  }

  if (terminalStatuses.has(run.status)) stage = run.status;
  const expectedTotal =
    caseIds.length * Number(run.iterations) * (run.baseline ? 2 : 1);
  const expectedExecutions = [...executions.values()].filter(
    (execution) => execution.configuration !== "unknown",
  );
  return {
    runId: run.id,
    status: run.status,
    stage,
    completed: expectedExecutions.filter(
      (execution) => execution.state === "completed",
    ).length,
    total: expectedTotal,
    updatedAt,
    executions: [...executions.values()],
  };
}

export function isTerminalRunStatus(status: string) {
  return terminalStatuses.has(status);
}
