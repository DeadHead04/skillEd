---
layout: home

hero:
  name: skilled
  text: Test agent behavior. Improve with evidence.
  tagline: Define repeatable cases, run your chosen engine, and inspect the results before the next change.
  image:
    src: /logo.svg
    alt: skilled
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Connect your agent
      link: /guide/mcp
    - theme: alt
      text: Install the CLI
      link: /guide/installation

features:
  - title: CLI and MCP in one installation
    details: Use the evaluation tools and bundled skilled-improve prompt, references and templates from your agent host.
    link: /guide/mcp
    linkText: Connect with MCP
  - title: Compare saved runs
    details: Check verdict and score changes, review case coverage, and flag regressions without another model call.
    link: /guide/comparison
    linkText: Understand comparisons
  - title: Improve from evaluation results
    details: Use skilled-improve with your agent to inspect failed cases, revise a Skill, and rerun the same checks.
    link: /guide/getting-started#improve-from-evidence
    linkText: Learn more
  - title: Declarative Eval Config
    details: Define evaluation environment, engine, model, and cases through YAML (eval.yaml + cases/*.yaml).
    link: /guide/writing-evals
    linkText: Configuration reference
  - title: Multi-Engine Support
    details: Works with Qoder CLI, Claude Code, Codex, OpenCode, and Qwen Code as Agent Engines.
  - title: Flexible Judging
    details: Supports rule_based, script, and agent_judge evaluation strategies.
    link: /guide/writing-evals#grading-strategies
    linkText: Grading strategies
  - title: Structured Reports
    details: Outputs Anthropic-compatible grading.json, benchmark.json, plus result.json, JUnit XML, and HTML reports.
    link: /guide/cli-reference#output-layout
    linkText: Output layout
  - title: Anthropic Compatible
    details: Import evals.json via skilled import, or auto-detect with --auto.
    link: /guide/migration
    linkText: Migration guide
  - title: CI-Ready
    details: Designed for local development and continuous integration pipelines.
    link: /guide/cli-reference#exit-codes
    linkText: Exit codes
---

## Overview

Start with the behavior you want to check: a response, a generated file, a tool call or a scripted condition. `skilled` runs those cases against the selected engine, gathers evidence and reports each result. Use `skilled-improve` with your agent to inspect failures, revise a Skill or add missing cases, then run the suite again.

Choose local, Docker or OpenSandbox execution. Existing Anthropic `evals.json` suites can be consumed directly or imported as YAML. JSON, JUnit and HTML outputs support both local review and CI. Source and releases live in [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd); the [installation guide](./guide/installation.md) covers public installers, updates, and source builds.

![How skilled evaluates and evolves Agent Skills through automatic eval repair and iteration](/overview.svg)
