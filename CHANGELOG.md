# Changelog

This file records releases of `skilled` maintained in
[DeadHead04/skillEd](https://github.com/DeadHead04/skillEd).

## 0.1.0-dev.0 — development candidate

This version is prepared from the TypeScript implementation. Source availability
and local verification do not imply that release archives, an npm package or a
container image have been published.

### Application

- CLI and embeddable execution API for evaluation cases and repeated runs.
- Local, Docker and OpenSandbox workspaces with process and artifact handling.
- Agent adapters, custom engines, MCP tools and user simulation.
- Rule, script and model judges with JSON, JUnit and HTML reporting.
- Baseline comparisons, lifecycle event logs and optional telemetry.
- `skilled-improve` workflow and `codex-skilled` / `dsh-skilled` integrations.

### Distribution

- TypeScript sources compiled to ESM JavaScript using the pinned Node toolchain.
- Six bundled-runtime archive targets and an optional local npm tarball.
- SHA-256 validation, platform/version checks and installation wrappers.
- Containerized Action with structured status outputs and report files.
- English and Chinese setup guides, examples and configuration references.
- CI, release integrity checks and license notices in each standalone package.

### Verification

See [verification and release scope](docs/verification.md) for real-test coverage,
platform limits and checks that require provider access. Historical design notes
under `docs/design/` and `proposals/` are reference material, not release promises.
