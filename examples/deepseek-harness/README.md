# DeepSeek Harness Custom Engine example

This example runs a stateful, multi-turn Skill evaluation through DeepSeek
Harness (DSH) using skilled's local Custom Engine contract. It defaults to
DashScope's `qwen3.8-max` model and keeps the API key in the process
environment.

## Prerequisites

- Node 24.21.0 and this TypeScript checkout built with `npm ci && npm run build`
- `dsh` available on `PATH`
- `DASHSCOPE_EVAL_API_KEY` available in the environment

The source example targets this pinned DSH version:

```bash
npm install -g @deepseek-ai/dsh@0.1.5-rc.1
dsh --version
```

## Run

From this repository checkout:

```bash
export DSH_SKILLED_RUNNER="$PWD/dist/examples/deepseek-harness/evals/fixtures/dsh_runner.js"
node dist/src/bootstrap.js run ./examples/deepseek-harness/evals/eval.yaml
```

The example deliberately does not put the DashScope key in YAML. Inject it
from your secret manager or shell environment. To select another compatible
Qwen model, pass `--model <model-name>` to `skilled run`. Override
`DASHSCOPE_BASE_URL` to use another compatible endpoint.

The runner creates a fresh `.skilled-dsh/runs/<run-id>/` home for every case
attempt, disables DSH telemetry, configures the DashScope OpenAI-compatible
route, and exposes the installed Skill directory to DSH. It drives DSH through
the public ACP profile: the first turn creates a persistent DSH session, and
later invocations resume that exact session using skilled's opaque
`session_id`. Each invocation returns an incremental structured
`SessionResult`, including tool calls, tool results, and token counts.

The bundled case uses two turns. The first asks the installed Skill to decode a
fixture; the second requires DSH to recall that result from the resumed session.
DSH session JSONL, ACP frames, and stderr are retained as run artifacts for
debugging after injected credentials are redacted.

This is an experimental local integration. MCP installation is not included.

The bridge is TypeScript compiled to JavaScript and invokes DSH over ACP using Node. Set `DSH_SKILLED_NODE` to override the Node executable. Local tests cover real subprocess failures, timeouts, cleanup, and source helper comparisons. Authenticated DSH/model success has not been rerun for this candidate; the model and endpoint defaults are retained from the source example.
