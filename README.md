# SkillEd

For real execution in Docker, run `./scripts/setup-docker-execution.sh --real` after the deterministic checks. This runs isolation tests, signs in directly inside Docker when necessary, and runs authenticated acceptance in two replacement containers. See the [Docker execution guide](docs/operations/docker-execution-readiness.md). Login alone does not satisfy the gate.

SkillEd helps a trusted team upload an existing Skill, define approved tests, inspect evidence, review an improvement, verify it and explicitly activate or download the candidate. The backend invokes the pinned **Skill-Up CLI**; application code does not import its internal packages.

```text
Upload Skill and task files
→ understand the task and approve evaluation coverage
→ generate, inspect and approve an immutable eval
→ run selected cases, trials and an optional baseline
→ inspect assertions, outputs and partial evidence
→ review Skill and eval patches separately
→ verify current and candidate versions using three matched trials
→ explicitly activate or download
```

## Current release status

Hosted real execution remains **disabled until the Render feasibility gate passes**. The local Docker configuration supplies a constrained seccomp profile for Codex's nested sandbox. All 13 isolation and authenticated acceptance checks pass on the tested Docker Desktop host, including real tool use, both judge paths and recovery after container replacement. See the [measured Docker acceptance](docs/acceptance/2026-09-10-codex-docker/README.md) for browser-workflow evidence and remaining limits. Render must demonstrate its own runtime compatibility.

The [69-finding implementation tracker](docs/audits/2026-09-05-implementation-tracker.md) distinguishes implemented code, automated acceptance, pending operational evidence and later releases. The [Render deployment/migration runbook](docs/operations/private-render-pilot.md) covers credentials, service boundaries, all-history migration, restoration and cutover. Neither document claims that real hosted execution has been certified.

## Evaluation studio

The task-specific studio adds **Dashboard** and **Skills**, package findings, profile approval/revision comparisons, linked evidence charts, actual file diffs and version-specific release decisions. See the [studio acceptance report](docs/acceptance/2026-09-09-evaluation-studio/README.md) for the implemented contracts, manual workflow, screenshots and outstanding real-execution gates. Apply migration **007** before starting the updated web/controller images. The local review installation remains at <http://127.0.0.1:3400/dashboard>.

## Start a credential-free local demo

Requirements: Git, Docker Desktop/Compose v2 and sufficient Docker memory (8 GB is a useful development starting point). No personal Codex login is required for this test installation.

```sh
git status --short
./scripts/preflight.sh --demo
docker compose -f compose.test.yaml up -d --build
COMPOSE_FILE=compose.test.yaml SKILLED_BASE_URL=http://127.0.0.1:3100 ./scripts/verify-stack.sh --demo
```

Open [the local demo](http://127.0.0.1:3100). Sign in as `admin` with `deterministic-test-password-only`. These are synthetic local-only test credentials. The stack has its own PostgreSQL/artifact/work volumes and binds web only to loopback. It does not mount personal credentials.

The separate `docker-compose.yml` remains the original local installation on `127.0.0.1:3000`; PostgreSQL stays private/loopback. Do not expose it to a LAN or public internet. Before upgrading existing root-owned artifact/work volumes to the new UID 10001 images, follow the backup and ownership maintenance steps in the runbook. Preserve all existing history and unrelated files.

`docker compose down` preserves named volumes. **Never use `down -v` without explicit approval.** Do not point acceptance tests at the original application database.

## Browser workflow

1. Choose **Add Skill package**, upload a ZIP with `SKILL.md`, describe the task and classify task files as input dataset, authority, expected output, example or past failure.
2. Start understanding, answer blocking questions and review the coverage plan. The limit is 50 cases; coverage is never silently truncated.
3. Generate and inspect cases: prompts, required assertions, source references, input fixtures and validators. Approve the exact eval bundle. Approved evals cannot change in place; clone a draft to edit.
4. Choose **New run**. Select cases, one to three repeated trials and an optional baseline without the Skill. The UI shows the exact execution count. You can start a new eval around unchanged Skill bytes or rerun after completion.
5. Inspect failed dimensions, assertion evidence, transcripts and output files. Baseline benefit and repeated-trial stability are separate. Partial-run evidence remains downloadable when available.
6. Request an improvement. Review the genuine file diff, then approve/reject Skill changes and eval changes separately. Eval changes require their own generated-bundle approval.
7. Verify the candidate against the same explicitly approved eval as the current version. Three complete trials, stable candidate results, passing targeted fixes and no new required-assertion failures are required.
8. Explicitly activate the verified candidate or download it. Uploads and candidate creation do not activate anything. Stale activation is rejected.

Long operations recover their job IDs from server state after refresh and offer cancellation. Network failures retain safe retry keys. Administrators use **Diagnostics** to inspect execution availability, queue age, storage and errors.

## Evidence and permissions

- **Demo evidence** is deterministic and makes no model calls. It cannot authorize activation in real mode.
- **Imported history — not reverified** preserves original labels and active-version pointers, but cannot certify new candidates until rerun through the corrected pipeline.
- **Execution unavailable** means the browser/history remain usable while login, sandbox or runtime prerequisites are missing.
- `PASS` requires every required assertion. `PARTIAL` means task-success requirements passed while a required constraint failed; historical correctness/scope dimensions retain their compatibility mapping. `FAIL` is task failure. `ERROR` means trustworthy execution/grading evidence is unavailable. Missing, malformed, duplicate or unmapped required grading is never green.
- Script judges inspect concrete text/JSON/CSV/XLSX outputs and protected fields. They run through an explicit sandbox wrapper, never directly with service permissions during real execution.
- Each case, baseline variant, repeated trial and agent judge starts fresh. Hidden expected answers and authoring history must remain outside tested workspaces. Actual isolation is a measured release gate.
- Authoring and improvement have separate durable App Server conversations. Missing native state is reconstructed from completed saved messages and recorded as reconstruction.

One trusted team shares the installation. Administrators issue single-use signup links; invited people choose their own login IDs and passwords. Administrators can also create accounts with temporary passwords that must be changed on first sign-in. Operators cannot manage accounts. People can change their password in **Your account**, and administrators can issue single-use recovery links. Password, role and activation changes revoke affected application sessions. There is no unrestricted public signup, per-customer tenant boundary or per-user Codex OAuth.

See the [complete manual account test guide](docs/acceptance/manual-account-flow.md) for signup, sign-in, recovery, role checks and failure cases. Start its separate local installation with:

```sh
COMPOSE_DISABLE_ENV_FILE=true docker compose -p skilled-account-review -f compose.test.yaml -f compose.accounts.yaml up -d --build
```

Open <http://127.0.0.1:3400/login>. Its initial administrator is `admin` / `deterministic-test-password-only`. These credentials belong only to this disposable local installation. Keep existing installations and their volumes intact. Account signup does not authenticate Codex or satisfy executor readiness.

Existing deployments need migration **006** and runtime-role provisioning before the new web image starts. New credentials use salted scrypt hashes; existing bcrypt passwords continue to work. Account link secrets are stored only as hashes, shown once to the administrator and carried in URL fragments. They are excluded from history exports, so invitations and recovery links must be reissued after migration. Recovery is administrator-assisted; no email delivery is configured.

The private pilot uses official Codex login directly inside the executor, persisted in its own Docker volume. Existing host credential files remain untouched; upgraded installations sign in again. Do not read, print, copy, commit or package credential files. Normal development/CI must not receive personal credentials. No real-agent suite should run without explicit authorization after deterministic and isolation gates pass.

## Architecture

| Component                | Purpose                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| Web/API                  | Login, intake, review/decisions, durable events and authorized downloads                      |
| Controller               | PostgreSQL jobs, immutable manifests, leases/reconciliation and report ingestion              |
| Executor private service | Pinned Codex/Skill-Up, explicit sandboxed execution, cancellation and persisted session state |
| Artifact private service | Streamed content-addressed immutable objects with exact-object short-lived grants             |
| PostgreSQL               | Versioned history, approved evals, decisions, jobs and events                                 |

`render.yaml` is separate from local Compose and uses paid services in Singapore. Only web/controller get restricted database credentials. Executor/artifact services reject database and artifact-signing credentials. Model operations are globally sequential. The pilot adds no Redis, Kubernetes, external object storage or alternate execution provider.

Migrations are ordered and advisory-lock protected. Render runs them with temporary owner credentials; runtime services use `SKILLED_AUTO_MIGRATE=false`. Limits and toolchain support are published in `packages/core/src/capabilities.ts`. Unsupported dependencies block real launch; arbitrary installation, open internet tools and live MCP are outside this release.

## Development and verification

Host development requires Node 24 and pnpm 11.19.0. Docker supplies the authoritative pinned production build when the host runtime is older.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:3100 SKILLED_E2E_PASSWORD=deterministic-test-password-only pnpm test:e2e
git diff --check
```

For full credential-free backend acceptance, use a disposable `SKILLED_TEST_DATABASE_URL` whose database name includes `skilled_test`, set `SKILLED_PRIVATE_SERVICE_TESTS=true`, and point `SKILLED_CONTRACT_CLI` at a rebuilt pinned CLI. See the runbook for exact commands. These enable actual PostgreSQL role/lifecycle/migration, private API and synthetic CLI contract tests; normal unit execution skips unavailable integration dependencies explicitly.

CI builds Go 1.25.5 Skill-Up with `skilled-v2` version identification, runs the contract tests and starts the empty credential-free Compose stack for the full browser journey. Workbook assertions are additionally tested inside the pinned executor image with its actual Python dependencies.

Real acceptance is a separate release step. The existing `test:real:smoke`, `test:real:jiomart` and `test:real:full` commands consume model resources and do not substitute for sandbox feasibility checks.

## Repository map

- `apps/web`: Next.js browser UI, auth, API, SSE and downloads. Unit and integration tests live in each source folder's `__test__` subdirectory.
- `apps/worker`: controller, executor/artifact private services, App Server and CLI ingestion.
- `packages/core`: contracts, migrations, lifecycle guards, result adapter, archives, artifact validators and history tooling.
- `skill-up`: pinned vendored source; invoke its binary, never import `internal/*` in product code.
- `infra/render-canary`, `render.canary.yaml`: credential-free hosted feasibility probe.
- `render.yaml`: private Render staging/pilot infrastructure.
- `docs/audits`: original audit and implementation tracker.
- `docs/operations`: deployment, migration, backup, restoration and remaining release gates.
- `docs/plans`: product history and original architecture contracts.

Guided Skill creation follows this pilot. Public customer hosting, signup, billing, tenant isolation, customer model access, arbitrary dependencies and live MCP require separate releases and their own acceptance gates.
