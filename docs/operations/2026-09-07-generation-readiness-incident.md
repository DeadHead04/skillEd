# Generation blocked by execution readiness — 7 September 2026

The reported screenshot says:

> Execution unavailable: the required isolation and login acceptance checks have not passed for this image

This is SkillEd's own readiness rejection, raised before a real model operation starts. It does not by itself establish a bad Skill, a failed task assertion or an expired ChatGPT login. Retrying does not repair a missing prerequisite.

## What was checked

- Refreshed `origin/staging`: still `5ff4b816e794417d97f97ee63efd50757c32424d`.
- Inspected the readiness implementation, job dispatch, retry route, Compose configuration, Render configuration and canary.
- Ran repository preflight successfully with Docker access.
- Reproduced the exact exception by calling `requireExecutionReady()` inside the isolated staging worker. Both the evidence-path and revision settings were absent. This direct diagnostic made no model call and did not change the worker's demo mode.
- Reran the actual pinned Codex sandbox canary as UID 10001 at `2026-09-07T13:38:34.998Z`. Result: **1 passed, 4 failed, 8 pending; blocked**. The failures reported `bwrap: No permissions to create a new namespace`.
- Read local health endpoints: 3100, 3200 and 3300 were running demo evidence. Port 3000 was an older real installation with a successful Codex login-status check; its older health/schema do not establish readiness under the new contract. No modes or histories were changed.
- The original and staging-review databases did not contain a job with this exact error detail. The screenshot's URL/host has been requested and is still needed to identify its particular deployment. These local observations are not a claim to have inspected that host.

No credential-file contents were read or copied. No authenticated model work, sandbox bypass, application restart or production configuration change was performed.

## The failure chain

`apps/worker/src/readiness.ts:5` returns false if any prerequisite fails:

1. `SKILLED_EXECUTION_EVIDENCE` is absent, unreadable or invalid.
2. Neither `SKILLED_IMAGE_REVISION` nor `RENDER_GIT_COMMIT` identifies the deployed revision.
3. The report does not satisfy `acceptsExecutionEvidence()`.
4. The subsequent `codex login status` command fails, times out or does not report a login.

`packages/core/src/execution-contract.ts:78` requires a ready report, the exact matching revision, a timestamp less than 24 hours old and exactly one passing entry for each of the 13 required checks. Missing, failed, duplicate, pending, expired or mismatched evidence is rejected. This 24-hour rule belongs to SkillEd's report policy; it is not the lifetime of a ChatGPT login.

The local worker checks this before dispatch in `apps/worker/src/index.ts:123`. The split deployment checks it in the executor. The worker then records the exception and marks the eval failed. The browser's retry endpoint queues another generation job without first resolving readiness, so the same error recurs.

There are two confirmed setup gaps in this revision:

- `docker-compose.yml:44` defaults the worker to real mode without supplying the evidence path or revision. A newly built worker using that configuration fails before it even checks login, unless another explicit configuration supplies those values. A `.env` entry alone is insufficient when Compose does not pass it through to the container.
- `infra/render-canary/canary.mjs:91` leaves eight checks pending and the report status blocked. The minimal canary is a preliminary probe, not an implementation of the complete certification process. Running it successfully cannot currently produce a report the application will accept.

The fresh local namespace failure is a third, independent obstacle. Supplying the missing variables does not make the sandbox work or complete the pending checks. Linux Codex sandbox enforcement depends on kernel/container support; the effective policy must be tested on the intended host. [Official Codex permissions documentation](https://learn.chatgpt.com/docs/permissions)

## End-to-end repair sequence

### 1. Identify the failing instance and expose its actual reason

Use the screenshot's browser URL to identify the service and deployed revision. Inspect only non-secret settings, report metadata and `codex login status` in the execution service, under the same user and `CODEX_HOME` as the application.

Replace the current boolean-only diagnostic with structured reasons: configuration missing, evidence missing/unreadable/invalid, revision mismatch, evidence expired, required checks failed/pending, login unavailable or executor unreachable. Do not return raw authentication logs or service secrets. Preserve the boolean guard as a derived result so diagnostics cannot enable execution.

Acceptance: each condition independently produces the correct sanitized reason. A valid report plus unavailable login is distinguishable from missing evidence with a valid login.

### 2. Complete the preliminary isolation check on the intended execution host

Determine whether the non-root runtime permits the namespace and sandbox operations required by the pinned Codex version. Validate restricted reads, allowed workspace writes, tool-network denial, script judges and resource/process limits through the actual runtime policy. Apply the same policy to real execution entrypoints; the standalone canary's temporary configuration does not automatically configure App Server or Skill-Up.

The error text mentions one possible kernel setting, but that is not a demonstrated fix for this container or Render. Do not treat a host-wide setting change, privileged container, unconfined runtime or sandbox bypass as the default solution. If Render cannot support the required boundary, keep cloud execution disabled and revise the deployment/version decision.

Acceptance: synthetic home/sibling/hidden-answer markers remain inaccessible; approved files remain usable; network and resource/process restrictions are demonstrably enforced. The existing failing local evidence cannot certify Render either way.

### 3. Authenticate directly and finish the remaining acceptance harness

After the credential-free boundary checks pass, perform the official login flow directly on the executor with its intended persistent `CODEX_HOME`. For an eligible headless setup, `codex login --device-auth` allows browser completion without copying a desktop credential store. Confirm with `codex login status`. [Official Codex authentication documentation](https://learn.chatgpt.com/docs/auth)

Implement the pending acceptance cases for initial execution, resume, App Server, agent-judge correction, login persistence and conversation reconstruction, plus the outstanding process/resource checks. This harness runs bounded authorized probes after the preliminary isolation gate; it must not depend on fabricating a ready report to bootstrap itself.

Acceptance: all 13 checks pass against the exact deployed code/toolchain and actual production permission paths. Publish the report from measured results. Do not hand-edit failed/pending entries to passed or refresh timestamps without rerunning the required checks.

### 4. Wire the accepted report and revision into the executor

For the split deployment, persist the measured report at the path already declared in the Blueprint:

```text
SKILLED_EXECUTION_EVIDENCE=/data/executor/acceptance.json
CODEX_HOME=/data/executor/codex
```

Render provides `RENDER_GIT_COMMIT`; verify it matches the report. For a local/custom image, explicitly pass `SKILLED_IMAGE_REVISION` for the revision actually used to build that image. It takes precedence over `RENDER_GIT_COMMIT`, so a stale override will keep rejecting a new deployment. The report must be readable by UID 10001 and must survive the intended service lifecycle without becoming reusable for unrelated image revisions.

Update local Compose/preflight to handle these prerequisites explicitly if that mode is to support the new real worker. Keep personal credential stores out of the hosted image/migration path. A mounted login alone is insufficient.

Acceptance: the execution service reports ready only when every prerequisite is satisfied. A different image, expired report or revoked login returns a specific blocked reason. Implement actual report-renewal operations before its 24-hour expiry.

### 5. Prevent the browser's retry loop and verify the recovery journey

Check current execution readiness before accepting an operation that needs a model, while preserving the executor's enforcement at dispatch. Return an actionable service-unavailable response when blocked. Show the same reason in administrator diagnostics. Keep the approved plan/draft and expose a readiness recheck; only enable generation/retry once execution is available. Treat this as an infrastructure prerequisite rather than falsely implying the Skill or judge failed.

Acceptance: reload the previously failed eval, see the correct blocker, repair readiness, retry once, and observe real generation advance to a validated ready draft. Verify report expiry/login loss during later operations, partial evidence retention, cancellation and restart behavior. Existing approval immutability must remain intact.

## Immediate available path

The review application at <http://127.0.0.1:3200> remains usable for the deterministic browser workflow. Its outcomes are demo evidence and do not demonstrate a real Skill improvement. It is not necessary to change the failing real installation or overwrite its history to use that separate demo.

The real fix is incomplete executor setup and acceptance implementation, with an additional measured local sandbox incompatibility. The exact failing host still needs identification. This incident note supplements the [full staging audit](../audits/2026-09-06-staging-readiness.md), especially R03–R04 and R15–R16; it does not claim those fixes have been implemented.
