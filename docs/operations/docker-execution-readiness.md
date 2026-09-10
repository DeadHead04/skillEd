# Docker tester: generation blocked before it starts

The message `no isolation acceptance report is configured for this image` is an execution setup rejection. It does not grade the Skill and does not establish that the person's ChatGPT login is invalid. Retrying generation cannot repair it.

## Initialize real Docker execution

Enable **device-code authorization for Codex** in the intended account's
**ChatGPT Settings > Security** before starting login. For a managed workspace,
the workspace administrator may need to enable it in workspace permissions.
If the authorization page displays “Enable device code authorization for Codex,”
use its ChatGPT Security Settings link, enable the setting, then rerun the login
command for a fresh code. This rejection comes from the account's sign-in policy;
rebuilding Docker or retrying generation does not change it.
[Official Codex authentication instructions](https://learn.chatgpt.com/docs/auth#preferred-device-code-authentication-beta)

The login code expires after 15 minutes in the pinned CLI. If it expires while
changing settings, rerun `./scripts/create-codex-login.sh` using the same Compose
project, then continue the setup command below. Do not copy credential files.

After deterministic checks, use the existing Compose project (preserve its name and volumes):

```sh
./scripts/setup-docker-execution.sh --real
```

This explicitly consumes model requests. It builds the executor, drains the ordinary worker, checks isolation without credentials, starts the official device-login flow if needed, and runs real CLI/App Server/Skill-Up judge acceptance. A second container proves login persistence and native conversation recovery; a missing-thread test checks reconstruction. The ordinary worker restarts even on failure, retaining history and actionable diagnostics while real execution stays gated.

Default Compose now stores Codex login in `codex-home` and measured acceptance in `acceptance`, both named volumes. It never binds a desktop credential file. Existing application database/artifact/work volumes keep their names and content. The old host login remains untouched; perform a new login in Docker after upgrading.

The image has a build-time fingerprint of pinned binaries, dependency lockfile and product source. This takes precedence over manually configured revisions, so a rebuild cannot accidentally reuse an older image's accepted report. Reports still expire after 24 hours; rerun measured acceptance instead of modifying timestamps. The current setup command is operator-run, not an automatic background renewal service.

The production launcher applies the same strict filesystem policy to task CLI, resume and App Server paths. Script judges apply limits inside their fresh namespace. The pinned CLI uses `sandbox -- COMMAND`; the previous platform subcommand was not supported by this build. Details and the explicit Docker syscall delta are in [the runtime boundary notes](../../infra/docker/README.md).

All 13 isolation and authenticated checks passed on the development Docker host on 10 September 2026, including real CLI/App Server tool use, script and agent judges, login persistence, resume and reconstruction. The [acceptance record](../acceptance/2026-09-10-codex-docker/README.md) tracks the separate browser workflow. These results do not certify another person's Docker host or Render; each installation must run its own acceptance.

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

The preliminary command exits zero when its seven isolation checks pass, but its report remains blocked with authenticated checks pending. It must never be installed as an accepted report; use the full setup command above. A sandbox failure needs investigation on that specific host before login or real-agent acceptance. Keep the gate closed rather than adding a privileged container, disabling the sandbox, or relabeling synthetic runs as real.

## Wire a genuinely accepted local report

The setup command manages the report volume automatically. For an externally managed accepted report from this exact image, the optional overlay can instead use these settings in the existing local `.env`:

```dotenv
COMPOSE_FILE=docker-compose.yml:compose.execution.yaml
SKILLED_IMAGE_REVISION=<actual-built-and-tested-release-revision>
SKILLED_EXECUTION_REPORT_FILE=/absolute/path/to/acceptance.json
```

The overlay mounts the report read-only at `/data/acceptance/acceptance.json`, passes its container path to the worker, and refuses to create a missing host file. Custom Compose configurations can mount their own report location and set `SKILLED_EXECUTION_EVIDENCE` accordingly. Container environment changes require recreation; `docker compose restart` alone does not apply them. Recreate from the same tested image and rerun the diagnostic.

In the browser, the failed/collecting eval preserves its task and plan. **Recheck execution** reads current readiness without queuing another job. After the worker publishes ready status, the original generation action becomes available again. Diagnostics lists the specific reason, required check statuses, and report expiry. The worker/executor still enforce the gate at dispatch if readiness changes after the page loads.

For a UI-only demonstration, use the separate `compose.test.yaml` installation and label its results **Demo evidence**. That is a different test objective and is not a remedy for blocked real execution.
