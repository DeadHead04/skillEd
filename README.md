<p align="center"><img src="docs/public/readme-banner.svg" width="1120" alt="skilled — Test agent skills. Improve with evidence. Define cases, evaluate behavior, compare results." /></p>

<h1 align="center">skilled</h1>
<p align="center">Repeatable tests for agent skills, with a clear path from a failed case to a verified improvement.</p>

<p align="center">
  <a href="https://github.com/DeadHead04/skillEd/releases/latest"><img src="https://img.shields.io/github/v/release/DeadHead04/skillEd?color=167d68" alt="Latest release" /></a>
  <a href="https://github.com/DeadHead04/skillEd/actions/workflows/ci.yml"><img src="https://github.com/DeadHead04/skillEd/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-167d68" alt="Apache 2.0 license" /></a>
</p>

<p align="center">
  <a href="#install">Install</a> · <a href="#your-first-check">First check</a> · <a href="https://deadhead04.github.io/skillEd/guide/mcp">Use with your agent</a> · <a href="https://deadhead04.github.io/skillEd/">Documentation</a>
</p>

Write down what a Skill should do, run those cases against your agent, and keep the reports. After a change, rerun the same cases and compare results to see what improved and what regressed.

| Component | What it does | How you use it |
| --- | --- | --- |
| **`skilled`** | Validates Skills, runs evaluations, and compares saved reports | CLI commands or MCP tools |
| **`skilled-improve`** | Guides your agent through diagnosing failures, revising a Skill, and checking the result | Bundled MCP prompt or host workflow |

**One installation includes both.** `skilled-improve` is a workflow, not a second terminal command. Validation, dry runs, and saved-report comparison work without model credentials. Live evaluations use the engine and account you configure.

## Install

<details open>
<summary><strong>macOS & Linux</strong></summary>

```sh
curl -fsSL https://raw.githubusercontent.com/DeadHead04/skillEd/main/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
skilled --version
```

Add the PATH line to `~/.zshrc` or `~/.bashrc` for future terminals. Requires Bash, curl, and standard archive tools.

</details>

<details>
<summary><strong>Windows PowerShell</strong></summary>

```powershell
$installer = Join-Path $env:TEMP 'skilled-install.ps1'
Invoke-WebRequest https://raw.githubusercontent.com/DeadHead04/skillEd/main/install.ps1 -OutFile $installer
& $installer
$env:Path = "$(Join-Path $HOME '.local/bin');$env:Path"
skilled --version
```

Add `$HOME\.local\bin` to your user PATH for future terminals. Follow your organization's script policy if PowerShell blocks downloaded scripts.

</details>

The installer downloads the latest release, verifies its SHA-256 checksum, and installs to `~/.local/bin`. **The Node runtime and application dependencies are bundled.** No GitHub login or source build is needed.

[Manual downloads](https://github.com/DeadHead04/skillEd/releases/latest) · [Pin a version, update, or uninstall](docs/guide/installation.md) · [Platform verification](docs/guide/windows.md)

Prefer having your agent handle setup? Paste this into your agent:

> Set up skilled in this project using https://raw.githubusercontent.com/DeadHead04/skillEd/main/instruction.md, then validate a first evaluation without calling a model.

## Your first check

For a project that already has a `SKILL.md` and `evals/eval.yaml`, run these commands from its root:

```sh
skilled validate --skill .
skilled validate evals/eval.yaml
skilled run evals/eval.yaml --dry-run
```

This checks the Skill, evaluation configuration, and case selection without calling a model. Starting from scratch? The [Hello World walkthrough](docs/guide/getting-started.md) includes every file to create and works on all three operating systems.

Once your chosen engine is installed and authenticated, run the evaluation:

```sh
skilled run evals/eval.yaml --format json --format html --format junit
```

Open the HTML report in the directory printed by the CLI to inspect case verdicts and evidence. Live evaluations may incur provider charges; see [engine and credential setup](docs/guide/writing-evals.md#credentials).

## Improve with your agent

From your project folder, activate the bundled workflow for your host:

```sh
skilled setup --host codex
# Or:
skilled setup --host claude-code
```

Start a new host session in that project, then ask: **Use skilled-improve to evaluate this Skill.**
Setup copies the canonical workflow into the host's project Skill directory. It preserves
host settings and refuses to overwrite local workflow edits. Repeat the command after
upgrading skilled; use `--remove` to remove an unmodified managed copy. Existing engine
logins work for local evaluation; Docker and a separate API key are optional.

For tool-based integration, use the optional [MCP setup guide](docs/guide/mcp.md). The server command is:

```sh
skilled mcp --workspace /absolute/path/to/your-project
```

Then ask your agent:

> Use skilled-improve to validate this Skill and its evaluation suite. Explain the problems and suggest regression cases. Start without calling a model.

The default MCP connection supports validation, dry runs, comparison, and the bundled workflow. To execute evaluations through MCP, configure the engine and add `--allow-execution` to the server arguments.

### The improvement loop

1. **Evaluate.** Run versioned cases and preserve the report as a baseline.
2. **Inspect.** Review failed assertions and the actual outputs.
3. **Revise.** Use `skilled-improve` to help your agent edit the Skill or add missing cases.
4. **Compare.** Rerun the same suite and check the saved reports. See the [scoring contract](docs/guide/scoring.md) for skipped checks and compatible baselines:

```sh
skilled compare baseline/iteration-1/report.json candidate/iteration-1/report.json --fail-on-regression
```

Use the report paths from your runs. Comparison checks observed changes and flags coverage differences; it does not continuously monitor conversations. [How comparison and scoring work →](docs/guide/comparison.md)

## Built for repeatable evaluation

| Capability | What you get |
| --- | --- |
| Versioned YAML cases | Prompts, fixtures, and expected behavior beside your Skill |
| Flexible grading | Assertions, custom scripts, and model judges |
| Your agent engine | Claude Code, Codex, OpenCode, Qoder CLI, Qwen Code, or a custom engine |
| Execution choices | Host, Docker, or a configured OpenSandbox server |
| Reports you can use | JSON for tooling, HTML for review, and JUnit for CI |
| Baselines and repetition | With/without-Skill evaluations and repeated runs |
| Existing evaluation suites | Import Anthropic `evals.json` or use automatic discovery |

Host observation capture is a separate, optional integration. See the [Codex plugin](plugins/codex-skilled/README.md) or [DSH plugin](plugins/dsh-skilled/README.md) for setup.

## Find your next step

| I want to… | Guide |
| --- | --- |
| Try a complete example | [Your first evaluation](docs/guide/getting-started.md) |
| Connect my agent | [MCP tools and skilled-improve](docs/guide/mcp.md) |
| Write cases and choose a judge | [Writing evaluations](docs/guide/writing-evals.md) |
| Check for regressions | [Comparison and scoring](docs/guide/comparison.md) |
| Look up commands or exit codes | [CLI reference](docs/guide/cli-reference.md) |
| Contribute or run the tests | [Contributing](CONTRIBUTING.md) |

## Development

Use Node **24.21.0** (see [`.nvmrc`](.nvmrc)), npm, and Git:

```sh
git clone https://github.com/DeadHead04/skillEd.git
cd skillEd
npm ci
npm run build
node dist/src/bootstrap.js --help
```

The application is TypeScript compiled to ESM. `src/` contains the CLI and execution API; `skills/` and `plugins/` contain agent workflows; `examples/`, `tests/`, and `docs/` contain examples, verification, and guides. [Contribution checks and real-service testing →](CONTRIBUTING.md)

## Release and verification

**skilled is an early-stage project.** [Release 0.2.0](https://github.com/DeadHead04/skillEd/releases/tag/v0.2.0) includes the MCP server, Skill integrity checks, and saved-report comparison. Distribution is through GitHub Releases; an npm registry package and Homebrew formula are not published.

Packaged execution and installation have been tested on Linux, macOS, and Windows. Native architecture coverage, authenticated model scenarios, and service limits are documented in [verification and release scope](docs/verification.md). Archive availability is not a claim that every device or provider combination has been tested.

[Report a bug](https://github.com/DeadHead04/skillEd/issues/new/choose) · [Changelog](CHANGELOG.md) · [Security policy](SECURITY.md)

## License

[Apache-2.0](LICENSE). Original copyright and attribution notices are retained in [NOTICE](NOTICE).
