# Phase 3 — Isolated Response-Only Evaluation

## Objective

Execute frozen suites through Skill-Up in hardened containers while ensuring
the model can produce text but cannot call tools or access the internet.

## Execution design

The worker starts one fresh container per logical suite run. Inside it:

1. Verify the Skill package and suite checksums.
2. Materialize the Skill root and standard Skill-Up YAML.
3. Add an ephemeral eval overlay selecting `skilled-response`.
4. Invoke pinned Skill-Up with with-Skill and without-Skill configurations.
5. Skill-Up installs the Skill for the with-Skill variant; `evals/` remains
   excluded.
6. The response runner reads root `SKILL.md` only for the with-Skill variant.
7. The runner calls the internal model gateway without tools.
8. Skill-Up performs deterministic checks and emits structured reports.
9. The worker uploads artifacts, ingests results, and destroys the container.

Skill-Up uses its `none` runtime inside the already isolated outer container.
This avoids Docker-in-Docker and gives the worker a single security boundary to
manage.

## Response-runner contract

Input is Skill-Up `SessionInput`. Output is `SessionResult` containing:

- Engine and model identifiers.
- Exit code.
- Duration.
- Input and output token usage.
- Final assistant message.
- Minimal user/assistant transcript.
- No tool calls or generated-file artifacts.

Prompt composition is fixed and versioned:

- Platform developer policy: response-only; no tools.
- With-Skill developer content: parsed Skill name, description, and Markdown
  body.
- Without-Skill: no Skill content.
- User content: the test prompt unchanged.

References, scripts, assets, `evals/`, and unknown files are not sent to the
model. A returned tool-call record, if any, makes that execution fail policy
even if content assertions pass.

## Model gateway and credentials

- Evaluation containers receive a short-lived run token and internal gateway
  URL, never an OpenAI key.
- The token is scoped to one workspace, run, allowed model, maximum calls, and
  expiry.
- The gateway rejects tools, unsupported endpoints/models, oversized input,
  excess calls, and expired/replayed tokens.
- Platform-managed and workspace BYOK credentials resolve only within the
  gateway.
- Usage and provider request IDs are returned; credential values are redacted.

## Container controls

- Image digest allowlist.
- Non-root execution, read-only root, writable bounded workspace/tmp.
- CPU, memory, process, output, and wall-clock limits.
- Capabilities dropped; no-new-privileges; no host namespace or device access.
- No host bind mount and no Docker socket inside the evaluation container.
- Internal network shared only with the gateway; no direct external route.
- Automatic cleanup plus orphan reconciliation.

The worker is the only component allowed to control Docker. Web/API processes
only enqueue jobs.

## Job and retry policy

- One run expands to cases × two variants × iterations.
- Default iterations: 1; allowed values: 1, 3, 5.
- Provider 429 and transient 5xx errors retry within configured limits and are
  recorded as attempts.
- Invalid snapshots, policy failures, assertion failures, and unsupported model
  choices do not retry.
- Cancellation stops future executions, terminates current work, retains
  completed results, and cleans the container.
- Worker lease expiry permits safe retry without double-counting results.

## Parallel work

- Track A: response runner and contract tests with a fake gateway.
- Track B: gateway policy/auth/usage service with a fake provider.
- Track C: worker, queue lifecycle, and container hardening.
- Track D: Skill-Up overlay generation and report fixtures.

Integration first uses a deterministic fake model. Paid-model smoke testing is
the last gated step.

## Acceptance gate

1. Run one case in both variants and ingest two paired outputs.
2. Prove the with-Skill request contains `SKILL.md` and the baseline does not.
3. Prove requests contain no tool definitions.
4. Prove scripts/references/assets are not read or sent.
5. Block direct internet access from the evaluation container while allowing
   the internal gateway.
6. Prove provider keys do not appear in the container, logs, reports, or
   artifacts.
7. Enforce CPU, memory, process, timeout, and output limits.
8. Handle model timeout, 429, 5xx, malformed response, Skill-Up failure,
   cancellation, worker crash, and orphan cleanup.
9. Run multiple iterations without result collision or double counting.
10. Complete a paid OpenAI smoke run only after all fake-provider and isolation
    tests pass.
