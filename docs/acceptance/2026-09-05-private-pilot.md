# Private pilot implementation: acceptance record

Date: 2026-09-05. Branch: `codex/private-render-pilot`.

**The corrected local workflow and private-service foundation are implemented. The hosted real-execution pilot is not released.** The original installation and its data were preserved. A separate credential-free Compose installation was used for acceptance.

## Implemented behavior

- Ordered migrations through version 5; immutable approved evals, versions, completed evidence and decisions; enforced lifecycle transitions; atomic resource/job/event creation; idempotent launch/decision handling and stale activation rejection.
- Versioned Skill-Up report adaptation, strict required assertions and complete case/configuration/trial matrices; stable per-assertion candidate comparison; distinct task failure, validator failure, cancellation and infrastructure error paths.
- Awaited bounded upload streams, safe archive paths/modes, structural Skill metadata, independent evaluations around existing versions, normalized-package identity, input fixtures and text/JSON/CSV/XLSX artifact assertions.
- Separate controller/executor/artifact interfaces, scoped signed grants, one global model job, fenced leases, continuous recovery, cancellation/process cleanup, App Server protocol timeouts and completed-context reconstruction.
- Browser case/material review, selected cases/trials/baseline, refresh-safe progress, actual diffs, separate approvals, three-trial candidate verification, explicit activation, history and diagnostics.
- Reproducible non-root images, separate Render Blueprint, fail-closed execution readiness, all-history export/import and administrator recovery tooling, credential-free CI and a deployment/restore runbook.

## Verification

| Check                         | Result                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Preflight                     | Passed                                                                                                                                                                                                                                           |
| Formatting                    | Passed                                                                                                                                                                                                                                           |
| Repository lint/typechecks    | Passed for core, worker and web; lint scripts are TypeScript checks                                                                                                                                                                              |
| Backend suite                 | 55 Node tests: 54 passed on host; Linux process-tree test explicitly skipped on macOS and passed inside the actual non-root Linux worker                                                                                                         |
| Extra workbook acceptance     | Passed in the pinned image using openpyxl; protected-cell drift and missing output detected                                                                                                                                                      |
| Pinned CLI contract           | Passed without model calls: actual rebuilt script-judge output including negative/malformed/crash/timeout fixtures                                                                                                                               |
| Upstream affected Go packages | Agent, judge and CLI tests passed with Go 1.25.5                                                                                                                                                                                                 |
| PostgreSQL acceptance         | Clean/old-schema migration, repeated migration, immutable records, concurrent claims, fencing, queued cancellation, exact trial matrix, runtime-role restrictions, actual API idempotency/stale activation, and logical history rehearsal passed |
| Production builds             | Web, worker/executor and separate controller/artifact images built successfully with frozen lockfiles and pinned base images                                                                                                                     |
| Browser acceptance            | 36 passed across desktop, laptop and mobile, including upload through verified candidate activation                                                                                                                                              |
| Compose verification          | Passed on the isolated demo installation; loopback web and private PostgreSQL preserved                                                                                                                                                          |
| Render Blueprint validation   | Passed; no services provisioned                                                                                                                                                                                                                  |
| Audit coverage                | All 69 IDs have one tracking disposition                                                                                                                                                                                                         |
| Diff whitespace               | Passed                                                                                                                                                                                                                                           |

Host Node is 23.9, below the repository's Node 24 requirement. The host pnpm wrapper was unavailable for this version, so the equivalent checked-in test/TypeScript/Prettier entry points were run directly. Production builds used Node 24.13.0 in Docker. The Linux-specific process test was run in that image rather than treating macOS process-group behavior as evidence for Linux. No personal credentials were supplied to the acceptance stack.

Browser journeys use synthetic evidence. Script-judge contract tests invoke the real pinned CLI with synthetic artifacts; they do not invoke Codex models. Workbook tests inspect real generated fixture files but do not prove real-agent task quality.

## Blocking and pending release gates

1. **Render repository access:** Render could not fetch the private `DeadHead04/skillEd` repository through its current GitHub connection, including the old redirected URL. Repository access must be enabled before the canary or staging can be deployed.
2. **Execution feasibility:** the [local canary](local-executor-canary.json) passed non-root identity and failed namespace-dependent sandbox probes. This does not prove Render will fail. All actual Render read/write/process/egress/resource probes, Codex initial/resume/App Server/judge-correction paths and login/replacement recovery must pass before execution is enabled. No bypass was added.
3. **Authorized real acceptance:** no real-model suite was run. Real fixture tasks, derived evals, artifact transfers, cancellation/replacement recovery and rubric calibration remain required after isolation passes and authorization is provided.
4. **Operations and cutover:** production-sized load/storage tests, image inventory/security review, current cost confirmation, a timed paired backup restoration, full source-history migration rehearsal and final paused-source cutover remain pending. The 24-hour RPO/four-hour restore objective has not been certified.

The [69-finding tracker](../audits/2026-09-05-implementation-tracker.md) lists the exact remaining operational checks. The [runbook](../operations/private-render-pilot.md) gives initialization, role provisioning, direct executor login, import/recovery, drain and rollback procedures. Guided creation and public-customer features retain the later-release boundaries requested in the plan.

## Review environment

The original installation remains on `http://127.0.0.1:3000` with its original worker mode. The isolated demo is on `http://127.0.0.1:3100`, with synthetic credentials documented in the README. It contains only acceptance fixtures. Its volumes are separate from the original installation.

UI review checked explicit demo labels, per-dimension failure evidence, current/candidate version context, readable desktop layout and the complete mobile decision path. The remaining onboarding improvement is reducing long mobile case summaries; exact case details are already expandable. The design remains a focused evaluation workbench. A broader guided-creation experience is a later release.

### Visual review

Score: 33/40 (decision clarity 4, evidence hierarchy 4, state truth 5, identity 4, restraint 3, typography/spacing 4, accessibility 4, responsiveness 5). This is a visual review, not a screen-reader or WCAG certification. The three visible gaps are long mobile case summaries, repeated metadata between the case overview and detail inspector, and abstract page headlines. Remove repeated overview metadata; preserve explicit demo labels and failing-dimension evidence. The next UI iteration should collapse coverage groups into counted summaries while retaining exact case inspection.
