# Verification and release scope

`skilled` uses production functions and actual files, processes, HTTP services, Docker containers and plugin hosts for acceptance. A missing device, credential or service remains unverified; a successful build alone does not certify it.

## Reproduce the checks

```sh
npm ci
npm run build
npm run gate -- --phase=5
npm run audit:brand
npm run docs:build
```

The gate writes its source revision, enabled services, test totals, skipped checks and logs to `evidence/runs/`. The default gate does not enable external services or model requests. See [the real-service setup guide](./guide/ci-maintenance.md) for real-service settings. Native CI verifies the packaged CLI/API on Linux, macOS and Windows; the complete test suite runs on Ubuntu.

## Published release evidence

For 0.2.0, the release acceptance adds installed-bundle MCP discovery, workflow
and template reads, source validation, dry runs and offline comparison. Source
tests exercise actual local SHA-256 engine runs over MCP, negative verdicts,
cancellation and time limits. Native package CI also runs the cancellation and
time-limit tests on Linux, macOS and Windows. Check the
[CI workflow](https://github.com/DeadHead04/skillEd/actions/workflows/ci.yml) and
[release workflow](https://github.com/DeadHead04/skillEd/actions/workflows/release.yml)
for the result on the exact commit being installed.

The implementation plan has three sequential gates:

1. Correctness: reproduce scoring errors; test source selection and installed-byte
   integrity using real files and runtimes, including opt-in Docker checks.
2. Integration: compare actual reports; connect a real MCP SDK client; execute a
   local engine and verify cancellation; build English setup documentation.
3. Publication: run the cumulative suite and branding audit; execute native
   archives; publish the accepted bytes; install the published release on each
   native CI operating system. Provider-backed tests remain separately gated by
   credentials and an explicit spending limit.

See [comparison and scoring](./guide/comparison.md) and [MCP setup](./guide/mcp.md)
for shipped behavior and limitations.

[Release 0.1.0](https://github.com/DeadHead04/skillEd/releases/tag/v0.1.0) was published from commit `6063f74ba7f7d513e03b8e687c7f4accdb41baf4`. Its [release workflow](https://github.com/DeadHead04/skillEd/actions/runs/38136609356) passed all eight jobs:

- Release archive build and publication with checksum verification.
- Packaged CLI/API acceptance on native Linux, macOS, and Windows runners.
- Installation of the actual published assets, version checks, and latest-version reinstall on those three operating systems.

The [source CI run](https://github.com/DeadHead04/skillEd/actions/runs/38136607439) passed the cumulative gate and native package checks for that commit. Before publication, real-service development checks also exercised Docker, OpenSandbox, MCP, plugin services, reports, and the Action container. The full suite and its optional service checks have different prerequisites; a skipped live-model check is not a pass.

Six CLI targets have archive integrity checks. Native execution applies to each runner's architecture, not every OS/CPU combination. Separate development checks exercised macOS ARM64, Linux ARM64 Docker, macOS x64 through Rosetta, and Linux x64 through Docker emulation.

The repository and release downloads are public. The npm tarball is a release asset; no npm registry package or container registry image has been published. The latest workflow evidence applies to its exact commit, not automatically to every subsequent change.

## Remaining limits

- Authenticated engines, model judges, user simulators and a successful model-backed DSH ACP session need explicit provider/model access and a spending ceiling. The two skipped simulator tests do not enumerate every unavailable live-model path.
- Native Windows ARM64 and every provider/OS/architecture combination have not been established by the three native CI jobs. Translated or emulated execution is recorded separately.
- OpenSandbox execd 1.0.16 removes stdout line separators in the tested implementations. Direct downloads and reports are checked; glob-based artifact collection is not certified for that server version.
- JavaScript integer precision is limited to the safe-integer range. Some uncommon formatting/parser boundaries are not asserted exhaustively.
- A live engine evaluation still requires a configured engine and provider account. Package checks do not demonstrate model quality or authenticate all providers.

## Candidate integrity

`npm run release:build` requires a clean committed tree and creates six CLI archives plus npm, plugin and workflow packages. The release manifest records the source commit, hashes, runtime version and destination. Every separately distributed archive includes LICENSE and NOTICE. `npm run distribution:verify` checks actual archive contents, names, hashes, branding and notices. Platform execution is a separate acceptance step.

The source and release retain the Apache-2.0 license and copyright notices. Product branding is consistently `skilled`, with `skilled-improve`, `codex-skilled` and `dsh-skilled` as the workflow and integration names.

## Optional GitHub security services

Workflow analysis retains its SARIF artifact. CodeQL, Security-tab uploads, and release attestations are enabled by the workflows for this public repository. Availability of a workflow does not imply that it passed for an earlier release: v0.1.0 was published while the repository was private. Private forks can opt into entitled services with `SKILLED_CODE_SCANNING_ENABLED=true` and `SKILLED_ATTESTATIONS_ENABLED=true`. Hash and license verification remain mandatory regardless of those options.
