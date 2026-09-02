# SkillEd

SkillEd is a UI-first workspace for Agent Skills. The implemented Phase 1 lets a
GitHub-authenticated user import, validate, catalog, search, and safely inspect
immutable Skill packages without executing package content.

Phase 1 includes:

- workspace-isolated GitHub authentication with one `user` role;
- GitHub App imports for authorized public/private repositories;
- bounded ZIP and browser-folder imports;
- Agent Skills frontmatter, structure, reference, and compatibility validation;
- immutable local artifacts with commit/checksum version identity;
- catalog search, validation/source filters, sorting, and pagination;
- import progress, candidate selection, duplicate detection, and findings;
- Skill Overview and safe Files inspection;
- intentionally empty Tests, Runs, and Statistics tabs.

Skill editing, evaluation, model calls, test creation, releases, relationships,
telemetry, Skill Upper chat, and Skill-Up execution are not part of Phase 1.

## Repository contents

- [`docs/plans/`](docs/plans/00-product-context.md) contains the decision-ready
  product, architecture, phase, and acceptance plans.
- [`design/`](design/skillup-design/index.html) contains the supplied visual
  references plus the four generated Phase 1 references under
  [`design/phase-1/`](design/phase-1/01-skill-catalog.png).
- [`apps/web/`](apps/web/package.json) contains the Next.js UI, authentication,
  and HTTP APIs.
- [`apps/worker/`](apps/worker/package.json) contains the PostgreSQL-backed
  asynchronous import worker.
- [`packages/`](packages/domain/package.json) contains shared domain, database,
  GitHub App, scanner, and artifact-store modules.
- [`skill-up/`](skill-up/README.md) is a clean internal copy of Alibaba
  Skill-Up pinned to commit `6da1264f626661b4b649569469cb3e8212e723da`.
- [`THIRD_PARTY.md`](THIRD_PARTY.md) records upstream attribution and license
  information.

## Planning index

- [Product context](docs/plans/00-product-context.md)
- [Skill package structure](docs/plans/01-skill-structure.md)
- [MVP user flow](docs/plans/02-mvp-user-flow.md)
- [Technical architecture](docs/plans/03-technical-architecture.md)
- [Data and API contracts](docs/plans/04-data-and-api-contracts.md)
- [End-to-end acceptance](docs/plans/acceptance/end-to-end-scenarios.md)

Implementation should follow the numbered phase plans under
[`docs/plans/phases/`](docs/plans/phases/01-skill-catalog.md).

## Local Phase 1 setup

Requirements: Node.js 24, Corepack/pnpm 11, and Docker.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d --wait postgres
pnpm db:migrate
```

For local UI-only development, set `DEV_AUTH_BYPASS=true` in `.env`. Run these
in separate terminals:

```bash
pnpm dev
pnpm dev:worker
```

Open `http://127.0.0.1:3000/login`. Real GitHub sign-in/import additionally
requires the GitHub OAuth and GitHub App values documented in `.env.example`.

To run the whole local stack in containers instead, use:

```bash
docker compose --profile app up --build
```

The web and worker containers share only the bounded import/artifact runtime
volume; PostgreSQL uses its own volume.

## Verification

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm secrets:check
git diff --check
```

Unit tests do not require PostgreSQL. Integration and browser tests use the
Compose database and deterministic local/mock fixtures; they do not require
GitHub credentials or internet access.

## Upstream boundary

Skill-Up remains an untouched, attributed internal fork in Phase 1 and is not
invoked by this application. Future evaluation work must use supported upstream
contracts rather than importing `skill-up/internal/*` from product code.
