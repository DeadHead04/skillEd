# SkillEd V1 Product Context

## Outcome

V1 lets a trusted user upload one Agent Skill package and supporting task
evidence, create sophisticated evals through a guided Codex conversation, run
those evals through Skill-Up with Codex, understand failures, review proposed
Skill changes, and download or activate a verified candidate without using a
terminal.

## Authoritative lifecycle

```text
upload → package version → task understanding → eval draft → approved snapshot
       → run → evidence → upgrade proposal → approved candidate → verification
       → active version or download
```

Versions, approved eval snapshots, run specifications, and results are
immutable. Conversations and drafts are mutable assistance surfaces and never
silently alter an authoritative artifact.

## Responsibility split

### SkillEd

- Owns the UI, package intake, compatibility analysis, versions, conversations,
  approvals, queue, artifact storage, report ingestion, comparisons, and
  downloads.
- Materializes exact checksummed artifacts into temporary cloud workspaces.
- Determines when paid or state-changing work may begin.

### Codex with `skill-upper`

- Inspects the selected package and uploaded task evidence.
- Produces a structured task understanding and asks only material questions.
- Proposes coverage plans, cases, fixtures, graders, and upgrade patches.
- Diagnoses whether a failure belongs to the Skill, eval, judge, or environment.
- Works only in an isolated draft copy; it cannot promote a version.

### Skill-Up

- Validates declarative eval files.
- Installs the selected Skill into a real Codex execution workspace.
- Runs cases, variants, and repeated trials.
- Applies rule-based, script, and agent judges and emits structured reports.

### User

- Supplies the package and whatever task evidence is available.
- Answers unresolved questions.
- Approves eval snapshots, paid runs, proposed changes, and final activation.

## Evidence-dependent sophistication

The product must not claim equal confidence from unequal inputs.

| Supplied evidence | What V1 can establish |
| --- | --- |
| Skill package only | Structural and instruction-derived provisional tests |
| Package + task description | Behavioral and adversarial requirements |
| Package + example inputs | Realistic fixtures and boundary cases |
| Package + expected outputs | Stronger correctness or invariant checks |
| Package + dataset | Stratified coverage and controlled perturbations |
| Package + authority documents | Grounded semantic grading |
| Package + past failures | High-value regression cases |

The UI labels eval confidence as `provisional`, `behavioral`, `grounded`, or
`strong`, explains missing evidence, and never presents an unsupported green
result as proof of business correctness.

## V1 scope

- ZIP upload and safe file inspection.
- One stable Skill identity with multiple immutable versions.
- Original, installable, development, and run-evidence downloads.
- Codex App Server conversation for eval authoring and upgrade proposals.
- Generated Skill-Up YAML, cases, fixtures, and supported judges.
- Cloud Skill-Up runs using the Codex engine and the logged-in worker.
- Isolated tested-agent and judge sessions.
- Per-case evidence, artifact diffs, scope drift, stability, latency, and token
  reporting.
- Candidate creation, old-versus-new verification, activation, and rollback.

## Deferred

- Projects, multi-Skill graphs, marketplaces, organization RBAC, and billing.
- GitHub synchronization, pull requests, and managed deployment.
- Arbitrary public uploads or concurrent use of a shared Codex identity.
- User-supplied live MCP servers, unrestricted setup commands, and unrestricted
  network access.
- Fully autonomous eval approval, Skill modification, promotion, or release.
- Production traffic ingestion and drift alerting.

## Product principles

1. Top-level decisions stay simple; evidence remains available underneath.
2. Original uploads are preserved byte-for-byte.
3. Every test and update is pinned to exact checksums.
4. The tested agent, semantic judge, and authoring agent never share context.
5. Generated tests are reviewed; tests are never weakened merely to turn green.
6. A successful target repair does not hide unrelated drift or regressions.
