# Install skilled and its workflow

The source repository is [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd). The executable is `skilled`; the workflow is `skilled-improve`. See the [installation guide](../../../docs/guide/installation.md) for platform selection, PATH setup, updates, and removal.

## CLI from source

Use Node 24.21.0. Clone the repository and build the CLI:

```sh
git clone https://github.com/DeadHead04/skillEd.git
cd skillEd
npm ci
npm run build
node dist/src/bootstrap.js --version
```

To make `skilled` available on PATH, run `npm link` after the build. When assisting a user, create a global link only when they have asked to install the CLI. For isolated use, invoke `node /absolute/path/to/skillEd/dist/src/bootstrap.js` directly.

## Release bundles

A release bundle contains the application and a pinned Node runtime. Pick the archive for your operating system and CPU from the [release page](https://github.com/DeadHead04/skillEd/releases), verify its SHA-256, and extract the whole directory. Run `./skilled --version` from the extracted bundle on macOS or Linux, or `.\skilled.cmd --version` on Windows. Keep the complete extracted directory together.

If the repository is private, download assets using an authenticated GitHub session or `gh release download --repo DeadHead04/skillEd`; the HTTP installers do not supply GitHub credentials. Never put credentials into a download URL.

Release assets must be published before this download method is available. Until then, use the source build above or build an archive locally:

```sh
npm run package -- --target=darwin-arm64
```

Replace the target with `darwin-x64`, `linux-arm64`, `linux-x64`, `win32-arm64`, or `win32-x64` as appropriate.

The repository's `install.sh` and `install.ps1` select this repository's releases by default and verify the archive checksum before activating the new installation. Select a published version with `SKILLED_VERSION`. For a separately hosted release, use `SKILLED_REPOSITORY=owner/repository` or `SKILLED_RELEASE_BASE_URL`; a custom base supports `latest-version.txt` or an explicit `SKILLED_LATEST_VERSION_URL`. See the installation guide for complete commands.

## Codex plugin

`npm run build` assembles `dist/bundled-plugins/codex-skilled`. It includes the workflow, hooks, observation schema, and compiled observer. Hook and MCP commands require Node on PATH.

Use the host's supported local-plugin flow to install this directory after the user requests observation capture. Review the hook code before trusting it. Keep validation in an isolated host profile. Local observations are written beneath `CODEX_HOME/plugin-data/skilled-observer`; set `SKILLED_OBSERVER_DATA` to choose an isolated test directory.

## DSH plugin

`npm run build` assembles `dist/bundled-plugins/dsh-skilled`. Run `npm pack` in that directory to create a local plugin archive, then install it through DSH's supported local package flow in an isolated profile. The package is private and does not require an npm registry publication. The tested host contract uses services 0.1.5-rc.2 and Cordis 4.0.2; verify compatibility before choosing another host version.

Both plugins include the canonical workflow and observation schema. Capture requires host setup; DSH also requires `observer.enabled: true`. Installing the CLI alone does not enable capture.
