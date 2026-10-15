<h1 align="center"><img src="docs/public/wordmark.svg" width="300" alt="skilled" /></h1>
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
  <a href="#install">Install</a> · <a href="#use-it-in-your-project">Get started</a> · <a href="#see-the-skill-improve">See a real result</a> · <a href="https://deadhead04.github.io/skillEd/">Documentation</a> · <a href="https://github.com/DeadHead04/skillEd/releases">Releases</a>
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

## See the Skill improve

A refund-policy Skill refunded shipping, rounded refunds up, and rejected eligible returns after day 14. A real Codex evaluation exposed those mistakes. Revising the Skill to match the policy—**30 days, no shipping refund, round down**—fixed five cases without changing the tests.

| Same 18 cases | Original Skill | Revised Skill |
| --- | --- | --- |
| Cases passed | 13 / 18 (72.2%) | 18 / 18 (100%) |
| Day 14 partial refund | 933 cents · FAIL · score 0 | 333 cents · PASS · score 1 |
| Day 30 return | Denied · FAIL · score 0 | Approved · PASS · score 1 |

![Recorded CLI comparison: 18 matched cases, five improvements, zero regressions; two case scores change from 0 to 1](docs/public/demos/improvement.svg)

*Typeset excerpt of actual CLI output, not a native application screenshot. [Full output, including the provenance warning](docs/public/demos/improvement.txt).*

Each case here has one script assertion that checks the final JSON, saved refund file, and injection side effects. **Score 1 means that assertion passed; 0 means it failed.** The percentages above are case pass rates, not confidence scores. The revised Skill also passed **10 / 10 independent holdouts**. [See the exact Skill changes and scoring evidence →](https://deadhead04.github.io/skillEd/guide/see-it-work)

## Catch a regression before you ship

Compare a passing report with one from an intentionally broken version of the Skill:

![Recorded CLI comparison: a passing case becomes FAIL, its score drops from 1 to 0, and the command exits 1](docs/public/demos/regression.svg)

*Replay of real evaluation reports; [full output](docs/public/demos/regression.txt). Exit 1 is the expected regression signal.*

This is how saved-run comparison can expose behavioral drift after a change. It does not watch unrelated conversations in the background. These results demonstrate one Skill and engine; they are not an accuracy guarantee. The reports lack complete input fingerprints, so the CLI warns that matching cases alone cannot establish equivalent grading conditions. Review that warning and the underlying inputs.

**Where MCP fits:** your agent starts an evaluation with `skilled_start`, checks `skilled_status`, retrieves reports with `skilled_results`, and compares runs with `skilled_compare`. Graders produce the scores; MCP makes the tools and evidence available to the agent. [Visual walkthrough →](https://deadhead04.github.io/skillEd/guide/see-it-work) · [Verification scope →](docs/verification.md)

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
| See a Skill evolve, with scores and a regression | [Recorded walkthrough](https://deadhead04.github.io/skillEd/guide/see-it-work) |
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
