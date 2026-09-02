# Phase 3 — Cloud Skill-Up Execution and Results

## Objective

Run approved suites against exact Skill versions using Codex in a bounded cloud
workspace and present trustworthy evidence entirely in the UI.

## Deliverables

- Serialized evaluation queue for the already-authenticated Codex worker.
- Pinned standard image containing Codex, Skill-Up, Python, Node.js, Git, and
  approved artifact libraries.
- Fresh workspace materialization, checksum verification, job-local Skill
  installation, resource limits, cleanup, cancellation, retries, and recovery.
- Skill-Up CLI adapter supporting Codex, rule/script/agent judges, iterations,
  optional without-Skill baseline, and structured JSON/HTML artifacts.
- Strict separation of authoring, tested-agent, and semantic-judge context.
- Transactional report ingestion and SSE run progress.
- Result summary and per-case deep dive for target correctness, semantic
  completeness, unsupported claims, invariant/scope preservation, artifact
  validity, stability, latency, tokens, errors, outputs, and transcripts.

## Acceptance gate

1. Run the uploaded JioMart-style file task end to end without a terminal.
2. Prove each case and semantic judge has an isolated session.
3. Preserve and expose Skill-Up raw reports while normalizing results
   idempotently.
4. Show target repair and unrelated drift independently; no false-green rollup.
5. Repeat cases and visibly classify inconsistent outcomes.
6. Survive timeout, Codex rate limit, worker restart, cancellation, malformed
   report, and cleanup failure without double counting.
7. Prove agent-executed tools cannot read or copy the Codex credential store,
   sibling jobs, host files, Docker socket, or undeclared public endpoints.
