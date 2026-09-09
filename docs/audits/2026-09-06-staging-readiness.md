# Staging code and Render readiness review — 6 September 2026

**Verdict: the staging code builds and its deterministic browser workflow works, but this revision is not ready for real execution on Render.** The review reproduced deployment configuration failures, stale approval acceptance and misleading result displays. The actual local Codex sandbox probe failed. No hosted sandbox certification or authenticated model acceptance was completed.

## Revision and scope

- Fetched `origin` with pruning and reviewed `origin/staging` at **`5ff4b816e794417d97f97ee63efd50757c32424d`**.
- Created local review branch `codex/staging-readiness-2026-09-06`. The previous `codex/private-render-pilot` branch and existing local installations were preserved.
- Compared staging with pilot commit `655fc69`: **24 files, 4,647 additions and 2,660 deletions**. The staging branch includes the backend pilot implementation and a substantial replacement of the browser workbench, followed by a UI acceptance fix. New file previews and `CLAUDE.md` are also in that diff.
- Inspected the browser routes/components, API lifecycle paths, shared contracts/storage/database code, worker/authoring/improvement paths, vendored CLI boundary, execution/storage services, tests, migration tools and Render configuration. This is a targeted architecture and behavior review, not a claim that every possible input or line is proven correct.
- Reviewed [GitHub CI run 33982009075](https://github.com/DeadHead04/skillEd/actions/runs/33982009075), which succeeded. Independent local testing found failures that this green run does not exclude.
- No production application code was changed during this review. A cache setting was corrected **only in a temporary local deployment configuration** to prove the proposed deployment fix. The committed Blueprint still needs that change.

The [original 69-finding audit](2026-09-05-backend-cloud-readiness.md) and [implementation tracker](2026-09-05-implementation-tracker.md) remain the baseline. The findings below supplement them and reopen acceptance where current staging contradicts a claimed browser capability. They do not erase prior findings or certify pending operational checks.

## What the application actually does

SkillEd is an approval and evidence workbench around an existing Skill package. It stores the package, its task materials, evaluation versions, runs and improvement proposals. It uses the pinned **Skill-Up CLI as an executable**, rather than importing its internal Go packages. Codex supplies authoring, improvement and tested-agent work when real execution is enabled.

The intended workflow is upload → task understanding → coverage approval → generated eval approval → run → inspect evidence → review patch → verify current and candidate with the same eval → explicit activation or download. This is implemented sufficiently to complete a deterministic browser journey. The current result UI loses important information on several non-happy paths.

| Layer            | Current implementation                                                                                                                                              | Important boundary                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Browser and API  | Next.js/React workbench; named-user login; package/material intake; eval/run/proposal actions; downloads; durable event access                                      | Uses shared contracts and PostgreSQL, with restricted runtime credentials in the split deployment                    |
| Shared core      | Versioned migrations, state checks, append-only decisions, idempotency receipts, grading adapter, archive checks, immutable artifact storage, history import/export | Database triggers protect important immutable records; optional request revisions still weaken the approval boundary |
| Controller       | PostgreSQL queue, one active operation, lease tokens, cancellation/reconciliation, staging and ingestion                                                            | Uses remote execution when configured; fake mode produces deterministic evidence without executing a model           |
| Executor         | Authenticated private API, persisted execution state, pinned Skill-Up/Codex, App Server, cancellation and readiness checks                                          | Real execution is deliberately unavailable until image-specific acceptance passes                                    |
| Artifact service | Immutable objects and short-lived signed grants for an exact operation/key                                                                                          | Separate disk from executor; web/controller need writable temporary caches even with remote storage                  |
| Database         | PostgreSQL 17; ordered migration history; separate migration/web/controller roles                                                                                   | History and imported result labels are retained; imported evidence cannot certify a new real candidate               |

The rebuilt images contain Node **24.13.0**, Codex CLI **0.149.0-alpha.4.1** and the patched pinned Skill-Up binary identifying itself as **`skilled-v2`**. Go contract testing used the pinned **1.25.5** toolchain. The service image for controller/artifacts excludes Codex by design.

### Real implementation versus demo evidence

The browser, database, HTTP routes, archive handling, signed artifact transfers and lifecycle tests below exercised actual code and processes. In the browser journeys, **authoring responses, case outcomes and suggested improvements came from the fake adapter**. Their activation proves the deterministic approval pipeline, not that Codex improved a real Skill. Demo evidence remains labeled and cannot be reused to authorize activation in real mode.

Synthetic CLI contract fixtures did execute the rebuilt Skill-Up binary and validators. The Linux process test and Python workbook validator also executed real processes. None required a personal model session.

Guided Skill creation, arbitrary dependency installation, live MCP integrations, public signup, tenant isolation, customer model authentication and billing remain later releases. Exposing the private pilot's login page does not supply those capabilities.

## Servers started for this review

Both review stacks are running on loopback only, with new disposable databases and volumes:

| URL                     | Stack                                                                                   | Purpose                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| <http://127.0.0.1:3200> | `skilled-staging-review`: web, worker, PostgreSQL                                       | Current staging UI, full test suite and synthetic failure fixtures                 |
| <http://127.0.0.1:3300> | `skilled-staging-cloud-review`: web, controller, executor, artifact service, PostgreSQL | Render-style service separation, independent storage and restricted database roles |

Test login on these two installations only: **`admin` / `deterministic-test-password-only`**. These are disposable local test credentials, not production credentials. Original installations on ports 3000 and 3100 were left intact; their modes were not changed. The split stack has the temporary web cache setting described in R01. Its executor remains unavailable for real model work.

## Verification results

| Check                                                                           | Observed result                                                      | Limit of the evidence                                                                                    |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Repository preflight                                                            | Passed                                                               | Original stack preserved                                                                                 |
| Formatting                                                                      | Passed                                                               | Rechecked after adding this report                                                                       |
| Lint/typecheck                                                                  | Passed for core, worker and web                                      | Repository lint scripts currently invoke TypeScript checking; this is not an independent lint rule suite |
| Backend suite with disposable PostgreSQL, private-service tests and rebuilt CLI | **54 passed, 1 skipped, 0 failed** out of 55                         | The skipped Linux-specific process check was run separately in the worker image                          |
| Linux process/environment/timeout/descendant cleanup                            | **1 passed** as UID 10001                                            | Does not establish all sandbox resource/process isolation guarantees                                     |
| Python XLSX validator in the executor image                                     | **1 passed**                                                         | Synthetic workbook; no model execution                                                                   |
| Vendored Go agent, judge and CLI tests                                          | Passed                                                               | Synthetic/unit contracts, not authenticated Codex runs                                                   |
| Production Docker web/worker builds                                             | Passed                                                               | Authoritative Node 24 build; host Node is older and host pnpm wrapper was unusable                       |
| Separate controller/artifact service image build                                | Passed                                                               | Image started successfully in the split stack                                                            |
| Local stack verification                                                        | Passed in demo mode                                                  | Health does not certify real execution readiness                                                         |
| Full browser suite: desktop/laptop/mobile                                       | **33 passed, 3 failed** on the initial run                           | All failures were the sidebar test; see R14                                                              |
| Rerun of the three sidebar failures after fixture creation                      | **3 passed**                                                         | Demonstrates shared-state/order dependence, not a clean initial pass                                     |
| Browser upload through verified activation on split services                    | **1 passed**                                                         | After the temporary cache fix; fake model adapter, real HTTP/storage/DB roles                            |
| Extra API/browser probes                                                        | Reproduced approval, preview, terminal-state and result-summary gaps | Synthetic fixtures deliberately cover states missed by the main journey                                  |
| Render CLI Blueprint validation                                                 | **Valid**                                                            | Schema validation does not test network reachability, filesystem ownership or execution isolation        |
| Actual pinned Codex Linux sandbox canary                                        | **1 passed, 4 failed, 8 pending; blocked**                           | Local Docker runtime only; no hosted Render probe performed                                              |

The requested package scripts were exercised through their underlying Node entrypoints where host pnpm was unavailable, and production builds ran in Docker. It would be inaccurate to report a completely green fresh-database browser suite or a passed real-Codex acceptance suite.

## Findings and acceptance work

P1 means a release-blocking correctness/deployment issue or missing release proof for this pilot. P2 means a concrete usability, robustness or test-maintenance gap. “Reproduced” means an executed probe; “source review” identifies a code path without claiming a hosted/model experiment.

### R01 — P1: Render web cannot materialize remote artifacts with its current cache path

**Reproduced in the split topology.** Login and upload returned 200/201, but preview returned 404 and package download returned 500 with `EACCES: permission denied, mkdir '/app/apps/web/artifacts'`. `ArtifactStore` defaults to `./artifacts/local`; Render's web service does not set `ARTIFACT_ROOT`. Its working directory is not writable by the application user.

Source: `render.yaml:27`, `packages/core/src/artifacts.ts:12`, `apps/web/Dockerfile`.

**Fix:** set the web cache to the already-owned `/data/artifacts` directory. Keep it ephemeral; the artifact service is the durable store. Report filesystem failures as operational failures rather than “File not readable”/404, and make diagnostics actually probe the relevant storage path.

**Acceptance:** run upload, package/material preview and download through separate non-root services with no shared disk. Restart the web instance and repeat against the same immutable remote objects. The temporary setting restored preview/download to 200 and enabled the split-stack browser journey. See [before](../acceptance/2026-09-06-staging/cloud-before-cache-config.json) and [after](../acceptance/2026-09-06-staging/cloud-after-cache-config.json); the second upload correctly returned a duplicate-package conflict and the retained object was then read successfully.

### R02 — P1: private service ports conflict with current Render documentation

**Configuration review, not a hosted connection test.** Both private services explicitly use port **10000** in `render.yaml:110` and `render.yaml:128`. Current Render documentation lists 10000 among ports unavailable for private-network communication. Blueprint validation still accepts the configuration. [Render private networking](https://render.com/docs/private-network)

**Fix:** select an allowed port, for example 10001, for both private services and the canary where applicable; retain `fromService` hostport discovery. Confirm effective platform behavior during staging because schema validation cannot resolve this risk.

**Acceptance:** authenticated web/controller-to-artifact and controller-to-executor calls succeed on Render; unauthenticated calls fail; neither private service receives a public endpoint.

### R03 — P1: execution feasibility remains blocked and the canary is incomplete

**Reproduced locally.** The actual pinned Codex sandbox reported `bwrap: No permissions to create a new namespace`. Workspace, denied-read, script-judge and network probes therefore failed before they could establish their guarantees. Non-root execution passed. The canary deliberately leaves eight required checks pending and always reports blocked (`infra/render-canary/canary.mjs:91`).

This local result does **not** establish whether Render supports the required boundary. No Render-hosted canary was deployed in this review. No authenticated model calls were made after the failed boundary probe, and no bypass was introduced.

**Fix/acceptance:** complete and run the entire image-specific gate on Render: effective read/write/network restrictions, script judges, process isolation, CPU/RAM/PID/output/time limits, initial execution, resume, App Server, judge correction, login persistence and conversation recovery. Use synthetic hidden markers. Retain execution-disabled behavior until every required check passes. Define how the 24-hour acceptance evidence is legitimately renewed for each release; never manufacture passing records. See [fresh canary evidence](../acceptance/2026-09-06-staging/executor-canary.json).

Codex documents Linux kernel/sandbox compatibility constraints and explicit restricted-read profiles. Compatibility must be measured for the pinned binary and actual deployment. [Codex permissions](https://learn.chatgpt.com/docs/permissions)

### R04 — P1: the canary profile does not establish the production model paths' permissions

**Source review.** The canary creates a restricted-read profile with root denied. Production App Server requests use `workspace-write`/`workspaceWrite` (`apps/worker/src/app-server.ts:188` and `:243`); the CLI agent uses `--sandbox workspace-write` (`skill-up/internal/agent/codex.go:36`). These call sites do not demonstrate the same effective read restrictions tested by the canary.

**Fix:** configure and verify one explicit permission policy across tested-agent initial/resume paths and agent judges, including correction turns. Authoring and improvement require their own deliberately scoped workspaces. Trusted Codex access to login state must not imply that tested shell commands can read it.

**Acceptance:** exercise the actual production entrypoints, not only `codex sandbox`, with allowed fixture access and denied synthetic home, sibling, hidden-answer and other-workspace access. Capture effective policy/version provenance. A passing standalone canary alone is insufficient.

### R05 — P1: stale eval approval succeeds when the client omits the revision

**Reproduced through the real API.** With a ready draft at revision 5, approving with expected revision 1 returned 409; the same action without `expectedRevision` returned 200. The browser's approval buttons omit it. The decision row recorded a null revision and only a hash of request detail, not the approved bundle and materials.

Source: `apps/web/src/app/api/v1/[...path]/route.ts:478`, `apps/web/src/app/evals/[id]/page.tsx:418`, `packages/core/src/lifecycle.ts:23`.

**Fix:** require the reviewed revision and immutable bundle/input hashes for approval; send them from the browser. Persist the actual revision and hashes in the append-only decision. Apply the same discipline to proposal and material decisions where revisions remain optional.

**Acceptance:** two clients review revision N; one revises it; the other's stale or missing-revision approval is rejected without freezing N+1. Duplicate approval of exactly the same revision/hash remains idempotent. See [API evidence](../acceptance/2026-09-06-staging/approval-reproduction.json). Reopens the approval coverage of baseline I08/O03.

### R06 — P1: interrupted runs are displayed as indefinitely in progress

**Reproduced in the browser.** `apps/web/src/app/runs/[id]/page.tsx:149` omits `interrupted` from its terminal states. A persisted interrupted run renders “Evaluation in progress” with no recovery action or partial download.

**Fix:** use the shared terminal-state contract and display the interruption reason, retained evidence and new-run action.

**Acceptance:** interrupt/reconcile a run, reload its URL and verify a terminal view without ongoing progress polling. Include imported interrupted jobs and executor replacement. Reopens baseline O01/O05 and partial evidence UI acceptance.

### R07 — P1: failed/cancelled pages hide partial evidence and link back to the failed run

**Reproduced with stored results.** The early return at `apps/web/src/app/runs/[id]/page.tsx:162` omits case evidence and downloads for failed/cancelled runs. Its “Configure a new run” link points to `/runs/current?skill=...`; when this is the latest run, that route resolves back to it.

**Fix:** render available results/artifacts on every terminal state and link to an explicit new-run configuration carrying the intended Skill/eval IDs.

**Acceptance:** cancel after a case completes, and separately cause an infrastructure failure after a case completes. Both pages show retained samples, a partial download and a working rerun action. Reopens baseline E16/E17.

### R08 — P1: repeated trials hide dimension regressions and assertion instability

**Reproduced.** Result rendering selects one worst overall-result sample per case and infers stability only from equality of the overall result label (`runs/[id]/page.tsx:190`). Two PARTIAL trials can fail different assertions. In the fixture, trial 1 failed scope; trial 2 failed source preservation. The UI reported **Source preservation 1/1 held**, no instability, and exposed only one sample's assertions despite displaying “2 samples”.

**Fix:** retain every sample, aggregate dimensions and required assertions across trials, and use assertion-level stability. Add a trial/configuration selector for evidence. Keep baseline benefit separate.

**Acceptance:** same-result/different-assertion failures remain visibly unstable and every failed dimension is shown. Each sample's output, assertions and transcript can be inspected. The existing verification backend's stronger comparison must not be weakened to match this UI. See [screenshot](../acceptance/2026-09-06-staging/completed-desktop.png). Reopens baseline E15 and UI evidence acceptance.

### R09 — P1: an ERROR-only run receives a green summary

**Reproduced.** `runs/[id]/page.tsx:205` counts only FAIL/PARTIAL as actionable; `:293` otherwise renders a pass-colored “No Skill failures”. The ERROR-only fixture shows 0/1 passing beside that green status. Error classification and unmeasured dimensions cannot establish a successful Skill result.

**Fix:** give missing/invalid execution evidence an explicit error or unknown summary and recovery action. Preserve the distinction from task failure without representing absence of trustworthy grading as success.

**Acceptance:** ERROR-only, mixed PASS/ERROR and empty/incomplete evidence never produce a green overall verdict. See [screenshot](../acceptance/2026-09-06-staging/error-desktop.png). The core adapter correctly rejects false greens; this is a browser regression against baseline E01/E03.

### R10 — P2: large ZIP previews silently misreport completeness and size

**Reproduced through the preview helper/API.** A 2,097,159-byte text entry returned size 1,048,576 and `truncated: false`. `packages/core/src/archive.ts:230` stops collecting whole chunks near the cap, then calculates size/truncation from the retained buffer. It still drains the full entry.

**Fix:** track actual entry size separately, retain an exact bounded prefix and signal truncation correctly; handle stream close/error/cleanup explicitly. `apps/web/src/lib/data.ts:292` also reads an entire task material before slicing its preview; use bounded file reads there.

**Acceptance:** test empty, exact-cap, cap+1, multi-chunk, binary, malformed and 100 MiB entries, including concurrent previews and memory use. See [reproduction](../acceptance/2026-09-06-staging/preview-reproduction.json).

### R11 — P2: inactive uploaded packages are labeled active

**Reproduced.** The package page unconditionally says “Active package” (`skill/page.tsx:150`). Workflow navigation derives “v1 active” from the displayed version number (`components/nav.tsx:58`), although it may merely be the latest uploaded version. The same page correctly lists that version as Inactive.

**Fix:** derive activation labels from `active_version_id`; distinguish the displayed upload/candidate from the active pointer everywhere.

**Acceptance:** fresh upload, inactive replacement, verified candidate and explicitly activated version each have consistent labels. Uploading must still leave the database's active pointer unchanged. See [screenshot](../acceptance/2026-09-06-staging/package-desktop.png). Backend baseline E06 remains protected; browser truth does not.

### R12 — P2: binary task material previews offer the wrong download

**Source review.** `skill/page.tsx:98` passes the Skill ZIP download URL to `FileView` even when previewing a task material. A separately uploaded XLSX or other binary material is not part of that ZIP.

**Fix:** use an application-authorized material download for the exact selected material. Keep package downloads separate.

**Acceptance:** upload two binary materials and open/download each; verify filename, media type, checksum and authorization against the selected object.

### R13 — P2: case toggles can fail silently and are available during invalid states

**Source review.** `components/actions.tsx:68` sends only `enabled`, does not inspect the PATCH response and does not track the returned rebuild job. The eval page locks toggles only after approval; generation is another state in which the API rejects editing. Users can click, receive a conflict and see no actionable error.

**Fix:** require/send revision, disable edits outside permitted draft states, handle HTTP/network errors and expose pending rebuild progress. Preserve the exact bundle review requirement after changes.

**Acceptance:** stale edits, double-clicks, generation-in-progress and lost connections show truthful state and a recovery path; a successful edit updates the complete draft and reviewable bundle atomically.

### R14 — P2: browser suite depends on another test's activation state

**Reproduced.** `apps/web/e2e/workbench.spec.ts:40` expects an already-active version and a ten-case result without creating that fixture. All three viewport variants failed on the initial run, then passed after the pilot journey created active packages.

**Fix:** create the required package/run/activation within the test or an explicit isolated fixture; avoid ordering assumptions across projects/workers.

**Acceptance:** the test and the complete suite pass independently from empty databases and in different test orders. A retry after unrelated tests populated state is not equivalent to a clean pass.

### R15 — P1: the named real suites are not complete application acceptance suites

**Source review.** `apps/worker/src/real-test.ts` shells out to Skill-Up against a caller-provided/default eval path. There is no committed default `evals/eval.yaml` fixture. Smoke and jiomart use the same command; full only adds baseline/three iterations. These scripts do not exercise browser intake, approvals, artifact judging, candidate verification or deployment recovery, nor do they enforce the application readiness gate themselves.

**Fix:** create a bounded real acceptance harness with committed synthetic tasks, explicit readiness preconditions, model budget/time limits and preserved evidence. Retain a clearly named CLI diagnostic separately.

**Acceptance after R03/R04:** consume an uploaded CSV/XLSX, produce a real artifact, reject protected-field modification, distinguish judge failure, verify a targeted Skill fix over three trials, reject a regression, activate explicitly, and demonstrate cancellation/replacement recovery. The user's request authorizes real testing, but the already-agreed isolation gate must pass first.

### R16 — P1: controller-to-executor recovery needs durable dispatch identity and failure drills

**Source review; not a performed replacement experiment.** `apps/worker/src/remote-execution.ts:23` creates a new in-memory execution ID per invocation. Initial dispatch is outside the subsequent cleanup try/catch (`:86`); polling errors cancel the attempt rather than recovering a persisted execution/cursor association. Executor persistence and lease expiry exist, but they do not alone establish controller reattachment or output ingestion after a lost start acknowledgment.

**Fix:** persist execution ID, dispatch phase and replay cursor with the job before dispatch; reconcile uncertain starts and existing remote executions using that identity. Preserve/upload partial reports when failing a job, and reject stale-owner writes.

**Acceptance:** lose the start response, restart controller before lease expiry, interrupt polling, restart executor, cancel during transfer and simulate stale owners. Each outcome is recoverable or explicitly terminal with available evidence and no orphaned process. Reopens the remaining operational portion of baseline O01/O02/O05.

### R17 — P1: exact case input and agent-judge truth scoping need completion

**Source review.** `apps/worker/src/evals.ts:754` builds agent-judge configuration without an explicit selected truth/context manifest. Script validators receive selected truth, while every case with dataset fixtures receives the same fixture tree (`:773`). Source references do not themselves select which input files a case or agent judge can read.

**Fix:** express exact per-case inputs and judge-only truth explicitly in the generated contract and execution manifest. Bind referenced objects by ID/hash. Do not solve this by placing all truth in the tested workspace.

**Acceptance:** a two-case task with different inputs/truth receives only approved per-case inputs; each judge gets its allowed truth and selected output; hidden synthetic markers remain unreadable to tested code. Include real artifact output, not only response text. This is a remaining gate for baseline E08/E09/E19.

### R18 — P2: deployment guidance and operational evidence remain incomplete

**Source/documentation review.** Newly added `CLAUDE.md` describes no migration system, a 30-second lease and unpatched upstream behavior, conflicting with the current code and runbook. Maximum-size storage behavior, actual disk ownership, real replacement recovery and a timed paired backup restore remain unproven. The free-space check is an admission check, not a durable reservation; output collection limits do not themselves prove in-flight CPU/RAM/PID/storage limits.

**Fix:** update the handoff document to current migrations, 60-second leases, patched CLI and release gates. Add operational tests for input/output/log limits, disk pressure, abandoned workspaces, disk replacement and paired database/artifact restoration. Show proposal failure reasons and comparison reasons in the browser; a generic regression message does not explain authentication, generation or transfer failure.

**Acceptance:** demonstrate the 200 MiB intake, 250 MiB collected-output and 10 MiB log budgets under concurrency/aborts; validate resource enforcement separately; restore within four hours with a recovery point no older than 24 hours; account for every historical record and missing artifact. Public/customer capabilities keep their explicit later-release disposition.

## Browser review

Screenshot-based score: **27/40** — decision clarity 3, evidence hierarchy 3, state truth 1, visual identity 4, restraint 4, typography/spacing 4, accessibility 4, responsive credibility 4. This is a visual/workflow assessment, not a screen-reader or comprehensive accessibility certification. The 390-pixel sample had no horizontal overflow; the existing suite also exercised desktop/laptop/mobile views.

The three most consequential visible gaps are the false green ERROR summary, hidden trial failures and terminal pages without evidence/recovery. Remove the green “No Skill failures” verdict for unknown/error evidence. Preserve the restrained workbench layout, explicit demo labels and separate dimension summaries. The next iteration should restore truthful state and sample-level evidence in the existing design before adding more visual polish.

## Concrete sequence to reach Render

1. **Correct the local release candidate.** Fix R01 and the browser/API correctness gaps R05–R14. Add negative-state fixtures and independent browser tests. Keep all actual evidence dimensions and immutable approvals intact. Re-run required checks once against the final changes.
2. **Prepare the deployment configuration.** Fix/verify R02; retain four separate compute services and PostgreSQL in Singapore. Set the web cache explicitly, keep private service APIs authenticated, and validate the Blueprint again. Resolve the private GitHub repository connection for Render and verify it can fetch the selected commit; this review did not retest a hosted build. Pin the intended release/image identity and keep automatic real-execution rollout disabled.
3. **Initialize deterministic staging.** Obtain a current quote before provisioning. Run migrations and role provisioning with temporary migration credentials; set web/controller restricted URLs and `SKILLED_AUTO_MIGRATE=false`. Configure independent application, executor and artifact-grant secrets. Confirm UID 10001 can use the two persistent mounts and ephemeral caches. Keep web/controller fake. Repeat the full browser journey across the actual private network, including uploads/downloads after service restart.
4. **Prove execution feasibility on Render.** Complete R03/R04/R16 before turning real execution on. Validate all process/read/network/resource limits against the exact pinned production paths. If the platform cannot support them, execution remains disabled and the deployment/version decision must be revised. Do not enable privileged execution or a sandbox bypass to obtain a green demonstration.
5. **Authenticate and run bounded real acceptance.** After credential-free isolation checks pass, authenticate directly on the executor through the official Codex login flow. Never copy desktop credentials into images or migration bundles. Complete R15/R17, persist raw/partial reports and renew image-bound evidence through actual checks. Official guidance recommends API authentication for programmatic CLI workflows and cautions against exposing account-backed execution to untrusted users; the existing ChatGPT approach remains a trusted private-pilot constraint. [Codex authentication](https://learn.chatgpt.com/docs/auth)
6. **Rehearse history migration and recovery.** Use the existing export/import tools against disposable destinations. Reconcile IDs, relationships, original result labels, active pointers, conversations and artifact hashes. Imported history remains unverified; active jobs become interrupted; application sessions are invalidated. Exclude credential stores. Rehearse paired database/artifact restore and executor replacement with completed-context reconstruction.
7. **Perform controlled cutover.** Drain execution, pause local writes, take the final consistent export, import/reconcile and only then enable the private team installation. Preserve the source. Keep rollback compatible with additive migrations and retain evidence/history. Record storage pressure, queue age, cancellation latency, validator errors and authentication availability.

Current starting capacities remain web 1 CPU/2 GB, controller 0.5 CPU/512 MB, executor 2 CPU/4 GB, artifacts 0.5 CPU/512 MB and paid 1 GB PostgreSQL, with 20 GB artifact and 10 GB executor disks. The Blueprint's legacy plan IDs remain accepted aliases; they are not a deployment defect. Confirm total compute, database/disk storage, workspace and bandwidth costs in the creation review. No verified monthly total was obtained here. [Compute plans](https://render.com/docs/compute-plans), [pricing](https://render.com/pricing)

Persistent disks attach to one service instance, are unavailable to other services and affect deployment replacement/downtime. Therefore the artifact service, drain procedure and paired backup are required parts of this architecture. Local Docker success does not establish Render disk ownership or restart behavior. [Render disk constraints](https://render.com/docs/disks)

## Evidence and reproduction

Selected sanitized results and screenshots are in [the acceptance evidence directory](../acceptance/2026-09-06-staging/README.md). They contain only disposable synthetic application data. Temporary environment files, signing keys, service inventories and session state were excluded.

Use the repository's [acceptance runbook](../operations/private-render-pilot.md) for the standard commands. Run integration tests only against a disposable `skilled_test` database, enable private-service tests, rebuild the pinned CLI and set `SKILLED_CONTRACT_CLI`. Use fake mode for ordinary browser testing. The additional reproduction inputs and expected repairs are specified beside each finding above.

No Render deployment, final history migration, public exposure or authenticated real-Codex acceptance is claimed by this report. The durable deliverables of this review are the fetched review branch, running isolated servers, measured findings and this evidence-backed release sequence.
