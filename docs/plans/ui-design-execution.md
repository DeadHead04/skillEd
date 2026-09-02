# V1 UI Design and Build Execution

## Outcome

Build one coherent SkillEd interface in which a user can upload one Skill
package, create and approve evals, run them with Codex, understand failures,
review a proposed Skill change, and decide whether to activate the verified
candidate. The interface must make evidence and approvals easier to understand
than the underlying Skill-Up files without hiding them.

This is an implementation handoff for Codex. It does not add product scope.
The product contract, API contracts, phase plans, and acceptance scenarios stay
authoritative.

## Codex starting instruction

Use this prompt when starting the UI implementation:

> Use `$skilled-ui-designer` to implement the next incomplete SkillEd vertical
> slice. Read the product contract and only the screen/design references routed
> by the skill. Use the supplied ImageGen reference for visual direction, not as
> a raster UI or copy source. Preserve the V1 scope, implement every listed
> state for that slice, capture desktop and mobile screenshots, and apply the
> critic rubric for at most two focused revisions.

The implementing Codex task must read:

1. [`00-product-context.md`](00-product-context.md)
2. the relevant phase plan under [`phases/`](phases/)
3. [`04-data-and-api-contracts.md`](04-data-and-api-contracts.md)
4. [`../../skills/skilled-ui-designer/SKILL.md`](../../skills/skilled-ui-designer/SKILL.md)

Do not load every visual reference at once. The skill routes the task to the
smallest relevant reference set.

## Product identity

The selected direction is **Precision Workbench**: an editorial evidence desk
crossed with a calm lab console. A dark graphite rail holds orientation; a warm
paper work surface holds decisions; cyan identifies active work, coral exposes
failure or regression, blue identifies grounded evidence, and amber marks
provisional or incomplete evidence.

The generated references are directional:

- [direction exploration](../../skills/skilled-ui-designer/assets/direction-board.png)
- [eval authoring](../../skills/skilled-ui-designer/assets/eval-authoring.png)
- [failure analysis](../../skills/skilled-ui-designer/assets/results-failure-analysis.png)
- [candidate comparison](../../skills/skilled-ui-designer/assets/candidate-comparison.png)

Use CSS and code-native controls for the product. None of these PNGs ship in
the rendered interface.

## Application frame

Every authenticated screen uses the same four-part grammar:

1. A compact dark navigation rail with only `Skill`, `Evals`, `Runs`, and
   `Improve`.
2. A context strip showing the exact Skill version, eval version when relevant,
   and worker state.
3. One primary work surface organized around the decision on that screen.
4. A collapsible evidence inspector for source, raw artifacts, transcripts, or
   exact YAML.

On narrow screens the rail becomes a top bar, the inspector becomes a
full-height drawer, dense tables become stacked comparison rows, and the
primary approval action may sit in a sticky bottom bar. Version identifiers
remain visible without hover.

## Implementation baseline

When application scaffolding begins, use one web application with TypeScript
and server-rendered routes. Prefer a small set of local accessible primitives,
CSS custom properties, and component-level styles. Add a dependency only when
it removes substantial accessibility or interaction risk; do not introduce a
dashboard theme, charting package, animation framework, or broad component kit
for V1 aesthetics.

Before choosing exact framework versions or commands, inspect the repository
and current official framework documentation. Do not encode a stale dependency
version in the plan.

Create tokens once before screen work:

```css
--ink-950: #111614;
--graphite-800: #26302c;
--paper-50: #f4f1e8;
--paper-100: #eae5d8;
--signal-cyan: #35c2b2;
--safety-coral: #f36d4a;
--evidence-blue: #5a8dee;
--attention-amber: #d8a83e;
```

Also define semantic tokens for text, muted text, border, focus, pass, fail,
partial, running, and disabled states. Components consume semantic tokens, not
raw palette values. Use a compact grotesk for UI and tabular numbers; use
monospace only for IDs, paths, timings, YAML, and diffs.

## Shared components

Build components when the first real screen needs them, then reuse them. Do not
create an abstract design-system package before there are consumers.

| Component | Responsibility |
| --- | --- |
| `AppShell` | rail/top navigation, context strip, work surface, inspector slot |
| `VersionContext` | exact Skill/eval versions and immutable/current/candidate label |
| `StatusSignal` | shape/icon, explicit status text, and optional explanation |
| `EvidenceInspector` | tabbed source/artifact/transcript/YAML drawer or side panel |
| `DecisionBar` | one primary action, allowed secondary action, pending/error state |
| `StepRail` | known workflow stages without invented percentages |
| `MetricCell` | one dimension, numerator/denominator, delta, and evidence link |
| `CaseRow` | case status, dimension, group, iteration stability, drill-down |
| `DiffViewer` | accessible file list and line diff with addition/deletion labels |
| `ConversationPane` | persisted Codex messages plus structured saved answers |

Each status must combine language with a non-color cue. Every async component
needs loading, success, no-data, blocked, recoverable-error, and terminal-error
behavior where the product flow can produce those states.

## Vertical slice 1 — Skill intake

**User decision:** Is this package safe and complete enough to create evals?

Build the empty upload state and the scanned package state together. Accept the
Skill ZIP, task description, and task files. After scanning, show the selected
Skill root/version, file tree and preview, evidence level, readiness findings,
and concrete blocking issues. The only primary action in a ready state is
`Create evals`.

States to prove: empty, uploading, scanning, ready, needs attention, blocked,
multiple Skill roots, identical upload, and changed ZIP/new version. An unsafe
archive cannot expose `Create evals`. A Skill-only upload is clearly
`Provisional`; it is not presented as proof of task correctness.

Acceptance evidence:

- keyboard upload and drag/drop reach the same outcome;
- readiness findings link to an exact file or package rule;
- selected root and exact version remain visible;
- `Download Skill` is secondary and never confused with the primary action;
- mobile preserves the blocking reason before the file tree.

## Vertical slice 2 — Eval authoring

**User decision:** Do these cases represent the task and its dangerous failure
modes well enough to approve?

Use the [eval-authoring reference](../../skills/skilled-ui-designer/assets/eval-authoring.png).
Show `Understand`, `Questions`, `Eval plan`, and `Review` as visible steps. Put
Codex explanation and replies in the conversation column, durable task facts,
coverage groups, and cases in the main work area, and source/YAML/fixtures in
the inspector. A blocking question becomes a saved field with a visible answer;
it must not survive only in chat history.

Support `Answer questions`, `Generate evals`, and `Approve evals` as mutually
exclusive primary actions determined by state. The user can disable or edit a
case, request regeneration, inspect its fixture and grading method, run
validation, and approve only a valid draft. Approval records an immutable eval
version.

States to prove: understanding in progress, unanswered material question,
coverage plan ready, generating, draft created, validation errors, ready for
approval, and approved. Show case provenance and evidence level. Make
adversarial false-green coverage a named group rather than burying it in a
total.

Acceptance evidence:

- chat never replaces the structured case list;
- exact case count and coverage-group count agree everywhere;
- invalid YAML or fixture paths block approval with the exact error;
- editing a case increments the draft revision;
- approval confirmation names the Skill version and eval revision being frozen.

## Vertical slice 3 — Run launch and progress

**User decision:** Is the pinned configuration correct, and what is happening?

The launch summary names Skill version, eval version, case count, iterations,
baseline choice, model/settings, estimated agent and judge calls, and sequential
worker state. `Start run` is primary only after the configuration is complete.

After launch, use the known stage sequence `queued → preparing → running →
judging → completed`, with explicit failed, cancelling, and cancelled branches.
Show completed/active/pending case rows and timestamps. Never show a percentage
unless it is computed from known completed work. Closing and reopening the page
must reconstruct state from persisted events.

Acceptance evidence:

- configuration is pinned before the run starts;
- active and queued stages are distinguishable without color;
- cancellation communicates what evidence was preserved;
- login expiry, timeout, interruption, and malformed-report errors have
  actionable copy and never appear as Skill failures.

## Vertical slice 4 — Results and failure evidence

**User decision:** Where did the Skill help, fail, drift, or behave
inconsistently?

Use the [failure-analysis reference](../../skills/skilled-ui-designer/assets/results-failure-analysis.png).
Lead with separate metric cells for target correctness, semantic quality, source
preservation, scope preservation, artifact validity, stability, and operational
cost. Include the without-Skill delta only when that baseline ran. Do not
compute or display a single overall quality score.

Order the table failure-first and support status, dimension, and case-group
filters. A case opens input, output, files, transcript, grader evidence, and
unexpected changes. If the intended target passes while unrelated content
changes, render `Partial — target passed; scope failed`, keep the scope metric
red/coral, and expose `Suggest update`.

States to prove: all pass, mixed/partial, Skill failure, flaky outcome, judge
error, agent error, and report-ingestion error. Infrastructure and judge errors
remain separate from Skill correctness.

Acceptance evidence:

- the false-green scenario in the end-to-end acceptance plan cannot render as
  pass;
- a user can reach assertion evidence and produced artifacts from one case row;
- iteration variance is visible rather than averaged away;
- metric labels and values remain readable at 200% zoom.

## Vertical slice 5 — Update proposal

**User decision:** Should these proposed Skill changes and eval changes be
accepted?

Lead with problem, intended effect, risk, touched files, and verification plan.
Make the file diff the primary evidence surface. Conversation supports questions
and revision but cannot replace the diff. `Skill changes` and `Eval changes`
have independent decisions; rejecting an eval weakening must not discard an
otherwise acceptable Skill patch.

`Approve and test` creates a candidate and queues verification. `Reject`
changes nothing. `Request revision` keeps the proposal attached to its base
version. Name that immutable base wherever a decision is made.

Acceptance evidence:

- approval summary states exactly which patch groups are included;
- additions and deletions use signs/text as well as color;
- changed files, expected gains, and risks are navigable by keyboard;
- the current Skill cannot silently change at proposal approval time.

## Vertical slice 6 — Candidate comparison

**User decision:** Is the candidate better without unacceptable regression?

Use the [candidate-comparison reference](../../skills/skilled-ui-designer/assets/candidate-comparison.png).
Compare the current and candidate versions under identical eval version,
settings, and iterations. Put regression alerts before improvements. Separate
fixed, unchanged, flaky, and regressed cases; show per-dimension deltas and exact
file changes.

If verification has not completed or any blocking regression remains, the
primary action is `Return to proposal`. `Activate candidate` appears only after
verification and always requires an explicit confirmation naming both versions.
Downloading either version remains available as a secondary action.

Acceptance evidence:

- activation cannot occur from a generating or failed comparison;
- regression cases open the same evidence depth as ordinary results;
- activation updates the current pointer without mutating either package;
- mobile places the regression warning and decision before detailed deltas.

## Visual critique loop

For each vertical slice:

1. Implement working states with representative fixture data.
2. Capture the decision state at `1440 × 900` and `390 × 844`, plus any state
   whose risk cannot be assessed from the decision state.
3. Start a fresh critic context with only the screenshots, screen purpose,
   selected direction, and
   [`critic-rubric.md`](../../skills/skilled-ui-designer/references/critic-rubric.md).
4. Fix the highest-impact hierarchy, truthfulness, interaction, responsive, or
   accessibility issues—not superficial variation.
5. Repeat once only if the second review is still likely to change a user
   decision.

A slice is visually ready when no rubric dimension is below `4/5`, the total is
at least `34/40`, there are no automatic deductions, and no critical product
state is represented falsely. If two rounds do not reach the threshold, record
the remaining issue instead of hiding it or looping indefinitely.

## Automated and manual checks

Every slice needs component tests for state logic and browser tests for its
primary decision. The completed journey must cover the happy path and required
negative scenarios in
[`acceptance/end-to-end-scenarios.md`](acceptance/end-to-end-scenarios.md).

Minimum UI checks:

- keyboard-only completion of every approval path;
- visible focus and semantic names for controls, tabs, drawers, and tables;
- text/status contrast in default, hover, focus, disabled, and error states;
- 200% zoom without loss of decisions or actions;
- narrow viewport without page-level horizontal scrolling;
- reduced-motion behavior;
- no credentials, temporary host paths, hidden prompts, or expected answers in
  rendered logs and downloads;
- no false `Pass` when any required grading dimension fails.

## Build order and completion rule

Implement the frame and tokens with Skill intake, then complete slices 1–6 in
order. A slice is complete only when its API state mapping, component/browser
tests, desktop/mobile screenshots, critic result, and accessibility checks are
all recorded. Do not build future settings, teams, projects, GitHub, billing,
marketplace, generic plugin management, or telemetry screens. Do not add empty
navigation or data models for them.

V1 UI is complete when the full acceptance journey can be performed from the
browser, including rejecting an eval weakening, exposing a false-green scope
failure, blocking a regressed candidate, explicitly activating a verified
candidate, and downloading the selected Skill and report.
