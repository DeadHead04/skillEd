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

## Available evidence

Before repository publication, the integrated TypeScript candidate passed 1,559 tests with zero failures and two authenticated simulator tests skipped. Separate archive acceptance exercised macOS ARM64, Linux ARM64 Docker, macOS x64 via Rosetta and Linux x64 via Docker emulation. Six archive targets passed integrity checks. Installer tests used real archive downloads through local HTTP, including corrupted downloads and wrong-version/target rejection. The Action container executed successful and intentionally failing evaluations and produced JSON, JUnit and HTML reports.

These are recorded development results, not claims that every original assertion or every provider/platform combination has been tested. The latest GitHub workflow run and its retained evidence apply to its exact commit. Publication changes are verified again before upload.

## Remaining limits

- Authenticated engines, model judges, user simulators and a successful model-backed DSH ACP session need explicit provider/model access and a spending ceiling. The two skipped simulator tests do not enumerate every unavailable live-model path.
- Native Windows and native x64 testing were unavailable in the development environment. Translated or emulated execution is recorded separately.
- OpenSandbox execd 1.0.16 removes stdout line separators in the tested implementations. Direct downloads and reports are checked; glob-based artifact collection is not certified for that server version.
- JavaScript integer precision is limited to the safe-integer range. Some uncommon formatting/parser boundaries are not asserted exhaustively.
- Public release downloads, npm registry installation and published image pulls require actual published assets. Repository source availability is separate from an installable release.

## Candidate integrity

`npm run release:build` requires a clean committed tree and creates six CLI archives plus npm, plugin and workflow packages. The release manifest records the source commit, hashes, runtime version and destination. Every separately distributed archive includes LICENSE and NOTICE. `npm run distribution:verify` checks actual archive contents, names, hashes, branding and notices. Platform execution is a separate acceptance step.

The source and release retain the Apache-2.0 license and copyright notices. Product branding is consistently `skilled`, with `skilled-improve`, `codex-skilled` and `dsh-skilled` as the workflow and integration names.

## Optional GitHub security services

Workflow analysis runs for this private repository and retains its SARIF artifact. CodeQL and Security-tab uploads require code scanning entitlement; set the repository variable `SKILLED_CODE_SCANNING_ENABLED=true` after enabling that service. Private-repository attestations require an eligible GitHub plan; set `SKILLED_ATTESTATIONS_ENABLED=true` only when available. Hash and license verification remain mandatory regardless of those options. See GitHub's [code-scanning availability](https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning) and [attestation requirements](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).
