# CI maintenance

Development and CI use npm, TypeScript and Node’s test runner. Workflows are maintained in [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd/actions). A workflow file describes the checks to run; its presence does not establish a successful run or a published release.

## Local checks

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run audit:brand
npm run docs:build
```

The Makefile exposes corresponding `build`, `verify`, `test`, `test-action`, `e2e`, `hooks`, `package`, `package-plugins`, `docs` and `fmt-check` targets. `fmt-check` checks whitespace errors; it is not a Go formatter. Windows wrappers live under `scripts/windows/`.

## Real integrations

Enable only services that are available, and retain explicit skipped/unverified entries for missing targets. `SKILLED_DOCKER_INTEGRATION=1` enables real container checks; `SKILLED_ENGINE_INSTALL_INTEGRATION=1` installs official agent CLIs in disposable containers without model calls. Browser tests require Chrome/Playwright. OpenSandbox and OTLP checks use their actual configured services.

`npm run gate -- --phase=5` records revision, platform, command output and test counts in `evidence/runs/`. Model credentials are separate from process/container checks. Authenticated model acceptance needs the selected provider/model, an agreed spending limit and credential injection; an installed executable is not proof of model compatibility.

## Publishing

Build immutable artifacts, inspect checksums, install/test the same candidate, then publish only to configured owner-controlled destinations. Keep a rollback artifact. GitHub releases use [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd/releases). Configure the repository’s release environment, token permissions and any required approvals before enabling publication. The documentation workflow deploys this repository’s VitePress site to GitHub Pages at `https://deadhead04.github.io/skillEd/`, using the `/skillEd/` base path and the `github-pages` environment. Enable Pages with GitHub Actions as its build source. npm registry packages and container images still need their own destinations and credentials and have not been published.

Use read-only tokens for validation. Never run untrusted contribution code with release secrets or privileged persistent runners. Keep model credentials out of logs and artifacts. A workflow must report a failure or unavailable check honestly instead of converting it into success.

## Release acceptance sequence

1. Complete the cumulative phase gate, typecheck, documentation build, and the authenticated improvement journey on the intended commit. Preserve failures and unavailable platforms in the evidence.
2. Merge through the protected main branch. Choose a version and create its matching tag only after the committed package version is correct. The release workflow rejects a mismatched tag or a commit outside main history.
3. Build the archives once. Native Linux, macOS, and Windows runners extract and execute those exact bytes, including workflow setup, repeat setup, protection of local edits, removal, and preservation of existing Skills and project instructions. These checks do not substitute for authenticated model acceptance.
4. Publish only the accepted artifacts with their checksums. The published installer acceptance matrix downloads both the versioned release and `latest`, installs into a new location, and exercises Codex and Claude Code workflow setup in fresh projects.
5. Check every release job before calling the release verified. Publication precedes the public-download checks, so a failed post-publication check requires an explicit repair/release decision; a release page alone is not evidence of successful installation. Recheck the public guide against the installed version.

Project setup requires version 0.3.0 or newer. Installation documentation links to the latest **released installer**, rather than an installer from an unrelated main-branch revision. Source builds and unreleased behavior must remain clearly identified until the corresponding release is available.
