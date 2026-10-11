# skilled-improve

此工作流从真实输入建立评测用例、检查报告，并根据失败结果改进 Skill。详细流程见 `SKILL.md`，CLI 和配置说明见 `references/`。

`evals/` 保留原始工作流用例及 shell/Python 测试断言。可以在仓库根目录执行：

```sh
python3 skills/skilled-improve/evals/test_regression_scripts.py
npm run build
node dist/src/bootstrap.js validate skills/skilled-improve/evals/eval.yaml
```

真正运行工作流评测需要对应引擎、模型凭据及模型费用授权。本次迁移的本地验收未重新运行需要模型凭据的工作流。DashScope 配置位于 `evals/eval-dashscope.yaml`。模拟器配置用例中的 `test-model` 仅为校验占位符，不表示真实模型已运行。

本地安装参见 `references/install.md`；发布地址尚未配置。
