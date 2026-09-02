# V1 End-to-End Acceptance Scenarios

## Release criterion

A trusted user can complete upload → eval authoring → approval → cloud run →
failure review → proposed update → approval → candidate verification →
activation/download entirely in the UI. Every stage uses immutable artifacts
and exposes enough evidence to detect false-green results.

## 1. Package and evidence intake

Upload a realistic Skill ZIP containing `SKILL.md`, references, assets, scripts,
and optional existing evals. Add a task description, spreadsheet input,
authority file, and historical failure. Verify safe extraction, manifest,
compatibility, v1 creation, file preview, task-evidence snapshot, and original
download. Upload a modified ZIP and verify v2 without altering v1.

## 2. Adversarial archive safety

Reject traversal, absolute paths, escaping symlinks, device files, duplicate
normalized paths, encrypted archives, excessive nesting, file-count/size bombs,
and unsupported executable setup. No rejected file is executed or rendered as
active content.

## 3. Eval authoring

Start from the UI. Codex with `skill-upper` produces structured task
understanding and asks only unresolved grading questions. After answers, it
creates a coverage plan spanning normal behavior, semantic omission, invented
claims, authority conflict, scope drift, malformed inputs, cross-field
coherence, and delivery validity. Generated files validate and the user can
edit and approve a stable snapshot.

Repeat with a package only. The system must label confidence provisional and
must not fabricate expected business outputs.

## 4. Conversation continuity

Pause an authoring thread while waiting for an answer, restart the web and
worker processes, and continue. Simulate unavailable Codex thread state and
reconstruct a new thread from the stored handoff without changing bound
artifacts or prior decisions.

## 5. Cloud execution

Run an approved multi-file suite with one and three iterations. Verify exact
package/eval/evidence checksums, job-local Skill installation, isolated case and
judge sessions, report ingestion, live progress, cancellation, cleanup, and
downloadable artifacts. No test receives authoring or holdout-answer context.

## 6. False-green defense

Use controlled cases where Codex repairs the planted target but over-edits
unrelated output. The result must show target correctness passing and scope
preservation failing. Exercise deterministic artifact checks, semantic Codex
judging, and hidden case manifests independently.

## 7. Upgrade approval

Generate a proposal from visible failures. Verify top-level summary, exact
patch, rationales, risk, compatibility, new regression tests, and rerun plan.
Reject one proposal and prove the base is unchanged. Approve another and prove
it creates a candidate rather than replacing the active version.

## 8. Candidate verification

Run affected, full regression, and holdout cases on active and candidate
versions with the same pinned settings. Display fixed, unchanged, flaky, and
regressed cases plus metric/file differences. Require explicit activation and
prove rollback works.

## 9. Failure and recovery

Exercise invalid package, Skill-Up validation failure, Codex login expiry, rate
limit, timeout, malformed output, judge failure, worker crash, duplicate lease,
artifact-store failure, cancellation, and orphan cleanup. Preserve completed
evidence and never double count retry attempts.

## 10. Downloads and confidentiality

Verify original, installable, development, diff, and run-evidence exports
against manifests. Confirm that credentials, environment dumps, temporary
paths, unrelated task evidence, hidden holdout answers, and sibling-user data
never appear in downloads, reports, logs, or Codex-visible workspaces.

## Required automated layers

- Unit tests for parsing, manifests, compatibility, serializers, state
  transitions, metrics, patch selection, and export policy.
- Integration tests for PostgreSQL, artifact storage, queue leases, App Server
  conversation coordination, Skill-Up validation/execution, and ingestion.
- Linux isolation tests for workspace, process, network, resource, and
  credential boundaries.
- Browser tests for the complete journey and partial/error/recovery states.
- A deterministic fake-agent suite for CI plus one explicitly approved real
  Codex smoke flow in the private environment.
