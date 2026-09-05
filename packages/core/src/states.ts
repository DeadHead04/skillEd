export const transitions = {
  eval: {
    collecting: ["understanding", "failed"],
    understanding: ["awaiting_answers", "planning", "failed"],
    awaiting_answers: ["planning", "understanding", "collecting", "failed"],
    planning: ["awaiting_plan_approval", "awaiting_answers", "failed"],
    awaiting_plan_approval: [
      "generating",
      "planning",
      "understanding",
      "collecting",
      "failed",
    ],
    generating: ["validating", "ready", "failed"],
    validating: ["ready", "failed"],
    ready: [
      "approved",
      "generating",
      "understanding",
      "collecting",
      "awaiting_plan_approval",
      "failed",
    ],
    approved: [],
    failed: [
      "understanding",
      "generating",
      "collecting",
      "awaiting_plan_approval",
    ],
  },
  run: {
    queued: ["preparing", "cancelling", "cancelled", "failed", "interrupted"],
    preparing: ["running", "cancelling", "cancelled", "failed", "interrupted"],
    running: [
      "judging",
      "finalizing",
      "cancelling",
      "cancelled",
      "failed",
      "interrupted",
    ],
    judging: ["ingesting", "finalizing", "cancelling", "failed", "interrupted"],
    ingesting: ["completed", "failed", "interrupted"],
    finalizing: ["completed", "failed", "cancelled", "interrupted"],
    cancelling: ["cancelled", "failed", "interrupted"],
    completed: [],
    cancelled: [],
    failed: [],
    interrupted: [],
  },
  proposal: {
    generating: ["review", "failed", "rejected"],
    review: [
      "revision_requested",
      "generating",
      "rejected",
      "approved",
      "candidate_created",
    ],
    revision_requested: ["generating", "failed"],
    approved: ["candidate_created"],
    candidate_created: ["verifying", "failed"],
    verifying: ["verified", "failed"],
    verified: [],
    failed: ["verifying"],
    rejected: [],
  },
  job: {
    queued: ["running", "cancelled", "interrupted", "failed"],
    running: ["completed", "failed", "cancelled", "interrupted"],
    completed: [],
    failed: [],
    cancelled: [],
    interrupted: [],
  },
} as const;
export type Machine = keyof typeof transitions;
export function assertTransition(machine: Machine, from: string, to: string) {
  const allowed = (transitions[machine] as Record<string, readonly string[]>)[
    from
  ];
  if (!allowed?.includes(to))
    throw Object.assign(
      new Error(`Invalid ${machine} transition: ${from} → ${to}`),
      { status: 409, code: "INVALID_TRANSITION" },
    );
}
