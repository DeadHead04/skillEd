# V1 UI Journey

## Navigation

The UI has one current Skill workspace with five areas:

1. **Package** — upload, validation, files, compatibility, and downloads.
2. **Evals** — guided Codex conversation, coverage plan, cases, and snapshots.
3. **Runs** — launch, progress, results, transcripts, and artifacts.
4. **Improvements** — proposed patches, approval, and verification.
5. **Versions** — active/candidate history, comparisons, activation, rollback,
   and downloads.

## 1. Upload

The user uploads a Skill ZIP and may add a task description, example inputs,
expected outputs, a dataset, authority material, or previous failure examples.
SkillEd scans asynchronously and shows the primary Skill candidates, package
tree, findings, dependency hints, and compatibility status. Selecting a valid
candidate creates immutable v1.

Uploading changed contents later creates v2 and shows a package diff. It does
not switch the active version automatically.

## 2. Understand and author evals

The user selects **Create evals**. SkillEd starts an `eval_authoring` Codex
thread bound to one Skill version and one mutable eval draft, explicitly loads
`skill-upper`, and provides the selected task-evidence snapshot.

Codex first returns structured understanding:

- intended outcome and output artifacts;
- authoritative sources;
- allowed and forbidden changes;
- important rules and dependencies;
- likely failure modes;
- unknowns that affect grading.

The UI renders material unknowns as questions. Once answered, Codex proposes a
coverage plan before creating files. The plan shows categories, case counts,
judge types, required fixtures, estimated runs, and confidence level.

After approval, Codex writes a draft `eval.yaml`, case YAML, fixtures, and
verifiers in an isolated draft workspace. Skill-Up validation and policy checks
run automatically. The UI presents human-readable cases and an optional raw
YAML/file view. Approving creates an immutable `EvalSnapshot`.

## 3. Run

The user chooses the Skill version, approved eval snapshot, model, iterations,
and optional without-Skill baseline. The confirmation screen shows estimated
case executions and warns that the shared Codex identity has serialized usage.

Run states:

```text
queued → preparing → validating → running → judging → ingesting → completed
                             ↘ failed
queued|preparing|running → cancelling → cancelled
```

Progress persists when the page is closed. Server-sent events provide live
updates; polling remains authoritative.

## 4. Review

The summary separates target correctness, semantic completeness, unsupported
claims, scope preservation, artifact validity, stability, latency, and tokens.
There is no opaque combined Skill score.

Each case exposes its input, output, files, transcript, grader assertions,
evidence, unexpected changes, and trial history. A green target result cannot
hide collateral drift.

## 5. Improve

The user chooses **Generate improvement** from a completed run. SkillEd starts
an `upgrade_proposal` Codex thread with `skill-upper`, bound to the exact base
version, visible failure evidence, and approved user constraints. It works on a
temporary copy and returns:

- top-level behavior summary;
- exact file patch;
- reason and expected impact per change;
- risks and compatibility changes;
- proposed regression cases;
- tests that should be rerun.

The top-level actions are **Apply and verify**, **Review details**, and
**Reject**. Approval creates a candidate version, never an in-place edit.
Rejection preserves the proposal and optional reason. Partial approval creates
a revised proposal before a version is created.

## 6. Verify and activate

SkillEd runs affected cases, the full visible regression suite, and reserved
holdout cases against the candidate. The comparison shows file changes,
fixed/unchanged/regressed cases, metric deltas, compatibility, and artifacts.
The user may activate, keep the current version, request another proposal, or
download the candidate. Activation is a pointer update and rollback remains
available.

## Conversation behavior

Authoring and improvement are separate persisted threads. Test-agent and judge
sessions are isolated per execution and are never resumed. SkillEd stores a
structured handoff summary so a lost Codex thread can be recreated from exact
artifact IDs, decisions, unresolved questions, and relevant run evidence.
