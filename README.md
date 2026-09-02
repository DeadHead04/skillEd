# SkillEd

SkillEd is a UI-only workspace for evaluating and improving one Agent Skill
package at a time. A user uploads a Skill ZIP plus optional task descriptions,
sample inputs, expected outputs, datasets, or prior failures. SkillEd uses
Codex with the bundled `skill-upper` Skill to understand the package, ask
questions, and author an evaluation suite. It then uses the pinned Skill-Up CLI
with the Codex engine to run the suite in a cloud worker, ingest evidence, and
propose reviewable upgrades.

The v1 loop is:

> Upload package and task evidence → understand → generate evals → approve →
> run Codex through Skill-Up → inspect failures → propose update → approve →
> verify candidate → activate or download

Everything is available from the web UI. Users do not edit YAML, invoke a CLI,
or access the worker directly.

## V1 boundaries

- One active Skill package at a time; immutable versions remain available for
  comparison and download.
- ZIP upload is the required source. GitHub synchronization is deferred.
- A private, trusted-user deployment uses one already-authenticated Codex
  worker with serialized jobs.
- Package references, assets, fixtures, and supported Python/Node scripts may
  be exercised in an isolated workspace.
- Arbitrary live MCP servers, unrestricted internet access, public multi-tenant
  uploads, autonomous promotion, and billing are deferred.
- Every generated eval suite and every candidate Skill update requires explicit
  user approval before it becomes authoritative.

## Repository contents

- [`docs/plans/`](docs/plans/00-product-context.md) contains the v1 product,
  architecture, data, phase, and acceptance contracts.
- [`design/`](design/skillup-design/index.html) contains exploratory visual
  references, not implementation requirements.
- [`skill-up/`](skill-up/README.md) is the pinned upstream evaluation engine.
- [`THIRD_PARTY.md`](THIRD_PARTY.md) records attribution and licensing.

## Planning index

- [Product context](docs/plans/00-product-context.md)
- [Skill package and compatibility](docs/plans/01-skill-structure.md)
- [V1 UI journey](docs/plans/02-mvp-user-flow.md)
- [Technical architecture](docs/plans/03-technical-architecture.md)
- [Data and API contracts](docs/plans/04-data-and-api-contracts.md)
- [End-to-end acceptance](docs/plans/acceptance/end-to-end-scenarios.md)

Implementation follows the numbered documents under
[`docs/plans/phases/`](docs/plans/phases/01-package-intake.md).

## Upstream boundary

SkillEd invokes Skill-Up only through its supported CLI, YAML, engine, judge,
runtime, and structured-report contracts. Product code must not import
`skill-up/internal/*`. The upstream copy must remain attributable and easy to
update.
