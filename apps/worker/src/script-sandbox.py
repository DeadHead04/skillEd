#!/usr/bin/env python3
"""Trusted judge entrypoint. A sandbox failure is fatal; there is no direct-exec fallback."""
import json
import os
import pathlib
import resource
import shlex
import shutil
import subprocess
import sys
import tempfile
from runtime_permissions import policy_args, scratch_environment


def main():
    if sys.platform != 'linux' or len(sys.argv) != 5:
        raise RuntimeError('Linux judge sandbox requires workspace, script, transcript and command')
    workspace, script, transcript, command = sys.argv[1:]
    workspace = str(pathlib.Path(workspace).resolve(strict=True))
    script = str(pathlib.Path(script).resolve(strict=True))
    # Restricted-read files are deliberately not executable. Invoke their
    # declared interpreter inside the sandbox without granting script writes.
    if shlex.split(command) == [script]:
        with open(script, 'r') as source:
            first_line = source.readline(4096).strip()
        interpreter = shlex.split(first_line[2:]) if first_line.startswith('#!') else ['sh']
        if not interpreter:
            raise RuntimeError('Script judge has an empty interpreter declaration')
        command = shlex.join(interpreter + [script])
    scratch, environment = scratch_environment(workspace)
    config = tempfile.mkdtemp(prefix='skilled-judge-home-', dir='/tmp')
    environment.update({'HOME': config, 'CODEX_HOME': config})
    for key in ['EVAL_FINAL_MESSAGE', 'EVAL_TRANSCRIPT_PATH', 'EVAL_EXIT_CODE']:
        environment[key] = os.environ.get(key, '')
    # Apply UID-accounted limits after entering the fresh user namespace.
    limited = '\n'.join([
        'import os,resource',
        'resource.setrlimit(resource.RLIMIT_AS,(512*1024**2,512*1024**2))',
        'resource.setrlimit(resource.RLIMIT_CPU,(30,30))',
        'resource.setrlimit(resource.RLIMIT_NPROC,(64,64))',
        'resource.setrlimit(resource.RLIMIT_NOFILE,(256,256))',
        'resource.setrlimit(resource.RLIMIT_FSIZE,(250*1024**2,250*1024**2))',
        'resource.setrlimit(resource.RLIMIT_CORE,(0,0))',
        'os.execvp("sh",["sh","-c",' + repr(command) + '])',
    ])
    try:
        readable = [script] + ([transcript] if transcript else [])
        args = ['/usr/local/bin/skilled-codex'] + policy_args(workspace, readable)
        # The pinned CLI accepts sandbox -- COMMAND, without a linux subcommand.
        args += ['sandbox', '--', 'python3', '-c', limited]
        return subprocess.run(args, cwd=workspace, env=environment, timeout=30).returncode
    finally:
        shutil.rmtree(config, ignore_errors=True)
        shutil.rmtree(scratch, ignore_errors=True)



if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('Script sandbox unavailable: ' + str(error), file=sys.stderr)
        sys.exit(2)
