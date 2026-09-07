import type {
  CaseCompletedProgress,
  CaseStartedProgress,
  RunProgressConfiguration,
  RunProgressStatus,
} from "@skilled/core";

export type ExecutionSlot = {
  caseId: string;
  configuration: Exclude<RunProgressConfiguration, "unknown">;
};

export type ProgressEvent =
  | { type: "case_started"; data: CaseStartedProgress }
  | { type: "case_completed"; data: CaseCompletedProgress };

export function buildExecutionSlots(caseIds: string[], baseline: boolean) {
  return caseIds.flatMap<ExecutionSlot>((caseId) => [
    { caseId, configuration: "with_skill" },
    ...(baseline
      ? ([{ caseId, configuration: "without_skill" }] as ExecutionSlot[])
      : []),
  ]);
}

export function createSkillUpProgressParser(options: {
  slots: ExecutionSlot[];
  iterations: number;
  onEvent: (event: ProgressEvent) => Promise<unknown>;
  onOutput?: () => void;
}) {
  let buffered = "";
  let iteration = 1;
  let completedExecutions = new Set<string>();
  let writes = Promise.resolve();
  let writeError: unknown;

  const queue = (event: ProgressEvent) => {
    writes = writes.then(
      async () => {
        try {
          await options.onEvent(event);
        } catch (cause) {
          writeError ??= cause;
        }
      },
      () => undefined,
    );
  };

  const identity = (
    index: number,
    total: number,
    reportedCaseId: string,
    reportedConfiguration?: ExecutionSlot["configuration"],
  ) => {
    const slot = options.slots[index - 1];
    const reportedSlot = reportedConfiguration
      ? options.slots.find(
          (candidate) =>
            candidate.caseId === reportedCaseId &&
            candidate.configuration === reportedConfiguration,
        )
      : undefined;
    const resolvedSlot = reportedConfiguration ? reportedSlot : slot;
    const consistent =
      total === options.slots.length &&
      resolvedSlot?.caseId === reportedCaseId &&
      (!reportedConfiguration ||
        resolvedSlot.configuration === reportedConfiguration);
    return {
      caseId: consistent ? resolvedSlot.caseId : reportedCaseId,
      configuration: consistent
        ? (reportedConfiguration ?? resolvedSlot.configuration)
        : "unknown",
    } as const;
  };

  const parseLine = (line: string) => {
    const completed = line.match(
      /\[(\d+)\/(\d+)\]\s+(?:\[(WITH-SKILL|WITHOUT-SKILL)\]\s+)?([^:]+):\s+(PASS|FAIL|ERROR|SKIP)\b/,
    );
    const started = completed
      ? null
      : line.match(
          /\[(\d+)\/(\d+)\]\s+(?:\[(WITH-SKILL|WITHOUT-SKILL)\]\s+)?([^:]+):\s*.*\.\.\.\s*$/,
        );
    const match = completed ?? started;
    if (!match || iteration > options.iterations) return;
    const index = Number(match[1]);
    const total = Number(match[2]);
    const reportedConfiguration =
      match[3] === "WITH-SKILL"
        ? "with_skill"
        : match[3] === "WITHOUT-SKILL"
          ? "without_skill"
          : undefined;
    const reportedCaseId = match[4]!.trim();
    const resolved = identity(
      index,
      total,
      reportedCaseId,
      reportedConfiguration,
    );
    const base = {
      ...resolved,
      index,
      total,
      iteration,
      provisional: true as const,
    };
    if (completed) {
      queue({
        type: "case_completed",
        data: { ...base, reportedStatus: completed[5] as RunProgressStatus },
      });
      if (
        resolved.configuration !== "unknown" &&
        index >= 1 &&
        index <= total
      ) {
        completedExecutions.add(
          `${resolved.caseId}\u0000${resolved.configuration}`,
        );
        if (completedExecutions.size === options.slots.length) {
          iteration++;
          completedExecutions = new Set();
        }
      }
    } else {
      queue({ type: "case_started", data: base });
    }
  };

  return {
    feed(chunk: string) {
      if (!chunk) return;
      options.onOutput?.();
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) parseLine(line);
    },
    flush() {
      if (buffered) parseLine(buffered);
      buffered = "";
    },
    async drain() {
      await writes;
      if (writeError) throw writeError;
    },
  };
}
