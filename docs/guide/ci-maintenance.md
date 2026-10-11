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

Build immutable artifacts, inspect checksums, install/test the same candidate, then publish only to configured owner-controlled destinations. Keep a rollback artifact. GitHub releases use [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd/releases). Configure the repository’s release environment, token permissions and any required approvals before enabling publication. npm packages, container images and public docs need their own destinations and credentials; this checkout does not claim that those services have been published.

Use read-only tokens for validation. Never run untrusted contribution code with release secrets or privileged persistent runners. Keep model credentials out of logs and artifacts. A workflow must report a failure or unavailable check honestly instead of converting it into success.
