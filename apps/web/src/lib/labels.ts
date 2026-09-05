/**
 * One vocabulary for machine state.
 *
 * Statuses are stored as machine tokens (`awaiting_plan_approval`) but a
 * person reading the workbench should never have to decode one. Every screen
 * renders state through these helpers so the same status always reads the
 * same way, and so the words describe what the operator does next rather than
 * what the row contains.
 */

export type Tone = "done" | "current" | "blocked" | "todo";

export type StageView = {
  label: string;
  detail: string;
  tone: Tone;
};

export function humanize(value: string | null | undefined) {
  if (!value) return "Unknown";
  const text = String(value).replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Result states, in the order a reviewer should care about them. */
export const resultOrder = ["ERROR", "FAIL", "PARTIAL", "PASS"] as const;

/** The six required dimensions, in a fixed order so the pips never move. */
export const dimensionOrder = [
  "correctness",
  "semantic",
  "source",
  "scope",
  "artifact",
  "stability",
] as const;

/** Human names for the six required dimensions, in their fixed order. */
export const dimensionLabels: Record<string, string> = {
  correctness: "Task correctness",
  semantic: "Semantic quality",
  source: "Source preservation",
  scope: "Scope preservation",
  artifact: "Artifact validity",
  stability: "Stability",
};

/**
 * One cell per dimension rather than one overall score.
 *
 * A dimension that no case measured reports "not measured" instead of
 * silently counting as a pass — that distinction is what stops a partial
 * result reading as green.
 */
export function dimensionMetrics(
  results: Array<{ dimensions?: Record<string, boolean> | null }>,
) {
  return dimensionOrder.map((dimension) => {
    const measured = results.filter(
      (result) => result.dimensions && dimension in result.dimensions,
    );
    return {
      key: dimension,
      label: dimensionLabels[dimension] ?? dimension,
      measured: measured.length,
      passed: measured.filter((result) => result.dimensions?.[dimension])
        .length,
    };
  });
}

export function resultCopy(result: string) {
  switch (result) {
    case "PASS":
      return "Every required dimension passed.";
    case "PARTIAL":
      return "The target correction passed, another required dimension did not.";
    case "FAIL":
      return "Task correctness failed.";
    case "ERROR":
      return "No trustworthy evidence was produced.";
    default:
      return "Not yet reported.";
  }
}

export function evidenceModeCopy(mode: string) {
  if (mode === "real") return { label: "Real Codex", real: true };
  if (mode === "demo") return { label: "Demo adapter", real: false };
  return { label: "Unverified legacy", real: false };
}

export function evalStage(
  status: string | null,
  version: number | null,
): StageView {
  const stages: Record<string, StageView> = {
    collecting: {
      label: "Evals",
      detail: "Start authoring",
      tone: "current",
    },
    understanding: {
      label: "Evals",
      detail: "Reading the task",
      tone: "current",
    },
    awaiting_answers: {
      label: "Evals",
      detail: "Answer questions",
      tone: "current",
    },
    planning: { label: "Evals", detail: "Planning coverage", tone: "current" },
    awaiting_plan_approval: {
      label: "Evals",
      detail: "Approve the plan",
      tone: "current",
    },
    generating: { label: "Evals", detail: "Writing cases", tone: "current" },
    validating: { label: "Evals", detail: "Validating", tone: "current" },
    ready: { label: "Evals", detail: "Review and approve", tone: "current" },
    approved: {
      label: "Evals",
      detail: version ? `Approved v${version}` : "Approved",
      tone: "done",
    },
    failed: { label: "Evals", detail: "Generation failed", tone: "blocked" },
  };
  if (!status)
    return {
      label: "Evals",
      detail: "No draft yet",
      tone: "todo",
    };
  return (
    stages[status] ?? {
      label: "Evals",
      detail: humanize(status),
      tone: "current",
    }
  );
}

export function runStage(
  status: string | null,
  summary: { total: number; pass: number } | null,
): StageView {
  if (!status) return { label: "Runs", detail: "Not run yet", tone: "todo" };
  if (status === "completed")
    return {
      label: "Runs",
      detail: summary ? `${summary.pass}/${summary.total} passing` : "Complete",
      tone: "done",
    };
  if (status === "failed" || status === "interrupted")
    return { label: "Runs", detail: humanize(status), tone: "blocked" };
  if (status === "cancelled")
    return { label: "Runs", detail: "Cancelled", tone: "todo" };
  return { label: "Runs", detail: humanize(status), tone: "current" };
}

export function proposalStage(
  status: string | null,
  activated: boolean,
): StageView {
  if (activated)
    return {
      label: "Improve",
      detail: "Candidate active",
      tone: "done",
    };
  const stages: Record<string, StageView> = {
    generating: { label: "Improve", detail: "Diagnosing", tone: "current" },
    review: { label: "Improve", detail: "Decision needed", tone: "current" },
    revision_requested: {
      label: "Improve",
      detail: "Revision requested",
      tone: "current",
    },
    approved: { label: "Improve", detail: "Approved", tone: "current" },
    candidate_created: {
      label: "Improve",
      detail: "Verify candidate",
      tone: "current",
    },
    verifying: { label: "Improve", detail: "Verifying", tone: "current" },
    verified: {
      label: "Improve",
      detail: "Ready to activate",
      tone: "current",
    },
    failed: { label: "Improve", detail: "Blocked", tone: "blocked" },
    rejected: { label: "Improve", detail: "Rejected", tone: "todo" },
  };
  if (!status)
    return {
      label: "Improve",
      detail: "Nothing proposed",
      tone: "todo",
    };
  return (
    stages[status] ?? {
      label: "Improve",
      detail: humanize(status),
      tone: "current",
    }
  );
}
