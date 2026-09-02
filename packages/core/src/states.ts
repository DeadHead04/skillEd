const transitions = {
  eval: {
    collecting: ["understanding"],
    understanding: ["awaiting_answers", "planning", "failed"],
    awaiting_answers: ["planning", "failed"],
    planning: ["awaiting_plan_approval", "failed"],
    awaiting_plan_approval: ["generating", "planning", "failed"],
    generating: ["validating", "failed"],
    validating: ["ready", "failed"],
    ready: ["approved", "generating"],
    approved: [],
    failed: [],
  },
  run: {
    queued: ["preparing", "cancelling", "failed"],
    preparing: ["running", "cancelling", "failed", "interrupted"],
    running: ["judging", "cancelling", "failed", "interrupted"],
    judging: ["ingesting", "cancelling", "failed", "interrupted"],
    ingesting: ["completed", "failed", "interrupted"],
    cancelling: ["cancelled"],
    completed: [],
    cancelled: [],
    failed: [],
    interrupted: [],
  },
  proposal: {
    generating: ["review", "rejected"],
    review: ["revision_requested", "rejected", "approved"],
    revision_requested: ["generating"],
    approved: ["candidate_created"],
    candidate_created: ["verifying"],
    verifying: ["verified", "failed"],
    verified: [],
    failed: [],
    rejected: [],
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
