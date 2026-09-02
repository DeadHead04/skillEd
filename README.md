# SkillEd

SkillEd is a UI-only tool for testing and improving one Agent Skill package at
a time.

The v1 flow is:

```text
Upload Skill ZIP and task files
→ Codex + skill-upper understands the task and creates evals
→ user reviews and approves the evals
→ Skill-Up runs the evals with Codex in the cloud
→ user reviews results and failure evidence
→ Codex + skill-upper proposes a Skill update
→ user approves or rejects it
→ Skill-Up verifies the candidate against the same evals
→ user downloads or activates the improved Skill
```

Users never need a terminal or edit Skill-Up YAML directly.

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
