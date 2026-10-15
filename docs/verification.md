# Verification and release scope

For a concrete example, [watch a Skill improve](./guide/see-it-work.md): recorded CLI output, exact policy changes, grader evidence, and a deliberately caught regression.

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

## 0.3.0 candidate acceptance

The repair suite covers negative-rule denominators, skipped-assertion import,
real rule-output comparison, debug/full-run gate semantics, project workflow
activation/update/removal, and real MCP EOF/SIGTERM cleanup with active children.
The native archive probe also installs and removes the workflow for both hosts.
Session lookup respects `CLAUDE_CONFIG_DIR` and `CODEX_HOME`; native records supply
observed model names. Unavailable usage is labeled in JSON through `usage_status`.

Earlier candidate verification passed 1,571 tests with zero failures and 33 skips,
including a real Chrome report check. Three policy evaluations each passed through
installed Codex and Claude Code using native subscription logins. These checks do
not certify every provider, device, observer host or remote sandbox service.

The compatibility reference and intentional scoring differences are recorded in
[compatibility.json](https://github.com/DeadHead04/skillEd/blob/main/docs/compatibility.json) and [Scoring](./guide/scoring.md).
The older file-disposition ledgers are historical bookkeeping, not a claim that
every original assertion was reexecuted. Candidate evidence is complemented by the CI result for the final release commit;
native CI does not replace authenticated host acceptance.

An earlier installed-host attempt was blocked by host approval. After scoped
execution was authorized, the real Codex conversation completed a baseline,
Skill revision, rerun, and independent holdouts: 13/18 baseline cases passed,
18/18 improved cases passed, and 10/10 holdouts passed. Those results describe
that policy Skill and model, not every possible evaluation parameter.

That journey also found five release/runtime defects: an outdated public
installer, permission escalation on resumed turns, client timeouts during long
MCP calls, overridden report formats, and a native benchmark reading another
case's Skill. The contaminated without-Skill comparison is not valid evidence
of improvement. The repair plan is maintained in
`docs/design/reliability-repair-plan.txt`.

| Behavior | Maintained evidence | State |
| --- | --- | --- |
| Negative rules and stable denominators | `tests/judge/scoring-contract.test.ts` | Passed locally |
| Failed gate skips judges and fails the case | `tests/evaluator/gate-scoring.test.ts`, `tests/cli/commands.test.ts` | Passed; intentional scoring difference |
| Skipped assertions survive report conversion | `tests/judge/scoring-contract.test.ts`, report suites | Passed locally |
| Unchanged real rule output remains comparable | `tests/judge/scoring-contract.test.ts` | Passed locally |
| MCP EOF and termination clean up active work | `tests/mcp/shutdown.test.ts` | Passed locally on macOS |
| Scoped native session lookup | `tests/agent/session-lookup.test.ts` | Passed locally |
| Project workflow install, repeat, edit protection, removal | `tests/cli/setup.test.ts`, extracted archive probe | Passed locally for both host layouts |
| Installed reference paths | `scripts/verify-package.mjs` | Passed locally |
| Native subscription policy evaluation | Six installed CLI cases across Codex and Claude Code | Passed locally |
| Baseline → revision → held-out evaluation | Real installed Codex conversation with policy Skills | Passed after scoped approval; Claude full cycle remains unverified |

## Reliability regression checks

The repair gate passed 1,584 tests with zero failures and 38 explicitly skipped
checks on the local macOS host. A fresh real Codex rerun reproduced 13/18 baseline
passes, 18/18 improved passes and 10/10 holdout passes. A deliberately broken
Skill failed its case; restoring the Skill passed it. An intervening disk-full
run returned execution errors and was retained as failed evidence before retrying.
Native two-turn acceptance also confirmed unchanged sandbox/approval settings
and denial of a write outside the permitted workspace.

A real Codex evaluation lasting 331 seconds returned its background-job start
response in 67 milliseconds under a one-second MCP client timeout. Closing and
reopening the client recovered the same run without duplicate execution; the
case passed and produced JSON, HTML and JUnit reports. A fresh project using the
0.3.0 archive also confirmed that an authenticated Codex session discovered the
installed skilled-improve workflow and validated all 18 policy cases while
preserving the existing Skill. These are recorded acceptance observations, not
performance guarantees.

Docker boundary checks passed before the development machine's storage failure;
the final Docker suite is required in source CI and release builds. Live model
Docker authentication is separately gated on an available daemon and account.

- `tests/agent/codex-resume.acceptance.mjs` exercises a real logged-in two-turn
  Codex session, checks the recorded sandbox policy, and attempts a forbidden
  sibling-file write. It is opt-in and uses real account access.
- `tests/mcp/server.test.ts` starts actual evaluation processes over MCP, closes
  the client/server, reconnects using the persisted run ID, verifies idempotency,
  and checks cancellation, timeouts, worker crashes and all report formats.
- `tests/mcp/jobs.test.ts` covers incomplete worker installation and bounded
  metadata. `tests/mcp/shutdown.test.ts` preserves synchronous cleanup.
- `tests/runtime/docker.test.ts` attacks concurrent and retained-container read
  boundaries and checks fresh grading snapshots, background processes, symlinks,
  private-file cleanup and provisioning before untrusted workspace upload.
- `tests/evaluator/benchmark-isolation.test.ts` verifies unsafe benchmark modes
  fail before credentials, model execution or report-directory mutation.

Public installer acceptance runs setup, repeated setup and removal for both
host layouts after installing the pinned release and again after updating to
latest. Archive verification protects edited workflows and existing Skills.

## Published release evidence

[Release 0.3.0](https://github.com/DeadHead04/skillEd/releases/tag/v0.3.0)
was published from `71c3ddb5d18f45dc5e0a83455802c082a300d73c`.
All eight [release jobs](https://github.com/DeadHead04/skillEd/actions/runs/38557758484)
passed: build, native archive acceptance on Linux/macOS/Windows, publication, and
published versioned/latest installation on those three runners. Installer checks
exercise project setup and removal for both Codex and Claude Code.
The final [source CI](https://github.com/DeadHead04/skillEd/actions/runs/38557622966)
recorded 1,586 passes, zero failures, and 41 explicit skips. Its separate real
Docker suite recorded 47 passes and two OpenSandbox skips.

A fresh public install on macOS also passed both setup paths without GitHub
login or an external Node runtime on PATH, preserving existing Skills and project
instructions. One final real Codex case through that public CLI passed after
42 seconds; disconnecting and reconnecting recovered the same durable run and
worker, and JSON, HTML and JUnit reports were verified. This checked the published
bytes after the final supervisor changes. Temporary authentication material was
removed and the original login remained unchanged.

The [actual refund-policy report screenshot](https://github.com/DeadHead04/skillEd/blob/main/docs/public/refund-policy-report.png)
shows the 18/18 improved run described above. It is a single observed acceptance
result, not a promise of model accuracy. Optional authenticated Codex model
execution inside Docker remains unverified following the local daemon failure;
Docker isolation and authenticated native Codex were tested separately.

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

- Authenticated engines, model judges, user simulators and a successful model-backed DSH ACP session need explicit provider/model access. Separately billed API tests also need a spending ceiling. The two skipped simulator tests do not enumerate every unavailable live-model path.
- Native Windows ARM64 and every provider/OS/architecture combination have not been established by the three native CI jobs. Translated or emulated execution is recorded separately.
- OpenSandbox execd 1.0.16 removes stdout line separators in the tested implementations. Direct downloads and reports are checked; glob-based artifact collection is not certified for that server version.
- JavaScript integer precision is limited to the safe-integer range. Some uncommon formatting/parser boundaries are not asserted exhaustively.
- A live engine evaluation still requires a configured engine and provider account. Package checks do not demonstrate model quality or authenticate all providers.

## Candidate integrity

`npm run release:build` requires a clean committed tree and creates six CLI archives plus npm, plugin and workflow packages. The release manifest records the source commit, hashes, runtime version and destination. Every separately distributed archive includes LICENSE and NOTICE. `npm run distribution:verify` checks actual archive contents, names, hashes, branding and notices. Platform execution is a separate acceptance step.

The source and release retain the Apache-2.0 license and copyright notices. Product branding is consistently `skilled`, with `skilled-improve`, `codex-skilled` and `dsh-skilled` as the workflow and integration names.

## Optional GitHub security services

Workflow analysis retains its SARIF artifact. CodeQL, Security-tab uploads, and release attestations are enabled by the workflows for this public repository. Availability of a workflow does not imply that it passed for an earlier release: v0.1.0 was published while the repository was private. Private forks can opt into entitled services with `SKILLED_CODE_SCANNING_ENABLED=true` and `SKILLED_ATTESTATIONS_ENABLED=true`. Hash and license verification remain mandatory regardless of those options.
