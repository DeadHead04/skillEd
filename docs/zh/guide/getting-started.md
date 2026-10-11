# 快速上手

`skilled` 用于评估 Agent Skill、Agent 和工作空间。`skilled-improve` 工作流帮助 Agent 阅读报告、改进 Skill 或用例，并重新执行评测。

所有安装方式、名称和路径详见[品牌与安装](./installation.md)。

## 本地源码

从 [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd) 获取 TypeScript 源码。当前开发版本为 `0.1.0-dev.0`，开发需要 **Node 24.21.0**、npm 和 Git。私有仓库需要已认证的 Git，或使用 `gh repo clone DeadHead04/skillEd`：

```sh
git clone https://github.com/DeadHead04/skillEd.git
cd skillEd
npm ci
npm run build
node dist/src/bootstrap.js --version
node dist/src/bootstrap.js --help
```

开发入口为 `node dist/src/bootstrap.js`。自包含归档内置 Node，并提供 `skilled` 启动器（Windows 为 `skilled.cmd`）；下面命令使用已安装的启动器，在源码目录中可替换为开发入口。

```sh
npm run package -- --target=darwin-arm64
node scripts/verify-package.mjs artifacts/skilled_0.1.0-dev.0_darwin-arm64.tar.gz
```

选择与设备匹配的归档。现有执行证据覆盖 macOS arm64 和 Linux arm64 Docker；生成其他目标的归档不代表原生验证通过。

## 评估 Skill

`SKILL.md` 与 `evals/` 位于同一 Skill 根目录，用例文件和仓库样本路径相对此根目录解析。

```text
my-skill/
  SKILL.md
  evals/
    eval.yaml
    cases/basic.yaml
```

```sh
skilled validate ./my-skill/evals/eval.yaml
skilled list-cases ./my-skill/evals/eval.yaml
skilled run ./my-skill/evals/eval.yaml --dry-run
skilled run ./my-skill/evals/eval.yaml --format json --format html --format junit
```

实际模型执行需要凭据，`--dry-run` 不调用模型。通过环境变量或 `~/.skilled/credentials.yaml` 配置，参见[用户配置](./user-config.md)，不要把真实密钥写入版本库。

## 根据证据改进

工作流源文件为 `skills/skilled-improve/SKILL.md`。运行 `npm run build` 和 `node scripts/package-plugins.mjs` 后，通过宿主的本地插件接口安装 `dist/bundled-plugins/codex-skilled` 或 `dist/bundled-plugins/dsh-skilled`。

可以让 Agent：“使用 skilled-improve 为这个 Skill 添加评测，检查失败报告，改进 Skill 或用例，然后重新执行。”跳过或无法执行的检查不能被视为通过。

## 示例

源码包含 `examples/code-stats`、`examples/deepseek-harness` 和 `examples/user-simulator`。先验证各自的 `evals/eval.yaml`，再按 README 配置引擎和凭据。DSH 示例使用编译后的 TypeScript ACP 桥接程序；代码统计样本中的 Go 文件只是评测输入。

## 验证范围

本地进程、Docker、OpenSandbox、MCP、报告、事件和插件服务分别记录执行证据。真实模型调用需要指定模型、凭据和费用限制。已测试的 OpenSandbox execd 1.0.16 在两个实现中都会丢失 stdout 换行，影响 glob 文件收集；直接下载和报告已验证。

## 核心概念

使用 skilled 评测一个 Skill，你需要准备两样东西：

1. **eval.yaml** — 评测入口配置，声明运行环境、使用的 Engine 和模型、评估方式等全局设置
2. **case.yaml** — 单个评测用例，定义要发给 Agent 的 prompt、预期结果和评分规则

它们放在你 Skill 目录下的 `evals/` 文件夹中：

```plain
my-skill/
  SKILL.md              # 你的 Skill 定义
  evals/                # 评测目录
    eval.yaml           # 评测入口配置
    cases/              # 用例目录
      basic-test.yaml   # 一个评测用例
      edge-case.yaml    # 另一个评测用例
    fixtures/           # 测试资源（可选）
      repos/            # 仓库模板
      scripts/          # 评估脚本
```

---

## 5 分钟上手

### 第一步：创建评测配置

在你的 Skill 目录下创建 `evals/eval.yaml`：

```yaml
schema_version: v1alpha1

environment:
  type: none                    # 纯文本 Skill 无需容器隔离

engine:
  name: claude_code             # 使用 Claude Code 作为 Agent Engine

cases:
  files:
    - evals/cases/hello-world.yaml
```

> **提示：** 当 `evals/eval.yaml` 位于包含 `SKILL.md` 的目录下时，skilled 会自动安装当前 Skill。未写出的字段会使用默认值：JSON 报告、`timeout_seconds: 300`、`max_turns: 10`、`parallelism: 1`。只有需要覆盖默认行为时，才添加 `engine.model`、`skills`、`cases.defaults` 或 `report`。

完整的 `eval.yaml` 配置说明见 [编写评测配置与用例](./writing-evals)。

### 第二步：编写 Eval Case

创建 `evals/cases/hello-world.yaml`：

```yaml
input:
  prompt: |
    请帮我生成一个 Hello World 程序

expect:
  must_contain:
    - "Hello"
    - "World"
  must_not_contain:
    - "error"
```

用例 `id` 默认取文件名（这里是 `hello-world`）。只有在需要脚本评测或 Agent 评测时，才需要额外添加 `judge` 配置。

### 第三步：校验配置

这一步是可选的，但建议首次运行前执行：它只检查 `eval.yaml` 和引用的用例文件，不会启动 Agent Engine。

```bash
skilled validate
```

正确时输出：

```plain
✓ eval.yaml is valid (loaded 1 case(s))
```

### 第四步：运行评测

```bash
skilled run
```

你将看到类似这样的输出：

```plain
Running 1 case(s) with agent claude_code
[Runner] Running 1 cases with agent claude_code
[Evaluator] Skill installed: <skill-name>
[Evaluator] Running case hello-world (with_skill): Skill 应该正确响应基本请求
[Evaluator] Case hello-world: PASS (pass_rate: 100.0%)
[INFO] Results written to ./<skill-name>-workspace/iteration-1
```

---

## 下一步

- [编写评测配置与用例](./writing-evals) — 了解 `eval.yaml` 和 `case.yaml` 的完整配置方式
- [CLI 命令参考](./cli-reference) — 查看所有可用命令和参数
- [从 Anthropic 格式迁移](./migration) — 如果你已有 Anthropic skill-creator 的 `evals.json`
