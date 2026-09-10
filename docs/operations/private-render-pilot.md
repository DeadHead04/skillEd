# Private Render pilot: deployment, migration and recovery

This runbook implements the approved private-team architecture. **It does not certify hosted execution.** The credential-free local canary failed to create the namespace required by Codex. Render could not fetch the private repository through its current GitHub connection. No Render services or database were created, and no existing installation was migrated or stopped.

## Release order and gates

1. Run the corrected local deterministic workflow and the automated checks below.
2. Grant Render's GitHub connection access to `DeadHead04/skillEd`. The old `ShiveshPandey0409/skillEd` URL redirects to that repository; it does not solve missing Render access.
3. Deploy `render.canary.yaml` from the reviewed release commit. It is a credential-free private service. Run every isolation probe on Render before enabling model execution. A failed or pending probe blocks release.
4. Deploy `render.yaml` with demo mode. Migrate its empty database and provision runtime roles before starting web/controller. Complete the full browser journey with synthetic data and no personal credentials.
5. After explicit authorization, authenticate directly on the executor, run the real acceptance below, and rehearse executor replacement and backup restoration.
6. Rehearse history import into a separate empty destination, reconcile it, then schedule the final pause/export/import/cutover. Retain the local source and backups.

The executor reads `SKILLED_EXECUTION_EVIDENCE`. Its versioned report must contain every check in `REQUIRED_EXECUTION_CHECKS`, all passed, for the exact `RENDER_GIT_COMMIT`/`SKILLED_IMAGE_REVISION`, within 24 hours. It also checks current Codex login availability. Renew acceptance evidence before expiry; do not extend timestamps or hand-mark pending checks as passed. The minimal canary deliberately cannot certify authenticated paths.

Required real acceptance: workspace reads/writes; denied synthetic home/sibling/hidden-truth markers; process isolation; tool network and cloud-metadata denial while approved model access works; script-judge isolation; CPU/RAM/PID/output/time limits; initial execution; resume; App Server; agent-judge correction; persistent login and completed-context reconstruction after executor replacement. Use synthetic markers, never real credentials. Capture commands, results, runtime/image versions and cleanup evidence. If Render cannot enforce these boundaries with the pinned CLI, keep execution disabled and revise the deployment/version decision.

## Services and credentials

`render.yaml` defines web, controller, executor, artifact service and managed PostgreSQL in Singapore. Web uses Standard (1 CPU/2 GB), controller and artifacts use Starter (0.5 CPU/512 MB), executor uses Pro (2 CPU/4 GB), PostgreSQL uses Basic-1gb. These legacy IDs remain accepted aliases of the [current compute plan IDs](https://render.com/docs/compute-plans). The Blueprint has passed Render validation.

Obtain a fresh quote in the Render creation review before provisioning. Include all four compute instances, PostgreSQL compute and storage, 20 GB artifact disk, 10 GB executor disk, workspace plan, bandwidth and build overages. Capacity and cost have not been benchmarked. [Current pricing](https://render.com/pricing)

Only web/controller receive database URLs, with separate `skilled_web`/`skilled_controller` roles. The database owner URL belongs only to a temporary administrative migration process, never a persistent application service. The artifact service receives the Ed25519 verification PEM, while web/controller receive the private signing PEM. Generate a dedicated key pair outside the repository and install it using Render secrets. The executor receives only its API token and exact-object grants; it refuses database and artifact signing credentials.

Use the Blueprint's private `hostport` references. Private-network placement does not replace authentication. Artifact grants expire in five minutes and bind one key, operation and byte limit. Executor start/status/cancel/renew/publish require its bearer token; writes also require the lease token. Health returns sanitized readiness without service secrets. No Docker socket, Redis, shared service disk, object-store provider or alternate execution provider is used.

Set a strong administrator password, generated session secret and `SKILLED_HTTPS=true`. Only the first empty-database login creates the configured administrator; existing account credentials are never overwritten by environment changes. Administrators create operators through Users. There is no public signup. Configure Render access controls for a trusted installation; a reachable login page does not make this a public customer product.

Render disks attach to one instance and interrupt zero-downtime replacement. Confirm UID 10001 can write each dedicated mount during staging; do not run the production executor as root to compensate for disk ownership. Stage and verify ownership through a controlled administrative setup before services start. [Disk constraints](https://render.com/docs/disks)

## Database initialization

Use the pinned release's controller image or Node 24 workspace with an owner `MIGRATION_DATABASE_URL` supplied securely for the command's lifetime:

```sh
node --import tsx packages/core/src/migrate.ts
node --import tsx packages/core/src/roles.ts
```

The roles command additionally requires `SKILLED_WEB_DB_PASSWORD` and `SKILLED_CONTROLLER_DB_PASSWORD`, each at least 32 characters. It does not print them. Supply the resulting runtime connection strings to their respective services, then remove the owner environment. Render runtime services must retain `SKILLED_AUTO_MIGRATE=false`.

Migrations are ordered and advisory-lock protected. Schema 1/2 is the legacy baseline; 3 establishes immutability/leases/decisions; 4 enforces lifecycle transitions; 5 separates legacy and current normalization identities. Runtime credentials have no schema or migration writes. Re-run role provisioning after additive migrations that introduce new tables. Do not replay schema SQL manually or disable immutability triggers to fix an application bug.

## History rehearsal and cutover

The history commands work with the original schema as well as the current one. They copy referenced application artifacts only, never a Codex home or browser session. Export selects user identity fields without password hashes. Archives with credential-store entries are rejected before copying and reported as unavailable.

For a consistent final snapshot, stop new browser writes and drain/stop the source worker first. Keep PostgreSQL and artifacts intact. Use an administrative environment with the source database URL and its existing `ARTIFACT_ROOT`:

```sh
node --import tsx packages/core/src/history-cli.ts export /secure-backups/skilled-final
```

The new destination must be empty and migrated. Supply its owner URL and either a dedicated artifact root or the artifact service URL plus signing key, then run:

```sh
node --import tsx packages/core/src/history-cli.ts import /secure-backups/skilled-final
```

The directory includes `history.json`, its SHA-256, and referenced immutable artifacts. Treat it as private application data. Transfer it through an authenticated administrative channel. The manifest is a checksum inventory, not a digital signature: its integrity depends on that trusted channel and backup access controls.

Import verifies hashes, publishes artifacts before references, checks table counts, restores relationship cycles and active-version pointers, and records an idempotent import checksum. Repeating an identical import is safe; importing into a different nonempty installation fails. Missing objects remain explicit manifest entries; assess every missing reference before approving cutover. Normalized package digests can be derived from verified transported bytes without pretending that historical tests were reverified.

Imported active jobs become interrupted. Completed result labels and IDs remain unchanged; a separate legacy assessment prevents them from certifying candidates. Native Codex thread IDs are cleared; saved completed conversation messages are used when starting replacement threads. Active-version pointers remain visibly historical. Every application session is invalidated, and imported accounts require password recovery.

Recover the existing administrator after import using `SKILLED_ADMIN_LOGIN_ID` and `SKILLED_ADMIN_PASSWORD` plus the temporary owner URL:

```sh
node --import tsx packages/core/src/recover-admin.ts
```

Then reset other named accounts through Users. Reauthenticate Codex directly on the executor using the official interactive or device login supported by the pinned CLI. Do not copy desktop credentials into the executor, backup, image or artifacts. The shared ChatGPT login is a private-pilot constraint. Official guidance recommends API authentication for programmatic CLI workflows; it is not a customer OAuth integration. [Authentication](https://learn.chatgpt.com/docs/auth), [permissions](https://learn.chatgpt.com/docs/permissions)

Perform the full rehearsal before the final source pause. Measure export/import/restore duration, reconcile every source record and artifact, inspect representative conversations/reports/downloads, and rerun an imported Skill through the corrected pipeline. Enable hosted writes only after this passes. Keep the original local installation and final snapshot available for rollback.

## Operations, retention and rollback

- Execution concurrency is one per installation. Leases renew every 10 seconds, expire after 60 seconds and reconcile every 10 seconds. New controllers wait for valid prior leases; stale owners cannot write. Interrupted operations require an explicit retry.
- Stop new submissions and drain queued/running work before deployment. A controller handles SIGTERM with a bounded drain; executor replacement terminates its process tree and marks unfinished disk records interrupted. Do not deploy disk services while an upload or model operation is active.
- Limits: 50 cases, 3 trials, 15-minute case/authoring, 3-minute agent judge, 30-second script judge, 2-hour job; 200 MiB aggregate upload; existing ZIP limits; 250 MiB collected output; 10 MiB raw logs. Admission requires 2 GiB local free space. Internal input transport has a separate 512 MiB bound; it does not increase upload limits.
- Diagnostics shows execution availability, login/storage/queue state, queue age, execution/sample duration, cancellation latency and validator errors. Review daily. Investigate a queue older than the two-hour job bound, stale workers, growing validator errors or low storage before admitting more work. Structured events retain job/run correlation IDs.
- Temporary workspaces expire after 24 hours, excluding active work. Referenced versions, messages, decisions and evidence are retained until explicit deletion. Immutable execution records are retained for idempotency. CAS cleanup of unreferenced published blobs is deliberately not automatic; reconcile before deleting anything.
- Take a paired logical database/history export and immutable artifact backup at least daily using the export command. Keep backups outside the live service disks under administrator-controlled access, without introducing another runtime artifact provider. Never back up the executor credential store. The target is a 24-hour RPO and four-hour restore; the timed production-sized rehearsal is still a release gate, not an achieved SLA.
- Rotate executor tokens on both caller/executor during a drain. For artifact signing-key rotation, allow existing five-minute grants to expire, replace signer/verifier together and confirm old grants fail. Rotate application session secrets to revoke sessions. Keep key material out of diagnostics.
- Roll back compatible application images against additive migrations. Never delete schema/history to roll back code. If reverting to the original local installation after hosted writes, reconcile the new hosted history first; simply reopening stale local writes would lose those changes.

For an existing local Compose volume created by older root images, back it up and inspect its ownership before upgrading to UID 10001. Correct only the named application artifact/work volumes in a controlled maintenance step. Do not change permissions on a desktop credential file or delete volumes. Original Compose bindings remain loopback only.

## Deterministic acceptance

```sh
pnpm format:check
pnpm lint
pnpm typecheck
SKILLED_TEST_DATABASE_URL=postgres://.../skilled_test SKILLED_PRIVATE_SERVICE_TESTS=true SKILLED_CONTRACT_CLI=/tmp/skilled-skill-up pnpm test
pnpm build
docker compose -f compose.test.yaml up -d --build
COMPOSE_FILE=compose.test.yaml SKILLED_BASE_URL=http://127.0.0.1:3100 ./scripts/verify-stack.sh --demo
PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:3100 SKILLED_E2E_PASSWORD=deterministic-test-password-only pnpm test:e2e
docker compose -f compose.test.yaml exec -T worker python3 packages/core/src/__test__/judge-harness-xlsx.test.py
git diff --check
```

The PostgreSQL test URL must identify a disposable `skilled_test` database. Tests create/drop their own schemas and one temporary role-test database; never point them at application history. Build the CLI with `go build -trimpath -ldflags '-X main.version=skilled-v2' -o /tmp/skilled-skill-up ./cmd/skill-up` from `skill-up/` using Go 1.25.5. CLI contract fixtures invoke synthetic script judges, not a model.

## Vendored boundary

The application invokes the pinned binary. Narrow upstream patches remove the resume sandbox bypass, allow a trusted script-judge sandbox wrapper, honor debug judge timeouts, and identify the binary as `skilled-v2`. `go test ./internal/agent ./internal/judge ./internal/cli` and `pinned-cli.test.ts` cover these changes. Runtime permissions still require the Render canary; passing unit tests cannot certify isolation.

## Later releases

Guided “Create a Skill from a task” follows the pilot. Public signup, billing, tenant isolation, customer model authentication, live MCP, arbitrary dependency installation and other execution/storage providers remain explicitly outside this pilot. The [69-finding checklist](../audits/2026-09-05-implementation-tracker.md) records implementation and acceptance status separately.
