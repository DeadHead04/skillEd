# Windows and platform status

The translation retains Windows process, shell, environment and path handling. Windows x64/arm64 archives are build targets, but native Windows execution has not been performed in the available verification environment. A generated archive is not a compatibility certification.

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

No native Windows test or model-session claim is made. Run the cumulative gate on the target machine and retain its platform/version evidence before advertising support. Other native OS/architecture targets are likewise separate checks. In the tested OpenSandbox environment, execd 1.0.16 drops stdout line separators, affecting glob artifact collection; this was reproduced in the source implementation too.

Do not infer Windows guest support from Linux sandbox tests. The current runtime contract and configured server determine available guest behavior.
