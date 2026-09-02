# Phase 2 — Codex and skill-upper Eval Authoring

## Objective

Turn an exact Skill version and task-evidence snapshot into a sophisticated,
reviewable Skill-Up suite through the UI.

## Deliverables

- Persistent Codex App Server process using the private worker's authenticated
  identity and the pinned `skill-upper` Skill.
- `eval_authoring` conversation records, streaming turns, waiting-for-user
  questions, structured handoff summaries, thread resume, and reconstruction.
- Structured task understanding: outcome, inputs, outputs, authorities, allowed
  changes, invariants, dependencies, failure modes, and unknowns.
- Evidence-dependent coverage plan with confidence label, case categories,
  fixture plan, judge plan, estimated executions, and reserved holdout cases.
- Isolated draft generation of `eval.yaml`, cases, fixtures, and verifier files.
- Policy scanning plus pinned `skill-up validate` before review.
- Human-readable suite editor with raw files available as a deep view.
- Explicit approval producing an immutable `EvalSnapshot`.

## Acceptance gate

1. Package-only input produces provisional tests and requests missing business
   evidence instead of inventing correctness.
2. Package plus task/files produces cases grounded in supplied evidence.
3. Closing and reopening the UI resumes or reconstructs the authoring state.
4. Generated references stay inside the snapshot and pass Skill-Up validation.
5. Rule, script, and agent judges are chosen per observable requirement.
6. User can edit/reject a case and approve an immutable snapshot.
7. Codex cannot modify the authoritative Skill version or start a paid run.
