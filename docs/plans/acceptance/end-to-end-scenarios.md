# End-to-End Acceptance Scenarios

## Release criterion

The first release is complete only when a new editor can import a Skill, find
and inspect it, create response-only tests, run paired with/without-Skill
evaluations in isolated containers, and understand the resulting evidence and
statistics without using a terminal or editing YAML.

## Scenario 1 — Primary happy path

Fixture: a valid `release-notes-writer` Skill containing `SKILL.md`, one
reference, one script, one asset, and no existing `evals/`.

1. Editor signs in and opens an authorized workspace.
2. Editor imports the fixture from a pinned GitHub commit.
3. Import reports one valid Skill and informational uncovered-resource notices.
4. Skill appears in catalog search with source, commit, validation, zero tests,
   and `Untested` state.
5. Editor opens Overview and Files and safely previews every supported file.
6. Editor creates a suite with:
   - normal release-notes prompt;
   - format/heading edge case;
   - unrelated prompt proving the instructions do not produce forbidden text.
7. Generated YAML passes the pinned Skill-Up validator.
8. Editor starts one iteration using an allowed OpenAI model and confirms the
   estimated two calls per case.
9. Run completes all with-Skill and without-Skill executions.
10. Result page pairs each case, displays output/assertion evidence, and shows
    pass rates, uplift, latency, tokens, estimated cost, and 100% no-tool
    compliance.
11. Statistics link back to the exact Skill and suite snapshots.
12. Files, scripts, and assets remain unexecuted and are labelled not covered.

## Scenario 2 — Multiple Skills in one repository

1. Import a repository containing three valid Skill roots and one unrelated
   directory.
2. Scanner returns exactly three selectable Skills with distinct paths.
3. Select two and confirm two catalog entries share source/commit but retain
   stable independent IDs.
4. Reimport the commit and confirm no duplicates.
5. Import a later commit changing only one selected Skill and confirm a new
   version is added only where content/source identity requires it.

## Scenario 3 — Invalid and unsafe packages

Required fixtures and outcomes:

- Missing `SKILL.md` → no runnable Skill.
- Invalid YAML frontmatter → cataloged validation error, run disabled.
- Name does not match directory → validation error.
- Broken relative reference → warning.
- Non-empty `allowed-tools` → response-only warning.
- `../` or absolute archive path → import rejected.
- Escaping symlink/device file → import rejected.
- Duplicate normalized path/case variant → import rejected.
- Excessive file count, uncompressed size, or individual file size → import
  rejected before resource exhaustion.
- HTML/JavaScript file → shown as safe text/download, never executed.
- Secret-shaped filename/content fixture → warning/quarantine according to
  scanner policy; never logged or rendered unredacted in shared diagnostics.

## Scenario 4 — Test authoring integrity

1. Create cases using every supported literal and regex assertion.
2. Confirm generated YAML has stable ordering and validates.
3. Attempt invalid regex, duplicate ID, empty prompt, and empty assertion; each
   is rejected with field-level feedback.
4. Concurrent editors update the same draft; stale update receives a revision
   conflict and does not overwrite the current version.
5. Freeze snapshot A, edit the draft, freeze snapshot B, and confirm A’s files
   and checksum are unchanged.
6. Import a suite containing MCP, setup steps, custom engine, script judge, or
   repository fixtures; show it as unsupported and prevent execution without
   deleting the original definition.

## Scenario 5 — With-Skill baseline correctness

Use a deterministic fake model that records request messages.

1. With-Skill request contains parsed Skill metadata and Markdown body.
2. Without-Skill request contains none of the Skill content.
3. Both requests contain the identical user prompt and configured model.
4. Neither request contains tools or provider credentials.
5. Supporting files are not read or included.
6. Returned usage, latency, output, and transcript map to the correct case,
   variant, and iteration.
7. A synthetic transcript tool call causes a visible policy failure.

## Scenario 6 — Isolation and credential safety

1. Evaluation container runs non-root with read-only root and bounded writable
   workspace.
2. Attempts to contact public internet endpoints fail.
3. The internal model gateway remains reachable.
4. Attempts to access host filesystem, Docker socket, devices, or other
   containers fail.
5. CPU, memory, process, timeout, and output limits terminate abusive fixtures.
6. Provider API key is absent from container environment, filesystem, process
   list, Skill-Up report, application logs, and stored artifacts.
7. Expired, replayed, wrong-model, or wrong-run gateway token is rejected.
8. Container and staged files are removed after every terminal outcome.

## Scenario 7 — Failure and recovery

Exercise and verify visible stable error categories for:

- Provider timeout.
- Rate limit followed by successful bounded retry.
- Provider 5xx exhaustion.
- Invalid/malformed model response.
- Skill-Up validation or execution failure.
- Missing/malformed structured report.
- Worker crash before and after model completion.
- Cancellation while queued and while running.
- Database/artifact-store failure during ingestion.

Completed results survive cancellation and recovery. Duplicate attempts remain
auditable but do not double-count final quality statistics. No orphan container
remains after reconciliation.

## Scenario 8 — Statistics accuracy

Use a fixed data fixture containing passes, assertion failures, errors,
cancelled executions, retries, missing usage, and missing pricing.

Verify:

- With-Skill and without-Skill pass-rate denominators.
- Error rate and cancelled exclusions.
- Uplift in percentage points.
- Improved/regressed/not-comparable pair classification.
- Input/output token totals.
- Pricing-snapshot cost.
- Average/median and p95 sample-size rule.
- Retry attempt costs remain inspectable while final result is counted once.
- Every chart exposes filters, numerator, denominator, sample size, and
  unavailable count.

## Scenario 9 — Authorization

1. Viewer can search and inspect authorized workspace data but cannot import,
   edit tests, start/cancel runs, or change connections.
2. Editor can import, author, and run but cannot manage members or credentials.
3. Owner can perform all workspace operations.
4. Guessed IDs and search terms never reveal another workspace’s Skill, file,
   test, run, artifact, statistic, or audit metadata.
5. All mutations create non-secret audit events.

## Required automated layers

- Unit tests for parsing, validation, serialization, metric formulas, and
  policy decisions.
- Integration tests for database constraints, artifact storage, queue leases,
  GitHub acquisition, Skill-Up invocation, report ingestion, and gateway auth.
- Container security tests run on a Linux Docker-capable CI worker.
- Browser tests for primary, empty, partial, error, authorization, and
  accessibility states.
- One explicitly approved paid-model smoke test outside ordinary pull-request
  CI; deterministic fake-provider tests remain the merge gate.

## Release checklist

- All Phase 1–4 acceptance gates pass.
- Upstream Skill-Up pin and response-runner image digest are recorded.
- No live external tools or unsupported YAML paths are enabled.
- Threat model and retention defaults are reviewed.
- Backup/restore and worker orphan reconciliation are exercised.
- Accessibility checks cover keyboard operation, labels, focus, status updates,
  and color-independent result states.
- Operator runbook covers queue backlog, provider outage, cleanup failure,
  credential rotation, and report-ingestion recovery.
