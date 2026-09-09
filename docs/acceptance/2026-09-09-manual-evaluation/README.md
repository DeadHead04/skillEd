# Product-QC walkthrough ready for manual inspection

Date: 9 September 2026. Installation: <http://127.0.0.1:3400>. Evidence mode: **demo**. No Codex model calls were made and the executor readiness gate was not changed.

The prepared `manual-product-qc` package was uploaded through the browser with the task description, product cards, authority rules, recorded failures and expected decisions. The browser workflow completed task understanding, ten-case generation, evaluation approval, a two-trial run with a baseline, improvement review, candidate creation and verification. The candidate remains **unactivated** for the user's final review and decision.

## Open the saved workflow

1. [Package and task materials](http://127.0.0.1:3400/skill?skill=73c18135-4cd0-4bd4-9461-c1d8205abf08).
2. [Approved evaluation and case details](http://127.0.0.1:3400/evals/1d6b8393-df25-4bb7-9048-0d612b8a5040?skill=73c18135-4cd0-4bd4-9461-c1d8205abf08).
3. [Original run, assertions and baseline](http://127.0.0.1:3400/runs/818c74cc-057e-4cd5-b824-5e759a4aa336?skill=73c18135-4cd0-4bd4-9461-c1d8205abf08).
4. [Review the improvement, comparison and activation control](http://127.0.0.1:3400/improve/b38dc457-b9ee-4fbf-9cac-48846eb512e2?skill=73c18135-4cd0-4bd4-9461-c1d8205abf08).

Use the documented local test account if sign-in is needed. To repeat the workflow yourself, select the package and create a new evaluation or clone its approved evaluation as a draft. The [full manual guide](../manual-skill-evaluation.md) explains the upload and review steps.

## Checks performed

- Preflight and stack verification passed. Web, worker and PostgreSQL remain on the existing local demo configuration.
- All four material downloads matched their source files by SHA-256. Dataset, authority, past-failure and expected-output classifications were observed in the browser.
- The evaluation was approved with ten cases. The run was refreshed and recovered its existing state.
- The run contains all 40 unique case/configuration/trial combinations: 20 Skill samples and 20 no-Skill baseline samples. Each configuration contains 12 PASS, 6 FAIL and 2 PARTIAL samples, corresponding to six passing, three failing and one partial case per trial.
- Candidate verification contains two completed runs on the same approved eval, with three trials and 30 unique samples each. The base has 18 PASS, 9 FAIL and 3 PARTIAL samples. The candidate has 30 PASS samples. These are deterministic fixture outcomes, not demonstrated model improvement.
- Proposal status is `verified`; the package's active-version pointer is still null. Verification did not activate the candidate.
- Original raw-report and candidate-package downloads returned successfully; both ZIP archives passed integrity checks.

The [machine-readable summary](summary.json) records IDs, counts, file hashes and download hashes. Downloads are [demo-run-report.zip](demo-run-report.zip) and [demo-candidate-v2.zip](demo-candidate-v2.zip). They contain only synthetic test evidence/package content.

## Issues visible during the walkthrough

1. The launch page says **“This spends real model time”** in demo mode and displays a Codex model as its engine. The results page correctly shows **Demo evidence**. The launch copy needs the same mode-aware treatment.
2. The results summary displays **Stability — not measured** even with two trials. Use the saved sample matrix to inspect repetition; do not take this summary as complete stability reporting.
3. The fake adapter's prompts, assertions, failure responses and proposed grounding paragraph are prepared fixtures. They do not prove that the four uploaded cards were consumed or that expected decisions were graded. The proposal repeats grounding requirements already present in the sample Skill, illustrating why a green demo comparison cannot establish usefulness.
4. The displayed Skill diff removes and re-adds the whole file while the effective change appends a grounding section. This obscures the small actual change during review.

These observations are recorded for correction; no application code was changed during this walkthrough. Real task-quality testing still requires the [execution-readiness repair and acceptance work](../../operations/2026-09-07-generation-readiness-incident.md). None of the demo evidence authorizes a real-mode candidate or certifies Render deployment.
