# Contributing to skilled

Use Node 24.21.0, npm and Git. Development takes place in [DeadHead04/skillEd](https://github.com/DeadHead04/skillEd). The repository is public and can be cloned without GitHub authentication.

```sh
git clone https://github.com/DeadHead04/skillEd.git
cd skillEd
npm ci
npm run typecheck
npm run build
npm test
npm run audit:brand
npm run docs:build
```

The Makefile provides `build`, `verify`, `test`, `test-action`, `e2e`, `hooks`, `package`, `package-plugins`, `docs` and `fmt-check`. Windows helpers are under `scripts/windows/`. Go-specific lint/build tooling from the original implementation is not a dependency of this application.

## Structure and behavior

See [README.md](README.md) for the source layout. CLI parsing belongs in `src/cli`; configuration, runtimes, engine adapters, judges, evaluation, reporting and events belong in their respective `src/` modules. The public `execute` entrypoint reuses the same command implementation. Keep serialized contracts stable and test behavior at the boundary affected by a change.

`skills/skilled-improve` is the canonical workflow source. Plugin copies are generated under `dist/bundled-plugins`; change the source, then rebuild. `examples/code-stats` includes Go files as text input to an evaluated Skill. These are not application modules.

## Real verification

Use real files, processes and services for integration acceptance. Pure parser/calculation tests may use input data and outputs captured from the pinned source. A canned response does not replace an actual engine or model integration.

Set `SKILLED_DOCKER_INTEGRATION=1` for Docker checks. `node scripts/collector.mjs` starts the owned OTLP collector and prints its output path; pass that path with `SKILLED_TEST_OTEL_FILE`. Stop it with `node scripts/collector.mjs --stop`.

`node scripts/services/opensandbox-local.mjs start` provisions the pinned local OpenSandbox test service with Docker and an isolated Python environment managed by `uv`. It prints an environment-file path containing an ephemeral API key; do not print the file. Use `npm run gate:services -- /path/to/environment.json --phase=5`, then stop the owned service with the matching script's `stop` command.

The cumulative gate records logs, counts, revision and platform. A skipped test remains unverified. Live model checks need an explicitly selected provider/model, credentials and spending limit. Native platforms not available locally require separate runners before a support claim.

## Pull requests

`main` is protected, including for administrators. Work on a feature branch and open a pull request. Before merging, update the branch with `main`, resolve review conversations, and pass `verify`, all three `native-package` checks (Linux, macOS, and Windows), and CodeQL's `analyze` check. Direct pushes, force pushes, and branch deletion are blocked. A second person's approval is optional; review the diff and test evidence before merging your own work.

Keep changes focused and describe the user-visible behavior plus checks performed. Preserve license notices. Do not commit personal credentials, caches, generated archives or `dist/` output. Changes to user-facing behavior should update the English documentation and changelog. [AGENTS.md](AGENTS.md) contains repository guidance for coding agents.

## Documentation and proposals

Run `npm run docs:dev` to preview the VitePress site and `npm run docs:build` before shipping it. `SKILLED_DOCS_BASE` controls a deployment subpath. The `proposals/` archive retains design history; use `proposals/init-proposal.sh` to start a new proposal when a new feature or contract change needs a written design.

GitHub releases belong to `DeadHead04/skillEd`. Configure its release environment and permissions before publishing a version. Documentation deploys to [GitHub Pages](https://deadhead04.github.io/skillEd/) from `main` through `.github/workflows/docs.yml`. npm registry and container publication remain separate decisions. Local packages and passing checks do not establish that an additional public release exists.
