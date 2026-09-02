# V1 Data and API

## Seven persisted entities

### 1. `skills`

Stable Skill identity: `id`, `name`, `active_version_id`, and timestamps.

### 2. `skill_versions`

Immutable package: `id`, `skill_id`, `version_number`, `base_version_id`,
`source` (`upload` or `proposal`), checksums, manifest JSON, readiness,
`artifact_path`, and timestamp.

### 3. `eval_versions`

Mutable while `draft`, immutable after `approved`: `id`, `skill_version_id`,
status, revision, task understanding JSON, questions/answers JSON, coverage
plan JSON, evidence level, bundle path/checksum, validation result, and approval
time.

### 4. `conversations`

User-facing Codex work: `id`, type (`eval_authoring` or `skill_update`),
`codex_thread_id`, bound Skill/eval/run IDs, status, context summary JSON, and
timestamps. Messages are stored as child rows.

### 5. `runs`

One Skill-Up invocation: `id`, Skill/eval version IDs, purpose (`evaluation` or
`candidate_comparison`), model/settings JSON, iterations, baseline flag, status,
progress JSON, raw-report path, error, and timestamps.

### 6. `case_results`

One case/variant/iteration result: run ID, case ID, status, grading JSON, output
summary, artifact paths, transcript path, duration, tokens, and error.

### 7. `update_proposals`

Proposed change: `id`, source run ID, base Skill version ID, conversation ID,
summary, patch path, proposed eval patch path, risk JSON, decision, candidate
version ID, and timestamps.

Artifacts and job events do not need separate domain models; they are storage
paths and child rows attached to these entities.

## State rules

```text
Eval: draft → validating → ready → approved | failed
Run: queued → preparing → running → judging → completed | failed | cancelled
Proposal: generating → review → approved | rejected | revision_requested
Approved proposal: approved → candidate_created → verifying → verified | failed
```

An approved eval version, existing Skill version, completed run, or decided
proposal is never edited in place.

## API surface

### Skill

- `POST /api/v1/skill/upload`
- `GET /api/v1/skill`
- `GET /api/v1/skill/versions/:versionId`
- `GET /api/v1/skill/versions/:versionId/files/*`
- `GET /api/v1/skill/versions/:versionId/download`
- `POST /api/v1/skill/versions/:versionId/activate`

### Eval creation

- `POST /api/v1/evals`
- `GET /api/v1/evals/:evalId`
- `POST /api/v1/evals/:evalId/messages`
- `PATCH /api/v1/evals/:evalId/cases/:caseId`
- `POST /api/v1/evals/:evalId/validate`
- `POST /api/v1/evals/:evalId/approve`

### Runs

- `POST /api/v1/runs`
- `GET /api/v1/runs/:runId`
- `GET /api/v1/runs/:runId/events`
- `POST /api/v1/runs/:runId/cancel`
- `GET /api/v1/runs/:runId/report/download`

### Updates

- `POST /api/v1/runs/:runId/update-proposal`
- `GET /api/v1/update-proposals/:proposalId`
- `POST /api/v1/update-proposals/:proposalId/messages`
- `POST /api/v1/update-proposals/:proposalId/decision`
- `GET /api/v1/update-proposals/:proposalId/comparison`

The decision endpoint accepts `approve`, `reject`, or `request_revision`.
Approval queues candidate creation and verification.

## Run pinning

Every run stores exact Skill/eval bundle checksums, model/settings, Skill-Up and
Codex versions, iteration count, judge definitions, and baseline choice. The
comparison endpoint computes its view from two pinned runs; it does not require
a separate comparison table.
