---
title: "Agent skill evaluation scores and grading"
description: "Understand skilled evaluation scores, assertion evidence, rubric identity, and comparisons. MCP exposes evaluation results; it does not assign a separate score."
---

# Scoring and comparison

For a worked example, see [how a refund case goes from score 0 to 1](./see-it-work.md#_3-read-the-score-from-its-evidence), including the actual response and script evidence. MCP exposes evaluation tools and reports; it does not assign a separate score.

Rule grades now identify their scoring contract as `skilled/2` and include a
`rubric_id` derived from the configured rules. Assertion IDs identify criteria;
their display text and evidence describe the outcome. Changing an outcome does
not change the rubric. Changing a criterion does.

Every configured negative rule contributes an assertion. A forbidden match fails;
its absence passes. When a negative rule fails, configured success rules remain
in the denominator with `skipped: true` and receive no credit. They are not run.
For compatibility, `summary.failed` includes all assertions that earned no credit,
including skipped assertions; inspect `skipped` to distinguish unevaluated checks.
An empty rubric remains unscored by comparison.

Prerequisite checks (`expect`) are separate from rubric assertions. A failed gate
makes the case **FAIL** and the unexecuted judge **SKIP**, with zero judge credit.
Passing gates never add credit. Debug and full evaluation use the same rule.
The debug command's exit code indicates that the debugging operation completed;
read the grade/report to determine the case outcome.

JSON import retains skipped assertions. HTML and Markdown label them as skipped;
JUnit failure details distinguish them from observed assertion failures. A skipped
assertion is not a skipped test case: a case with a matched failure rule still fails.

Comparison requires compatible scoring versions, rubric identities, prompts and
report identity before calculating score deltas. Engine/model changes are reported
as warnings; review them before attributing a score change to a Skill edit.
Script grades include a fingerprint of the script bytes and timeout. Dependencies
read by a script are not fingerprinted automatically; pin them in evaluation
fixtures and review provenance before interpreting a delta.

Reports without scoring metadata retain the legacy text-based comparison behavior;
regenerate both baselines with the same CLI before relying on numerical deltas.
New and legacy rule scores are not mixed. Verdict transitions remain visible when
scores cannot be compared. A numerical delta is evidence for the tested inputs,
not statistical proof of general behavioral drift.

Project Skill discovery follows the documented host locations:
[Codex](https://learn.chatgpt.com/docs/build-skills) and
[Claude Code](https://code.claude.com/docs/en/skills). Use `skilled setup --host codex`
or `skilled setup --host claude-code` to install the bundled workflow locally.

Claude and Codex case reports include `usage_status`. `unavailable` means the
legacy numeric zero counts are placeholders, not measured zero usage. Requested
models and models observed in native session records remain distinct fields.
