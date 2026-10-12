# Your first evaluation

This walkthrough creates a small Skill and a real evaluation case. You can validate the files without a model account, then run the case after configuring an agent engine.

## 1. Install the CLI

Follow [Installation](./installation.md) for macOS, Linux, or Windows. Release archives bundle their own runtime; you do not need Node or a source build.

```sh
skilled --version
skilled --help
```

## 2. Create a Skill and a case

Create these files with your editor in a new `skilled-hello` directory:

```text
skilled-hello/
  SKILL.md
  evals/
    eval.yaml
    cases/
      greeting.yaml
```

`SKILL.md` defines the behavior being evaluated:

```markdown
---
name: hello-world
description: Return a short greeting when the user asks to be greeted.
---

When asked for a greeting, respond with exactly `Hello, world!`.
```

`evals/eval.yaml` selects the host runtime and Claude Code engine:

```yaml
schema_version: v1alpha1

environment:
  type: none

engine:
  name: claude_code

cases:
  files:
    - evals/cases/greeting.yaml
```

`evals/cases/greeting.yaml` defines the prompt and the expected response:

```yaml
input:
  prompt: Please greet me.
expect:
  must_contain:
    - "Hello, world!"
```

The case ID defaults to `greeting`. Case paths are relative to the Skill root. Because `SKILL.md` is beside `evals/`, skilled provisions this Skill automatically. This suite is also available under [examples/hello-world](https://github.com/DeadHead04/skillEd/tree/main/examples/hello-world).

## 3. Validate without calling a model

Open a terminal in `skilled-hello` and run:

```sh
skilled validate evals/eval.yaml
skilled validate --skill .
skilled list-cases evals/eval.yaml
skilled run evals/eval.yaml --dry-run
```

The suite should validate and list the `greeting` case. These commands do not execute the agent or verify its authentication. They give you a way to check file paths, configuration, and case selection before a live run.

## 4. Configure the engine and run

This example uses Claude Code on the host (`environment.type: none`). Install that engine and authenticate it before running the case. You can use an existing local login with the model block omitted, or configure a provider through environment variables or `~/.skilled/credentials.yaml`. See [credentials and connection recipes](./writing-evals.md#credentials).

To use another supported engine, change `engine.name` and configure its account. Host logins are not automatically copied into Docker or OpenSandbox runtimes. Provider requests may incur charges.

```sh
skilled run evals/eval.yaml --format json --format html --format junit
```

The CLI prints the results directory. Open its HTML report to inspect the response and assertions; use JSON for tooling and JUnit for CI. A successful case means the response satisfied the configured assertion. Review the actual report before deciding whether your Skill meets its broader requirements.

## 5. Add a regression case

Create another case under `evals/cases/`, add its path to `cases.files`, and rerun. Keep the cases as you revise `SKILL.md` so changes are checked against the same expectations.

```sh
skilled run evals/eval.yaml --baseline
skilled run evals/eval.yaml --iteration 3
```

A baseline run compares behavior with and without the Skill. Repeated iterations help expose variation and make additional engine calls. See [output layout and flags](./cli-reference.md).

## Improve from evidence

The CLI release already includes `skilled-improve`. [Connect your agent through MCP](./mcp.md) and load the `skilled-improve` prompt, or have it read the `skilled://workflow/skilled-improve` resource. No second executable or separate download is required. Add `--allow-execution` to the server arguments when you are ready for live evaluations.

For host observation features, install the optional [Codex](https://github.com/DeadHead04/skillEd/tree/main/plugins/codex-skilled) or [DSH](https://github.com/DeadHead04/skillEd/tree/main/plugins/dsh-skilled) plugin using its host-specific instructions.

Ask your agent: “Use skilled-improve to inspect the failed evaluations, improve this Skill or its cases, and rerun.” The workflow uses evaluation artifacts as evidence. Installing the CLI alone does not enable plugin observation capture.

## Next steps

- [Writing evaluations](./writing-evals.md): schemas, environments, engines, and grading.
- [User configuration](./user-config.md): `skilled init`, config files, and telemetry.
- [CLI reference](./cli-reference.md): commands, output layout, and exit codes.
- [Import existing evaluations](./migration.md): use Anthropic-style `evals.json`.
- [Verification status](../verification.md): release checks and known limitations.
