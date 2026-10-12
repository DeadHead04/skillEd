# Hello World

A minimal Skill and one rule-based evaluation. From the repository root, with the CLI installed:

```sh
skilled validate examples/hello-world/evals/eval.yaml
skilled list-cases examples/hello-world/evals/eval.yaml
skilled run examples/hello-world/evals/eval.yaml --dry-run
```

These commands validate and select the case without making a model request. For a real evaluation, install and authenticate Claude Code on this host, then run:

```sh
skilled run examples/hello-world/evals/eval.yaml --format json --format html --format junit
```

The case checks that the response contains `Hello, world!`. A live run invokes the configured engine and may incur provider charges. Change `engine.name` to use another supported engine. See [Getting started](../../docs/guide/getting-started.md) and [credentials](../../docs/guide/writing-evals.md#credentials).
