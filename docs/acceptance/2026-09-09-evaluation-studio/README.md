# Evaluation studio — implementation and acceptance

Date: 9 September 2026. Local installation: <http://127.0.0.1:3400/dashboard>.

The studio uses a new dark interface and the workflow **Package → Test plan → Run → Results → Improve → Release**. Dashboard and Skills are the primary destinations. The old design skill was not used. Existing account work, saved package versions, runs, conversations and decisions remain intact. This is an implemented local demo, not certification of a real model or a released Render pilot.

## Implemented workflow

- Dashboard shows attention items and recent packages. The registry supports search, status filters, card/list layouts and package-tree inspection. A searchable package switcher replaces the growing sidebar list.
- Package inspection separates structural validity, runtime compatibility, task coverage and measured performance. Metadata constraints, folder identity, linked-resource locations, excluded controls and optional Codex dependencies are checked. Optional folders are not required. Long instructions and inspection limits remain advisory. No completeness percentage is invented.
- Task-specific judging areas have stable IDs and explicit task-success, constraint or informational roles. New Codex proposals must supply areas. Legacy dimensions remain readable without rewriting historical records.
- Profile approval binds a revision and a canonical hash. JSON key ordering does not change that hash. Visible current/proposed comparisons precede applying a revision; stale authoring proposals are rejected. Material changes invalidate the draft's prior profile and generated cases.
- Required instructions can be marked as agent inputs. Expected answers are always judge-only. Every generated group must have its approved case count, areas and concrete assertion mappings. Two assertions in the same area cannot accidentally share a validator by dimension.
- Results preserve denominators, invalid evidence and missing samples. Area charts link to cases; case inspectors expose assertions, prompts, responses, outputs and trial/configuration selection. Quality, baseline benefit and repeated-trial stability are separate. Old runs and version-specific reruns use the package attached to their records.
- Text/JSON previews and CSV tables use authorized run-artifact routes. Judge observations expose expected/actual field values and protected-field differences. XLSX comparisons show stored values/formula text; formulas are not recalculated. Full XLSX files remain downloads rather than an embedded workbook editor.
- Improvement review shows a genuine contextual file diff and links each new proposed file change to actual failed required assertions. Candidate packages are assessed independently. Skill and evaluation decisions remain separate. Verification uses three matched trials and explicit activation.
- A package with no active version can receive initial activation after complete, current-pipeline, three-trial evidence for the full approved suite. The server rejects empty evidence, adapter mismatch, missing samples and a stale active-version pointer. Initial verification does not claim measured improvement.
- Account and team flows remain available. Keyboard navigation, an Escape-close evidence inspector, mobile layouts, visible demo/legacy labels, retry behavior and execution diagnostics use the same interface.

## Backend and image changes

Migration **007** adds package assessment and approved profile hash storage without rewriting old records. Run/export provenance includes the profile hash. The normalization contract is `skilled-grading-v3`.

The history rehearsal uncovered an optional-table lookup falling through a test schema into `public`. Optional export tables now resolve in the source schema, preventing unrelated decisions from entering an export.

Unified diffs use Git's bounded local diff operation. Both the full worker and standalone controller images contain Git. The judge wrapper invokes the pinned native Codex executable, avoiding the npm launcher's initialization under the judge address-space limit. This fixes one startup failure; it does not make the remaining sandbox checks pass.

## Acceptance evidence

The final command results and screenshot inventory are recorded in [checks.json](checks.json). Browser captures use synthetic fixtures and are explicitly demo evidence. They do not prove a model consumed or judged uploaded files.

Automated coverage includes:

- Metadata, resource paths, excluded files, safe archive modes, material visibility, structured validators, malformed/missing evidence and stable IDs.
- Actual PostgreSQL migrations, concurrent decisions, initial activation, idempotency, immutable history, role restrictions, leases, cancellation and history export/import reconciliation.
- Rebuilt pinned CLI fixtures for PASS, PARTIAL, FAIL and ERROR; Linux process cleanup; actual XLSX files and formula-text preservation.
- Account signup/login/recovery, the complete upload-to-verified-activation browser journey, profile revisions, chart selection, historical-version reruns, dashboard/registry controls and failure recovery.
- Widths 360, 390, 768, 1280, 1440 and 1920 for main workflow stages. Desktop zoom reflow is checked at 200%; the duplicate laptop/mobile zoom cases are intentionally skipped.

The CLI report-contract test runs only generated, trusted validators without a model, network or credential mount. It is separate from the actual production sandbox check. A passing contract test is never submitted as isolation acceptance.

## Still required before a real pilot release

**Real execution remains blocked.** The current actual script-sandbox probe returns `Resource temporarily unavailable (os error 11)` under the configured limits. Earlier namespace-denial evidence is retained in the existing operations reports. Initial/resume/App Server/judge-correction isolation, resource enforcement, executor login persistence and replacement recovery still need complete measured acceptance for the exact deployment image. No check was converted to PASS and no service-level sandbox bypass was introduced.

After that gate passes, run the authorized real product-review workflow and genuinely different task families, including all text/JSON/CSV/XLSX output and protected-field cases. Review real Codex criteria, source references and repair quality; demo fixtures cannot establish their quality.

Render needs its own deterministic staging validation, repository access, execution feasibility evidence, current image inventory, load/storage checks, timed backup restoration, all-history migration rehearsal and final paused-source cutover. No hosted service, personal login or source-history activation was changed by this work. The [operations runbook](../../operations/private-render-pilot.md) remains the deployment procedure.

Package findings currently support replacing an uploaded package and creating tests around it. Generating a repair directly from a static assessment before any executable source exists remains additional product work; run-based improvement and initial verification are available. Source references and package resource links are inspectable; an automatic semantic instruction-to-every-assertion trace still requires real authoring validation. Public marketplace, customer tenants, multi-model comparisons, arbitrary installation and live MCP remain outside this pilot.

## Saved product-review demo

A new evaluation was created around the existing `manual-product-qc` version 1 and its retained materials. It proposes five product-specific areas and contains 40 samples (10 cases × 2 configurations × 2 trials). Its new improvement remains in review; the original active-version pointer is still null.

- [Open product-specific results](http://127.0.0.1:3400/runs/5089cc17-614d-45f8-b15b-af761d56b8af?skill=73c18135-4cd0-4bd4-9461-c1d8205abf08).
- [Review the linked improvement and file diff](http://127.0.0.1:3400/improve/7021b745-61c6-4f88-b487-6596170e26f7?skill=73c18135-4cd0-4bd4-9461-c1d8205abf08).
- [Record IDs and area definitions](saved-product-demo.json).
- [Chart/API/raw-report reconciliation](chart-reconciliation.json) and [downloaded demo report](demo-report.zip).

The five displayed area totals were independently reconciled with assertion observations in the API and downloaded `result.json`. A matching total establishes UI/report consistency, not model quality.

### Screenshots

[Dashboard](screenshots/dashboard-1440.png) · [Registry](screenshots/registry-1440.png) · [Package](screenshots/package-1440.png) · [Test plan](screenshots/plan-1440.png) · [Results](screenshots/results-1440.png) · [Improvement](screenshots/improve-1440.png) · [Mobile results](screenshots/results-390.png) · [Revision comparison](screenshots/revision-1440.png)

## Interactive chart update

The results explorer now supports per-trial selection, Skill/baseline comparison, linked previews and evidence filters, and refresh-safe navigation. See the [interaction guide and regression evidence](interactive-charts.md).

## Try it manually

1. Open the local dashboard. Sign in with the documented synthetic local account: `admin` / `deterministic-test-password-only`.
2. Open Skills, inspect a package/version and its resource map, or upload the files in `examples/manual-skill-evaluation`.
3. Create an evaluation. Review the task, judging areas and input visibility. Use Request change to inspect a proposed revision before applying it.
4. Approve the plan, inspect generated coverage and approve the immutable suite.
5. Launch selected cases/trials and an optional baseline. Read the **Demo evidence** label.
6. Select an area and a case. Compare assertions, outputs, repeated outcomes and baseline evidence.
7. Suggest an update, inspect the diff and linked failures, approve the candidate, verify it and explicitly activate only the package you intend to use.

The earlier [saved product-QC walkthrough](../2026-09-09-manual-evaluation/README.md) remains available as historical demo evidence. Its old approval and result labels are preserved; a new evaluation is required for newly proposed task areas.
