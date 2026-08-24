# SkillEd Product Context

## Purpose

SkillEd is a lifecycle workspace for Agent Skills. It combines a Skill editor
and catalog with Skill-Up-backed evaluation and Langfuse-like run analytics.
It is not a general LLM observability platform in the first release.

The immediate product loop is:

> Import → discover → inspect → author tests → run with/without Skill → compare
> evidence → improve

## First-release outcome

A permitted workspace user can:

1. Import one or multiple Skills from GitHub or an uploaded archive.
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

## Users and responsibilities

| User | Primary work |
| --- | --- |
| Skill author | Imports a Skill, fixes validation problems, creates tests, and reviews failures. |
| Reviewer | Checks test quality and compares evidence before accepting a new version. |
| Consumer | Searches the catalog and determines whether a Skill is understandable and tested. |
| Workspace administrator | Controls membership, model credentials, retention, and run limits. |

Humans own expected behavior and promotion decisions. SkillEd performs
structural validation, deterministic grading, comparison, and aggregation.
Agent-assisted test generation and Skill rewriting are deferred until the
manual workflow is reliable.

## Product boundary

Skill-Up already supplies declarative suites and cases, with-Skill versus
without-Skill variants, agent/custom engines, judges, runtimes, and structured
reports. SkillEd will reuse those capabilities rather than reimplement the
evaluator.

SkillEd owns:

- Workspaces, users, and authorization.
- Import, catalog, search, and stable Skill identity.
- Immutable Skill and suite snapshots.
- UI-based test authoring and policy validation.
- Job scheduling and secure container orchestration.
- Model-gateway policy and credential isolation.
- Report ingestion, normalized results, cost calculation, and statistics.
- GitHub synchronization and later release/package workflows.

Skill-Up owns:

- Evaluation configuration loading and validation.
- Installing the selected Skill into a run workspace.
- Running with-Skill and without-Skill configurations.
- Assertion execution, grading, benchmark generation, and reports.
- Standard `SessionInput` and `SessionResult` contracts for custom engines.

Product code must not import `skill-up/internal/*`. Integration is through the
supported CLI/config/report boundary so the upstream copy can be updated.

## Locked MVP decisions

- UI-first; no user-facing CLI is required.
- Tests are single-turn and response-only initially.
- The model is sent no tool definitions and any tool-call transcript entry is a
  policy failure.
- Only the main `SKILL.md` instructions are evaluated. Scripts are not run and
  references/assets are not automatically injected.
- Deterministic text and regular-expression assertions are supported first.
- Each run pairs the with-Skill and without-Skill variants.
- OpenAI is reached only through an internal gateway; evaluation containers do
  not receive provider keys or general internet access.
- Git commits or upload checksums pin Skill versions; run inputs are immutable.
- Native agent routing/trigger selection is not measured. The UI reports
  `Not measured`, consistent with the open upstream
  [routing proposal](https://github.com/alibaba/skill-up/issues/166).

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

1. **Evidence over a single score.** Always expose case output, assertion
   evidence, errors, sample count, and comparison arm.
2. **Immutable comparisons.** A result is meaningful only when Skill, tests,
   model, engine, and runner versions are pinned.
3. **Honest unsupported states.** Do not infer trigger selection, auxiliary-file
   coverage, or semantic correctness when the run cannot prove it.
4. **Portable Skills and tests.** Keep product infrastructure and secrets out of
   the Skill repository; materialize standard Skill-Up YAML.
5. **Secure by construction.** Users cannot supply arbitrary commands, images,
   network destinations, engines, or judge scripts in the first release.
