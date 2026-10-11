<p align="center"><img src="assets/logo.svg" width="96" alt="skilled" /></p>

# skilled

[English](README.md)

为 Agent Skill、Agent 和工作空间建立可重复的检查。用 YAML 描述任务与预期行为，选择引擎，在本地或隔离环境中运行同一套用例。`skilled` 生成 JSON、JUnit 和 HTML 结果；`skilled-improve` 帮助 Agent 根据结果修改 Skill 或完善评测。

![评测与改进流程](docs/public/overview.svg)

TypeScript 源码位于 [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd)。命令和包名为 **`skilled`**，当前开发版本为 `0.1.0-dev.0`。此移植保留既有评测契约，并按 [Apache-2.0](LICENSE) 保留 Alibaba 原始版权声明。仓库为私有时需要访问授权，获授权用户可从源码安装；已发布归档请查看 [GitHub Releases](https://github.com/DeadHead04/skillEd/releases)。npm、容器和文档托管尚未发布。

## 本地构建

使用 **Node 24.21.0**（`.nvmrc`）、npm 和 Git。容器测试需要 Docker。私有仓库需要已认证的 Git，也可使用 `gh repo clone DeadHead04/skillEd`。

```sh
git clone https://github.com/DeadHead04/skillEd.git
cd skillEd
npm ci
npm run build
node dist/src/bootstrap.js --version
node dist/src/bootstrap.js --help
node dist/src/bootstrap.js validate examples/code-stats/evals/eval.yaml
node dist/src/bootstrap.js run examples/code-stats/evals/eval.yaml --dry-run
```

`--dry-run` 只验证配置并列出选中的用例，不调用模型。实际执行需要引擎或提供商的账号和凭据；请通过环境变量或 `~/.skilled/credentials.yaml` 提供，不要写入示例、报告或版本库。

```sh
node dist/src/bootstrap.js run /path/to/skill/evals/eval.yaml --format json --format html --format junit
```

支持 `evals/eval.yaml` 和 Anthropic `evals/evals.json` 自动发现。`--baseline` 比较有/无 Skill；`--iteration N` 重复 N 次，默认追加下一个编号迭代。`--event-log /path/to/events.jsonl` 输出生命周期事件。详见 [CLI 参考](docs/zh/guide/cli-reference.md)。

归档解压、PATH、npm、Windows、在线安装、更新与卸载步骤详见[品牌与安装](docs/zh/guide/installation.md)。

## 本地安装包

```sh
npm run package -- --target=darwin-arm64
node scripts/verify-package.mjs artifacts/skilled_0.1.0-dev.0_darwin-arm64.tar.gz
```

归档包含 Node、编译后的代码、生产依赖、资源和启动器。选择与设备匹配的目标；解压后执行 `skilled`，Windows 使用 `skilled.cmd`。构建目标包括 Linux、macOS、Windows 的 x64/arm64，但产出归档不代表已通过原生系统验证。执行检查覆盖 macOS arm64、Linux arm64 Docker、Rosetta 下的 macOS x64 和 Docker 模拟下的 Linux x64。原生 Windows、其他原生设备和需要认证的模型组合仍未验证。版本归档发布到 [GitHub Releases](https://github.com/DeadHead04/skillEd/releases) 后，请按[发行包安装说明](docs/zh/guide/installation.md#发布后的在线安装)操作。私有资产需通过已认证的 GitHub CLI 下载；HTTP 安装器需要匿名可读资产或可访问镜像。

## 工作流与插件

[skills/skilled-improve](skills/skilled-improve/SKILL.md) 是唯一工作流源。执行 `npm run build` 和 `node scripts/package-plugins.mjs` 后，使用宿主的本地安装流程加载 `dist/bundled-plugins/codex-skilled` 或 `dist/bundled-plugins/dsh-skilled`。详见 [Codex 插件](plugins/codex-skilled/README.md) 和 [DSH 插件](plugins/dsh-skilled/README.md)。本地安装成功不等于已验证需要认证的宿主模型会话。

## 代码结构

`src/cli`、`src/api` 提供命令和执行入口；`src/config`、`src/contracts`、`src/credentials` 处理配置；`src/runtime`、`src/platform`、`src/agent`、`src/mcp`、`src/skill` 处理工作空间与引擎；`src/evaluator`、`src/judge`、`src/usersimulator`、`src/runner` 执行用例与迭代；`src/report` 生成报告。`tests`、`examples`、`docs`、`proposals` 保存真实测试、示例和历史设计资料。

TypeScript 编译为 ESM JavaScript。配置与报告字段保留原格式，内部接口使用 Promise、camelCase 和 `AbortSignal`。代码统计示例中的 Go 文件是有意保留的**输入样本**，不是程序运行依赖。

## 验证与文档

已验证范围与待完成检查见[验证状态](docs/verification.md)。

```sh
npm run typecheck
npm run test:real
npm run audit:brand
npm run docs:build
```

`SKILLED_DOCKER_INTEGRATION=1` 启用真实 Docker 测试，`SKILLED_ENGINE_INSTALL_INTEGRATION=1` 启用官方引擎安装测试。`npm run gate -- --phase=5` 将证据写入 `evidence/runs/`。跳过的服务或设备检查表示未验证，不是通过。真实模型测试需要明确的提供商、模型、凭据和费用限额。

已测试的 OpenSandbox execd 1.0.16 在原始实现和此迁移中都会丢失 stdout 换行；直接文件下载、结果与报告已验证，但基于 glob 的文件收集仍受此上游问题限制。本地和 Docker 的收集正常测试。

运行 `npm run docs:dev` 查看双语站点；`npm run docs:build` 生成 `docs/.vitepress/dist`。子路径部署使用 `SKILLED_DOCS_BASE`。请阅读 [快速上手](docs/zh/guide/getting-started.md)、[编写评测](docs/zh/guide/writing-evals.md)、[用户配置](docs/zh/guide/user-config.md) 和 [贡献指南](CONTRIBUTING.md)。发布验证与维护流程见 [CI 维护](docs/zh/guide/ci-maintenance.md)。
