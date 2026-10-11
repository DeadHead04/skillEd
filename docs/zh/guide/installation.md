# 品牌与安装

产品和命令统一为 **`skilled`**。源码和 GitHub 发布使用 [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd)，当前开发版本为 `0.1.0-dev.0`。源码存在不代表已有可下载的发行包；npm、容器与公开文档站点尚未发布。

## 名称与路径

| 组件 | 名称或位置 |
| --- | --- |
| 产品 / CLI | `skilled` |
| 改进工作流 | `skilled-improve` |
| Codex / DSH 插件 | `codex-skilled` / `dsh-skilled` |
| 产品环境变量 | `SKILLED_…` |
| 项目配置 | `.skilled.yaml` |
| 用户配置 | `$XDG_CONFIG_HOME/skilled/config.yaml`，否则为 `~/.config/skilled/config.yaml` |
| 凭据 | `~/.skilled/credentials.yaml` |

Logo、文档、报告、帮助、插件清单和发布文件名均使用这些名称。提供商自己的环境变量保留其名称；Apache-2.0 和 Alibaba 原始版权声明保留。原始代码与迁移记录存放在产品目录之外。

## 选择安装方式

| 方式 | 前提 | 当前状态 |
| --- | --- | --- |
| 自包含归档 | 匹配系统与架构；无需另外安装 Node、Go 或 Python | 本地 `artifacts/` 中可用 |
| npm 压缩包 | Node 24.21.0 或更高的 24.x 版本、npm | 本地 `artifacts/skilled-0.1.0-dev.0.tgz` 可用 |
| 源码 | Node 24.21.0、npm、Git | `npm ci` 后 `npm run build` |
| GitHub 版本下载 | 已发布资产；私有仓库需要已认证的 GitHub CLI | 下载、校验并解压匹配归档 |
| HTTP 安装器 | 匿名可读的资产或可访问镜像；Bash/curl 或 PowerShell | 使用 `DeadHead04/skillEd`；私有 GitHub 资产请使用上一种方式 |

安装 CLI 与模型认证是两回事。Docker 运行时需要 Docker，OpenSandbox 需要已配置的服务。参见[用户配置](./user-config.md)。

## 从源码构建

使用 Node **24.21.0** 和 npm。仓库为私有时，需要已授权的 Git 账号，也可用 `gh repo clone DeadHead04/skillEd` 克隆：

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

最后一条命令验证并选择用例，不调用模型。需要 PATH 中的命令时，可按下文构建和安装包。源码安装无需等待公开发行版。

## macOS / Linux 本地归档

在仓库根目录执行。以下选择 Apple Silicon；其他设备把 `target` 改为 `darwin-x64`、`linux-arm64` 或 `linux-x64`。

```sh
target=darwin-arm64
version=0.1.0-dev.0
bundle="skilled_${version}_${target}"

# Linux 使用 sha256sum -c 代替 shasum -a 256 -c。
(cd artifacts && shasum -a 256 -c "$bundle.tar.gz.sha256")
mkdir -p "$HOME/.local/opt/skilled"
tar -xzf "artifacts/$bundle.tar.gz" -C "$HOME/.local/opt/skilled"
export PATH="$HOME/.local/opt/skilled/$bundle:$PATH"
skilled --version
skilled --help
```

保留整个解压目录，启动器依赖相邻的运行时与应用文件。将包含实际版本目录名的 PATH 配置加入 `~/.zshrc` 等启动文件以持久生效；不支持只给启动器创建一个裸符号链接。

如果尚未构建归档，先执行 `npm run package -- --target=darwin-arm64`，替换为实际目标。现有候选包及哈希记录在 `artifacts/release-manifest.json`。

## Windows 本地归档

选择与系统匹配的 `win32-x64` 或 `win32-arm64`。在仓库根目录的 PowerShell 中执行：

```powershell
$bundle = 'skilled_0.1.0-dev.0_win32-x64'
$archive = Join-Path $PWD "artifacts/$bundle.zip"
$expected = ((Get-Content "$archive.sha256") -split '\s+')[0]
if ((Get-FileHash -Algorithm SHA256 $archive).Hash -ne $expected) {
    throw 'Archive checksum mismatch'
}
$destination = Join-Path $HOME '.local/opt/skilled'
New-Item -ItemType Directory -Force $destination | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $destination
$env:Path = "$(Join-Path $destination $bundle);$env:Path"
skilled.cmd --version
skilled.cmd --help
```

将该版本目录加入用户 PATH 可供后续终端使用。Windows 归档已通过完整性检查，但当前开发设备尚未执行原生 Windows 或 PowerShell 安装器验证。

## 本地 npm 包

仓库根目录已有候选 tarball 时：

```sh
npm install --global ./artifacts/skilled-0.1.0-dev.0.tgz
skilled --version
skilled --help
```

npm 包使用系统已安装的 Node。也可不进行全局安装：

```sh
npm exec --yes --package=./artifacts/skilled-0.1.0-dev.0.tgz -- skilled --version
```

这些命令明确指向本地包；本项目尚未发布无 scope 的 npm 名称。当前 `private: true` 防止误发布。只构建 npm 包可执行 `npm run build`，然后 `npm pack --pack-destination artifacts`。

## 发布后的在线安装

先确认 [GitHub Releases](https://github.com/DeadHead04/skillEd/releases) 中已有目标版本、平台归档和 SHA-256 文件。仅有源码标签不能完成安装；以下说明不代表已发布版本。

**私有仓库**需要已授权的 GitHub CLI 会话。以下把 macOS ARM64 资产下载到前文使用的 `artifacts/` 目录：

```sh
gh auth status
gh release download v0.1.0-dev.0 --repo DeadHead04/skillEd \
  --pattern skilled_0.1.0-dev.0_darwin-arm64.tar.gz \
  --pattern skilled_0.1.0-dev.0_darwin-arm64.tar.gz.sha256 \
  --dir artifacts
```

Windows 使用 `gh release download v0.1.0-dev.0 --repo DeadHead04/skillEd --pattern "skilled_0.1.0-dev.0_win32-x64.zip*" --dir artifacts`；按需替换为 `win32-arm64`。随后按前文对应平台的本地归档步骤校验并安装。认证由 GitHub CLI 管理，不要把令牌放入下载 URL。

**匿名可读资产或可访问镜像**可使用源码中的 HTTP 安装器。安装器不会读取 GitHub CLI 认证，因此无法下载私有 GitHub 版本资产：

```sh
SKILLED_REPOSITORY=DeadHead04/skillEd \
SKILLED_VERSION=0.1.0-dev.0 \
bash ./install.sh
export PATH="$HOME/.local/bin:$PATH"
skilled --version
```

Windows：

```powershell
./install.ps1 -Repository 'DeadHead04/skillEd' -Version '0.1.0-dev.0'
$env:Path = "$(Join-Path $HOME '.local/bin');$env:Path"
skilled.cmd --version
```

`DeadHead04/skillEd` 是本项目的发布仓库。安装器从 `releases/download/vVERSION/` 下载匹配归档和 SHA-256 文件，检查哈希、产品、版本与目标，执行 CLI 版本检查后才切换启动包装器。`INSTALL_DIR` 可覆盖默认 `~/.local/bin`；其他 HTTP 服务使用 `SKILLED_RELEASE_BASE_URL` 指向各 `vVERSION` 目录的父路径。开发或预发布版本请明确指定版本；`latest` 使用服务器的最新发布解析。

## 验证、更新与卸载

安装后运行 `skilled --version` 和 `skilled --help`。从源码目录验证示例，不调用模型：

```sh
skilled validate examples/code-stats/evals/eval.yaml
skilled run examples/code-stats/evals/eval.yaml --dry-run
```

手动归档更新：校验并解压新版本，然后修改 PATH。在线更新：以目标版本重新运行安装器；验证失败会保留原包装器，旧版按内容哈希命名的目录仍保留。npm 更新：用相同的全局安装命令安装新 tarball。

npm 卸载使用 `npm uninstall --global skilled`。手动归档卸载时移除 PATH 条目与对应版本目录。在线安装器卸载时移除其 `skilled`/`skilled.cmd` 包装器及 `INSTALL_DIR/.skilled/` 下属于它的版本目录。用户配置、凭据和评测工作空间与程序分开，不属于卸载可执行文件的范围。

## 插件、镜像与发布

`npm run build` 在 `dist/bundled-plugins/` 中生成两个插件。插件需要对应宿主与兼容的 Node；安装 CLI 不会自动启用插件或观察记录。根 README 链接各插件的设置说明。

Action 镜像构建命令为 `docker build -f action/Dockerfile -t skilled-action:local .`。它运行 Action 入口，与桌面 CLI 安装分开。GitHub 发布和镜像工作流已提供；GitHub 版本发布到 `DeadHead04/skillEd`，需要配置 release 环境。npm 与容器发布还需相关注册表权限和凭据；公开文档托管需单独配置。参见 [CI 维护](./ci-maintenance.md)。

已验证 macOS ARM64、Linux ARM64 Docker、Rosetta 下的 macOS x64、Docker 模拟下的 Linux x64。六种归档均已验证完整性；翻译或模拟执行不代表原生 x64 设备认证。
