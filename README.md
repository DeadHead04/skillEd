<p align="center"><img src="docs/public/readme-banner.svg" width="1120" alt="skilled — Test agent skills. Improve with evidence. Define cases, evaluate behavior, compare results." /></p>

<h1 align="center">skilled</h1>
<p align="center"><strong>Test your agent’s Skills. Catch regressions. Improve with evidence.</strong></p>
<p align="center">An open-source evaluation toolkit for Codex, Claude Code, and other coding agents.</p>

<p align="center">
  <a href="https://github.com/DeadHead04/skillEd/releases/latest"><img src="https://img.shields.io/github/v/release/DeadHead04/skillEd?color=167d68" alt="Latest release" /></a>
  <a href="https://github.com/DeadHead04/skillEd/actions/workflows/ci.yml"><img src="https://github.com/DeadHead04/skillEd/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/DeadHead04/skillEd/actions/workflows/release.yml"><img src="https://github.com/DeadHead04/skillEd/actions/workflows/release.yml/badge.svg" alt="Release acceptance" /></a>
  <a href="docs/guide/installation.md"><img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-167d68" alt="macOS, Linux and Windows" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-167d68" alt="Apache 2.0 license" /></a>
</p>

<p align="center">
  <a href="#install">Install</a> · <a href="#use-it-in-your-project">Get started</a> · <a href="#see-the-evidence">See a real result</a> · <a href="https://deadhead04.github.io/skillEd/">Documentation</a> · <a href="https://github.com/DeadHead04/skillEd/releases">Releases</a>
</p>

A Skill can look right and still fail on edge cases. skilled turns the behavior you expect into repeatable evaluations, so you can check a change to the Skill, agent, or model before relying on it.

**One installation includes the evaluation CLI, MCP tools, and the `skilled-improve` workflow.** Use your existing Skills and local engine login. The release bundles its Node runtime; you do not need a source checkout or a separate Node installation.

## Install

### macOS & Linux

```sh
curl -fsSL https://github.com/DeadHead04/skillEd/releases/latest/download/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
skilled --version
```

Add the PATH line to `~/.zshrc` or `~/.bashrc` for future terminals. Requires Bash, curl, and standard archive tools.

<details>
<summary><strong>Windows PowerShell</strong></summary>

```powershell
$installer = Join-Path $env:TEMP 'skilled-install.ps1'
Invoke-WebRequest https://github.com/DeadHead04/skillEd/releases/latest/download/install.ps1 -OutFile $installer
& $installer
$env:Path = "$(Join-Path $HOME '.local/bin');$env:Path"
skilled --version
```

Add `$HOME\.local\bin` to your user PATH for future terminals. Follow your organization's script policy if PowerShell blocks downloaded scripts.

</details>

The installer verifies the release archive’s SHA-256 checksum before activating the CLI. Downloads are public; no GitHub login is required. Project setup is available in **v0.3.0 and newer**.

[Manual downloads](https://github.com/DeadHead04/skillEd/releases/latest) · [Pin a version, update, or uninstall](docs/guide/installation.md)

## Use it in your project

From the project where you keep your Skills, activate the bundled improvement workflow for your agent:

```sh
skilled setup --host codex
# For Claude Code instead:
skilled setup --host claude-code
```

Start a new agent session in that same folder and ask:

> Use skilled-improve on my Skill at `<path-to-skill>`. Inspect its policy and existing tests, add cases for boundaries and invalid inputs, and validate the suite first. Then run it with my configured engine, save a baseline, improve the Skill, and rerun the same cases plus independent holdouts. Show the reports and any regressions.

Replace `<path-to-skill>` with the actual directory. Your agent follows the workflow and uses skilled to evaluate the changes. **`skilled-improve` is an agent workflow, not a second terminal command.**

Setup preserves existing Skills and protects local workflow edits. Repeat setup after upgrading the CLI; add `--remove` to remove an unmodified managed copy. Setup does not authenticate an engine. Native evaluations can use an existing Codex or Claude Code login; model usage follows your account’s limits and billing.

No Skill yet? [Create your first Skill and evaluation](docs/guide/getting-started.md). Prefer agent-assisted installation? [Give your agent these setup instructions](instruction.md).

## Run the evaluation loop

For a Skill with `SKILL.md` and `evals/eval.yaml`, run from its root:

```sh
# Check the files and selected cases without calling a model.
skilled validate --skill .
skilled validate evals/eval.yaml
skilled run evals/eval.yaml --dry-run

# Run the configured, authenticated engine and save the baseline.
skilled run evals/eval.yaml --output-dir reports/before --format json --format html --format junit

# After revising the Skill, evaluate the same cases again.
skilled run evals/eval.yaml --output-dir reports/after --format json --format html --format junit

# Compare saved results; return a nonzero exit code for a regression.
skilled compare reports/before/iteration-1/report.json reports/after/iteration-1/report.json --fail-on-regression
```

Use fresh output directories for this example, or use the actual report paths printed by your runs. Open `report.html` to inspect case verdicts, outputs, and grading evidence. JSON supports automation; JUnit fits existing CI tooling.

**Drift detection means comparing saved evaluations.** Rerun after changing a Skill, engine, or model. Comparison surfaces verdict and coverage changes; inspect its comparability warnings before drawing conclusions. Installing skilled does not continuously monitor unrelated conversations. [Comparison and scoring →](docs/guide/comparison.md)

## See the evidence

A real Codex acceptance journey exercised a refund-policy Skill with boundary conditions, invalid inputs, and adversarial instructions:

| Check | Observed result |
| --- | --- |
| Original Skill | 13 of 18 cases passed |
| Revised Skill, same cases | 18 of 18 passed |
| Independent holdouts | 10 of 10 passed |
| Deliberate regression, then restoration | Failed as expected, then passed |

These are results from one tested Skill and engine, not a general accuracy guarantee. The screenshot below is the actual improved run’s HTML report.

![Actual refund-policy report: 18 cases passed, with the selected case’s prompt, response, and grading controls](docs/public/refund-policy-report.png)

The published v0.3.0 CLI also passed a real Codex evaluation after the MCP client disconnected and reconnected to the same job. JSON, HTML, and JUnit reports were verified. [Acceptance evidence and limits →](docs/verification.md)

## What you can test

| Capability | How it helps |
| --- | --- |
| YAML cases and fixtures | Keep expected behavior versioned beside the Skill |
| Assertions, scripts, and model judges | Check exact outputs, custom policy, or qualitative criteria |
| Multi-turn cases and repeated runs | Exercise follow-up pressure and variation |
| Codex, Claude Code, OpenCode, Qoder CLI, Qwen Code, and custom engines | Evaluate through your configured agent engine |
| Native, Docker, and configured OpenSandbox execution | Choose the runtime for ordinary evaluations |
| Isolated with/without-Skill benchmarks | Measure Skill contribution with a verified Docker filesystem boundary |
| Saved-report comparison | Detect regressions and coverage changes without another model call |
| Anthropic `evals.json` import | Bring an existing evaluation suite |

With/without-Skill benchmarks require Docker; native and OpenSandbox benchmark modes are rejected before execution. Ordinary native evaluations do not require Docker. [Benchmark configuration →](docs/guide/writing-evals.md#benchmark-mode)

## Connect through MCP

MCP is an optional route for agents that support local stdio servers:

```sh
skilled mcp --workspace /absolute/path/to/your-project
```

The default connection exposes validation, dry runs, report comparison, and the bundled workflow. Add `--allow-execution` to enable evaluations using your configured engine. This enables the server capability; your host’s approval policy still applies.

For long evaluations, use `skilled_start`, then `skilled_status` and `skilled_results`. A stable idempotency key lets the client reconnect to the same workspace and recover the run without launching a duplicate. Use `skilled_cancel` to request cancellation.

[Host configuration, tools, and recovery →](docs/guide/mcp.md)

Optional [Codex](plugins/codex-skilled/README.md) and [DSH](plugins/dsh-skilled/README.md) observation integrations have separate setup. They are not required for the evaluation loop above.

## Documentation

| I want to… | Start here |
| --- | --- |
| Create a first evaluation | [Getting started](docs/guide/getting-started.md) |
| Write cases and configure an engine | [Writing evaluations](docs/guide/writing-evals.md) |
| Understand scores and regressions | [Comparison](docs/guide/comparison.md) · [Scoring](docs/guide/scoring.md) |
| Look up commands and exit codes | [CLI reference](docs/guide/cli-reference.md) |
| Check what has actually been tested | [Verification scope](docs/verification.md) |
| Report a problem or contribute | [Issues](https://github.com/DeadHead04/skillEd/issues/new/choose) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) |

## Release status

[**v0.3.0 is available**](https://github.com/DeadHead04/skillEd/releases/tag/v0.3.0), including project setup, durable MCP jobs, preserved report formats, and benchmark isolation. All eight [release acceptance jobs](https://github.com/DeadHead04/skillEd/actions/runs/38557758484) passed, covering packaged execution and published installation on native Linux, macOS, and Windows runners.

Distribution is through GitHub Releases. An npm registry package and Homebrew formula are not published. Optional authenticated Codex execution inside Docker remains unverified; authenticated native Codex and Docker isolation were tested separately. See [verification](docs/verification.md) for provider and architecture limits.

[Changelog](CHANGELOG.md) · [All releases](https://github.com/DeadHead04/skillEd/releases)

## Develop locally

Use Node **24.21.0** (see [`.nvmrc`](.nvmrc)), npm, and Git:

```sh
git clone https://github.com/DeadHead04/skillEd.git
cd skillEd
npm ci
npm run build
node dist/src/bootstrap.js --help
```

The application is TypeScript compiled to ESM. `src/` contains the CLI and execution API; `skills/` and `plugins/` contain agent workflows; `examples/`, `tests/`, and `docs/` contain examples, verification, and guides. [Development checks →](CONTRIBUTING.md)

## License

[Apache-2.0](LICENSE). Copyright and attribution notices are retained in [NOTICE](NOTICE).
