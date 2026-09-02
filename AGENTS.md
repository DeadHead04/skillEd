# SkillEd agent handoff

## Start here

Read `README.md` before modifying or running the system. Run:

```bash
git status --short
./scripts/preflight.sh
```

Use demo mode for deterministic development:

```bash
SKILLED_ADAPTER_MODE=fake docker compose up -d --build
./scripts/verify-stack.sh --demo
```

Do not run real-agent suites unless the task explicitly needs real Codex
evidence. Before handoff, return the worker to the mode requested by the user.

## Non-negotiable contracts

- Preserve user files and unrelated worktree changes.
- Never read, print, copy, commit, or place `auth.json` in an artifact.
- Never expose the Compose stack publicly. The web binding stays on
  `127.0.0.1`; PostgreSQL stays private.
- Never import `skill-up/internal/*`; invoke the pinned Skill-Up binary.
- Eval authoring and Skill improvement use separate durable App Server threads.
- Each eval case, iteration, baseline variant, and agent judge starts fresh.
- Hidden expected answers and authoring history never enter tested-agent
  workspaces.
- `PARTIAL`, `ERROR`, flakiness, scope drift, and judge failures stay distinct.
- Unmapped required assertions are errors. Do not create placeholder
  non-empty-output validators.
- Skill versions, approved eval versions, completed runs, and decided proposals
  are immutable.
- Activation is always explicit and follows candidate verification.
- Do not run `docker compose down -v` without explicit user approval.

## Required checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:3000 pnpm test:e2e
docker compose up -d --build
./scripts/verify-stack.sh
git diff --check
```

If host pnpm is unavailable, the Docker build still provides the authoritative
production build check. Clearly report any check that could not run.
