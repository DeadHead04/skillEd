# Data and API Contracts

## Domain records

### Workspace and access

- `Workspace`: ID, name, slug, settings, created time.
- `WorkspaceMember`: workspace, user, role, for MVP there is only one role, that is user.
- `Connection`: workspace, provider (`github`, `openai`), status, encrypted or
  external secret reference; never the displayed secret value.

### Skills

- `Skill`: stable ID, workspace, canonical name, description, tags, source
  identity, source path, visibility, latest-version ID.
- `SkillVersion`: Skill ID, immutable commit/checksum, parsed metadata, package
  manifest, validation status, artifact pointer, imported actor/time.
- `ValidationFinding`: version, severity, code, message, relative path, optional
  line.

Stable Skill identity is independent of repository path. A version is immutable;
rescanning the same commit/checksum is idempotent.

### Tests

- `TestSuite`: Skill, name, description, draft revision, published source
  reference where available.
- `TestCase`: suite, stable case ID, title, description, prompt, tags,
  assertions, timeout, enabled flag, ordering.
- `SuiteSnapshot`: immutable checksum, canonical serialized suite, generated
  Skill-Up files, creator/time.

Case IDs are unique within a suite. Editing a draft changes its revision but
never a prior snapshot.

The first-release assertion union supports:

- RegEx Matching
- Word Matching
- Result Validation

### Runs

- `EvaluationRun`: workspace, Skill version, suite snapshot, engine version,
  model/settings snapshot, requested iterations, status, phase timestamps,
  actor, cancellation state, pricing snapshot.
- `RunAttempt`: run, attempt number, worker/container identity, timestamps,
  outcome and retry reason.
- `CaseExecution`: run, case, variant (`with_skill`, `without_skill`), iteration,
  status, final output, assertion evidence, error category, latency, tokens,
  estimated cost, no-tool status.
- `RunArtifact`: run/attempt, type, checksum, byte size, storage pointer,
  retention expiry.

One logical execution exists for every enabled case × two variants × requested
iterations. Cancelled unscheduled executions remain distinguishable from
errors.

### (Deferred as we can use Git to track this) Audit

(Deferred) `AuditEvent` records workspace, actor, action, target type/ID, timestamp, and
non-secret summary for imports, test changes, run creation/cancellation,
connection changes, and later publications.

**For now we simply use the test data stored in the DB corresponding to a skill.**

## Status contracts

Run status transitions:

```text
queued → preparing → running → ingesting → completed
                         ↘ failed
queued|preparing|running → cancelling → cancelled
```

Terminal status never moves backward. Retrying infrastructure work creates a
new attempt under the same logical run.

Case execution status:

- `pass`: output produced and every assertion passed.
- `fail`: output produced but an expectation or no-tool policy failed.
- `error`: model, runtime, timeout, adapter, or report failure.
- `cancelled`: execution was stopped or never scheduled after cancellation.

## API groups 

All endpoints are workspace-scoped, authorize before querying data, use JSON,
and return stable error codes plus safe messages.
All the APIs should be versioned (/api/v<version-number>/...), current version is `v1`

### Catalog

- `POST /api/v1/workspaces/:workspaceId/imports/github`
- `POST /api/v1/workspaces/:workspaceId/imports/upload`
- `GET /api/v1/workspaces/:workspaceId/imports/:importId`
- `GET /api/v1/workspaces/:workspaceId/skills`
- `GET /api/v1/workspaces/:workspaceId/skills/:skillId`
- `GET /api/v1/workspaces/:workspaceId/skills/:skillId/versions/:versionId`
- `GET /api/v1/workspaces/:workspaceId/skills/:skillId/versions/:versionId/files/*`

All the imports are asynchronous from repositories/archives. File preview serves
safe text or approved image types, applies byte limits, and never executes
content.

### Test authoring

- `GET/POST /api/v1/workspaces/:workspaceId/skills/:skillId/suites`
- `GET/PATCH /api/v1/workspaces/:workspaceId/suites/:suiteId`
- `POST /api/v1/workspaces/:workspaceId/suites/:suiteId/cases`
- `PATCH/DELETE /api/v1/workspaces/:workspaceId/suites/:suiteId/cases/:caseId`
- `POST /api/v1/workspaces/:workspaceId/suites/:suiteId/snapshots`
- `GET /api/v1/workspaces/:workspaceId/suite-snapshots/:snapshotId/yaml`

Conflict detection among versions is not needed for now.

### Runs and statistics

- `POST /api/v1/workspaces/:workspaceId/runs`
- `GET /api/v1/workspaces/:workspaceId/runs/:runId`
- `POST /api/v1/workspaces/:workspaceId/runs/:runId/cancel`
- `GET /api/v1/workspaces/:workspaceId/runs/:runId/executions`
- `GET /api/v1/workspaces/:workspaceId/skills/:skillId/statistics`

Run creation requires Skill version, suite or snapshot, allowed model, and
iteration count. It returns the immutable snapshot IDs and estimated maximum
execution count. Reusing an idempotency key returns the existing run.

Progress can use server-sent events backed by persisted job events; polling the
run endpoint remains authoritative.

## Metrics

For a selected filtered population:

- `scheduled`: all case/variant/iteration executions excluding executions
  removed before the run was accepted.
- `pass_rate = pass / scheduled_non_cancelled`.
- `error_rate = error / scheduled_non_cancelled`.
- `no_tool_compliance = executions_with_zero_tool_calls / completed_outputs`.
- `with_skill_pass_rate` and `without_skill_pass_rate` use their respective
  variants.
- `uplift_pp = 100 × (with_skill_pass_rate - without_skill_pass_rate)`.
- Token totals are reported separately for input and output.
- Estimated cost is the sum of usage multiplied by the immutable provider/model
  price effective for that run.
- Latency reports average and median; p95 appears only with at least 20 samples.

Every metric response includes numerator, denominator, filters, time range, and
unknown/unavailable counts. Currency cost is labelled `estimated` unless the
provider supplies authoritative billed cost.

## Snapshot contract

Every run pins:

- Skill ID, version ID, commit/checksum, and package checksum.
- Suite snapshot ID and checksum.
- Model provider/name and supported parameters.
- Skill-Up commit/version.
- Response-runner and container-image digest.
- Iteration count, timeout policy, and pricing snapshot.

These values are displayed on the run detail page and included in exported run
metadata. A run can be reproduced only when all referenced artifacts remain
available; otherwise it is historical evidence, not marked reproducible.

## Security and retention

- Raw prompts and outputs are workspace-private and inherit configurable
  retention.
- Normalized aggregate metrics may outlive raw artifacts but continue pointing
  to the original immutable run metadata.
- API responses never include provider credentials, gateway tokens, container
  environment dumps, or arbitrary host paths.
- Deletion is workspace-authorized, audited, and removes artifact objects while
  retaining the minimum tombstone needed for referential integrity and audit.
