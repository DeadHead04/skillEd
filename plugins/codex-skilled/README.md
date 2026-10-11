# Skilled for Codex

This plugin captures explicitly attributed Skill interactions through Codex hooks and stores normalized observations locally. Its bundled MCP server supplies capture and case-conversion operations; the release bundle includes the canonical `skilled-improve` Skill for capture guidance, review, approval, evaluation, and evolution.

`.codex-plugin/plugin.json` and `.mcp.json` are the canonical local Codex package manifests. Codex discovers `hooks/hooks.json` by default, so the capture hooks and bundled Node MCP server load from the same installed plugin root.

## Requirements

- A current Codex CLI or Codex desktop release with plugin and lifecycle-hook support. The IDE extension does not support plugins.
- Node 24.21.0 available as `node`.
- Explicit trust for the plugin's hook definition in Codex.

The pinned Codex 0.80.0 binary used by skilled's evaluation adapter is intentionally out of scope. It remains available for custom-model evaluation and does not load this plugin.

## Data and consent

Enabling the plugin and trusting its hooks opts in to local capture. Pending drafts and finalized observations are stored under `$CODEX_HOME/plugin-data/skilled-observer` (normally `~/.codex/plugin-data/skilled-observer`). The stable path keeps Hook and MCP access consistent on Codex versions that inject `PLUGIN_DATA` only for hooks. `SKILLED_OBSERVER_DATA` is available as a development/test override. Directories use mode `0700` and observation files use `0600`.

Common API-key, bearer-token, JWT, and secret-assignment shapes are redacted before persistence. Nothing is uploaded. Unattributed turns are discarded at `Stop`; the plugin also handles `Interrupt` when the Codex host exposes that hook event. Inferred attribution is rejected by the observation contract.

## Review workflow

Use `skilled-improve` to capture explicitly attributed feedback, list or show observations, preview a candidate case, and approve or reject a specific observation. Hooks and the `skilled_observer` MCP server remain plugin runtime components; they are not exposed as a second Skill.

Preview is read-only. Writing requires an approved observation, never overwrites an existing case, and updates `evals/eval.yaml`. If `skilled` is available on `PATH`, the plugin runs `skilled validate` and rolls back both files when validation fails; capture and review do not depend on skilled.

The complete capture-to-evaluation flow is available through the bundled `skilled-improve` Skill; running evaluations additionally requires the optional `skilled` CLI.

## Build a distributable bundle

[`../../skills/skilled-improve`](../../skills/skilled-improve) is the only editable source for `skilled-improve`; this source directory is intentionally not an installable plugin by itself. From the repository root, run:

```bash
npm run build
```

The command assembles a complete plugin under `dist/bundled-plugins/codex-skilled/`. Install that directory through the Codex host’s supported local-plugin flow. Source and release information live in [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd); use the [release page](https://github.com/DeadHead04/skillEd/releases) for packaged bundles once assets are published. No marketplace installation is required.

For CLI installation, follow the [installation guide](../../docs/guide/installation.md). The plugin can capture and review observations without the CLI, while evaluation requires `skilled` on PATH.

If the repository is private, release downloads require an authenticated GitHub session or GitHub CLI. Source builds and local plugin archives remain available without a public release.
