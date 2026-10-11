# Getting started

`skilled` evaluates Agent Skills, agents and workspaces. The `skilled-improve` workflow helps an agent inspect reports, improve the Skill or cases, and rerun the evaluation.

Start with the [CLI installer](./installation.md#install-from-github-releases). It installs a versioned `skilled` command with a bundled runtime. Run `skilled --version` and `skilled --help` to verify it.

## Optional: develop from a local checkout

Start with the TypeScript source in [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd). The CLI version is `0.1.0`. Use Node **24.21.0**, npm and Git. A private checkout requires authorized Git credentials, or use `gh repo clone DeadHead04/skillEd`:

```sh
git clone https://github.com/DeadHead04/skillEd.git
cd skillEd
npm ci
npm run build
node dist/src/bootstrap.js --version
node dist/src/bootstrap.js --help
```

The development command is `node dist/src/bootstrap.js`. An extracted self-contained archive exposes `skilled` (`skilled.cmd` on Windows), including its own Node runtime. Commands below use that installed launcher; substitute the development command when working from source.

```sh
npm run package -- --target=darwin-arm64
node scripts/verify-package.mjs artifacts/skilled_0.1.0_darwin-arm64.tar.gz
```

Choose the archive for the target machine. Available native checks cover macOS arm64 and Linux arm64 Docker; untested targets and authenticated model combinations are not certified by building an archive.

## Evaluate a Skill

Keep `SKILL.md` beside `evals/`. Case file paths and repository fixture paths are relative to that Skill root.

```text
my-skill/
  SKILL.md
  evals/
    eval.yaml
    cases/basic.yaml
```

```sh
skilled validate ./my-skill/evals/eval.yaml
skilled list-cases ./my-skill/evals/eval.yaml
skilled run ./my-skill/evals/eval.yaml --dry-run
skilled run ./my-skill/evals/eval.yaml --format json --format html --format junit
```

Actual engine/model execution needs configured credentials. Use environment variables or `~/.skilled/credentials.yaml`, and follow the [user configuration guide](./user-config.md). `--dry-run` makes no model call. Do not put real credentials in committed YAML.

## Improve from evidence

The canonical workflow is `skills/skilled-improve/SKILL.md`. Build host bundles with `npm run build` and `node scripts/package-plugins.mjs`, then install `dist/bundled-plugins/codex-skilled` or `dist/bundled-plugins/dsh-skilled` through that host's local plugin interface.

Ask the agent: “Use skilled-improve to add evaluations for this Skill, inspect failed reports, improve the Skill or its cases, and rerun.” The workflow reads the same evaluation artifacts as the CLI. It does not make a skipped or unavailable check pass.

## Examples

From the checkout, validate and list the included `examples/code-stats/evals/eval.yaml`, `examples/deepseek-harness/evals/eval.yaml`, or `examples/user-simulator/evals/eval.yaml`. Their README files describe the required agents and credentials. The DSH example uses a compiled TypeScript ACP bridge. Go files inside the code-statistics fixture are sample input, not application dependencies.

## Verification boundaries

Real local processes, Docker, OpenSandbox, MCP, reports, event logs and plugin services have separate recorded checks. Live authenticated model calls require an agreed model and spending limit. The tested OpenSandbox execd 1.0.16 removes stdout line separators, affecting glob artifact collection in both implementations; direct downloads and reports remain covered.

## Core concepts

To evaluate a Skill with skilled you need two things:

1. **eval.yaml** — the entrypoint config that declares the runtime environment, the Agent Engine and model, and the global grading strategy.
2. **case.yaml** — a single evaluation case that defines the prompt sent to the Agent, the expected output, and grading rules.

They live inside the `evals/` folder of your Skill:

```text
my-skill/
  SKILL.md              # Your Skill definition
  evals/                # Evaluation root
    eval.yaml           # Entrypoint config
    cases/              # One file per case
      basic-test.yaml
      edge-case.yaml
    fixtures/           # Optional test resources
      repos/            # Repository templates
      scripts/          # Grading scripts
```

---

## 5-minute quick start

### Step 1 — Create the eval config

Inside your Skill directory, create `evals/eval.yaml`:

```yaml
schema_version: v1alpha1

environment:
  type: none                    # Plain-text Skills don't need an isolated container

engine:
  name: claude_code             # Use Claude Code as the Agent Engine

cases:
  files:
    - evals/cases/hello-world.yaml
```

> **Tip:** When `evals/eval.yaml` lives under a directory that contains `SKILL.md`, skilled installs the current Skill automatically. The omitted fields use defaults: JSON report output, `timeout_seconds: 300`, `max_turns: 10`, and `parallelism: 1`. Add `engine.model`, `skills`, `cases.defaults`, or `report` only when you need to override them.

For the full `eval.yaml` schema, see [Writing Evals](./writing-evals).

### Step 2 — Write an Eval Case

Create `evals/cases/hello-world.yaml`:

```yaml
input:
  prompt: |
    Please generate a Hello World program

expect:
  must_contain:
    - "Hello"
    - "World"
  must_not_contain:
    - "error"
```

The case `id` defaults to the filename (`hello-world`). Add a `judge` block only when you need script-based or agent-based grading.

### Step 3 — Validate the config

This step is optional, but useful before the first run: it checks `eval.yaml` and all referenced case files without starting an Agent Engine.

```bash
skilled validate
```

On success you should see:

```text
✓ eval.yaml is valid (loaded 1 case(s))
```

### Step 4 — Run the evaluation

```bash
skilled run
```

You will see output similar to:

```text
Running 1 case(s) with agent claude_code
[Runner] Running 1 cases with agent claude_code
[Evaluator] Skill installed: <skill-name>
[Evaluator] Running case hello-world (with_skill): Skill should respond to a basic request
[Evaluator] Case hello-world: PASS (pass_rate: 100.0%)
[INFO] Results written to ./<skill-name>-workspace/iteration-1
```

---

## Next steps

- [Writing Evals](./writing-evals) — full reference for `eval.yaml` and case files.
- [CLI Reference](./cli-reference) — every command and flag.
- [Migrating from Anthropic](./migration) — if you already have an Anthropic skill-creator `evals.json`.
