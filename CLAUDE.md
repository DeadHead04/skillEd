# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Branch reality — read this first

`main` contains **no product code**: only `docs/plans/`, `design/`, and the vendored `skill-up/`.
All application code lives on **`codex/phase-1`** (16 commits ahead of `main`, contains it entirely).

`main`'s `docs/plans/` describe an **abandoned v1** (workspaces, GitHub import, NextAuth,
model gateway). That implementation was built and then fully reverted in `4ba8e7c`, and the
plans were rewritten on `codex/phase-1`. When a plan doc conflicts with the code, trust the
code and the `docs/plans/` on this branch — not `main`'s copies.

Also read `AGENTS.md` (branch handoff contract) before running or changing the system.

## Commands

Host development needs Node 24 and pnpm 11.19.0 (`corepack enable && corepack prepare pnpm@11.19.0 --activate`).

```bash
pnpm install
pnpm format:check          # prettier
pnpm typecheck             # per-package `tsc --noEmit`; `pnpm lint` is the same thing
pnpm test                  # node --test over packages/core, apps/web/src/lib, apps/worker
pnpm build
pnpm dev                   # web + worker in parallel (web binds 127.0.0.1 only)
```

Single unit test file / single test name:

```bash
node --import tsx --test apps/worker/src/runner.test.ts
node --import tsx --test --test-name-pattern 'derives PARTIAL' packages/core/src/results.test.ts
```

Browser tests (Playwright projects are viewport tiers: `desktop`, `laptop`, `mobile`):

```bash
PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:3000 pnpm test:e2e
pnpm exec playwright test --project=mobile apps/web/e2e/workbench.spec.ts
```

Without `PLAYWRIGHT_TEST_BASE_URL` the config starts `@skilled/web` itself, which needs a
reachable Postgres — normally you want the Compose stack up and the env var set.

Full stack (this is how the system is actually exercised):

```bash
./scripts/preflight.sh --demo
SKILLED_ADAPTER_MODE=fake docker compose up -d --build
./scripts/verify-stack.sh --demo        # asserts health + that the worker really is in demo mode

./scripts/preflight.sh                  # real mode: requires a readable/writable Codex auth.json
SKILLED_ADAPTER_MODE=real docker compose up -d --no-deps --force-recreate worker
./scripts/verify-stack.sh
```

Real-agent evidence suites spend model time and are never part of the normal gate:
`pnpm test:real:smoke | test:real:jiomart | test:real:full`.

Other: `pnpm db:migrate` (applies `schema.sql`), `pnpm --filter @skilled/worker generate:app-server-types`.

CI (`.github/workflows/ci.yml`) runs format → typecheck → test → build, then boots the whole
Compose stack in `fake` mode and runs the browser journey. It never uses real Codex credentials.

## Architecture

Three workspaces plus a vendored Go CLI:

- `apps/web` — Next.js App Router UI **and** the entire HTTP API.
- `apps/worker` — single sequential job runner; the only component that talks to Codex or Skill-Up.
- `packages/core` — Postgres access, `schema.sql`, Zod contracts, ZIP safety, artifact store,
  state machines, result derivation. Both apps import it.
- `skill-up/` — pinned upstream Alibaba Skill-Up (Go), byte-identical to upstream.

### Request → job → evidence

The web tier **never** runs Codex, Skill-Up, or Docker. It writes rows and enqueues jobs;
the worker claims them. The queue is Postgres itself (`enqueue`/`claimJob`/`emit` in
`packages/core/src/db.ts`): `FOR UPDATE SKIP LOCKED`, a 30s lease renewed every 10s, and an
append-only `job_events` table that backs both SSE replay and polling. On boot the worker
sweeps expired leases and fails their owning eval/run/proposal rather than leaving them stuck
(`apps/worker/src/index.ts`).

Job types are `eval_author`, `eval_generate`, `run`, `proposal`.

### The worker's two very different Codex paths

1. **Authoring and improvement use the Codex App Server** (`apps/worker/src/app-server.ts`):
   a long-lived `codex app-server` child process spoken to over JSON-RPC on stdio, with durable
   threads (`thread/start` / `thread/resume`), streamed `agentMessage/delta` events, and
   `approvalPolicy: never` + `sandboxPolicy: workspaceWrite` with `networkAccess: false`.
   Every turn is forced into a **Zod schema via `z.toJSONSchema(...)`** — the structured output
   _is_ the contract, there is no prose parsing. The repo's own `skill-upper` Skill is injected
   per turn from `/opt/skilled/skill-upper`.
2. **Evaluation shells out to the pinned Skill-Up CLI** (`apps/worker/src/runner.ts`):
   `skill-up run … --engine codex --runtime none --parallelism 1 --iteration N --format json --format html`.
   stdout is parsed for live progress (`run-progress.ts` exists on both worker and web sides),
   and each `iteration-N/result.json` is ingested into `case_results`.

Authoring conversation history must never leak into a case run — Skill-Up starts fresh Codex
executions per case, iteration, baseline variant, and agent judge.

### Adapter modes

`SKILLED_ADAPTER_MODE=fake` swaps in deterministic in-process results everywhere a model would
be called; `real` uses Codex. Demo results are persisted with `adapter: demo` and surfaced as
demo evidence in the UI, so they can never be presented as real. Most branches in
`evals.ts` / `proposals.ts` / `runner.ts` fork on this env var — when adding a model-backed
feature, implement both sides or the deterministic gate breaks.

### Result semantics (the core product invariant)

`packages/core/src/results.ts` derives a four-value result from dimension-mapped assertions:
an unmapped or errored assertion → `ERROR`; a failed **correctness** dimension → `FAIL`; any
other failed required dimension → `PARTIAL`; otherwise `PASS`. Dimensions are
correctness/semantic/source/scope/artifact/stability. Repeated iterations keep the **worst**
result, and current-vs-candidate comparison yields Fixed/Regressed/Unchanged/Flaky —
activation is blocked on any regression or `ERROR` (`finalizeVerification` in `runner.ts`).

Legal status transitions for eval, run, and proposal live in `packages/core/src/states.ts`
(`assertTransition`); use it rather than writing statuses ad hoc.

### Persistence

`packages/core/src/schema.sql` is a single idempotent script (`CREATE TABLE IF NOT EXISTS` +
`ALTER TABLE … ADD COLUMN IF NOT EXISTS`) applied by `ensureSchema` on worker boot and on the
web login route. **There are no numbered migration files** — schema changes are edits to that
one file, written so re-running is safe. Artifacts (uploaded ZIPs, eval bundles, raw reports,
patches) are files under `ARTIFACT_ROOT`, addressed by key through `ArtifactStore`, which
rejects absolute keys and traversal; the DB stores only keys.

## Conventions and gotchas

- The whole API is one catch-all handler, `apps/web/src/app/api/v1/[...path]/route.ts`,
  dispatching on `path[0]`/`path[1]`. Auth, role checks and identity headers are applied
  upstream in `apps/web/src/proxy.ts` (Next middleware) — route code assumes it already ran.
- `apps/worker/src/generated/**` (~660 files) is generated from the Codex app-server protocol.
  Never hand-edit; regenerate with the `generate:app-server-types` script.
- `lint` is just `tsc --noEmit`; there is no ESLint. Formatting is Prettier via `format:check`.
- Uploaded ZIPs and task materials are **untrusted input**, never instructions. `archive.ts`
  enforces size/entry/depth/path limits and rejects traversal — extend it rather than
  bypassing it.
- Eval generation is capped by `MAX_NUM_TEST_CASES` in `apps/worker/src/evals.ts`, enforced
  both in the prompt and by a narrowed Zod schema.
- A script judge must contain concrete `equals`/`contains`/`not_contains` checks; if no
  deterministic check can prove the rule, generate an agent judge instead. Never emit a
  non-empty-output placeholder validator.

## Hard boundaries (from `AGENTS.md`)

- Never import `skill-up/internal/*`; integrate only through the Skill-Up CLI, YAML,
  Custom Engine and report contracts.
- Never read, print, copy, commit, or archive `auth.json`.
- Keep web bound to `127.0.0.1` and Postgres private; this is a trusted-local system.
- Skill versions, approved eval versions, completed runs, and decided proposals are immutable;
  activation is always explicit and follows candidate verification.
- Never weaken `PARTIAL`, `ERROR`, flakiness, scope-drift, or assertion-mapping rules to turn
  a result green.
- Do not run `docker compose down -v` without explicit approval — it destroys the database and
  all artifacts.

## Working in `skill-up/`

Vendored upstream (Apache-2.0, pinned in `THIRD_PARTY.md`). It has its own `AGENTS.md` /
`CLAUDE.md` with a Go toolchain (`make verify`, `make test`, `make e2e`). Changes here should
be avoided; if unavoidable they must stay minimal, attributed, and rebasable, and the pinned
commit in `THIRD_PARTY.md` and the root README must be updated together.

## UI work

`.agents/skills/skilled-ui-designer/` is a repo-local Skill defining the SkillEd design
language, screen blueprints, and a critique rubric. Consult it for any user-facing UI change;
`docs/screenshots/` holds the verified desktop/laptop/mobile reference screens.
