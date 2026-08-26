# MVP User Flow and Screens

## Information architecture

The first release has four primary navigation areas:

1. **Skills** — catalog, import, package inspection, and Skill-level status.
2. **Tests** — suites and response-only cases belonging to a Skill.
3. **Runs** — queued, running, completed, failed, and cancelled evaluations.
4. **Settings** — GitHub connection, model access, limits,
   and retention.

Statistics are accessed from a Skill or run rather than introduced as a
separate generic observability product.

Use consistent terminology throughout the UI:

- `Skill`, not alternating `Skill Registry` and `Capability`.
- `Test suite` and `test case`, not alternating `eval`, `scenario`, and `test`.
- `Run`, not alternating `execution`, `experiment`, and `session`.
- `Result`, not alternating `evidence`, `trace`, and `report`.

## Primary journey

### 1. Import

The user selects **Import Skill** and chooses:

- GitHub repository URL, optional ref, and optional subdirectory; or
- ZIP/folder upload.

SkillEd scans without executing files and displays:

- Skills found and their paths.
- Parsed name and description.
- Commit/checksum and source provenance.
- Errors, warnings, and informational findings.
- Counts of instructions, references, scripts, assets, other files, and tests.

The user selects which discovered Skills to import. Invalid Skills remain
visible with actionable errors but cannot be run.

Edge states:

- No `SKILL.md`: explain the expected structure and stop.
- Multiple Skills: present individual selectable rows.
- Duplicate version: link to the existing version instead of creating another.
- Existing Skill at a new commit: create a new immutable version.
- Private repository authorization failure: preserve entered source details and
  offer reconnection; never request a personal token in a normal text field.

### 2. Discover

The Skills catalog displays:

- Name and description.
- Source repository and path.
- Current pinned version.
- Validation state.
- Number of enabled tests.
- Latest run status and pass rate.
- Baseline uplift when a completed paired run exists.

Search covers name, description, and path for MVP (other search options can be introduced later).
Filters cover valid/invalid, tested/untested, latest result, and source.

Empty states distinguish:

- Workspace has no Skills: show import action.
- Search has no matches: retain filters and offer clear action.
- Skill is imported but untested: link directly to **Create test**.

### 3. Inspect

The Skill detail screen has these tabs:

- **Overview:** rendered description, source, version, validation, latest
  evidence, and response-only coverage warning.
- **Files:** package tree and safe read-only previews.
- **Tests:** suites, case counts, draft state, and latest result.
- **Runs:** history for this Skill and version filters.
- **Statistics:** pass/baseline trend, latency, tokens, cost, errors, and sample
  counts.

The initial release does not edit Skill files. Source remains local Git and GitHub for the MVP.

### 4. Create tests

The user creates or opens a suite, then adds a case using a form:

- Stable case ID generated from title and editable until first publication.
- Title and optional description.
- Required single user prompt.
- Optional tags.
- `Contains all`, `contains any`, `must not contain` text checks.
- `Matches all`, `matches any`, `must not match` regular expressions.
- Timeout selected from workspace-approved values.

The UI shows a human-readable assertion summary and generated YAML preview.
Unknown YAML fields are not accepted through the first-release UI.

Saving creates a draft. Running does not freeze current draft. Only after user commits, it is saved as an immutable suite snapshot.
Publishing writes standard files under `evals/` through the GitHub branch-and-pull-request workflow when the source is Git-backed. Uploaded Skills retain tests as SkillEd-managed snapshots until exported or connected to GitHub.

### 5. Run

The run dialog shows:

- Skill and immutable version.
- Suite snapshot and enabled case count.
- Model selected from the workspace allowlist.
- Iterations: 1, 3, or 5; default 1.
- Fixed comparison: with Skill and without Skill.

The user confirms before a paid run. The UI moves immediately to a run page
showing queued/running progress. Leaving the page does not cancel the job.

Run states:

```text
queued → preparing → running → ingesting → completed
                         ↘ failed
queued/running → cancelling → cancelled
```

Cancellation is best-effort, stops unscheduled work, terminates the current
container, and preserves completed case results.

### 6. Review results

The summary displays:

- Scheduled, completed, passed, failed, errored, and cancelled executions.
- With-Skill pass rate.
- Without-Skill baseline pass rate.
- Uplift in percentage points.
- Latency, input/output tokens, estimated cost.

The case table pairs with-Skill and without-Skill executions. Opening a row
shows prompts, outputs, assertions, evidence, duration, usage, error details,
and the exact snapshots used.

We do NOT need trigger of the Skill testing for now.

## Permissions

Initial workspace roles, there is just a single role of user. RBAC can be added later on in the MVP.

## Human and system decisions

- User: defines prompts, assertions, run count, and whether evidence is good
  enough.
- SkillEd: validates structure and policy, freezes snapshots, schedules work,
  calculates metrics, and preserves evidence.
- (deferred) Skill-Up: executes variants and grades outputs.
- Model: produces only a response; it cannot call a tool.
