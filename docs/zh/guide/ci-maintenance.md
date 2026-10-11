# CI 维护

本候选版本使用 npm、TypeScript 和 Node 测试运行器。GitHub 工作流位于 [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd/actions)；文件存在不代表远程工作流成功或已有公开版本。

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run audit:brand
npm run docs:build
```

Makefile 提供 `build`、`verify`、`test`、`test-action`、`e2e`、`hooks`、`package`、`package-plugins`、`docs` 和 `fmt-check`。`fmt-check` 检查空白错误，不是 Go 格式化工具。Windows 包装脚本位于 `scripts/windows/`。

## 真实集成

`SKILLED_DOCKER_INTEGRATION=1` 启用真实容器检查，`SKILLED_ENGINE_INSTALL_INTEGRATION=1` 在临时容器中安装官方 CLI，不调用模型。浏览器测试需要 Chrome/Playwright；OpenSandbox 与 OTLP 使用真实配置的服务。

`npm run gate -- --phase=5` 将提交、平台、日志和测试数量记录在 `evidence/runs/`。不可用的服务或设备必须标记为未验证。模型测试需要提供商、模型、凭据和费用限制；CLI 安装成功不能证明模型调用成功。

## 发布

先构建不可变产物并检查校验和，再安装测试同一候选版本，最后发布到已确认归属的地址，保留回滚产物。GitHub 版本使用 [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd/releases)，需要配置 release 环境、令牌权限及必要审批。npm、容器和文档托管还需各自的目标与凭据，不能仅凭源码存在就宣称已经发布。

验证任务使用只读令牌。不要让不可信代码接触发布密钥或高权限持久化 Runner。日志和报告中不得包含模型凭据，也不能把失败或不可用检查转换为成功。
