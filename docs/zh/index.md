---
layout: home

hero:
  name: skilled
  text: 检查 Agent 行为，以证据改进
  tagline: 定义可重复的用例，运行所选引擎，在下一次修改前检查结果。
  image:
    src: /logo.svg
    alt: skilled
  actions:
    - theme: brand
      text: 快速开始
      link: /zh/guide/getting-started
    - theme: alt
      text: 编写评测配置与用例
      link: /zh/guide/writing-evals
    - theme: alt
      text: 语言迁移说明
      link: /zh/guide/migration#语言实现迁移

features:
  - title: skilled-improve 从评测到演进
    details: 通过自然对话创建评测，让 skilled-improve 诊断失败、修复或补充用例，并持续重新运行 skilled，推动评测集不断演进。
    link: /zh/guide/getting-started#根据证据改进
    linkText: 了解更多
  - title: 声明式评测配置
    details: 通过 YAML（eval.yaml + cases/*.yaml）定义评测环境、引擎、模型与用例。
    link: /zh/guide/writing-evals
    linkText: 配置参考
  - title: 多引擎支持
    details: 支持 Qoder CLI、Claude Code、Codex 等多种 Agent Engine。
  - title: 灵活的评判策略
    details: 内置 rule_based、script、agent_judge 三类评判策略。
    link: /zh/guide/writing-evals#评估策略
    linkText: 评估策略
  - title: 结构化报告
    details: 输出 Anthropic 兼容的 grading.json、benchmark.json，以及 result.json、JUnit XML 与 HTML 报告。
    link: /zh/guide/cli-reference#产物目录结构
    linkText: 产物结构
  - title: 兼容 Anthropic 格式
    details: 通过 skilled import 导入 evals.json，或使用 --auto 自动识别。
    link: /zh/guide/migration
    linkText: 迁移指南
  - title: 面向 CI
    details: 同时面向本地开发与持续集成流水线设计。
    link: /zh/guide/cli-reference#退出码
    linkText: 退出码说明
---

## 工作原理

先定义需要检查的行为：一段回答、生成的文件、工具调用或脚本条件。`skilled` 使用所选引擎运行用例、收集证据并报告结果。再让 Agent 使用 `skilled-improve` 分析失败，修改 Skill 或补充缺失用例，然后重新执行。

可选择本地、Docker 或 OpenSandbox 环境，直接运行 Anthropic `evals.json` 或导入为 YAML。JSON、JUnit 和 HTML 输出适合本地检查与 CI。源码和版本位于 [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd)；[安装指南](./guide/installation.md)提供源码构建、归档校验与安装步骤。

![skilled 通过自动修复和迭代 eval 来评测并演进 Agent Skill](/overview.svg)
