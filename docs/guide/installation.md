# Installation

Install **`skilled` 0.2.0** from [GitHub Releases](https://github.com/DeadHead04/skillEd/releases/tag/v0.2.0). The self-contained CLI includes its own Node runtime; end users do not need Go, Node or npm. The command is `skilled`; the bundled `skilled-improve` workflow is used by your agent through MCP or a host integration, not as a separate terminal command.

The repository and release assets are public. No GitHub login is required. This project does not publish the unqualified `skilled` npm registry package; install the GitHub release or the exact npm tarball attached to it.

## Install from GitHub Releases

### macOS and Linux

```sh
curl -fsSL https://raw.githubusercontent.com/DeadHead04/skillEd/main/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"
skilled --version
skilled --help
```

Bash, curl, and standard archive tools are required. Add the PATH line to your shell startup file, such as `~/.zshrc` or `~/.bashrc`. The installer checks the archive checksum, product, version and target, runs the bundled executable, and installs the command only after validation passes. `INSTALL_DIR` overrides `~/.local/bin`.

To inspect the installer before running it or pin a release:

```sh
curl -fsSL https://github.com/DeadHead04/skillEd/releases/download/v0.2.0/install.sh -o install.sh
# Review install.sh, then run:
SKILLED_VERSION=0.2.0 bash install.sh
```

### Windows PowerShell

```powershell
$installer = Join-Path $env:TEMP 'skilled-install.ps1'
Invoke-WebRequest https://raw.githubusercontent.com/DeadHead04/skillEd/main/install.ps1 -OutFile $installer
& $installer
$env:Path = "$(Join-Path $HOME '.local/bin');$env:Path"
skilled --version
skilled --help
```

Add `$HOME\.local\bin` to your user PATH for future terminals. Pass `-Version '0.2.0'` to pin the version and `-InstallDir <path>` to choose the destination. If PowerShell prevents downloaded scripts, inspect the script and follow your organization's script policy.

### Private forks and mirrors

For a private fork, install [GitHub CLI](https://cli.github.com/) and authenticate with access to that fork. Download its installer with `gh release download`, then enable `SKILLED_USE_GH=1` (PowerShell: `-UseGh`). This uses your existing GitHub CLI login without putting tokens in URLs. This mode is optional and is not required for this public repository.

Use `SKILLED_REPOSITORY=owner/repository` for another GitHub repository, or `SKILLED_RELEASE_BASE_URL` for an HTTP mirror containing `vVERSION/` directories. Authenticated GitHub mode cannot be combined with mirror URLs. `latest` selects the latest non-prerelease GitHub release.

## Choose an installation method

| Method | Requirements | Source |
| --- | --- | --- |
| Release installer | Bash or PowerShell; GitHub CLI/login for private assets | Versioned GitHub Release |
| Self-contained archive | Matching OS/architecture; no separate Node, Go or Python | Release `.tar.gz` or `.zip` plus checksum |
| npm tarball | Node 24.21.0 or later in the 24.x series, npm | Exact release `skilled-0.2.0.tgz` |
| Source checkout | Node 24.21.0, npm, Git | `npm ci` and `npm run build` |

Engine/provider credentials are separate from installing the CLI. Docker is required when selecting the Docker runtime. OpenSandbox needs its configured server. See [user configuration](./user-config.md).

## Build from source

Use Node **24.21.0**, npm, and Git:

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

The final command selects and validates cases without a model call. For a command on PATH, build a package below and install it. Source installation does not require a published release.

## macOS or Linux: install the local archive

Run from the repository root. This example selects macOS Apple Silicon. Change `target` to `darwin-x64`, `linux-arm64` or `linux-x64` for another machine.

```sh
target=darwin-arm64
version=0.2.0
bundle="skilled_${version}_${target}"

# Verify before extracting. On Linux use sha256sum -c instead.
(cd artifacts && shasum -a 256 -c "$bundle.tar.gz.sha256")
mkdir -p "$HOME/.local/opt/skilled"
tar -xzf "artifacts/$bundle.tar.gz" -C "$HOME/.local/opt/skilled"
export PATH="$HOME/.local/opt/skilled/$bundle:$PATH"
skilled --version
skilled --help
```

Keep the complete extracted directory together; the launcher uses its adjacent runtime and application files. To persist the command, add the resulting `export PATH=…` line with the actual bundle name to your shell startup file, such as `~/.zshrc`. A bare symlink to the archive launcher is not supported.

If the archive has not been built, use `npm run package -- --target=darwin-arm64` first, substituting your target. Existing accepted archives are listed with hashes in `artifacts/release-manifest.json`.

## Windows: install the local archive

Use `win32-x64` or `win32-arm64` to match Windows. From the repository root in PowerShell:

```powershell
$bundle = 'skilled_0.2.0_win32-x64'
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

Add that bundle directory to your user PATH for future terminals. The release workflow verifies the archive on a native Windows runner before publication and tests the PowerShell installer against the published assets. Other architectures require separate native execution checks; see [platform status](./windows.md).

## Install the local npm package

From the repository root, with the candidate tarball already built:

```sh
npm install --global ./artifacts/skilled-0.2.0.tgz
skilled --version
skilled --help
```

The npm package uses the installed Node runtime. Alternatively, run without a global installation:

```sh
npm exec --yes --package=./artifacts/skilled-0.2.0.tgz -- skilled --version
```

These commands deliberately identify the local tarball. This project has not published the unqualified npm package name. `private: true` currently prevents accidental registry publication. Packaging maintainers can create just the npm tarball with `npm run build` followed by `npm pack --pack-destination artifacts`.

## Download archives manually

Download the matching platform archive and its checksum, then use the local extraction instructions above:

```sh
gh release download v0.2.0 --repo DeadHead04/skillEd \
  --pattern 'skilled_0.2.0_darwin-arm64.tar.gz*' --dir artifacts
```

Replace `darwin-arm64` with `darwin-x64`, `linux-arm64`, or `linux-x64`. Windows uses `skilled_0.2.0_win32-x64.zip*` or `win32-arm64`. For the npm tarball, download `skilled-0.2.0.tgz` and its `.sha256` file, verify the hash, then install that exact file globally. Never substitute an unrelated package from the npm registry.

## Verify, update and uninstall

After any installation, run `skilled --version` and `skilled --help`. From this checkout, validate the included example without a model call:

```sh
skilled validate examples/code-stats/evals/eval.yaml
skilled run examples/code-stats/evals/eval.yaml --dry-run
```

For an archive update, verify and extract the new version, then change the PATH entry. For a release update, rerun the public installation command above with `SKILLED_VERSION=latest` (PowerShell: `-Version latest`); a failed validation preserves the existing wrapper, and prior content-addressed bundles remain on disk. For npm, install the new local tarball using the same global-install command.

To uninstall npm, run `npm uninstall --global skilled`. For a manually extracted archive, remove its PATH entry and the specific extracted bundle directory. For the hosted installer, remove its `skilled`/`skilled.cmd` wrapper and its owned bundle directories under `INSTALL_DIR/.skilled/`. User configuration, credentials and evaluation workspaces are separate and are not part of uninstalling the executable.

## Names and paths

| Component | Name or location |
| --- | --- |
| Product / CLI | `skilled` |
| Improvement workflow | `skilled-improve` |
| Codex / DSH plugins | `codex-skilled` / `dsh-skilled` |
| Product environment variables | `SKILLED_…` |
| Project configuration | `.skilled.yaml` |
| User configuration | `$XDG_CONFIG_HOME/skilled/config.yaml`, or `~/.config/skilled/config.yaml` |
| Credentials | `~/.skilled/credentials.yaml` |

The logo, docs, reports, CLI help, plugin manifests and release filenames use these names. Provider-owned environment variables retain their provider names. Apache-2.0 and Alibaba copyright notices are preserved. The original checkout and migration records are separate from the product.

## Plugins, image and publication

`npm run build` assembles the two plugin bundles under `dist/bundled-plugins/`. They require their respective host and a compatible Node installation; installing the CLI does not enable a plugin or its observation capture automatically. The root README links each plugin's setup instructions.

The Action image can be built with `docker build -f action/Dockerfile -t skilled-action:local .`. This image runs the Action entrypoint; it is separate from the desktop CLI installation. The release workflow builds archives, verifies them on Linux/macOS/Windows, and publishes accepted assets to `DeadHead04/skillEd`. It then tests the downloaded installers against that release. Container and npm publication still need registry/package ownership and credentials. The [documentation site](https://deadhead04.github.io/skillEd/) is deployed from this repository. See [CI maintenance](./ci-maintenance.md).

The published release passed native archive and installer checks on Linux, macOS, and Windows. Separate development checks covered Linux ARM64 Docker and translated/emulated x64 execution. See [verification evidence](../verification.md) for scope; six packaged targets do not imply six native device checks.
