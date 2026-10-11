# Installation

Install **`skilled` 0.1.0** from [GitHub Releases](https://github.com/DeadHead04/skillEd/releases/tag/v0.1.0). The self-contained CLI includes its own Node runtime; end users do not need Go, Node or npm. The default command is `skilled`, and the workflow is `skilled-improve`.

The repository is currently private. GitHub login is required to download its source or release assets. This project does not publish the unqualified `skilled` npm registry package; install the GitHub release or the exact npm tarball attached to it.

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

## Install from GitHub Releases

### macOS and Linux

Install [GitHub CLI](https://cli.github.com/) and authenticate with access to this repository:

```sh
gh auth login
installer_dir="$(mktemp -d)"
gh release download v0.1.0 --repo DeadHead04/skillEd --pattern install.sh --dir "$installer_dir"
SKILLED_USE_GH=1 SKILLED_VERSION=0.1.0 bash "$installer_dir/install.sh"
export PATH="$HOME/.local/bin:$PATH"
skilled --version
skilled --help
```

Add the PATH line to your shell startup file, such as `~/.zshrc` or `~/.bashrc`. `SKILLED_USE_GH=1` uses your existing GitHub CLI login; it does not place tokens in URLs. The installer checks the archive checksum, product, version and target, runs the bundled executable, and installs the command only after validation passes. `INSTALL_DIR` overrides `~/.local/bin`.

### Windows PowerShell

```powershell
gh auth login
$installerDir = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString('N'))
gh release download v0.1.0 --repo DeadHead04/skillEd --pattern install.ps1 --dir $installerDir
& (Join-Path $installerDir 'install.ps1') -UseGh -Version '0.1.0'
$env:Path = "$(Join-Path $HOME '.local/bin');$env:Path"
skilled --version
skilled --help
```

Add `$HOME\.local\bin` to your user PATH for future terminals. If your PowerShell policy prevents downloaded scripts, inspect the script and follow your organization's script policy.

### Public repository or mirror

When the repository is public, the same download-and-install flow works without GitHub login:

```sh
curl -fsSL https://raw.githubusercontent.com/DeadHead04/skillEd/main/install.sh | bash
```

For a fixed public version, download the script first and run `SKILLED_VERSION=0.1.0 bash install.sh`. On Windows, download `install.ps1` and run `./install.ps1 -Version '0.1.0'`. These anonymous commands cannot download a private repository; use `SKILLED_USE_GH=1` / `-UseGh` above.

Use `SKILLED_REPOSITORY=owner/repository` for another GitHub repository, or `SKILLED_RELEASE_BASE_URL` for an HTTP mirror containing `vVERSION/` directories. Authenticated GitHub mode cannot be combined with mirror URLs. `latest` selects the latest non-prerelease GitHub release.

## Choose an installation method

| Method | Requirements | Source |
| --- | --- | --- |
| Release installer | Bash or PowerShell; GitHub CLI/login for private assets | Versioned GitHub Release |
| Self-contained archive | Matching OS/architecture; no separate Node, Go or Python | Release `.tar.gz` or `.zip` plus checksum |
| npm tarball | Node 24.21.0 or later in the 24.x series, npm | Exact release `skilled-0.1.0.tgz` |
| Source checkout | Node 24.21.0, npm, Git | `npm ci` and `npm run build` |

Engine/provider credentials are separate from installing the CLI. Docker is required when selecting the Docker runtime. OpenSandbox needs its configured server. See [user configuration](./user-config.md).

## Build from source

Use Node **24.21.0** and npm. While the repository is private, authenticate Git with an authorized account or clone using `gh repo clone DeadHead04/skillEd`:

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
version=0.1.0
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
$bundle = 'skilled_0.1.0_win32-x64'
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

Add that bundle directory to your user PATH for future terminals. The release workflow verifies the archive on a native Windows runner before publication and tests the PowerShell installer against the published assets. The local development machine cannot execute Windows binaries.

## Install the local npm package

From the repository root, with the candidate tarball already built:

```sh
npm install --global ./artifacts/skilled-0.1.0.tgz
skilled --version
skilled --help
```

The npm package uses the installed Node runtime. Alternatively, run without a global installation:

```sh
npm exec --yes --package=./artifacts/skilled-0.1.0.tgz -- skilled --version
```

These commands deliberately identify the local tarball. This project has not published the unqualified npm package name. `private: true` currently prevents accidental registry publication. Packaging maintainers can create just the npm tarball with `npm run build` followed by `npm pack --pack-destination artifacts`.

## Download archives manually

Download the matching platform archive and its checksum, then use the local extraction instructions above:

```sh
gh release download v0.1.0 --repo DeadHead04/skillEd \
  --pattern 'skilled_0.1.0_darwin-arm64.tar.gz*' --dir artifacts
```

Replace `darwin-arm64` with `darwin-x64`, `linux-arm64`, or `linux-x64`. Windows uses `skilled_0.1.0_win32-x64.zip*` or `win32-arm64`. For the npm tarball, download `skilled-0.1.0.tgz` and its `.sha256` file, verify the hash, then install that exact file globally. Never substitute an unrelated package from the npm registry.

## Verify, update and uninstall

After any installation, run `skilled --version` and `skilled --help`. From this checkout, validate the included example without a model call:

```sh
skilled validate examples/code-stats/evals/eval.yaml
skilled run examples/code-stats/evals/eval.yaml --dry-run
```

For an archive update, verify and extract the new version, then change the PATH entry. For a release update, download the latest installer and rerun with `SKILLED_USE_GH=1 SKILLED_VERSION=latest` (PowerShell: `-UseGh -Version latest`); a failed validation preserves the existing wrapper, and prior content-addressed bundles remain on disk. For npm, install the new local tarball using the same global-install command.

To uninstall npm, run `npm uninstall --global skilled`. For a manually extracted archive, remove its PATH entry and the specific extracted bundle directory. For the hosted installer, remove its `skilled`/`skilled.cmd` wrapper and its owned bundle directories under `INSTALL_DIR/.skilled/`. User configuration, credentials and evaluation workspaces are separate and are not part of uninstalling the executable.

## Plugins, image and publication

`npm run build` assembles the two plugin bundles under `dist/bundled-plugins/`. They require their respective host and a compatible Node installation; installing the CLI does not enable a plugin or its observation capture automatically. The root README links each plugin's setup instructions.

The Action image can be built with `docker build -f action/Dockerfile -t skilled-action:local .`. This image runs the Action entrypoint; it is separate from the desktop CLI installation. The release workflow builds archives, verifies them on Linux/macOS/Windows, and publishes accepted assets to `DeadHead04/skillEd`. It then tests the downloaded installers against that release. Container and npm publication still need registry/package ownership and credentials; public docs hosting is a separate setup step. See [CI maintenance](./ci-maintenance.md).

Verification covers macOS ARM64, Linux ARM64 Docker, macOS x64 through Rosetta and Linux x64 through Docker emulation. All six archives have integrity evidence; translated execution does not certify a native x64 host.
