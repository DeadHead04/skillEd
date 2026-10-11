// Modified for the skilled TypeScript distribution.
import {
  type Configuration,
  type CaseStatus,
  type RunStatus,
  type RunPhase,
  type ResultCounts,
  type TaskFields,
  type PayloadMap,
  type EventType,
  emptyCounts,
  integer,
  stringValue,
  taskFields,
  passRate,
} from "./event.js";
import { Publisher, SerialQueue } from "./publisher.js";
export interface Task {
  id: string;
  iteration: number;
  caseID: string;
  configuration: Configuration;
  index: number;
  title: string;
}
export interface Iteration {
  number: number;
  tasks: Task[];
}
export interface Plan {
  iterations: Iteration[];
}
interface TaskState {
  task: Task;
  started: boolean;
  completed: boolean;
  startedAt: number;
}
interface IterationState {
  iteration: Iteration;
  started: boolean;
  completed: boolean;
  startedAt: number;
  result: ResultCounts;
  completedN: number;
}
function snapshotPlan(plan: Plan): {
  tasks: Map<string, TaskState>;
  iterations: Map<number, IterationState>;
  total: number;
} {
  if (!plan.iterations.length)
    throw new Error("plan must contain at least one iteration");
  const copy = structuredClone(plan),
    total = copy.iterations.reduce((n, i) => n + i.tasks.length, 0);
  integer("plan task total", total, true);
  const tasks = new Map<string, TaskState>(),
    iterations = new Map<number, IterationState>(),
    indices = new Set<number>();
  for (const i of copy.iterations) {
    integer("iteration", i.number, true);
    if (!i.tasks.length)
      throw new Error(`iteration ${i.number} must contain at least one task`);
    if (iterations.has(i.number))
      throw new Error(`duplicate iteration ${i.number}`);
    iterations.set(i.number, {
      iteration: i,
      started: false,
      completed: false,
      startedAt: 0,
      result: emptyCounts(),
      completedN: 0,
    });
    for (const t of i.tasks) {
      if (t.iteration !== i.number)
        throw new Error(
          `task ${t.id} iteration does not match iteration ${i.number}`,
        );
      taskFields({
        task_id: t.id,
        iteration: t.iteration,
        case_id: t.caseID,
        configuration: t.configuration,
        task_index: t.index,
        task_total: total,
        title: t.title,
      });
      if (tasks.has(t.id)) throw new Error(`duplicate task ID ${t.id}`);
      if (indices.has(t.index))
        throw new Error(`duplicate task index ${t.index}`);
      indices.add(t.index);
      tasks.set(t.id, {
        task: t,
        started: false,
        completed: false,
        startedAt: 0,
      });
    }
  }
  for (let n = 1; n <= total; n++)
    if (!indices.has(n)) throw new Error(`plan is missing task index ${n}`);
  return { tasks, iterations, total };
}
export function validatePlan(plan: Plan): void {
  snapshotPlan(plan);
}
const elapsed = (start: number) =>
  Math.max(0, Math.floor(performance.now() - start));
function addStatus(c: ResultCounts, s: CaseStatus): void {
  c[
    (
      {
        PASS: "passed",
        FAIL: "failed",
        ERROR: "errored",
        SKIP: "skipped",
      } as const
    )[s]
  ]++;
}
export class Lifecycle {
  private readonly queue = new SerialQueue();
  private readonly tasks: Map<string, TaskState>;
  private readonly iterations: Map<number, IterationState>;
  readonly taskTotal: number;
  private started = false;
  private finished = false;
  private phase: RunPhase = "preparing";
  private startAt = 0;
  private completed = 0;
  private result = emptyCounts();
  private active = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private interval: number;
  constructor(
    private readonly publisher: Publisher,
    plan: Plan,
    options: { heartbeatIntervalMs?: number } = {},
  ) {
    if (!publisher) throw new Error("publisher must not be nil");
    const p = snapshotPlan(plan);
    this.tasks = p.tasks;
    this.iterations = p.iterations;
    this.taskTotal = p.total;
    this.interval = options.heartbeatIntervalMs || 30_000;
    if (this.interval < 0)
      throw new Error("heartbeat interval must not be negative");
  }
  private stopHeartbeat(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
  private async publish<K extends EventType>(
    type: K,
    payload: PayloadMap[K],
    signal?: AbortSignal,
    last = false,
  ): Promise<void> {
    try {
      await (last
        ? this.publisher.publishLast(type, payload, signal)
        : this.publisher.publish(type, payload, signal));
    } catch (e) {
      this.stopHeartbeat();
      throw e;
    }
  }
  private progress(signal?: AbortSignal): Promise<void> {
    return this.publish(
      "run_progress",
      {
        ...this.result,
        phase: this.phase,
        task_total: this.taskTotal,
        completed_tasks: this.completed,
        running_tasks: this.active.size,
        elapsed_ms: elapsed(this.startAt),
      },
      signal,
    );
  }
  private ensureActive(): void {
    if (!this.started) throw new Error("lifecycle has not started");
    if (this.finished) throw new Error("lifecycle already finished");
  }
  private ensureExecuting(): void {
    this.ensureActive();
    if (this.phase !== "executing")
      throw new Error(`lifecycle is in ${this.phase} phase, not executing`);
  }
  private fields(t: Task): TaskFields {
    return {
      task_id: t.id,
      iteration: t.iteration,
      case_id: t.caseID,
      configuration: t.configuration,
      task_index: t.index,
      task_total: this.taskTotal,
      title: t.title,
    };
  }
  start(
    engine: string,
    skillName: string,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.queue.run(async () => {
      if (this.started) throw new Error("lifecycle already started");
      stringValue("engine", engine, true);
      stringValue("skill_name", skillName, true);
      this.started = true;
      this.startAt = performance.now();
      await this.publish(
        "run_started",
        {
          engine,
          skill_name: skillName,
          task_total: this.taskTotal,
          iterations_total: this.iterations.size,
        },
        signal,
      );
      await this.progress(signal);
      this.timer = setInterval(() => {
        void this.heartbeat().catch(() => this.stopHeartbeat());
      }, this.interval);
      this.timer.unref();
    });
  }
  setPhase(phase: RunPhase, signal?: AbortSignal): Promise<void> {
    return this.queue.run(async () => {
      this.ensureActive();
      if (!["preparing", "executing", "finalizing"].includes(phase))
        throw new Error("invalid phase");
      if (phase === "finalizing")
        throw new Error("finalizing phase is owned by Finish");
      if (phase === "preparing" || this.phase !== "preparing")
        throw new Error(
          `phase transition from ${this.phase} to ${phase} is not forward`,
        );
      this.phase = phase;
      await this.progress(signal);
    });
  }
  heartbeat(signal?: AbortSignal): Promise<void> {
    return this.queue.run(async () => {
      this.ensureActive();
      await this.progress(signal);
    });
  }
  iterationStarted(number: number, signal?: AbortSignal): Promise<void> {
    return this.queue.run(async () => {
      this.ensureExecuting();
      const i = this.iterations.get(number);
      if (!i) throw new Error(`unknown iteration ${number}`);
      if (i.started) throw new Error(`iteration ${number} already started`);
      i.started = true;
      i.startedAt = performance.now();
      await this.publish("iteration_started", { iteration: number }, signal);
    });
  }
  caseStarted(id: string, signal?: AbortSignal): Promise<void> {
    return this.queue.run(async () => {
      this.ensureExecuting();
      const t = this.tasks.get(id);
      if (!t) throw new Error(`unknown task ${id}`);
      const i = this.iterations.get(t.task.iteration)!;
      if (!i.started || i.completed)
        throw new Error(`iteration ${i.iteration.number} is not active`);
      if (t.started) throw new Error(`task ${id} already started`);
      t.started = true;
      t.startedAt = performance.now();
      this.active.add(id);
      await this.publish("case_started", this.fields(t.task), signal);
      await this.progress(signal);
    });
  }
  caseCompleted(
    id: string,
    status: CaseStatus,
    rate?: number,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.queue.run(async () => {
      this.ensureExecuting();
      if (!["PASS", "FAIL", "ERROR", "SKIP"].includes(status))
        throw new Error("invalid case status");
      passRate(rate);
      const t = this.tasks.get(id);
      if (!t) throw new Error(`unknown task ${id}`);
      if (!t.started || t.completed)
        throw new Error(`task ${id} is not actively running`);
      t.completed = true;
      this.active.delete(id);
      this.completed++;
      addStatus(this.result, status);
      const i = this.iterations.get(t.task.iteration)!;
      i.completedN++;
      addStatus(i.result, status);
      await this.publish(
        "case_completed",
        {
          ...this.fields(t.task),
          completed_tasks: this.completed,
          status,
          ...(rate !== undefined ? { pass_rate: rate } : {}),
          duration_ms: elapsed(t.startedAt),
        },
        signal,
      );
      await this.progress(signal);
    });
  }
  iterationCompleted(number: number, signal?: AbortSignal): Promise<void> {
    return this.queue.run(async () => {
      this.ensureExecuting();
      const i = this.iterations.get(number);
      if (!i) throw new Error(`unknown iteration ${number}`);
      if (!i.started || i.completed)
        throw new Error(`iteration ${number} is not actively running`);
      if (i.completedN !== i.iteration.tasks.length)
        throw new Error(`iteration ${number} has unfinished tasks`);
      i.completed = true;
      await this.publish(
        "iteration_completed",
        {
          ...i.result,
          iteration: number,
          invocation_completed_tasks: this.completed,
          duration_ms: elapsed(i.startedAt),
        },
        signal,
      );
    });
  }
  finish(status: RunStatus, signal?: AbortSignal): Promise<void> {
    this.stopHeartbeat();
    return this.queue.run(async () => {
      this.ensureActive();
      if (!["COMPLETED", "ERROR", "CANCELLED"].includes(status))
        throw new Error("invalid run status");
      if (status === "COMPLETED") {
        if (this.completed !== this.taskTotal)
          throw new Error(
            `completed run has ${this.completed} of ${this.taskTotal} terminal tasks`,
          );
        for (const [n, i] of this.iterations)
          if (!i.completed)
            throw new Error(`completed run has unfinished iteration ${n}`);
      }
      this.phase = "finalizing";
      this.active.clear();
      this.finished = true;
      let progressError: unknown;
      try {
        await this.progress(signal);
      } catch (e) {
        progressError = e;
      }
      try {
        await this.publish(
          "run_finished",
          {
            ...this.result,
            status,
            completed_tasks: this.completed,
            duration_ms: elapsed(this.startAt),
          },
          signal,
          true,
        );
      } catch (e) {
        if (!progressError) throw e;
      }
      if (progressError) throw progressError;
    });
  }
}
