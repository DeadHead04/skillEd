# Codex in Docker: SkillEd compatibility investigation

**Follow-up:** this document preserves the initial investigation and its failures.
The subsequent implementation fixes and measured Docker results are recorded in
[the Docker acceptance handoff](../acceptance/2026-09-10-codex-docker/README.md).
Read that handoff for the current status; all 13 isolation and authenticated checks now pass on the tested Docker host. The investigation below preserves the original failures.

Investigated 10 September 2026. Source checkout: `340613eab4f507b58e73b0fba770f3b5d6ccc9d8`.

**Codex can run in Docker. SkillEd's current Docker setup has unresolved execution isolation and acceptance implementation gaps.** The recurring banner is our application refusing to launch work; it does not establish that Codex is incompatible with Docker or that the tester's login is wrong.

This investigation used official documentation, application and pinned Skill-Up source, and fresh credential-free containers. It did not run a model, access login stores, modify running services, or certify real evaluation. The other tester's OS and diagnostic output remain unavailable, so the runtime findings below describe this machine only.

## What was actually tested

Image: `sha256:a72ecd076462ee4862d38c6ccb3f5b5e14de85f138249fcd85c98620724f497f`, the existing local review worker image. Codex reports `0.149.0-alpha.4.1`; Skill-Up reports `skilled-v2`. Host runtime inspected: Docker Desktop 4.44.3, Engine 28.3.2, LinuxKit 6.10.14, arm64. The application UID is 10001.

Each probe ran in a disposable container with no host mounts, no application data, no credentials, and outer networking disabled. Neither container was privileged. No capabilities were added and Docker's default security policy was retained. The second container changed only its non-root UID/GID to 10002 for diagnosis. It is not a proposed production workaround.

| Probe                                                    | Observed result                                  | What it proves                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `codex --version`                                        | Successful                                       | The pinned Codex binary runs inside this image.                                                                                  |
| `skill-up --version`                                     | Successful                                       | The pinned Skill-Up binary runs.                                                                                                 |
| App Server `initialize` request                          | Successful JSON-RPC response                     | App Server starts and handles initialization; this does not test an authenticated turn.                                          |
| Create a user namespace                                  | `EPERM`: operation not permitted                 | Namespace creation is denied in this container configuration.                                                                    |
| Legacy workspace sandbox                                 | Bubblewrap namespace error                       | Even the ordinary workspace sandbox cannot execute the synthetic command here.                                                   |
| Strict workspace sandbox                                 | Same namespace error                             | The canary's stricter profile cannot initialize either.                                                                          |
| Strict sibling-read probe                                | Same namespace error before the command          | Sibling protection is **not evaluated**, not a successful denial test.                                                           |
| Actual script-judge wrapper, UID 10001                   | `Resource temporarily unavailable (os error 11)` | The production judge launch path has an additional startup failure.                                                              |
| Native sandbox with only 512 MiB address-space limit     | Reaches the namespace error                      | This limit alone did not reproduce error 11 in this probe. It is not proof that the memory budget is sufficient for real judges. |
| Native sandbox with only the 64-process limit, UID 10001 | Error 11                                         | The process limit reproduces the additional failure.                                                                             |
| Same process limit and actual wrapper, UID 10002         | Both reach the namespace error                   | A different non-root UID removes the earlier process-limit failure, but does not fix sandbox creation.                           |

App Server also warns that system `bubblewrap` is absent and it is using its bundled copy. The bundled executable reaches namespace creation and fails there. Installing a package alone is therefore not established as the fix.

The kernel reports a positive `max_user_namespaces` value. Seccomp filtering is active and the non-root process has no effective capabilities. A zero namespace quota is not the explanation observed here. These probes do not uniquely identify which Docker/kernel enforcement rule returns `EPERM`; syscall/security-policy investigation is still needed before proposing a narrowly scoped runtime change.

Raw results and reproducible probe:

- [Default UID results](/Users/shivesh/Documents/ChatGPT/skillEd/docs/acceptance/2026-09-10-codex-docker/default-uid.json)
- [Distinct UID comparison](/Users/shivesh/Documents/ChatGPT/skillEd/docs/acceptance/2026-09-10-codex-docker/distinct-uid.json)
- [Synthetic probe source](/Users/shivesh/Documents/ChatGPT/skillEd/docs/acceptance/2026-09-10-codex-docker/probe.py)

These files are diagnostic evidence, never accepted readiness reports. Because the outer container network was disabled, this experiment cannot certify Codex's network-denial policy.

## Why the error keeps appearing

### 1. The application gate is incomplete end to end

[Worker readiness](/Users/shivesh/Documents/ChatGPT/skillEd/apps/worker/src/readiness.ts:24) requires a configured report and matching release revision before checking login. [The report validator](/Users/shivesh/Documents/ChatGPT/skillEd/packages/core/src/execution-contract.ts:68) requires 13 passing checks, a ready status, and an age below 24 hours.

The [preliminary canary](/Users/shivesh/Documents/ChatGPT/skillEd/infra/render-canary/canary.mjs:7) initializes its status to blocked and never promotes it. Eight checks are explicitly emitted as pending: process isolation, resource limits, initial Codex execution, resume, App Server execution, judge correction, login persistence, and conversation recovery. Thus, even on a compatible Docker host, this canary alone cannot produce an accepted report.

The latest staging correction wires the missing configuration and exposes useful diagnostics. **It does not finish this acceptance harness.** Telling a new tester to keep retrying generation or repeatedly run the preliminary canary cannot solve that implementation gap. Login is not even checked when the report gate fails.

### 2. Docker isolation and Codex command isolation are separate layers

The actual local path is:

```text
Browser → web/API → durable job → Docker worker
                                  ├─ App Server → tool-command sandbox
                                  └─ Skill-Up --runtime none → Codex → tool-command sandbox
```

[The runner](/Users/shivesh/Documents/ChatGPT/skillEd/apps/worker/src/runner.ts:328) uses `--runtime none`. That means Skill-Up runs within the existing worker, rather than creating a fresh Docker container per case. [NoneRuntime](/Users/shivesh/Documents/ChatGPT/skillEd/skill-up/internal/runtime/none.go:392) requires a process sandbox, which selects [Codex workspace-write](/Users/shivesh/Documents/ChatGPT/skillEd/skill-up/internal/agent/codex.go:349). The outer service container does not replace this inner isolation requirement.

OpenAI documents Docker/devcontainer use and explains that Linux sandboxing depends on bubblewrap and seccomp; container or host restrictions can prevent the required namespace operations. It distinguishes retaining the inner sandbox from treating a container as the entire isolation boundary. [OpenAI security documentation](https://learn.chatgpt.com/docs/agent-approvals-security)

Docker's default seccomp policy restricts several namespace-related system calls. That supports investigating container policy here, but does not prove which particular rule blocked our syscall. [Docker seccomp documentation](https://docs.docker.com/engine/security/seccomp/)

Disabling the inner sandbox in the existing shared worker does not meet SkillEd's requirements: trusted login state, other workspaces and judging context must remain inaccessible to tested commands. Our required remedy is a demonstrated isolation configuration, not a bypass flag.

Docker also has a Codex-specific integration. Its current Sandboxes product uses microVMs, which are a different boundary from SkillEd's ordinary Compose worker. It is evidence of Codex support, not an automatically compatible replacement for the selected Render architecture. [Docker Codex integration](https://docs.docker.com/ai/sandboxes/agents/codex/), [Docker Sandboxes architecture](https://docs.docker.com/ai/sandboxes/)

### 3. The judge's process limit is not isolated per job

[The actual judge wrapper](/Users/shivesh/Documents/ChatGPT/skillEd/apps/worker/src/script-sandbox.py:32) applies `RLIMIT_NPROC=64` before starting Codex. On Linux this counts processes/threads associated with the real user ID, rather than only children belonging to this judge. [Linux resource-limit semantics](https://www.man7.org/linux/man-pages/man2/getrlimit.2.html)

The UID comparison strongly supports contention in that accounting as the cause of error 11 on this machine. We did not enumerate every process outside the container, so which other processes consume the budget is not established. Fixing namespace support alone would leave this second problem. The durable fix must measure Codex overhead and enforce the intended job budget independently of unrelated workers; merely raising or deleting the limit is not demonstrated acceptance.

### 4. The preliminary probes do not mirror all production permission paths

The canary and script judge construct explicit filesystem read restrictions. [App Server thread and turn requests](/Users/shivesh/Documents/ChatGPT/skillEd/apps/worker/src/app-server.ts:183) use legacy workspace-write settings; the tested-agent CLI path also chooses generic workspace-write. These call sites do not select the canary's strict read profile. The canary's script-judge check executes Python directly through its probe helper, rather than invoking the actual resource-limited judge wrapper.

Acceptance must exercise each real launch path and its intended role-specific allowlist. Passing a different helper configuration cannot certify production behavior. Current Codex documentation distinguishes explicitly selected permission profiles from older sandbox settings; compatibility must be checked against the pinned binary. [Codex permission profiles](https://learn.chatgpt.com/docs/permissions)

## Concrete correction order

1. **Establish host compatibility.** On the tester's actual image/host, collect the sanitized execution diagnostic, Docker/OS versions and preliminary probe. Investigate the denied namespace operation. Validate a supported configuration with the inner sandbox retained, preserving non-root execution and the service boundary. Do not prescribe blanket privileged or unconfined settings. Passing on this Mac would not certify Linux, Windows Docker Desktop, or Render.
2. **Unify permission enforcement and evidence.** Build trusted role-specific policies for tested tasks, authoring, and judges. Wire and test initial execution, resume, App Server turns and judge correction. Ensure hidden answers and sibling workspaces are unavailable to tested commands. Verify actual policies, not only the selected option names.
3. **Correct resource accounting.** Measure the pinned CLI's threads and memory under the intended workload; implement supported per-job process and resource containment. Include tests with other workers using the same service UID. Exercise the actual script wrapper, timeout, output limits and process-tree cleanup.
4. **Complete the acceptance harness.** Separate credential-free isolation tests from an explicitly authorized authenticated acceptance phase. Replace all eight pending checks with measured tests, and aggregate ready status only when every required check passes. Cover initial/resumed execution, both judge paths, cancellation, replacement and durable recovery.
5. **Authenticate in the intended executor.** Use the official headless login flow for the existing private-pilot ChatGPT choice. Device-code login is supported when enabled for the account/workspace. OpenAI recommends API authentication for programmatic CLI use; that is a separate model-access decision, not a repair for namespaces. [Codex authentication](https://learn.chatgpt.com/docs/auth)
6. **Publish and maintain actual readiness.** Mount the measured accepted report, bind it to the tested release and record image identity, host/policy details and tool versions. Recreate the service when environment or mounts change. Implement measured renewal for the current 24-hour expiry and invalidate evidence on relevant changes. Never edit timestamps or mark pending checks passed manually.
7. **Run the complete real workflow.** Use one actual package and uploaded task input through plan approval, generated cases, execution, output judging, improvement, three-trial verification and explicit activation. Confirm failures remain distinguishable from unavailable execution. Only this phase can establish real evaluation acceptance.

After the deterministic boundary is proven, the authorized authenticated acceptance runner needs a controlled entrypoint of its own. Ordinary generation must remain gated while acceptance is in progress; the solution is not to temporarily disable the application gate globally.

## Render consequence

Render supports Docker image deployments. That fact alone establishes neither nested namespace availability nor the resource controls required by this executor. The selected private service must pass the same real-path canary on Render itself. There is no Render-host runtime measurement in this investigation. If the required boundary cannot be enforced there, execution stays unavailable and the deployment/version decision must be revised. [Render Docker support](https://render.com/docs/docker)

## Verification scope and handoff

The repository was clean at the start. README and preflight were checked. All temporary probe containers exited and were removed. Existing application services, adapter modes, histories and credentials were preserved. Only this report and its synthetic evidence were added; no application code was changed. Full application/build/browser/Compose release checks were not rerun for this documentation-only investigation, and no real-agent acceptance was performed.

For the other person's installation, use [the existing Docker diagnostic guide](/Users/shivesh/Documents/ChatGPT/skillEd/docs/operations/docker-execution-readiness.md). Its commands identify the local blocker; they do not promise a completed acceptance harness that the repository does not yet contain.
