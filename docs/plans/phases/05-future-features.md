# Phase 5 and Later — Managed Expansion

This document preserves the broader SkillEd direction without placing those
requirements into the first-release implementation. Each group begins only
after Phases 1–4 meet their acceptance gates.

## 5A — Version management and GitHub publication

- Version diff for `SKILL.md` and supporting files.
- Draft/candidate/released/deprecated version lifecycle separated from
  evidence/approval and deployment status.
- GitHub branch plus pull-request publication for Skill and `evals/` changes.
- Old-version versus candidate orchestration using the same frozen suite,
  model, environment, and iterations.
- Explicit regression gates; never reduce valid assertions merely to improve a
  score.
- `depends_on`, `part_of`, and `replaces` relationships after stable version
  identity is proven.

## 5B — Guided editor and Skill Upper

- Structured `SKILL.md` editor with metadata, instructions, examples, and edge
  case guidance.
- Chat workspace loading the upstream `skill-upper` Skill into Codex.
- Chat actions limited to an isolated draft workspace and SkillEd-approved
  operations.
- Agent can explain a Skill, propose a patch, create/repair cases, run tests,
  and interpret results.
- Every file change appears as a reviewable diff; humans accept/reject before
  saving, rerunning paid tests, or creating a GitHub PR.
- No direct write to the canonical repository or release state.

## 5C — Packaging, use, and releases

- Generic portable archive excluding evals, reports, and secrets.
- Platform adapters for Codex, Claude Code, Cursor, Qoder, and other explicitly
  supported clients.
- Checksummed release manifest, license/attribution, dependency lock, and
  reproducible build record.
- Download, copyable installation instructions, and Git-based delivery first.
- Environment/secret references and managed deployment connectors only after
  target platforms expose safe, version-aware APIs.

## 5D — Advanced evaluation

Capabilities are introduced in increasing-risk order:

1. Multi-turn response-only cases.
2. Agent semantic judge with explicit cost and human-approved rubric.
3. Selected reference files injected as declared context without model tools.
4. Mocked local tools and fixtures.
5. Local script judge in hardened containers.
6. Synthetic repositories and file/shell-capable agents.
7. Live external tools only after per-tool authorization, secret, network,
   audit, and data-loss controls are designed and approved.

Every capability needs a suite-level mode. A response-only suite must remain
response-only after advanced modes exist.

## 5E — Trigger measurement

Instruction effectiveness does not prove routing. Agent-native routing metrics
require explicit structured evidence identifying selected/loaded Skills and
mapping runtime names to immutable Skill versions.

- Supported adapters emit selected Skill/version and capture completeness.
- Unsupported or plain-text agents report `unknown` and remain outside routing
  denominators.
- Candidate/rejected Skills and selection reasons are accepted only when the
  host provides reliable events.
- Behavior, assistant claims, or reading a `SKILL.md` file never count as
  explicit selection.

This work should align with the upstream
[Skill-Up routing issue](https://github.com/alibaba/skill-up/issues/166) rather
than creating an incompatible private YAML schema prematurely.

## 5F — Production observation and drift

- SDK/OTLP ingestion tied to exact Skill/version and deployment records.
- Redacted trace exploration and configurable retention.
- Usage, pass/evaluation outcomes, error mix, latency, tokens, and cost trends.
- Trigger metrics only where explicit routing events and labels exist.
- Explainable baseline-window drift and threshold alerts; no ML anomaly system
  initially.
- Reviewed production failure can become a draft regression case.

## Expansion gates

A later capability proceeds only when:

- Its user outcome and security boundary are documented.
- Required host/agent evidence exists; unsupported states are specified.
- Data/API changes remain compatible with immutable historical runs.
- Automated isolation, credential, policy, and failure tests pass.
- UI clearly distinguishes new coverage from earlier response-only evidence.
- Human approval points and paid/external side effects are explicit.
