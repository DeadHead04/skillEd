---
layout: home
hero:
  name: skilled
  text: Show that your Skill got better.
  tagline: Run real cases. Revise the Skill. See what improved—and what broke—before you ship.
  actions:
    - theme: brand
      text: Install and get started
      link: /guide/installation
    - theme: alt
      text: See it work
      link: /guide/see-it-work
---

<div class="home-section home-evidence">
<p class="section-label">REAL CODEX RUNS · REFUND-POLICY SKILL</p>

## Five failures. One revised Skill. Zero regressions.

The original Skill refunded shipping, rounded up, and used the wrong eligibility window. Correcting those instructions took the same suite from **13 / 18 to 18 / 18 passing cases**. A separate set of **10 holdouts also passed**.

[![Recorded CLI output: five improvements across 18 matched cases, with two case scores rising from 0 to 1](/demos/improvement.svg)](/demos/improvement.svg)

<p class="demo-caption">Actual CLI output, typeset for readability. Two changed cases shown. <a href="./guide/see-it-work">See the Skill changes, scores, and complete transcript →</a></p>

The score comes from the grader: in this suite, each case has one script assertion checking the final answer, saved file, and injection side effects. **0 = failed; 1 = passed.** MCP exposes these results to your agent; it does not assign a separate score.

</div>

<div class="home-section">
<p class="section-label">A CHANGE CAN ALSO MAKE THINGS WORSE</p>

## Make regressions visible.

A deliberately broken Skill turns a passing case into a failure. Comparing the saved reports catches it and returns **exit 1**, ready for a CI gate.

[![Recorded comparison: one regression, score 1 to 0, command exits 1](/demos/regression.svg)](/demos/regression.svg)

<p class="demo-caption">Replay of real reports, not continuous monitoring. <a href="./guide/see-it-work#catch-a-regression">Read the full output and provenance warning →</a></p>

Rerun evaluations after changing a Skill, model, or engine. Compare the same cases and review the grading conditions before interpreting a score change. These results describe one tested Skill and engine, not a general accuracy guarantee.

</div>

<div class="home-section">
<p class="section-label">START IN YOUR OWN PROJECT</p>

## Install once. Use the agent you already have.

The public release includes the CLI, MCP tools, the **skilled-improve** workflow, and its Node runtime.

::: code-group

```sh [macOS / Linux]
curl -fsSL https://github.com/DeadHead04/skillEd/releases/latest/download/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
skilled setup --host codex
# Or: skilled setup --host claude-code
```

```powershell [Windows]
$installer = Join-Path $env:TEMP 'skilled-install.ps1'
Invoke-WebRequest https://github.com/DeadHead04/skillEd/releases/latest/download/install.ps1 -OutFile $installer
& $installer
$env:Path = "$(Join-Path $HOME '.local/bin');$env:Path"
skilled setup --host codex
# Or: skilled setup --host claude-code
```

:::

Keep the PATH entry in your shell or user settings. Start a new agent session in the same project folder and ask:

> Use skilled-improve on my Skill. Validate the cases, run a baseline, diagnose the failures, revise the Skill, and rerun the same cases plus independent holdouts. Show what improved and what regressed.

**skilled** runs evaluations and compares reports. **skilled-improve** is the workflow your agent follows to revise the Skill; it is not another CLI executable. Live runs use your configured engine and its authentication. Setup preserves existing Skills and local workflow edits.

[Installation, updates, and uninstall →](./guide/installation.md) · [First evaluation →](./guide/getting-started.md) · [Connect through MCP →](./guide/mcp.md)

</div>

<div class="home-section home-closing">
<p class="section-label">OPEN SOURCE · TYPESCRIPT · APACHE-2.0</p>

## Keep the evidence beside the Skill.

Write YAML cases, choose assertions, scripts, or model judges, and save HTML, JSON, and JUnit reports. Compare results before adopting the next revision.

[Write evaluation cases](./guide/writing-evals.md) · [Scoring contract](./guide/scoring.md) · [Verification scope](./verification.md) · [Browse the source](https://github.com/DeadHead04/skillEd)

</div>
