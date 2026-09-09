# Docker execution-readiness repair — 9 September 2026

The user confirmed that a second person encounters the error in Docker on their computer. Their host has not been inspected. This acceptance reproduces a fresh installation locally; it does not certify the other person's sandbox or login.

## Confirmed cause and changes

- Default Compose selected real mode but omitted both report/revision settings from the worker environment. They are now forwarded, with a separate read-only report-mount overlay for genuinely accepted evidence.
- Missing path, missing revision, unreadable/invalid report, mismatched image, expired/time-invalid evidence, failed/pending checks, and unavailable login now have distinct sanitized reasons.
- Login is not probed until isolation passes; diagnostics accurately says **Not checked** when it has not been checked.
- The private executor exposes authenticated detailed readiness. The controller preserves it instead of losing the cause behind a generic boolean.
- Collecting/failed generation exposes a read-only recheck when blocked. No retry job is queued; drafts/history remain intact. API rejection is not marked automatically retryable.
- `scripts/check-execution.sh` provides a safe, non-model diagnostic. Preflight explicitly distinguishes local prerequisites from real execution acceptance.
- The preliminary canary is included in the worker image and exits nonzero for blocked acceptance in one-shot mode. It still cannot certify the eight pending paths.

## Measured evidence

`fresh-docker-diagnostic.json` reproduces `ACCEPTANCE_MISSING`: real mode, no report path, no revision, login not checked. This was a separate credential-free Compose project on loopback port 3500, with independent volumes.

`preliminary-canary.json` is **blocked**, with **1 passed, 4 failed, 8 pending**. Four actual sandbox probes returned `bwrap: No permissions to create a new namespace`. `imageRevision: unidentified-image` explicitly marks this as a preliminary local probe, not image acceptance. This file was never installed as accepted evidence. No real model calls or credential copying occurred.

`blocked-browser.json` records live upload, three read-only rechecks, HTTP 503 enforcement, preserved collecting state, refresh recovery, diagnostics and 390/1440 pixel checks. Screenshots document the blocker and diagnostics. The committed `execution-readiness.spec.ts` also passed all three desktop/laptop/mobile projects against that isolated blocked installation.

Required command for repeating that special browser test, using a dedicated real-mode test installation with no acceptance report:

```sh
SKILLED_E2E_BLOCKED_EXECUTION=true PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:3500 SKILLED_E2E_PASSWORD=deterministic-test-password-only pnpm test:e2e execution-readiness.spec.ts --workers=1
```

Normal CI intentionally skips that test against its demo worker. Readiness report, PostgreSQL mutation and private-service authentication tests remain credential-free in normal CI.

Final local checks passed: formatting, lint, typecheck, production build, Docker build, Compose verification in demo mode, optional Compose-overlay validation and `git diff --check`. The unit/integration run passed 78 tests with two environment skips; both skipped Linux/pinned-CLI fixtures then passed in the worker image. The full existing browser suite passed 52 tests with two intentional duplicate-zoom skips, followed by three passing blocked-execution browser tests. The original port-3000 installation and all application history were preserved; the port-3400 review worker remained in demo mode.

See the [Docker handoff guide](../../operations/docker-execution-readiness.md) for collecting the other person's actual reason and the remaining acceptance work. Real evaluation is still blocked; these changes repair configuration, diagnostics and recovery behavior, not the missing acceptance harness or host isolation capability.
