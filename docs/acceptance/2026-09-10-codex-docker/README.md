# Docker execution correction and acceptance

Recorded 10 September 2026. This is a local Docker Desktop result, not a
certification of Render or another tester's computer.

## Current status

The corrected worker passes all 13 isolation and authenticated checks on
Docker Desktop 4.44.3 / Engine 28.3.2, LinuxKit 6.10.14, arm64. It runs Codex
`0.149.0-alpha.4.1` and the rebuilt pinned Skill-Up CLI (`skilled-v2`).
[Accepted report](accepted-runtime.json) records the runtime fingerprint and
each result. Its status is **ready**. The separate real product-review workflow
passed its baseline run and all three initial-verification trials, as recorded below.
No credential file was read, copied, or included in evidence.

The earlier [default-UID](default-uid.json) and
[distinct-UID](distinct-uid.json) probes preserve the original failures.

## What was corrected

- Docker's default syscall policy prevented the inner sandbox from creating its
  namespaces and mounts. The new explicit seccomp delta retains the upstream
  restrictions, drops all capabilities, and enables no-new-privileges.
- The pinned CLI accepts `sandbox -- COMMAND`; the old `sandbox linux` invocation
  was incompatible. Production exec, resume and App Server now select the same
  restricted-read profile. App Server rejects threads with another profile.
- Applying the judge's process limit before namespace creation conflicted with
  other processes using its UID. The limits now apply inside the fresh namespace.
- Actual Skill-Up grading exposed staging bugs missed by a direct wrapper probe.
  Skill-Up prepares file permissions before entering the sandbox and honors the
  dedicated local temporary root. The wrapper invokes the interpreter with the
  validator and transcript read-only. Tested work and judge staging are separate.
- The default Compose installation now has a persistent Docker login volume and
  acceptance volume. The non-root entrypoint initializes new directories on
  existing work volumes; application history and existing volume names remain.
- Accepted reports bind to a fingerprint of native runtimes, Dockerfile, pinned
  dependencies, policy and application source. Changing the image invalidates
  old evidence. Reports still expire after 24 hours.
- A database integration test exposed global pgcrypto ownership by a temporary
  schema. Migration now installs the extension in public before baseline replay.
- Real model turns exposed a shell-snapshot read outside the permitted workspace.
  Shell snapshots are now disabled in the production policy; workspace tools run
  without widening credential-directory access.
- App Server reconstruction now recognizes the pinned CLI's actual missing-rollout
  error. Real recovery was verified after container replacement.
- Run launch now selects the stored package assessment and approved profile hash,
  so unsupported-package checks and execution provenance use actual database data.
- Real case generation rejected optional fields in the response schema. The
  transport adapter now makes them explicitly nullable and restores application
  omissions without erasing meaningful null values. This also covers patch proposals.
- The response schema requires every approved group and its exact case count.
  Generated suites receive up to three validation attempts with precise correction
  feedback. Rejected proposals remain in the conversation. Missing validators,
  invented material IDs, unsafe paths and mismatched assertion areas cannot approve.
- Concrete JSON-schema checks validate complete output structures. Invalid schemas
  and external references are validator errors; malformed task outputs are failures.
  Byte-preservation checks use the original text bytes rather than parsed JSON.
  The image includes pinned `jsonschema` 4.25.1 and fingerprints installed Python
  package files as well as the core executables and application source.
- Run/export identity uses the accepted executor fingerprint and actual permission
  policy, rather than an unrelated environment revision or historical policy label.
- The first real task run found a fixture-path error: the pinned CLI resolves
  `repo_fixture` from the Skill root. New bundles use `evals/fixtures`. A retained-case
  clone rebinds source references, prompt paths, validator file paths and judge truth
  to copied material IDs. Approval stores the exact resulting profile hash. The
  original approved evaluation and failed setup run remain unchanged.

See [the runtime boundary](../../../infra/docker/README.md) for the precise syscall
delta and [the operator guide](../../operations/docker-execution-readiness.md)
for setup and troubleshooting.

## Verification completed

| Check                                                                       | Result                             |
| --------------------------------------------------------------------------- | ---------------------------------- |
| Non-root, no effective capabilities, no-new-privileges, seccomp             | Passed                             |
| Permitted workspace reads/writes; denied synthetic home/sibling reads       | Passed                             |
| Fresh PID namespace; outside sentinel inaccessible                          | Passed                             |
| Host-reachable network listener inaccessible inside sandbox                 | Passed                             |
| Actual Skill-Up script judge PASS and intentional FAIL; protected truth     | Passed                             |
| CPU/memory/PID limits; oversized allocation denied                          | Passed                             |
| Production process runner cancellation, timeout, 10 MiB raw output bound    | Passed                             |
| Pinned Go agent/judge/CLI tests                                             | Passed                             |
| PostgreSQL, worker, private services and rebuilt CLI contracts              | 86 passed; 1 skipped               |
| Deterministic browser suite at port 3400                                    | 52 passed; 5 skipped               |
| Blocked-execution browser tests at port 3600                                | 3 passed                           |
| Format, lint, typecheck, production build, diff checks                      | Passed                             |
| Demo Compose verification; canary Blueprint schema validation               | Passed                             |
| Real CLI initial/resume, App Server, judge correction, login/recovery       | Passed (all 13 runtime checks)     |
| Real product-review run with baseline                                       | 4/4 samples; 20/20 assertions PASS |
| Real initial verification, three fresh trials                               | 6/6 samples; 30/30 assertions PASS |
| Exact output downloads, hashes, browser JSON preview, report reconciliation | Passed                             |
| Explicit initial activation and verified package download                   | Passed                             |

The isolated real review installation is at `http://127.0.0.1:3600`, with
synthetic local account `admin` / `deterministic-test-password-only`. The
port 3400 installation remains in demo mode. Original port 3000 data and
credentials were not migrated or replaced. The live real-review worker now uses
the corrected image. Official Docker login succeeded, and the complete measured
acceptance report enables real execution on that image.

## Real product-review workflow

The supplied `manual-product-qc.zip` was uploaded with synthetic product cards,
task instructions, authority, past failures and a hidden expected-output file.
Codex proposed four task areas: QC decisions, source citations, the JSON output
contract and input integrity. Two cases cover the four-card batch and a
missing-source boundary. Correctly rejecting a bad product card is an evaluation
PASS, not a task failure.

The initial approved evaluation produced setup ERRORs because of the fixture-path
bug. Run `59fdbe3f-9ffe-4a6f-9166-75b062c388fb` and evaluation
`da6ebe8f-729a-4e9f-9826-6723a61ff0b5` preserve that failure. The corrected immutable
clone is `554f2b2c-50c1-46b5-812e-e4da7a775ac8`, bundle SHA-256
`12f2d656db315e00ec623dfb89c5462883fd1bb2d8b5344ac530c64bb3923520`.
Its [19 calibration checks](calibration-corrected-bundle.json) use synthetic
known-good and invalid outputs through the actual sandboxed Skill-Up judge.
Calibration now uses the same fixture-root resolution as execution.

Real run `824ad69c-96f1-4a44-b347-f8a2848d0846` completed two cases with and
without the Skill: **4/4 samples PASS, 20/20 assertions PASS, zero grading or
ingestion errors**. All four `review.json` outputs were downloaded and verified
against their recorded hashes. The preview API returns the same JSON; the browser
case inspector and output-preview action were exercised too. The
[downloaded raw report](browser/baseline-raw-report.zip) includes original execution
evidence, outputs and `skilled-manifest.json` with the accepted image identity,
profile/package/evaluation hashes and reconciled assertion results.

There is **no measured baseline benefit** in this sample: both configurations
passed. Initial verification uses three fresh Skill-only trials against this exact
approved evaluation, rather than manufacturing an unnecessary improvement patch.

Initial verification run `348bbcc6-ea48-450d-913b-0e369d272c93` completed:
**6/6 samples PASS, 30/30 assertions PASS, stable outcomes and zero ingestion
errors**. Its package, approved evaluation, profile hash and model match the source
run. Every output was downloaded and hash-verified. The
[three-trial report](browser/verification-raw-report.zip) preserves the evidence.

The browser then explicitly activated Skill version
`37144936-2350-4131-ba16-179c2c514f3a` (v1), recording `initial_activation`.
The [release screen](browser/activate-initial.png) shows Active v1. Its downloaded
[package](browser/activated-skill.zip) has SHA-256
`1c259d9fc7da193c16d7e5a452404a7e775eb5b6c40212df43cb3568ea3f1e3e`, matching the
installable package hash in both real reports. It contains only the tested SKILL.md.

### Scope and remaining limitations

- This is real Codex execution with synthetic task data. Calibration outputs and
  demo results are separate and are not counted as real samples.
- Test-plan authoring required review and revision. The draft validator was reviewed
  via authenticated API before approval: schema root/order checks were tightened,
  and citation wording was aligned with what the mechanical validator actually tests.
  Negative calibration caught an intermediate schema mistake before approval. This
  is not evidence of fully autonomous, universally correct generated rubrics.
- Citation checks establish exact source IDs and nonempty reasons. They do not
  semantically grade free-form reason quality. JSON Schema format annotations and
  external references are intentionally unsupported; schemas use structural checks.
- The live acceptance here covers a JSON product-review task. Workbook and other
  artifact families have deterministic contract coverage; no broad real-model quality
  claim is made for them. Long byte-comparison details could be presented more compactly.
- Candidate patch/verification/activation remains covered by the deterministic
  browser journey and protocol contracts. This passing package uses initial release;
  it does not demonstrate a real-model improvement in a failing package.
- Render and another tester's Docker host require their own measured acceptance.
  The report expires after 24 hours and is invalidated by runtime changes. No hosted
  deployment, public exposure or credential migration was performed.

## Continue authenticated acceptance

For an existing default installation, use its existing Compose project and run:

```sh
./scripts/setup-docker-execution.sh --real
```

For this isolated real-review installation:

```sh
COMPOSE_DISABLE_ENV_FILE=true \
COMPOSE_PROJECT_NAME=skilled-real-review \
COMPOSE_FILE=docker-compose.yml:compose.real-review.yaml \
./scripts/setup-docker-execution.sh --real
```

The command builds the worker, stops ordinary execution, measures isolation,
requests official device login when needed, and performs prepare/resume phases
in separate containers sharing only their intended persistent volumes. It restores
the worker on failure, with real work still blocked. Both model attempts in the
judge correction check use actual Codex; one transport response is deliberately
malformed to exercise recovery. This fault injector is never used for user jobs.

After all 13 checks pass, complete a real package/task workflow through generated
test approval, execution, evidence inspection, candidate verification and explicit
activation. Do not substitute deterministic results for that acceptance. Keep
Render execution disabled until the same requirements pass on Render itself.
