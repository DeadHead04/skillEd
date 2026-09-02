# V1 Data and API Contracts

## Core records

### Package lifecycle

- `Skill`: stable identity, active version, optional candidate version, name,
  description, status, and timestamps.
- `SkillVersion`: immutable version key, base version/proposal where applicable,
  package checksums, manifests, compatibility, artifact keys, and provenance.
- `TaskEvidence`: kind, filename, checksum, media type, artifact key, and safe
  summary.
- `EvidenceSnapshot`: immutable selected evidence IDs and checksum.
- `ExportArtifact`: export kind, source version/run, checksum, storage key, and
  creation time.

### Eval authoring

- `EvalSuite`: stable owner of the current mutable draft.
- `EvalDraft`: revision, bound Skill version/evidence snapshot, structured task
  understanding, questions/answers, coverage plan, generated files, validation,
  and confidence level.
- `EvalSnapshot`: immutable canonical Skill-Up files, fixtures, verifier files,
  case manifest, policy result, checksum, and approval provenance.

### Conversations

- `AgentConversation`: purpose, Codex thread ID, bound artifacts, status, model,
  and timestamps.
- `ConversationTurn`: user/assistant content, Codex turn ID, structured payload,
  usage, and status.
- `ConversationHandoff`: latest decisions, unresolved questions, exact artifact
  references, and summary needed to reconstruct a thread.

### Runs

- `EvaluationRun`: pinned run specification, status, phases, requested
  iterations, baseline flag, actor, and cancellation state.
- `RunAttempt`: lease/worker identity, attempt number, timing, and outcome.
- `CaseExecution`: case, variant, iteration, status, output, assertion evidence,
  artifact pointers, timing, usage, and error category.
- `RunArtifact`: type, checksum, size, storage key, and retention.

### Improvements

- `UpgradeProposal`: base version, source run, conversation, summary, risk,
  patch artifact, proposed eval changes, status, and decision provenance.
- `ProposalChange`: file/hunk, rationale, expected impact, and selection status.
- `VersionComparison`: old/new versions, common eval snapshot, run IDs, metric
  deltas, fixed/regressed cases, and verification status.

## State machines

```text
Eval draft:
analyzing → waiting_for_user → planning → generating → validating
          → ready_for_review → approved | rejected | failed

Run:
queued → preparing → validating → running → judging → ingesting → completed
                             ↘ failed
queued|preparing|running → cancelling → cancelled

Proposal:
generating → ready_for_review → approved | rejected | revision_requested
approved → applying → candidate_created → verifying → verified | failed
verified → promoted | retained
```

## API groups

All routes are versioned and authorized. IDs always resolve inside the current
workspace; responses never expose server filesystem paths or secrets.

### Package and versions

- `POST /api/v1/skills/imports`
- `GET /api/v1/skills/imports/:importId`
- `GET /api/v1/skills/current`
- `GET /api/v1/skills/:skillId/versions`
- `GET /api/v1/skill-versions/:versionId`
- `GET /api/v1/skill-versions/:versionId/files/*`
- `POST /api/v1/skill-versions/:versionId/exports`
- `GET /api/v1/exports/:exportId`
- `POST /api/v1/skills/:skillId/activate/:versionId`

### Task evidence

- `POST /api/v1/skills/:skillId/evidence`
- `GET /api/v1/skills/:skillId/evidence`
- `POST /api/v1/skills/:skillId/evidence-snapshots`

### Eval authoring

- `POST /api/v1/skill-versions/:versionId/eval-drafts`
- `GET /api/v1/eval-drafts/:draftId`
- `POST /api/v1/eval-drafts/:draftId/turns`
- `POST /api/v1/eval-drafts/:draftId/answers`
- `PATCH /api/v1/eval-drafts/:draftId/cases/:caseId`
- `POST /api/v1/eval-drafts/:draftId/validate`
- `POST /api/v1/eval-drafts/:draftId/approve`
- `GET /api/v1/eval-snapshots/:snapshotId`
- `GET /api/v1/eval-snapshots/:snapshotId/files/*`

### Runs

- `POST /api/v1/runs`
- `GET /api/v1/runs/:runId`
- `GET /api/v1/runs/:runId/events`
- `POST /api/v1/runs/:runId/cancel`
- `GET /api/v1/runs/:runId/executions`
- `GET /api/v1/runs/:runId/artifacts`

### Improvements and comparison

- `POST /api/v1/runs/:runId/proposals`
- `GET /api/v1/proposals/:proposalId`
- `POST /api/v1/proposals/:proposalId/turns`
- `POST /api/v1/proposals/:proposalId/approve`
- `POST /api/v1/proposals/:proposalId/reject`
- `POST /api/v1/proposals/:proposalId/request-revision`
- `POST /api/v1/proposals/:proposalId/verify`
- `GET /api/v1/comparisons/:comparisonId`

## Snapshot contract

Every run pins IDs and checksums for the Skill version, normalized runtime
package, eval snapshot, task-evidence snapshot, environment image, Codex model
and settings, Skill-Up version, judge configuration, iterations, and baseline
mode. Every proposal pins the base version and source run. Every candidate pins
the exact approved patch and approval decision.

## Result dimensions

Store and display independent dimensions rather than one blended score:

- target correctness;
- semantic completeness;
- unsupported claims;
- source/invariant preservation;
- unrelated drift;
- artifact validity;
- stability across trials;
- latency, tokens, and errors;
- optional with-Skill versus without-Skill uplift.

Each metric response includes its numerator, denominator, unavailable count,
case population, and run/version filters.
