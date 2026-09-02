# Screen Blueprints

## Shared shell

Desktop uses a compact navigation rail, a context header, the main work surface,
and an optional right evidence inspector. The context header always identifies
the Skill and version. On narrow screens, navigation becomes a top bar and the
inspector becomes a full-height drawer.

Navigation contains only `Skill`, `Evals`, `Runs`, and `Improve`. Versions and
downloads belong to the Skill context rather than separate global products.

## Skill intake

**Decision:** Is this package safe and ready enough to create evals?

- Upload/drop area or current-package summary.
- Selected Skill root and version at top.
- File tree and preview as the main surface.
- Readiness findings in the evidence inspector.
- Task description and attached task files below package summary.
- Primary action: `Create evals`.
- States: empty, uploading, scanning, multiple roots, ready, needs attention,
  blocked, identical upload, and new version detected.

## Eval authoring

**Decision:** Do these cases represent the task and its important failures well
enough to run?

- Step header: `Understand`, `Questions`, `Eval plan`, `Review`.
- Conversation column for Codex explanations and user answers.
- Structured work area for task facts, coverage groups, or generated cases.
- Evidence inspector for source files, exact YAML, fixtures, and validation.
- Primary action changes with state: `Answer questions`, `Generate evals`, or
  `Approve evals`.

Chat never replaces the case list. Blocking questions become explicit fields
with saved answers.

## Run launch and progress

**Decision:** Is the pinned configuration correct, and what is happening now?

Show Skill version, eval version, case count, iterations, baseline choice,
estimated agent/judge calls, and shared-worker state. During a run, use a stage
rail plus live case rows. Do not invent percentages when only stages and case
completion are known.

## Results

**Decision:** Where did the Skill help, fail, drift, or behave inconsistently?

- Outcome band with distinct metric cells, not one combined score.
- Failure-first case table with status, dimension, and case-group filters.
- Current result and optional baseline/candidate in aligned columns.
- Expandable case detail; inspector for transcript, artifacts, assertion
  evidence, and changed files/cells.
- Primary action when failures exist: `Suggest update`.

Use `Partial` when the intended correction passes but another required dimension
fails. Never coerce this into pass.

## Update proposal

**Decision:** Should these Skill changes and these eval changes be accepted?

- Concise summary: problem, intended effect, risk, files, and tests.
- Independently selectable `Skill changes` and `Eval changes`.
- File diff as the main evidence surface.
- Conversation for questions or revision, not as the primary patch view.
- Primary action: `Approve and test`; secondary: `Reject`.

## Candidate comparison

**Decision:** Is the candidate better without unacceptable regressions?

Show current and candidate versions, identical test configuration, fixed,
unchanged, flaky, and regressed cases, metric deltas, and exact file changes.
Put regressions before improvements. `Activate candidate` appears only after
verification finishes; otherwise the primary action is `Return to proposal`.

## Responsive rules

- Preserve decisions and status before secondary metadata.
- Tables become stacked comparison rows; avoid horizontal page scrolling.
- Evidence inspector becomes a drawer with remembered tab.
- A sticky bottom action area may hold approvals on narrow screens.
- Never hide exact version identifiers behind hover-only affordances.
