# Windows 与平台状态

迁移保留 Windows 进程、Shell、环境变量和路径处理。Windows x64/arm64 是归档构建目标，但现有环境尚未执行原生 Windows 验证。生成归档不等于兼容性认证。

## 安装与开发

安装 Node 24.21.0、npm 和 Git 后运行：

```powershell
npm ci
npm run build
node dist/src/bootstrap.js --version
npm run typecheck
npm test
```

源码开发需要 Node；自包含 Windows 归档内置 Node 和 `skilled.cmd` 启动器。解压与机器架构匹配的归档后执行 `skilled.cmd --help`。

## 保留的运行行为

`none` 在本机执行，Windows Shell 使用 `cmd.exe`，进程树终止使用 `taskkill`。OpenSandbox 在远程 Linux 沙箱执行。Docker 需要本机可用的容器环境；当前 Docker 证据来自 macOS 上的 Linux 容器。

脚本 Judge 根据后缀选择解释器：`.ps1` 使用 PowerShell，`.cmd`/`.bat` 使用 `cmd.exe`，`.sh` 需要 bash。可通过 `SKILLED_BASH` 指定路径，也会查找 PATH 和常见 Git Bash 安装目录。由于路径语义不同，Windows 的 WSL bash shim 被排除。

## 未验证项

尚无原生 Windows 或需要认证的模型会话验证。对目标设备运行完整 gate 并保存平台版本证据后，再声明支持。不能用 Linux 沙箱结果推断 Windows 来宾支持。已测试的 OpenSandbox execd 1.0.16 在两个实现中都会丢失 stdout 换行，影响 glob 文件收集。
