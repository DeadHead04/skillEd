# User simulator example

This example exercises both ways to generate user replies: a `respond` turn
between fixed turns, and an autonomous conversation where the simulator
chooses the later messages and when to stop. In both cases the evaluator
enforces `max_turns`, and the rule-based judge checks the final answer.

`evals/eval.yaml` runs both cases with local OpenCode and
DashScope's `qwen3.8-max` for both the agent and simulated user. Supply
`DASHSCOPE_API_KEY` for the agent, and `SIMULATION_API_KEY` plus
`SIMULATION_BASE_URL` for the simulator through your secret manager. The
connections resolve independently even when the same authorized key is used.

With `DASHSCOPE_API_KEY` already supplied to the process:

```bash
npm run build
export SIMULATION_API_KEY="$DASHSCOPE_API_KEY"
export SIMULATION_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
node dist/src/bootstrap.js validate ./examples/user-simulator/evals/eval.yaml
node dist/src/bootstrap.js run ./examples/user-simulator/evals/eval.yaml
```

Install OpenCode before using the `none` runtime.
The source implementation recorded successful OpenCode 1.14.24 and Qwen3.8-Max runs: the mixed conversation used three turns and the autonomous conversation used two turns before stopping, with shared session IDs within each case. These are historical observations, not fixed expectations or authenticated verification of this TypeScript candidate.

The mixed case expects the final correction to three replicas; the autonomous case expects two replicas and an explicit simulator stop. Inspect transcript `source` / `stop_reason` fields when diagnosing a failure. Local candidate tests validate the configuration and exercise the production simulator protocol without billing a live model. Running this example end to end requires your configured service and credentials.

`evals/eval-anthropic.yaml` runs the same cases with Anthropic Messages for the
simulator. The agent keeps its independent Chat Completions connection:

```bash
export SIMULATION_BASE_URL=https://dashscope.aliyuncs.com/apps/anthropic
node dist/src/bootstrap.js validate ./examples/user-simulator/evals/eval-anthropic.yaml
node dist/src/bootstrap.js run ./examples/user-simulator/evals/eval-anthropic.yaml
```

The source also recorded successful runs against DashScope's Messages-compatible endpoint. Anthropic's official endpoint and authenticated execution of this candidate remain unverified. The original Go E2E commands are archived in the pinned reference checkout; use the TypeScript CLI commands above for this implementation.
