# Windows and platform status

Version 0.1.0 provides self-contained Windows x64 and ARM64 archives, alongside Linux and macOS archives. The [release workflow](https://github.com/DeadHead04/skillEd/actions/runs/38136609356) passed native package acceptance and published-installer checks on Linux, macOS, and Windows runners.

| Check | Verified scope |
| --- | --- |
| Archive contents, hashes, and metadata | All six OS/CPU targets |
| Packaged CLI/API and published installer | Native Linux, macOS, and Windows CI runner architectures |
| Additional development execution | macOS ARM64, Linux ARM64 Docker, macOS x64 via Rosetta, Linux x64 via Docker emulation |
| Windows ARM64 hardware and all live model combinations | Not established by these checks |

Start with the [Windows PowerShell installer](./installation.md#windows-powershell). It bundles Node and requires no source build.

## Setup

For development, install Node 24.21.0, npm and Git, then run:

```powershell
npm ci
npm run build
node dist/src/bootstrap.js --version
npm run typecheck
npm test
```

The source checkout needs Node. A self-contained Windows archive includes Node and a `skilled.cmd` launcher. Run `skilled.cmd --help` after extraction; choose the archive matching the machine architecture.

## Preserved runtime behavior

The `none` runtime executes on the host. Windows shell commands use `cmd.exe`; process-tree termination uses `taskkill`. The remote OpenSandbox runtime executes in its Linux sandbox. Docker support requires a working Docker environment; local tests here used Linux containers on macOS.

Script judges select interpreters by extension: `.ps1` uses PowerShell, `.cmd`/`.bat` uses `cmd.exe`, and `.sh` needs a usable bash. `SKILLED_BASH` supplies an explicit bash path. The implementation also checks PATH and common Git Bash locations; the Windows WSL bash shim is excluded because it does not accept the same host paths.

## Verification limits

Native Windows package and installer checks passed for v0.1.0. They do not certify Windows ARM64 hardware, all external services, or authenticated model sessions. Run the relevant checks on additional target machines and retain their platform/version evidence. In the tested OpenSandbox environment, execd 1.0.16 drops stdout line separators, affecting glob artifact collection; this was reproduced in the source implementation too.

Do not infer Windows guest support from Linux sandbox tests. The current runtime contract and configured server determine available guest behavior.
