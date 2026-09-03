# SkillEd

SkillEd is a private, local-first workbench for testing and improving Agent
Skill packages. A user uploads a Skill ZIP plus task evidence, reviews an eval
suite authored with Codex and Skill-Upper, runs it through Skill-Up, and
approves a versioned Skill update only after candidate verification.

```text
Browser on 127.0.0.1
        │ HTTP + SSE
        ▼
Next.js web ───── PostgreSQL
        │              │
        └── jobs/events┘
               ▼
       sequential worker
        ├── Codex App Server: authoring and update conversations
        ├── Skill-Up CLI: validation, execution, judges, reports
        └── Codex CLI: isolated agent and agent-judge runs
```

The complete product flow is:

```text
Upload Skill ZIP and typed task files
→ answer material questions
→ review and approve the eval coverage plan
→ generate and validate concrete eval cases
→ approve an immutable eval version
→ run Skill-Up with fresh Codex executions
→ inspect PASS / PARTIAL / FAIL / ERROR evidence
→ request a separate Codex improvement proposal
→ approve or reject Skill and eval changes
→ compare current and candidate Skills on the same eval version
→ explicitly activate or download the candidate
```

No terminal or YAML editing is required after the stack is running.

## Start from a clean machine

### Requirements

- Git.
- Docker Desktop with Docker Compose v2.
- A ChatGPT account that can use Codex.
- Codex CLI on the host only when a new browser login must be created.
- At least 8 GB of memory available to Docker is recommended.

Node, pnpm, Python, Go, Codex CLI, and Skill-Up are built into the containers.
They are needed on the host only for repository development or login setup.

### 1. Clone and configure

```bash
git clone https://github.com/ShiveshPandey0409/skillEd.git
cd skillEd
git switch codex/phase-1
cp .env.example .env
```

Set these values in `.env`:

```dotenv
SKILLED_ADMIN_LOGIN_ID=admin
SKILLED_ADMIN_DISPLAY_NAME=Local administrator
SKILLED_ADMIN_PASSWORD=choose-a-local-password
SKILLED_SESSION_SECRET=replace-with-output-from-openssl-rand-hex-32
SKILLED_ADAPTER_MODE=real
```

Generate the session secret with `openssl rand -hex 32`. Do not commit `.env`.

### 2. Make Codex authentication available

First try the normal Codex cache:

```bash
codex login status
test -f "$HOME/.codex/auth.json"
```

If it exists, Compose mounts only that file into the worker. The mount is
writable so Codex can refresh tokens. The complete Codex home, plugins, skills,
configuration, and task history are not mounted.

If the file does not exist because Codex uses the macOS Keychain or another
credential store, create a dedicated file-backed login:

```bash
./scripts/create-codex-login.sh
```

Complete the browser login, then add the path printed by the script to `.env`:

```dotenv
CODEX_AUTH_FILE=/absolute/path/to/skillEd/.auth/codex/auth.json
```

Official OpenAI documentation confirms that `codex login` uses the browser
flow, `codex login status` reports the active method, and file-backed sessions
are stored in `auth.json` under `CODEX_HOME`. Treat that file like a password:
[Codex authentication](https://learn.chatgpt.com/docs/auth).

### 3. Run preflight and start

```bash
./scripts/preflight.sh
docker compose up -d --build
./scripts/verify-stack.sh
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) and sign in with
`SKILLED_ADMIN_LOGIN_ID` and `SKILLED_ADMIN_PASSWORD`. On an empty database,
this first login bootstraps the first administrator. Later environment changes
do not overwrite database-managed accounts.

Successful health output includes:

```json
{
  "status": "ready",
  "database": "ready",
  "worker": {
    "status": "ready",
    "readiness": {
      "skillUp": true,
      "appServer": true,
      "codexLogin": "Logged in using ChatGPT"
    }
  }
}
```

The app binds only to `127.0.0.1:3000`. PostgreSQL is available locally at
`127.0.0.1:3001`; neither service is exposed to the LAN. This is a trusted
local multi-user setup, not a public arbitrary-code service.

## Users and roles

Administrators see **Users** in the workflow navigation. From that screen they
can create named accounts, promote or demote operators, deactivate or reactivate
accounts, and reset passwords. Password, role, and active-state changes revoke
the affected user’s existing sessions immediately.

- **Administrator:** operates every Skill workflow and manages users.
- **Operator:** operates every shared Skill workflow but cannot view or call
  user-management pages and APIs.

Login IDs are normalized to lowercase. Passwords must contain 12-128 characters
and are stored only as PostgreSQL `pgcrypto` bcrypt hashes. Five failed attempts
lock that login ID for 15 minutes. SkillEd prevents self-deactivation and keeps
at least one active administrator. User-management changes are recorded in the
database audit log.

V1 accounts share the same Skill packages and the same worker Codex identity.
This is access management, not separate tenant storage or per-user Codex OAuth.

## Deterministic demo mode

Use demo mode to verify the complete UI without model calls:

```bash
SKILLED_ADAPTER_MODE=fake docker compose up -d --build
./scripts/verify-stack.sh --demo
```

Demo results are stored with `adapter: demo` and labeled as demo evidence in
the UI. They cannot be presented as real Codex results.

Return the worker to real Codex mode with:

```bash
SKILLED_ADAPTER_MODE=real docker compose up -d --no-deps --force-recreate worker
./scripts/verify-stack.sh
```

## First UI walkthrough

1. Sign in and select **Add Skill package**.
2. Upload one ZIP containing a `SKILL.md` and describe the real task.
3. Attach task materials with the correct type: dataset, authority, expected
   output, example, or past failure.
4. Resolve the Skill root if several `SKILL.md` files are found.
5. Select **Create evals**, answer only blocking material questions, and review
   the structured task understanding.
6. Approve the coverage plan, generate the cases, inspect their provenance and
   required dimensions, then approve the immutable eval version.
7. Launch a run. Each case, iteration, baseline, and agent judge receives a
   fresh Codex execution; the authoring conversation is never inherited.
8. Open a failed or partial case, inspect assertions and artifacts, then select
   **Suggest update**.
9. Review the separate update conversation and filesystem diff. Approve the
   Skill patch and independently include or reject any eval patch.
10. Verify current and candidate versions using identical settings. Activation
    remains blocked on errors or new required-dimension regressions.

Every Skill package in the left sidebar owns its versions, evals, runs,
proposals, reports, and active version. Switching packages switches the entire
workflow context.

## Session and isolation guarantees

- Eval authoring receives one durable Codex App Server thread. Answers and
  follow-up messages resume that thread.
- Skill improvement receives a different thread bound to the exact source run,
  base Skill version, and approved eval version.
- Evaluation cases never inherit either conversation. Skill-Up starts fresh
  Codex executions for cases, iterations, baseline variants, and agent judges.
- Uploaded content is staged as untrusted task material. App Server runs with
  approval policy `never`, workspace-only writes, and network disabled.
- Only completed conversation messages become durable history; streamed deltas
  are progress events.
- Jobs are sequential, leased, renewed during long turns, replayable through
  persisted SSE events, and recovered honestly after a worker restart.

SkillEd uses the Codex App Server protocol for thread start/resume, streamed
events, sandbox settings, and structured output. See the official
[Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).

## Evaluation truth rules

- `ERROR`: trustworthy evidence could not be produced or ingested.
- `FAIL`: intended task correctness failed.
- `PARTIAL`: the target correction passed but another required dimension,
  such as scope, failed.
- `PASS`: every required assertion and dimension passed.
- Flakiness is displayed separately and retains the worst observed result.
- Unmapped required assertions are `ERROR/unclassified`, never green.
- Script judges contain explicit `equals`, `contains`, or `not_contains`
  checks. If Codex cannot define a concrete deterministic check, SkillEd uses
  an agent judge instead of a non-empty-output placeholder.
- Python or shell validators are deterministic artifact judges. They do not
  perform the task in place of Codex.

## Development and verification

Host development requires Node 24 and pnpm 11.19.0:

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:3000 pnpm test:e2e
```

The normal gate uses deterministic adapters and must not receive personal Codex
credentials. Real-agent runs are explicit evidence commands:

```bash
pnpm test:real:smoke
pnpm test:real:jiomart
pnpm test:real:full
```

`test:real:full` can consume substantial model time because it includes all
cases, a baseline, repeated iterations, and agent judges.

Useful operational commands:

```bash
docker compose ps
docker compose logs -f worker
docker compose logs -f web
curl -fsS http://127.0.0.1:3000/api/v1/health
docker compose restart worker
docker compose down
```

`docker compose down` preserves named volumes. `docker compose down -v`
permanently deletes PostgreSQL records and artifacts; do not run it during
normal development or automated agent setup.

## Troubleshooting

### Health says the worker is stale

```bash
docker compose ps
docker compose logs --tail=200 worker
docker compose restart worker
```

An abandoned active job becomes `interrupted`, and its owning eval, run, or
proposal moves to a terminal failure state instead of staying stuck.

### Codex login is unavailable

```bash
codex login status
ls -l "${CODEX_AUTH_FILE:-$HOME/.codex/auth.json}"
```

The auth file must be readable and writable by Docker Desktop. If the host uses
Keychain storage, use `./scripts/create-codex-login.sh` and set the resulting
absolute `CODEX_AUTH_FILE` path in `.env`.

### Port 3000 is already used

Stop the other local service before starting SkillEd. Do not change the binding
to `0.0.0.0` for this trusted-local V1.

### A real model operation fails or times out

Inspect the failed job in the UI and the worker log. SkillEd intentionally does
not retry correctness failures. Infrastructure failures remain distinct from
Skill failures, and partial evidence is preserved.

### Rebuild after code changes

```bash
docker compose up -d --build
./scripts/verify-stack.sh
```

Database migrations are idempotently applied when web and worker start.

## Repository map

- `apps/web`: Next.js UI, route handlers, authentication, SSE, and downloads.
- `apps/worker`: sequential jobs, Codex App Server, Skill-Up execution, and
  report ingestion.
- `packages/core`: PostgreSQL schema, shared Zod contracts, ZIP safety,
  artifact storage, state machines, and result normalization.
- `skill-up`: pinned vendored Alibaba Skill-Up source, built with Go 1.25.
- `examples`: small packages and task material for local walkthroughs.
- `docs/plans`: product, architecture, UI, phase, and acceptance contracts.
- `docs/screenshots`: verified desktop, laptop, and mobile decision screens.

Product code must use the Skill-Up CLI contract and must never import
`skill-up/internal/*`.

## Handoff checklist for another coding agent

An agent taking over this repository should:

1. Read this README and `AGENTS.md`.
2. Run `git status --short`; preserve unrelated or local user files.
3. Run `./scripts/preflight.sh` before changing container configuration.
4. Start in demo mode for deterministic development and browser tests.
5. Keep auth files, uploaded customer data, reports, and test workspaces out of
   Git. The relevant paths are ignored.
6. Never weaken `PARTIAL`, `ERROR`, provenance, or assertion-mapping rules to
   make a score green.
7. Use App Server for resumable authoring/update conversations and Skill-Up for
   isolated evaluation. Do not reuse authoring history inside a case run.
8. Rebuild and run `./scripts/verify-stack.sh`, typechecks, core tests, and the
   desktop/mobile Playwright suite before handing off.
9. Switch the final local worker back to real mode only after deterministic
   tests have finished.
10. Report which checks were deterministic and which used real Codex.

## Product and implementation references

- [Product contract](docs/plans/00-product-context.md)
- [Package contract](docs/plans/01-skill-structure.md)
- [UI flow](docs/plans/02-mvp-user-flow.md)
- [Architecture](docs/plans/03-technical-architecture.md)
- [Data and API](docs/plans/04-data-and-api-contracts.md)
- [UI execution](docs/plans/ui-design-execution.md)
- [Acceptance scenarios](docs/plans/acceptance/end-to-end-scenarios.md)
- [Package intake](docs/plans/phases/01-package-intake.md)
- [Eval authoring](docs/plans/phases/02-eval-authoring.md)
- [Evaluation](docs/plans/phases/03-cloud-evaluation.md)
- [Skill improvement](docs/plans/phases/04-upgrade-and-versioning.md)

## V1 boundaries

- Private, trusted, named local accounts sharing one installation.
- Multiple independent Skill packages; one selected workflow context at a time.
- Sequential jobs and filesystem-backed artifacts.
- Administrator and operator roles; no teams, organizations, or tenant-level
  data partitioning.
- One existing worker Codex login; no per-user API-key or OAuth UI.
- ZIP upload only.
- No public arbitrary-code execution, billing, marketplace,
  GitHub sync, live MCP, arbitrary dependency installation, or open internet
  tools.
