# SkillEd

SkillEd is a UI-first workspace for managing and evaluating Agent Skills. It
uses Alibaba Skill-Up as the evaluation backend and adds a searchable catalog,
guided test authoring, isolated execution, persisted results, and Skill-level
statistics.

The first release deliberately has a narrow end-to-end scope:

1. Import and list Skills.
2. Inspect the standard Skill package and validation results.
3. Create response-only evaluation cases from a visual form.
4. Run every case with and without the Skill in an isolated container.
5. Compare outputs and review pass rate, uplift, latency, tokens, cost, and run
   history.

The model receives no tools in this release. MCP servers, shell/file tools,
repository fixtures, scripts, live integrations, and agent-native routing
measurement are deferred.

## Repository contents

- [`docs/plans/`](docs/plans/00-product-context.md) contains the decision-ready
  product, architecture, phase, and acceptance plans.
- [`design/`](design/skillup-design/index.html) contains the supplied visual
  references. They are direction, not a final component specification.
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

## Upstream boundary

SkillEd must invoke Skill-Up through its supported CLI, YAML, Custom Engine,
and structured-report contracts. Product code must not import
`skill-up/internal/*`. Product-specific changes belong in SkillEd adapters;
changes to the copied upstream source should remain minimal, attributed, and
easy to rebase.
