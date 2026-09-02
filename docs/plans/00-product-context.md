# V1 Product Contract

## User outcome

A user can upload a Skill package and real task material, create and approve a
meaningful eval suite, run it with Codex, understand where the Skill fails,
approve or reject a proposed improvement, compare the candidate with the
current version, and download the chosen Skill entirely from the UI.

## The only lifecycle

```text
Skill version
→ eval draft
→ approved eval version
→ run and case results
→ update proposal
→ candidate Skill version
→ verification run
→ active/downloaded version
```

## Responsibilities

### SkillEd

- Stores packages, versions, task files, evals, results, proposals, and reports.
- Controls every approval and state change.
- Runs background work and renders progress/results in the UI.

### Codex with `skill-upper`

- Reads the exact Skill version and supplied task files.
- Summarizes the task and asks questions when required information is missing.
- Creates Skill-Up eval files and proposes Skill changes.
- Writes only to a temporary working copy.

### Skill-Up

- Validates the generated evals.
- Installs the selected Skill for the tested Codex agent.
- Runs cases and judges and produces structured reports.

### User

- Supplies the package and task evidence.
- Answers material questions.
- Approves evals, runs, proposed changes, and final activation.

## Eval quality follows available evidence

| Input | Eval capability |
| --- | --- |
| Skill only | Provisional instruction-derived cases |
| Skill + task description | Behavioral and adversarial cases |
| Skill + examples | Realistic fixtures and boundary cases |
| Skill + expected outputs or rules | Grounded correctness checks |
| Skill + dataset or past failures | Stratified and regression cases |

The UI must show the evidence level. A package-only eval cannot be presented as
proof of business correctness.

## Required v1 features

- Safe ZIP upload and file inspection.
- Immutable Skill versions and current/candidate comparison.
- Task description and file upload.
- Persisted Codex eval-authoring conversation.
- Generated cases, fixtures, rule/script/agent judges, and Skill-Up validation.
- User approval before running an eval version.
- Sequential cloud execution using the logged-in Codex worker.
- Case results, artifacts, transcript, grader evidence, drift, stability, time,
  and tokens.
- Codex-generated update proposal with approve/reject.
- Candidate verification, activation, and Skill/report download.

## Explicit non-goals

Projects, multiple simultaneous Skills, GitHub sync, teams/RBAC, public uploads,
billing, marketplace, production telemetry, live MCP, and automatic promotion
are not part of v1 and require no v1 tables, APIs, screens, or placeholders.
