# skilled-improve

The canonical workflow creates evaluation cases, validates suites, reviews real reports, and improves a Skill from observed failures. Read `SKILL.md` for the workflow and `references/` for CLI and schema details.

The `evals/` directory retains the source workflow scenarios and shell/Python assertion fixtures. Its deterministic assertion checks run with:

```sh
python3 skills/skilled-improve/evals/test_regression_scripts.py
```

From the repository root, run a workflow suite with the migrated CLI:

```sh
npm run build
node dist/src/bootstrap.js validate skills/skilled-improve/evals/eval.yaml
node dist/src/bootstrap.js run skills/skilled-improve/evals/eval.yaml
```

The run requires the selected real engine, provider credentials and permission to incur model costs. The DashScope variant is `evals/eval-dashscope.yaml`; it requires `DASHSCOPE_API_KEY` and OpenCode. Those authenticated workflow scenarios have not been rerun during local migration acceptance. `test-model` in simulator-generation scenarios is a placeholder for configuration validation, not proof of a real simulator response.

Local installation details are in `references/install.md`. Hosted release destinations are pending the release phase.
