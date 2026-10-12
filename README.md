<p align="center"><img src="assets/logo.svg" width="96" alt="skilled logo" /></p>

<h1 align="center">skilled</h1>
<p align="center"><strong>Test agent skills. Improve with evidence.</strong></p>
<p align="center">Repeatable evaluations for Agent Skills, agents, and workspaces.</p>

<p align="center">
  <a href="https://github.com/DeadHead04/skillEd/releases"><img src="https://img.shields.io/github/v/release/DeadHead04/skillEd" alt="Latest release" /></a>
  <a href="https://github.com/DeadHead04/skillEd/actions/workflows/ci.yml"><img src="https://github.com/DeadHead04/skillEd/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache 2.0 license" /></a>
</p>

<p align="center">
  <a href="#install">Install</a> · <a href="#try-it">Quick start</a> · <a href="https://deadhead04.github.io/skillEd/">Documentation</a> · <a href="https://github.com/DeadHead04/skillEd/releases">Releases</a> · <a href="CONTRIBUTING.md">Contribute</a>
</p>

Write the behavior you expect in YAML, run it against your chosen agent, and inspect the results. Keep the same cases as you change a Skill so you can check whether it improved or regressed. Use **skilled-improve** in your agent host to turn failed evaluations into revisions and new regression cases.

![The skilled evaluation and improvement workflow](docs/public/overview.svg)

## Install

### macOS and Linux

```sh
curl -fsSL https://raw.githubusercontent.com/DeadHead04/skillEd/main/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
skilled --version
```

The installer downloads the latest release, verifies its SHA-256 checksum, and installs to `~/.local/bin`. Add the PATH line to `~/.zshrc` or `~/.bashrc` for future terminals. Bash, curl, and standard archive tools are required; **Node and application dependencies are bundled**. No GitHub login is needed.

### Windows PowerShell

```powershell
$installer = Join-Path $env:TEMP 'skilled-install.ps1'
Invoke-WebRequest https://raw.githubusercontent.com/DeadHead04/skillEd/main/install.ps1 -OutFile $installer
& $installer
$env:Path = "$(Join-Path $HOME '.local/bin');$env:Path"
skilled --version
```

Add `$HOME\.local\bin` to your user PATH for future terminals. Follow your organization's script policy if PowerShell blocks downloaded scripts.

[Manual downloads](https://github.com/DeadHead04/skillEd/releases/latest) · [Pinned versions, updates, and uninstall](docs/guide/installation.md)

Releases include macOS, Linux, and Windows archives for x64 and ARM64. See [platform verification](docs/guide/windows.md) for the checks performed on each platform. Distribution is through GitHub Releases; an npm registry package and Homebrew formula are not published.

## Try it

Download a small, inspectable Skill and one evaluation case. These macOS/Linux commands use the installed CLI:

```sh
mkdir -p skilled-hello/evals/cases
cd skilled-hello
curl -fsSL https://raw.githubusercontent.com/DeadHead04/skillEd/main/examples/hello-world/SKILL.md -o SKILL.md
curl -fsSL https://raw.githubusercontent.com/DeadHead04/skillEd/main/examples/hello-world/evals/eval.yaml -o evals/eval.yaml
curl -fsSL https://raw.githubusercontent.com/DeadHead04/skillEd/main/examples/hello-world/evals/cases/greeting.yaml -o evals/cases/greeting.yaml
skilled validate evals/eval.yaml
skilled list-cases evals/eval.yaml
skilled run evals/eval.yaml --dry-run
```

Validation and the dry run check the suite without calling a model. The [getting started guide](docs/guide/getting-started.md) shows the files in full and how to create them on any platform.

For a real evaluation, this example selects **Claude Code** using the host runtime. Install and authenticate that engine first, or change `engine.name` to an engine you already use. Then run:

```sh
skilled run evals/eval.yaml --format json --format html --format junit
```

This calls your selected engine and may incur provider charges. Results are written to the workspace path printed by the CLI. Use [engine and credential configuration](docs/guide/writing-evals.md#credentials) for provider keys or an existing local login. A dry run does not verify engine authentication or model quality.

## What you can evaluate

| Capability | Use it to |
| --- | --- |
| YAML cases and assertions | Check responses, generated files, and expected behavior with versioned cases |
| Rule, script, and model judges | Choose simple assertions, custom checks, or model-based grading |
| Agent engines | Run Claude Code, Codex, OpenCode, Qoder CLI, Qwen Code, or a custom engine |
| Host, Docker, and OpenSandbox runtimes | Choose where cases execute; configure Docker or a sandbox server when needed |
| Baselines and repeated runs | Compare with and without a Skill and inspect variation across iterations |
| JSON, HTML, and JUnit reports | Review results locally and consume them in CI |
| Anthropic evaluation import | Reuse `evals.json` suites through import or automatic discovery |
| skilled-improve and host plugins | Help your agent inspect failures, revise a Skill, and add regression cases |

Engine accounts and runtime services are configured separately. Installing the CLI does not sign into an agent or enable host observation capture.

## Evaluate, inspect, improve

1. Define cases in `evals/eval.yaml` and `evals/cases/` beside your `SKILL.md`.
2. Validate the suite and run it against the selected engine.
3. Inspect the HTML report and individual case artifacts.
4. Use [skilled-improve](skills/skilled-improve/README.md) to revise the Skill or strengthen the cases, then rerun.

Useful commands for an existing suite:

```sh
skilled run evals/eval.yaml --baseline
skilled run evals/eval.yaml --iteration 3
skilled run evals/eval.yaml --event-log events.jsonl
```

`--baseline` compares runs with and without the Skill; `--iteration 3` runs three iterations. [CLI reference](docs/guide/cli-reference.md) documents the full command set, output layout, and exit codes.

The optional [Codex plugin](plugins/codex-skilled/README.md) and [DSH plugin](plugins/dsh-skilled/README.md) bundle the improvement workflow and observation integration. Follow the host-specific installation guide to enable them.

## Documentation and examples

| Start here | Go deeper |
| --- | --- |
| [Installation](docs/guide/installation.md) | [Writing evaluations](docs/guide/writing-evals.md) |
| [Your first evaluation](docs/guide/getting-started.md) | [User configuration](docs/guide/user-config.md) |
| [Hello World example](examples/hello-world/README.md) | [Code statistics](examples/code-stats/README.md) |
| [CLI reference](docs/guide/cli-reference.md) | [User simulator](examples/user-simulator/README.md) |
| [Platform status](docs/guide/windows.md) | [Custom DSH engine](examples/deepseek-harness/README.md) |

Browse the [documentation site](https://deadhead04.github.io/skillEd/) or read the same guides in this repository.

## Development

Use Node **24.21.0** (see [`.nvmrc`](.nvmrc)), npm, and Git:

```sh
git clone https://github.com/DeadHead04/skillEd.git
cd skillEd
npm ci
npm run build
node dist/src/bootstrap.js --help
npm run typecheck
npm run test:real
npm run audit:brand
npm run docs:build
```

The application is TypeScript compiled to ESM. `src/` holds the CLI and execution API; `skills/` and `plugins/` hold host workflows; `examples/`, `tests/`, and `docs/` hold sample suites, verification, and guides. See [CONTRIBUTING.md](CONTRIBUTING.md) for real-service tests, packaging, and contribution checks.

## Release status

**0.1.0 is an early release.** The release pipeline exercised packaged CLI/API execution and installation on Linux, macOS, and Windows. Full provider/model coverage is separate: live authenticated model scenarios require configured accounts and are not established by package checks. See [verification and known limits](docs/verification.md), including the OpenSandbox artifact-collection limitation.

[Report a bug](https://github.com/DeadHead04/skillEd/issues/new/choose) with the CLI version, operating system, command, and sanitized output.

## License

[Apache-2.0](LICENSE). Original copyright and attribution notices are retained in [NOTICE](NOTICE).
