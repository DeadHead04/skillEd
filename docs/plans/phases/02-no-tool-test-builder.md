# Phase 2 — Response-Only Test Builder

## Objective

Allow owners/editors to create deterministic Skill-Up test suites through the
UI without learning YAML and without configuring tools, commands, or external
services.

## Supported case model

Each enabled case contains:

- Stable ID and title.
- Optional description and tags.
- One required user prompt.
- Literal checks: all required, any required, and forbidden.
- Regular-expression checks: all required, any required, and forbidden.
- Expected exit code fixed to `0`.
- Timeout selected from a workspace-approved list.

The first release excludes multi-turn input, files, repository fixtures, setup
steps, artifacts, MCP, script judge, agent judge, custom engine settings, and
arbitrary environment values.

## YAML translation

- Maintain one typed internal case model and one versioned serializer.
- Materialize standard `evals/eval.yaml` plus one file per case under
  `evals/cases/`.
- Map literals to Skill-Up `expect` and rule-based judge conditions as
  appropriate; do not duplicate an assertion in both layers.
- Validate the generated suite with the pinned Skill-Up validator before a
  snapshot is runnable.
- Generate stable ordering and formatting so identical drafts produce identical
  checksums.
- Keep SkillEd runtime overlay fields outside generated repository files.

The YAML preview is read-only in this phase. This prevents unsupported raw
fields from bypassing product policy.

## Draft and snapshot behavior

- A suite has a mutable draft revision.
- Case changes use optimistic concurrency.
- Creating a run first validates the draft, then freezes a canonical immutable
  `SuiteSnapshot`.
- Previous snapshots and results never change when the draft changes.
- Disabled cases remain in the draft but are omitted from the run snapshot.
- Empty suites and suites containing only disabled cases cannot run.

Published Git-backed tests later use branch-and-PR delivery. Phase 2 only needs
to persist drafts and snapshots; it must retain generated files so publication
does not require translating historical data again.

## UX

- Suite list on Skill detail with case count, draft state, and validation.
- Case list with tag, prompt preview, assertion count, enabled state, and order.
- Guided case form with inline examples and validation.
- Human-readable assertion preview such as “Must contain A and B; must not
  contain C.”
- Generated YAML preview and copy/download action.
- Duplicate case action for fast edge/regression creation.

## Policy validation

Reject before save or import:

- Empty prompt or assertions with empty values.
- Invalid or unbounded regular expressions.
- Duplicate case IDs.
- User-provided MCP, engine, environment, setup, file, fixture, judge-script,
  network, or command configuration.
- Template substitutions that could expose environment variables or secrets.

Legacy Skill-Up suites with unsupported fields may be displayed as
`Unsupported in response-only mode`, but they are not silently simplified or
run.

## Parallel work

- Track A: domain types, canonical serializer, and Skill-Up validation adapter.
- Track B: suite/case persistence and revision APIs.
- Track C: suite and case UI using contract fixtures.
- Track D: security fixtures for unsupported/imported YAML.

## Acceptance gate

1. Create, edit, reorder, enable/disable, duplicate, and delete cases.
2. Detect a concurrent revision conflict without losing either edit.
3. Generate deterministic YAML accepted by the pinned Skill-Up validator.
4. Round-trip every supported assertion without changing meaning.
5. Reject every excluded tool/runtime/judge field fixture.
6. Freeze a snapshot and prove later draft edits do not change its checksum.
7. Prevent a viewer from modifying a suite.
8. Preserve an unsupported imported suite without allowing it to run.
