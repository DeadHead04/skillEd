# Changelog

## Unreleased

- Show Skill revisions, grader scores, and regression exits with recorded CLI transcripts; refresh the logo and add an evidence-linked visual walkthrough.

- Refresh project onboarding, public release links, and the README with an actual evaluation report and verified release evidence.

## 0.3.0

- Add project-local `skilled-improve` setup for Codex and Claude Code, including repeat setup, edited-file protection, and removal.
- Preserve sandbox and approval policy when resuming Codex sessions.
- Add durable MCP jobs with idempotent starts, reconnectable status/results, cancellation, and supervisor cleanup across native operating systems.
- Preserve configured HTML and JUnit reports alongside JSON; isolate concurrent run output directories.
- Require verified Docker filesystem isolation for with/without-Skill benchmarks and use clean grading snapshots.
- Correct negative-rule scoring, skipped-assertion import, and comparison of actual rule outputs.
- Add explicit Docker Codex login-file forwarding with credential validation and cleanup. Live authenticated Docker model execution remains unverified; see the verification guide.
- Verify native archives and published versioned/latest installation on Linux, macOS, and Windows, including workflow setup for both hosts.

- Clarify released-product setup and compatibility guidance, including public documentation availability and authenticated workflow verification limits.
- Refresh the README and documentation with clearer installation, evaluation, and agent-workflow paths, plus a responsive light/dark theme.
- Document the protected-branch contribution process.

## 0.2.0

- Separate prerequisite gates from judge rubric scores; unexecuted judges receive zero benchmark credit. Refresh older mixed gate/judge baselines.
- Add strict `validate --skill` metadata and local-reference checks, installation selection preflight and SHA-256 installed-file readback.
- Add offline `compare` with case/configuration matching, coverage and provenance warnings, and a regression exit flag.
- Add a bundled stdio MCP server with validation, comparison, bounded evaluation execution, workflow resources and the improvement prompt.
- Propagate CLI interrupts to evaluation cleanup and test the packaged MCP connection on native release targets.

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
