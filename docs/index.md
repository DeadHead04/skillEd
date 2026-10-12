---
layout: home

hero:
  name: skilled
  text: Better skills start with evidence.
  tagline: Test what your agent should do. Inspect what it actually did. Improve the Skill and check the result.
  actions:
    - theme: brand
      text: Run your first check
      link: /guide/getting-started
    - theme: alt
      text: Connect your agent
      link: /guide/mcp

features:
  - title: Start without model credentials
    details: Validate Skill files and evaluation cases, then preview a run before connecting an engine.
    link: /guide/getting-started
    linkText: Try a complete example
  - title: Keep the evidence
    details: Inspect case verdicts and outputs in HTML. Use JSON for tooling and JUnit in your CI pipeline.
    link: /guide/cli-reference#output-layout
    linkText: Explore the reports
  - title: See what changed
    details: Compare saved runs for regressions, score changes, and coverage differences. No additional model call needed.
    link: /guide/comparison
    linkText: Compare two runs
  - title: Improve with your agent
    details: The bundled skilled-improve workflow helps your agent diagnose failures, revise a Skill, and rerun the cases.
    link: /guide/mcp
    linkText: Connect through MCP
  - title: Choose your evaluation
    details: Define cases in YAML and grade them with assertions, scripts, or a model judge. Reuse existing evals.json suites.
    link: /guide/writing-evals
    linkText: Write evaluation cases
  - title: Use your engine and runtime
    details: Run a supported agent engine on the host, in Docker, or on a configured OpenSandbox server.
    link: /guide/writing-evals#credentials
    linkText: Configure your engine
---

<div class="home-section">
<p class="section-label">A CLEAR DIVISION OF WORK</p>

## One installation. Two parts that work together.

| Component | Responsibility | Where you use it |
| --- | --- | --- |
| **skilled** | Validate, evaluate, and compare | Your terminal or an MCP-compatible agent |
| **skilled-improve** | Guide diagnosis, revisions, and regression checks | A bundled workflow your agent follows |

`skilled-improve` is a prompt and workflow, not a separate executable. Your agent uses it with the evaluation tools; you keep the cases and evidence in your project.

</div>

<div class="home-section">
<p class="section-label">YOUR FIRST STEP</p>

## Install once. Start with a local check.

The release bundles its own Node runtime and application dependencies. No source build or GitHub account is required.

::: code-group

```sh [macOS / Linux]
curl -fsSL https://raw.githubusercontent.com/DeadHead04/skillEd/main/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
skilled --version
```

```powershell [Windows]
$installer = Join-Path $env:TEMP 'skilled-install.ps1'
Invoke-WebRequest https://raw.githubusercontent.com/DeadHead04/skillEd/main/install.ps1 -OutFile $installer
& $installer
$env:Path = "$(Join-Path $HOME '.local/bin');$env:Path"
skilled --version
```

:::

Keep the PATH entry in your shell or user settings for future sessions. [Installation options, updates, and uninstall →](./guide/installation.md)

Next, [create the Hello World example](./guide/getting-started.md) and validate it without calling a model. For a live evaluation, install and authenticate your selected engine first; provider usage may incur charges.

</div>

<div class="home-section">
<p class="section-label">A REPEATABLE PROCESS</p>

## From an expectation to an improvement

<ol class="workflow-steps">
  <li><span class="step-number">01</span><div><strong>Define</strong><p>Write the behavior you expect as versioned cases.</p></div></li>
  <li><span class="step-number">02</span><div><strong>Evaluate</strong><p>Run the engine and inspect the report and outputs.</p></div></li>
  <li><span class="step-number">03</span><div><strong>Improve</strong><p>Have your agent revise the Skill using failed cases.</p></div></li>
  <li><span class="step-number">04</span><div><strong>Compare</strong><p>Rerun the suite and check what improved or regressed.</p></div></li>
</ol>

Comparisons use the reports you supply. Background drift monitoring and unrelated conversation capture are not enabled by installing the CLI or connecting MCP. [Understand the comparison model →](./guide/comparison.md)

</div>

<div class="home-section home-closing">
<p class="section-label">OPEN SOURCE · TYPESCRIPT · APACHE-2.0</p>

## Try it on one Skill.

Start small, keep the report, and make the next change measurable.

[Follow the first-evaluation guide →](./guide/getting-started.md) · [Read the verification scope](./verification.md) · [Browse the source](https://github.com/DeadHead04/skillEd)

</div>
