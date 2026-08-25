# SkillEd Product Context

## Purpose

SkillEd is a lifecycle workspace for Agent Skills. It combines a Skill editor
and catalog with Skill-Up-backed evaluation and Langfuse-like run analytics.
It is not a general LLM observability platform in the first release.

The immediate product loop is:

> Import → discover → inspect → author tests → run with/without Skill → compare
> evidence → improve

## First-release outcome

A user can:

1. Import or create one or multiple Skills from GitHub or an uploaded archive.
2. Search and list imported Skills.
3. Inspect `SKILL.md`, supporting files, source provenance, and validation
   findings.
4. Create response-only tests without writing YAML.
5. Run the tests with and without the selected Skill against the same model.
6. Inspect every output and assertion result.
7. Review pass rate, baseline uplift, errors, latency, tokens, estimated cost,
   and historical runs.

The release is successful when this flow works without a terminal or manual
Skill-Up configuration.

## Product boundary

Skill-Up already supplies declarative suites and cases, with-Skill versus
without-Skill variants, agent/custom engines, judges, runtimes, and structured
reports. SkillEd will reuse those capabilities rather than reimplement the
evaluator.

SkillEd owns:

- Workspaces
- Import, catalog, search, and stable Skill identity.
- Immutable Skill and suite snapshots.
- UI-based test authoring and policy validation.
- Job scheduling and secure container orchestration.
- Model-gateway policy and credential isolation.
- Report ingestion, normalized results, cost calculation, and statistics.
- GitHub synchronization
  - And later in the project release/package workflows.

Skill-Up owns:

- Evaluation configuration loading and validation.
- Installing the selected Skill into a run workspace.
- Running with-Skill and without-Skill configurations.
- Assertion execution, grading, benchmark generation, and reports.
- Standard `SessionInput` and `SessionResult` contracts for custom engines.

Product code must NOT import `skill-up/internal/*`. Integration is through the
supported CLI/config/report boundary so the upstream copy can be updated.

## Locked MVP decisions

- UI-first; no user-facing CLI is required.
- Tests are single-turn and response-only initially.
- Only the main `SKILL.md` instructions are evaluated. Scripts are not run and
  references/assets are not automatically injected.
- Deterministic text, regular-expression and tests assertions are supported first.
- Each run pairs the with-Skill and without-Skill variants.
- Model providers are reached only through an internal gateway; evaluation containers do
  not receive provider keys or general internet access.
- Skills are versioned by Git commit hashes; run inputs are immutable.

## Explicitly deferred

- MCP and other live external tools.
- Shell, filesystem, or repository tool scenarios.
- Mocked tools and synthetic repositories.
- Script and agent judges.
- Multi-turn evaluation.
- Skill Upper chat and automated Skill/test patches.
- Relationship graphs and Skill sets.
- Deployment to managed agents.
- Production routing telemetry and drift alerts.
- Public marketplace, billing, ratings, and autonomous releases.

Deferred capabilities remain described in
[`phases/05-future-features.md`](phases/05-future-features.md), but they must not
expand the first-release schemas or screens prematurely.

## Product principles

1. **UI First Skill Management**: The user must be easily able to see and manage the skills
that they have in their system.
2. **Easy Evaluation Bench**: The user must be able to easily evaluate their skill against
parameters set by them.
3. **Versioned Skills**: The skill files are immutable, every iteration is a new version.
4. **Skill observability**: Only the evealuations run on the skill should be considered for
calculating skill metrics like average cost, latency, token usage and drift.