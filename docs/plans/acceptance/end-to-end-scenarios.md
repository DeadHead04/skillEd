# V1 End-to-End Acceptance

V1 ships only when the following journey succeeds without a terminal.

## Happy path

1. Upload a realistic Skill ZIP containing `SKILL.md`, references, assets, and
   scripts plus a task description, spreadsheet input, and authority file.
2. Select the Skill, inspect readiness/files, and create immutable v1.
3. Start eval creation. Codex with `skill-upper` accurately summarizes the task,
   asks material questions, and proposes coverage before generating files.
4. Review cases in plain language, edit one, validate, and approve the eval.
5. Start three iterations with a without-Skill baseline and follow live status.
6. Inspect top-level results and drill into inputs, outputs, files, transcripts,
   assertions, semantic evidence, and unrelated drift.
7. Request an update. Review the explanation, patch, risks, and regression-case
   changes. Approve the Skill patch but reject an unrelated eval weakening.
8. Verify current and candidate versions against the same eval and settings.
9. See fixed, unchanged, flaky, and regressed cases separately.
10. Explicitly activate the candidate and download its installable ZIP and run
    report.

## Required negative scenarios

- Package only: eval is labelled provisional and Codex asks for missing truth.
- Identical ZIP: no duplicate version.
- Changed ZIP: new version without changing the current pointer.
- Unsafe archive: rejected before extraction or execution.
- Missing runtime dependency: `needs_attention`, not a failed Skill result.
- Invalid generated YAML or escaping fixture path: approval blocked.
- Target fixed but unrelated content changed: correctness passes while scope
  preservation fails.
- Semantic judge failure: reported as judge error, not Skill failure or pass.
- Repeated case changes outcome: marked flaky.
- Codex login expiry, timeout, cancellation, worker restart, and malformed
  report: visible error, preserved completed evidence, and cleaned workspace.
- Rejected update: base package remains byte-identical.
- Candidate regression: comparison shows it and activation remains manual.
- Any download/report/log: no Codex credentials or temporary host paths.

## Automated checks

- Unit: ZIP safety, manifests/checksums, readiness, state changes, result
  calculations, patch application, and download exclusions.
- Integration: PostgreSQL, persistent files, App Server conversation/resume,
  Skill-Up validation/run/report ingestion, job interruption, and cancellation.
- Isolation: agent commands cannot read the Codex credential store, host files,
  sibling jobs, or forbidden network destinations.
- Browser: complete happy path plus every approval, error, and empty state.
- Real-agent smoke: one explicitly triggered private Codex run; deterministic
  fake-agent tests remain the normal automated gate.
