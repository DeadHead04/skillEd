// Modified for the skilled TypeScript distribution.
export const PROTOCOL_VERSION = 1;
export const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
export type Configuration = "with_skill" | "without_skill";
export type CaseStatus = "PASS" | "FAIL" | "ERROR" | "SKIP";
export type RunStatus = "COMPLETED" | "ERROR" | "CANCELLED";
export type RunPhase = "preparing" | "executing" | "finalizing";
export interface ResultCounts {
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}
export interface TaskFields {
  task_id: string;
  iteration: number;
  case_id: string;
  configuration: Configuration;
  task_index: number;
  task_total: number;
  title: string;
}
export interface PayloadMap {
  run_started: {
    engine: string;
    skill_name: string;
    task_total: number;
    iterations_total: number;
  };
  run_progress: ResultCounts & {
    phase: RunPhase;
    task_total: number;
    completed_tasks: number;
    running_tasks: number;
    elapsed_ms: number;
  };
  iteration_started: { iteration: number };
  case_started: TaskFields;
  case_completed: TaskFields & {
    completed_tasks: number;
    status: CaseStatus;
    pass_rate?: number;
    duration_ms: number;
  };
  iteration_completed: ResultCounts & {
    iteration: number;
    invocation_completed_tasks: number;
    duration_ms: number;
  };
  run_finished: ResultCounts & {
    status: RunStatus;
    completed_tasks: number;
    duration_ms: number;
  };
}
export type EventType = keyof PayloadMap;
export type Event = {
  [K in EventType]: {
    protocol_version: 1;
    event_version: 1;
    sequence_number: number;
    invocation_id: string;
    time: string;
    event: K;
    last_event?: boolean;
    attributes?: Record<string, string>;
    payload: PayloadMap[K];
  };
}[EventType];
export const emptyCounts = (): ResultCounts => ({
  passed: 0,
  failed: 0,
  errored: 0,
  skipped: 0,
});
export function integer(name: string, value: number, positive = false): void {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0))
    throw new Error(
      `${name} must be a safe integer ${positive ? "at least 1" : "at least 0"}`,
    );
}
export function stringValue(
  name: string,
  value: string,
  nonEmpty = false,
): void {
  if (
    typeof value !== "string" ||
    /([\uD800-\uDBFF](?![\uDC00-\uDFFF]))|((?<![\uD800-\uDBFF])[\uDC00-\uDFFF])/.test(
      value,
    ) ||
    (nonEmpty && !value)
  )
    throw new Error(
      `${name} must be ${nonEmpty ? "non-empty " : ""}valid UTF-8`,
    );
}
export function passRate(value: number | undefined): void {
  if (
    value !== undefined &&
    (!Number.isFinite(value) || value < 0 || value > 1)
  )
    throw new Error("pass_rate must be finite and between 0 and 1");
}
export function countsTotal(p: ResultCounts): number {
  for (const k of ["passed", "failed", "errored", "skipped"] as const)
    integer(k, p[k]);
  const sum = p.passed + p.failed + p.errored + p.skipped;
  integer("result count sum", sum);
  return sum;
}
export function taskFields(p: TaskFields): void {
  stringValue("task_id", p.task_id, true);
  integer("iteration", p.iteration, true);
  stringValue("case_id", p.case_id, true);
  if (!["with_skill", "without_skill"].includes(p.configuration))
    throw new Error("invalid configuration");
  integer("task_total", p.task_total, true);
  integer("task_index", p.task_index, true);
  if (p.task_index > p.task_total)
    throw new Error("task_index exceeds task_total");
  stringValue("title", p.title);
}
export function validatePayload<K extends EventType>(
  type: K,
  p: PayloadMap[K],
): void {
  if (!p || typeof p !== "object")
    throw new Error("event payload must not be nil");
  switch (type) {
    case "run_started": {
      const v = p as PayloadMap["run_started"];
      stringValue("engine", v.engine, true);
      stringValue("skill_name", v.skill_name, true);
      integer("task_total", v.task_total, true);
      integer("iterations_total", v.iterations_total, true);
      break;
    }
    case "run_progress": {
      const v = p as PayloadMap["run_progress"];
      if (!["preparing", "executing", "finalizing"].includes(v.phase))
        throw new Error("invalid phase");
      integer("task_total", v.task_total, true);
      integer("completed_tasks", v.completed_tasks);
      integer("running_tasks", v.running_tasks);
      integer("elapsed_ms", v.elapsed_ms);
      if (v.completed_tasks !== countsTotal(v))
        throw new Error("completed_tasks must equal the result count sum");
      if (
        v.completed_tasks > v.task_total ||
        v.running_tasks > v.task_total - v.completed_tasks
      )
        throw new Error("completed_tasks + running_tasks exceeds task_total");
      break;
    }
    case "iteration_started":
      integer(
        "iteration",
        (p as PayloadMap["iteration_started"]).iteration,
        true,
      );
      break;
    case "case_started":
      taskFields(p as TaskFields);
      break;
    case "case_completed": {
      const v = p as PayloadMap["case_completed"];
      taskFields(v);
      integer("completed_tasks", v.completed_tasks);
      if (v.completed_tasks > v.task_total)
        throw new Error("completed_tasks exceeds task_total");
      if (!["PASS", "FAIL", "ERROR", "SKIP"].includes(v.status))
        throw new Error("invalid case status");
      passRate(v.pass_rate);
      integer("duration_ms", v.duration_ms);
      break;
    }
    case "iteration_completed": {
      const v = p as PayloadMap["iteration_completed"];
      integer("iteration", v.iteration, true);
      integer("invocation_completed_tasks", v.invocation_completed_tasks);
      countsTotal(v);
      integer("duration_ms", v.duration_ms);
      break;
    }
    case "run_finished": {
      const v = p as PayloadMap["run_finished"];
      if (!["COMPLETED", "ERROR", "CANCELLED"].includes(v.status))
        throw new Error("invalid run status");
      integer("completed_tasks", v.completed_tasks);
      if (v.completed_tasks !== countsTotal(v))
        throw new Error("completed_tasks must equal the result count sum");
      integer("duration_ms", v.duration_ms);
      break;
    }
    default:
      throw new Error(`unknown event type ${type}`);
  }
}
