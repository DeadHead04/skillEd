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
  let completedIndexes = new Set<number>();
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

  const identity = (index: number, total: number, reportedCaseId: string) => {
    const slot = options.slots[index - 1];
    const consistent =
      total === options.slots.length && slot?.caseId === reportedCaseId;
    return {
      caseId: consistent ? slot.caseId : reportedCaseId,
      configuration: consistent ? slot.configuration : "unknown",
    } as const;
  };

  const parseLine = (line: string) => {
    const completed = line.match(
      /\[(\d+)\/(\d+)\]\s+([^:]+):\s+(PASS|FAIL|ERROR|SKIP)\b/,
    );
    const started = completed
      ? null
      : line.match(/\[(\d+)\/(\d+)\]\s+([^:]+):\s*.*\.\.\.\s*$/);
    const match = completed ?? started;
    if (!match || iteration > options.iterations) return;
    const index = Number(match[1]);
    const total = Number(match[2]);
    const reportedCaseId = match[3]!.trim();
    const resolved = identity(index, total, reportedCaseId);
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
        data: { ...base, reportedStatus: completed[4] as RunProgressStatus },
      });
      if (total === options.slots.length && index >= 1 && index <= total) {
        completedIndexes.add(index);
        if (completedIndexes.size === options.slots.length) {
          iteration++;
          completedIndexes = new Set();
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
