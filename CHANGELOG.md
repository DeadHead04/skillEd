# Changelog

## Unreleased

- Reorganize the public README around installation, a first evaluation, and feature guides.
- Add a Hello World evaluation and real CLI validation, case listing, and dry-run coverage.
- Document anonymous release installation and correct the published platform verification scope.
- Publish the English documentation through GitHub Pages.

This file records releases of `skilled` maintained in
[DeadHead04/skillEd](https://github.com/DeadHead04/skillEd).

## 0.1.0

First versioned TypeScript CLI release, distributed through GitHub Releases.
Includes authenticated private-repository installation, public HTTP installation,
and English-only user documentation. npm registry and container publication are
separate from these downloadable release assets.

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
- English setup guides, examples and configuration references.
- CI, release integrity checks and license notices in each standalone package.

### Verification

See [verification and release scope](docs/verification.md) for real-test coverage,
platform limits and checks that require provider access. Historical design notes
under `docs/design/` and `proposals/` are reference material, not release promises.
