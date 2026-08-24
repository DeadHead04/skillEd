# Phase 4 — Results and Skill Statistics

## Objective

Turn Skill-Up reports into understandable per-case evidence and trustworthy
Skill-level trends. This phase completes the first release.

## Report ingestion

- Archive original Skill-Up structured reports with checksums.
- Validate report shape and correlate case, variant, and iteration to the
  immutable run plan.
- Normalize status, output, assertion evidence, latency, tokens, errors, and
  no-tool compliance into `CaseExecution` records.
- Store Skill-Up/adapter versions and raw artifact pointers.
- Make ingestion idempotent by run, attempt, case, variant, and iteration.
- Mark missing or duplicate report entries as ingestion errors; do not invent
  results.

## Run result UI

### Summary

- Status and phase timestamps.
- Skill and suite snapshot links.
- Model, runner versions, image digest, iterations, and actor.
- Scheduled/completed/pass/fail/error/cancelled counts.
- With-Skill pass rate, baseline pass rate, and uplift.
- Latency, token totals, estimated cost, and no-tool compliance.

### Case comparison

Pair rows by case and iteration. Display:

- With-Skill status/output.
- Without-Skill status/output.
- Changed outcome (`improved`, `regressed`, `unchanged-pass`,
  `unchanged-fail`, or `not-comparable`).
- Assertion evidence and error category.
- Latency, token, and cost differences.

Opening an execution shows the prompt, response, checks, evidence, usage,
provider-safe identifiers, and raw-report link. It does not present a generic
tool timeline because tools do not exist in this mode.

### Partial and error states

- Partial cancelled run: show completed evidence and exclude cancelled work
  from pass-rate denominator.
- One variant errors: label pair `not-comparable`; do not treat the other arm as
  improvement.
- Missing usage: show `Unavailable` and keep pass/fail evidence.
- Missing price: show tokens and `Cost unavailable`.
- Raw artifacts expired: retain normalized evidence and mark artifact expiry.

## Statistics

Skill Statistics defaults to the current version and last 30 days, with filters
for version, suite, case tag, model, status, and time range.

Panels:

- Latest with-Skill pass rate and paired baseline uplift.
- Pass/fail/error trend over runs.
- Baseline comparison trend.
- Average/median latency and p95 when sample size is at least 20.
- Input/output tokens and estimated cost trend.
- Failures by case/tag and error category.
- Run history with immutable snapshot links.
- No-tool compliance, expected to remain 100%.
- Coverage notices: `SKILL.md only`, auxiliary resources not covered, trigger
  selection not measured.

Every percentage shows numerator/denominator and unavailable counts. The UI
does not create an overall “Skill score” by mixing quality, cost, and latency.

## Metric rules

- Pass rate includes completed pass/fail/error work but excludes cancelled work;
  error rate remains separately visible.
- Uplift is paired with-Skill pass rate minus without-Skill pass rate, in
  percentage points.
- A pair is improved/regressed only when both executions produced comparable
  graded outputs.
- Cost uses the pricing snapshot stored on the run, so history does not change
  when provider prices change.
- Retries count only the final accepted execution in quality metrics; attempts
  remain visible for reliability/cost analysis.

## Parallel work

- Track A: result schema, ingestion, and fixture tests.
- Track B: metric query/service implementation.
- Track C: run summary and case comparison UI.
- Track D: Skill statistics UI and accessibility/performance work.

## Acceptance gate

1. Ingest representative pass, fail, error, partial, retry, and cancellation
   reports idempotently.
2. Pair with/without variants correctly across multiple iterations.
3. Verify pass, error, uplift, token, cost, and latency formulas against fixed
   fixtures.
4. Never mark an errored/missing pair improved or regressed.
5. Display numerators, denominators, filters, sample size, and unavailable
   counts.
6. Drill from a Skill trend to the exact immutable run and case evidence.
7. Preserve normalized history after raw-artifact expiry.
8. Confirm viewer access is read-only and cross-workspace results are blocked.
9. Complete the full import → test → run → statistics journey from the
   acceptance plan.
