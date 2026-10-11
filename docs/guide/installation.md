# Branding and installation

The product and command are **`skilled`**. Source code and GitHub releases use [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd). The current development version is `0.1.0-dev.0`; the presence of source code does not imply a downloadable release. npm, container hosting and a public documentation site are not yet published.

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

## Choose an installation method

| Method | Requirements | Available now |
| --- | --- | --- |
| Self-contained archive | Matching OS/architecture; no separate Node, Go or Python installation | Local `artifacts/` archives |
| npm tarball | Node 24.21.0 or later in the 24.x series, npm | Local `artifacts/skilled-0.1.0-dev.0.tgz` |
| Source checkout | Node 24.21.0, npm, Git | `npm ci` and `npm run build` |
| GitHub release download | Published assets and authorized GitHub CLI for a private repository | Download, verify and extract the matching archive |
| HTTP installer | Anonymously readable release assets or an accessible mirror; curl/Bash or PowerShell | Uses `DeadHead04/skillEd`; private GitHub assets need the download method above |

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
version=0.1.0-dev.0
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

Add that bundle directory to your user PATH for future terminals. Windows archives have passed integrity checks; native Windows execution and the PowerShell installer remain unverified on the current development machine.

## Install the local npm package

From the repository root, with the candidate tarball already built:

```sh
npm install --global ./artifacts/skilled-0.1.0-dev.0.tgz
skilled --version
skilled --help
```

The npm package uses the installed Node runtime. Alternatively, run without a global installation:

```sh
npm exec --yes --package=./artifacts/skilled-0.1.0-dev.0.tgz -- skilled --version
```

These commands deliberately identify the local tarball. This project has not published the unqualified npm package name. `private: true` currently prevents accidental registry publication. Packaging maintainers can create just the npm tarball with `npm run build` followed by `npm pack --pack-destination artifacts`.

## Hosted installation after publishing

First confirm that [GitHub Releases](https://github.com/DeadHead04/skillEd/releases) contains the chosen version, its platform archive and SHA-256 sidecar. A source-only tag is not sufficient. No release publication is implied by these instructions.

For a **private repository**, use an authorized GitHub CLI session. This example downloads macOS ARM64 assets into the `artifacts/` directory used above:

```sh
gh auth status
gh release download v0.1.0-dev.0 --repo DeadHead04/skillEd \
  --pattern skilled_0.1.0-dev.0_darwin-arm64.tar.gz \
  --pattern skilled_0.1.0-dev.0_darwin-arm64.tar.gz.sha256 \
  --dir artifacts
```

On Windows, use `gh release download v0.1.0-dev.0 --repo DeadHead04/skillEd --pattern "skilled_0.1.0-dev.0_win32-x64.zip*" --dir artifacts`, choosing `win32-arm64` if needed. Verify checksums and install with the matching local-archive instructions above. Keep authentication in GitHub CLI; do not put tokens in download URLs.

For **anonymously readable release assets or an accessible mirror**, run the checked-out HTTP installer. The installer does not use GitHub CLI authentication and cannot fetch private GitHub release assets:

```sh
SKILLED_REPOSITORY=DeadHead04/skillEd \
SKILLED_VERSION=0.1.0-dev.0 \
bash ./install.sh
export PATH="$HOME/.local/bin:$PATH"
skilled --version
```

On Windows:

```powershell
./install.ps1 -Repository 'DeadHead04/skillEd' -Version '0.1.0-dev.0'
$env:Path = "$(Join-Path $HOME '.local/bin');$env:Path"
skilled.cmd --version
```

`DeadHead04/skillEd` is this project’s release repository. The installers download the matching archive and SHA-256 sidecar from `releases/download/vVERSION/`, check the checksum, product, version and target, run the bundled CLI version check, and only then switch the command wrapper. `INSTALL_DIR` changes the default `~/.local/bin` destination. For another HTTP host, use `SKILLED_RELEASE_BASE_URL` pointing to the parent of the `vVERSION` directories. Pin a version for development/prerelease candidates; `latest` follows the host's latest release resolution.

## Verify, update and uninstall

After any installation, run `skilled --version` and `skilled --help`. From this checkout, validate the included example without a model call:

```sh
skilled validate examples/code-stats/evals/eval.yaml
skilled run examples/code-stats/evals/eval.yaml --dry-run
```

For an archive update, verify and extract the new version, then change the PATH entry. For a hosted update, rerun the installer with the chosen version; a failed validation preserves the existing wrapper, and prior content-addressed bundles remain on disk. For npm, install the new local tarball using the same global-install command.

To uninstall npm, run `npm uninstall --global skilled`. For a manually extracted archive, remove its PATH entry and the specific extracted bundle directory. For the hosted installer, remove its `skilled`/`skilled.cmd` wrapper and its owned bundle directories under `INSTALL_DIR/.skilled/`. User configuration, credentials and evaluation workspaces are separate and are not part of uninstalling the executable.

## Plugins, image and publication

`npm run build` assembles the two plugin bundles under `dist/bundled-plugins/`. They require their respective host and a compatible Node installation; installing the CLI does not enable a plugin or its observation capture automatically. The root README links each plugin's setup instructions.

The Action image can be built with `docker build -f action/Dockerfile -t skilled-action:local .`. This image runs the Action entrypoint; it is separate from the desktop CLI installation. GitHub release and image workflows are present. GitHub releases target `DeadHead04/skillEd` and need its release environment configured. Container and npm publication still need registry/package ownership and credentials; public docs hosting is a separate setup step. See [CI maintenance](./ci-maintenance.md).

Verification covers macOS ARM64, Linux ARM64 Docker, macOS x64 through Rosetta and Linux x64 through Docker emulation. All six archives have integrity evidence; translated execution does not certify a native x64 host.
