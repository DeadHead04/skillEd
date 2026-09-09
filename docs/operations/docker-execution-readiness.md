# Docker tester: generation blocked before it starts

The message `no isolation acceptance report is configured for this image` is an execution setup rejection. It does not grade the Skill and does not establish that the person's ChatGPT login is invalid. Retrying generation cannot repair it.

## Confirmed implementation gaps

The default local Compose file selects `real` mode. Before this fix it did not pass `SKILLED_EXECUTION_EVIDENCE` or `SKILLED_IMAGE_REVISION` to the worker. Adding those settings to `.env` alone therefore had no effect inside that container. The code also returned the same error when either setting was absent.

The preliminary canary still leaves eight acceptance paths pending. It cannot generate a fully accepted report. Completing the real execution acceptance harness remains required; this diagnostic/configuration fix does **not** make a fresh installation capable of certified real evaluation. Previously observed local Docker probes failed namespace creation, and the actual script-judge probe failed with resource exhaustion. Those results describe the tested machine, not another person's Docker host.

Reports must match the tested image and be less than 24 hours old. Copying a report from a different installation, changing its revision/timestamp, or marking pending checks passed is not acceptance.

## Collect the exact blocker on the other person's computer

Use the updated checkout and rebuild its existing Compose project. Keep its original project name, Compose files, volumes and login configuration. Do not delete volumes or reset the database.

```sh
docker compose up -d --build
./scripts/check-execution.sh
```

The diagnostic runs inside the worker. It prints only sanitized readiness, configuration-presence booleans and required check statuses, and exits nonzero when real execution is blocked. It never starts a model call, runs an acceptance suite or copies credentials. For a split controller, it reads the executor's authenticated readiness endpoint instead. Direct Node deployments can run `node --import tsx apps/worker/src/readiness-cli.ts` in their configured execution environment.

Share that output, `git rev-parse HEAD`, the host OS and Docker version. Do not send `.env`, full container environment dumps or credential files.

| Reason                                         | Required action                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `ACCEPTANCE_MISSING`                           | Complete acceptance on this host/image, then mount its measured report and set the path visible inside the worker.    |
| `IMAGE_REVISION_MISSING`                       | Set the revision of the actual image being tested; an arbitrary current Git revision does not certify an older image. |
| `ACCEPTANCE_UNREADABLE` / `ACCEPTANCE_INVALID` | Check report mount, regular-file format and read access for UID 10001.                                                |
| `ACCEPTANCE_REVISION_MISMATCH`                 | Rerun acceptance after the image changes.                                                                             |
| `ACCEPTANCE_EXPIRED`                           | Rerun acceptance; do not extend the timestamp.                                                                        |
| `ISOLATION_NOT_ACCEPTED`                       | Inspect failed, pending, missing and duplicate checks. A preliminary canary is insufficient.                          |
| `AUTHENTICATION_UNAVAILABLE`                   | After isolation passes, complete the official login flow in the intended execution environment.                       |
| `EXECUTOR_UNREACHABLE`                         | Check the private executor address, shared service token and compatible controller/executor versions.                 |
| `WORKER_UNAVAILABLE` / `ADAPTER_MISMATCH`      | Check worker connectivity and that web/worker use the same intended adapter mode.                                     |

## Preliminary sandbox probe

The worker image includes the credential-free canary. It constructs a temporary synthetic home and only attempts sandbox probes; no model calls or credential-file reads occur. Run it inside the intended worker:

```sh
docker compose exec -T -e SKILLED_CANARY_ONCE=true worker node /opt/skilled/canary.mjs
```

A nonzero exit is expected until all required checks are certified; the current preliminary harness always leaves authenticated paths pending. It must never be installed as an accepted report. A sandbox failure needs investigation on that specific host before login or real-agent acceptance. Keep the gate closed rather than adding a privileged container, disabling the sandbox, or relabeling synthetic runs as real.

## Wire a genuinely accepted local report

Only after actual acceptance succeeds for that exact image, add these settings to the existing local `.env`:

```dotenv
COMPOSE_FILE=docker-compose.yml:compose.execution.yaml
SKILLED_IMAGE_REVISION=<actual-built-and-tested-release-revision>
SKILLED_EXECUTION_REPORT_FILE=/absolute/path/to/acceptance.json
```

The overlay mounts the report read-only at `/data/acceptance/acceptance.json`, passes its container path to the worker, and refuses to create a missing host file. Custom Compose configurations can mount their own report location and set `SKILLED_EXECUTION_EVIDENCE` accordingly. Container environment changes require recreation; `docker compose restart` alone does not apply them. Recreate from the same tested image and rerun the diagnostic.

In the browser, the failed/collecting eval preserves its task and plan. **Recheck execution** reads current readiness without queuing another job. After the worker publishes ready status, the original generation action becomes available again. Diagnostics lists the specific reason, required check statuses, and report expiry. The worker/executor still enforce the gate at dispatch if readiness changes after the page loads.

For a UI-only demonstration, use the separate `compose.test.yaml` installation and label its results **Demo evidence**. That is a different test objective and is not a remedy for blocked real execution.
