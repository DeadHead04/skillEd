# Local Docker execution boundary

`docker-default-v28.3.2.json` is Docker/Moby's unmodified seccomp profile from
[v28.3.2](https://github.com/moby/moby/blob/v28.3.2/profiles/seccomp/default.json),
distributed under the [Apache 2.0 license](https://github.com/moby/moby/blob/v28.3.2/LICENSE).

`codex-seccomp.json` retains that allowlist and its deny-by-default behavior.
The additions permit namespace-only `unshare`, `clone` when `CLONE_NEWUSER`
is present (x86/ARM argument layout), and `mount`, `umount2`, `pivot_root`.
Bubblewrap needs these to construct the inner filesystem and PID/user namespace.
Kernel checks still require namespace-local permissions for mounts; the executor
has no added host capabilities. Compose drops all capabilities and enables
`no-new-privileges`. It does not use privileged mode, unconfined seccomp,
host namespaces, host Docker sockets, or a Codex sandbox bypass.

This is an explicit local runtime configuration, not a claim about Render's
available container controls. Linux host LSM/user-namespace policies can impose
additional restrictions. The measured canary must pass on each target host.

The worker is capped at 2 CPUs, 4 GiB and 512 processes/threads. The real script
judge applies its smaller resource limits after entering the sandbox's fresh
user namespace; unrelated workers cannot consume its UID-accounted process
budget. Its memory limit does not constrain the trusted Codex controller startup.
The vendored Skill-Up judge sets executable staging permissions before entering
the sandbox. Inside it, the wrapper invokes the script's interpreter while the
script and selected transcript remain read-only. The canary runs actual
`skill-up debug judge` PASS and intentional FAIL fixtures through this path;
testing the wrapper alone would miss staging regressions.
Local Skill-Up workspaces and judge staging honor the executor's dedicated
`TMPDIR=/data/work/tmp`; they are separate directories. Shared `/tmp` remains
denied. The non-root entrypoint creates this directory on existing work volumes
as well as fresh installations.

The pinned CLI's actual syntax is `codex sandbox --permission-profile NAME --
COMMAND`, or `codex -c ... sandbox -- COMMAND`. It does not use the historical
`sandbox linux --permissions-profile` syntax. Permission profiles grant a fresh
workspace-local scratch directory and deny the shared `/tmp` contents.
Shell snapshots are disabled: otherwise real command startup tries to source
state from the intentionally protected service home and exits before executing.
Account connectors, plugins, browser/computer tools, image generation and nested
agents are disabled for this local-file, single-model pilot.

Run `./scripts/setup-docker-execution.sh --real` from the intended Compose
installation after deterministic tests. It runs isolation first, requests an
official Docker login if needed, performs real acceptance, and recreates the
acceptance process in another container to prove persistence before enabling
the worker. Failures keep real work blocked and preserve evidence.

The script's judge-correction test deliberately corrupts one synthetic
transport response. Both attempts use real Codex through the production
launcher; Skill-Up's real correction path must recover. This fault proxy is
only on PATH for that acceptance test and never for application jobs.
