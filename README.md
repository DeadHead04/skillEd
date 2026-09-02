# SkillEd

SkillEd is a private local workbench for testing and improving one Agent Skill
package at a time. The browser is the entire product surface; Codex App Server
and Skill-Up run behind a sequential worker.

The v1 flow is:

```text
Upload Skill ZIP and task files
→ Codex + skill-upper understands the task and creates evals
→ user reviews and approves the evals
→ Skill-Up runs the evals with Codex in an isolated worker operation directory
→ user reviews results and failure evidence
→ Codex + skill-upper proposes a Skill update
→ user approves or rejects it
→ Skill-Up verifies the candidate against the same evals
→ user downloads or activates the improved Skill
```

Users never need a terminal or edit Skill-Up YAML directly.

## Run it

Requirements: Docker Desktop and an existing ChatGPT login in Codex CLI.

```bash
codex login status
docker compose up --build
```

Open `http://127.0.0.1:3000`. Compose starts only `web`, `worker`, and
`postgres`; PostgreSQL is not published to the host. The worker receives only
the existing `~/.codex/auth.json` mount, not the rest of `~/.codex`. If Codex
uses Keychain storage instead, set `CODEX_AUTH_FILE` to a SkillEd-specific
Codex home after completing one browser login.

For a deterministic walkthrough without model calls:

```bash
SKILLED_ADAPTER_MODE=fake docker compose up --build
```

This credential arrangement is for one trusted local user. Do not expose this
Compose stack as a public arbitrary-code service.

## Verification

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Normal CI uses deterministic adapters and never receives personal Codex
credentials. Real evidence runs are explicit: `pnpm test:real:smoke`,
`pnpm test:real:jiomart`, and `pnpm test:real:full`.

The result model keeps correctness, semantics, grounding, scope, artifact
validity, stability, duration, and token use separate. A correction that adds
unrelated drift is `PARTIAL`, and an unclassified assertion is `ERROR`; neither
can become a green pass.

## Source layout

- `apps/web`: Next.js route handlers, SSE, and Precision Workbench UI.
- `apps/worker`: leased sequential jobs, Codex App Server, and Skill-Up.
- `packages/core`: PostgreSQL schema, shared Zod contracts, ZIP safety,
  artifacts, state machines, and result normalization.
- `skill-up`: pinned vendored CLI source, built with Go 1.25 in the worker.

## V1 constraints

- ZIP upload only.
- One Skill is selected from each upload.
- One private Codex account is already logged in on the worker.
- Jobs run sequentially.
- The uploaded package, generated evals, results, and Skill versions are stored.
- Live MCP servers, arbitrary internet access, and arbitrary dependency
  installation are not supported.

## Plans

- [Product contract](docs/plans/00-product-context.md)
- [Package contract](docs/plans/01-skill-structure.md)
- [UI flow](docs/plans/02-mvp-user-flow.md)
- [Architecture](docs/plans/03-technical-architecture.md)
- [Data and API](docs/plans/04-data-and-api-contracts.md)
- [UI design and build execution](docs/plans/ui-design-execution.md)
- [Acceptance](docs/plans/acceptance/end-to-end-scenarios.md)

Build order:

1. [Package intake](docs/plans/phases/01-package-intake.md)
2. [Eval creation](docs/plans/phases/02-eval-authoring.md)
3. [Cloud evaluation](docs/plans/phases/03-cloud-evaluation.md)
4. [Skill improvement](docs/plans/phases/04-upgrade-and-versioning.md)

The repository contains a pinned copy of Alibaba Skill-Up. SkillEd uses its CLI,
YAML, judge, engine, and report interfaces; product code must not import
`skill-up/internal/*`.
