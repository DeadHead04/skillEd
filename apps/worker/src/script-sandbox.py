#!/usr/bin/env python3
"""Trusted judge entrypoint. A sandbox failure is fatal; there is no direct-exec fallback."""
import json
import os
import pathlib
import resource
import shutil
import subprocess
import sys
import tempfile


def main():
    if sys.platform != 'linux' or len(sys.argv) != 5:
        raise RuntimeError('Linux judge sandbox requires workspace, script, transcript and command')
    workspace, script, transcript, command = sys.argv[1:]
    workspace = str(pathlib.Path(workspace).resolve(strict=True))
    script = str(pathlib.Path(script).resolve(strict=True))
    config = tempfile.mkdtemp(prefix='skilled-judge-policy-')
    try:
        rules = {':root': 'deny', ':minimal': 'read', ':tmpdir': 'deny', ':slash_tmp': 'deny', workspace: 'write', script: 'read'}
        if transcript:
            rules[str(pathlib.Path(transcript).resolve(strict=True))] = 'read'
        lines = ['default_permissions = "skilled-judge"', '[permissions.skilled-judge]', 'extends = ":workspace"', '[permissions.skilled-judge.filesystem]']
        lines.extend(json.dumps(key) + ' = ' + json.dumps(value) for key, value in rules.items())
        lines.extend(['[permissions.skilled-judge.network]', 'enabled = false'])
        pathlib.Path(config, 'config.toml').write_text('\n'.join(lines) + '\n')
        environment = {'PATH': os.environ.get('PATH', '/usr/local/bin:/usr/bin:/bin'), 'HOME': config, 'CODEX_HOME': config, 'TMPDIR': workspace, 'TZ': 'UTC'}
        for key in ['EVAL_FINAL_MESSAGE', 'EVAL_TRANSCRIPT_PATH', 'EVAL_EXIT_CODE']:
            environment[key] = os.environ.get(key, '')
        def limits():
            resource.setrlimit(resource.RLIMIT_AS, (512 * 1024**2, 512 * 1024**2))
            resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
            resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
            resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
            resource.setrlimit(resource.RLIMIT_FSIZE, (250 * 1024**2, 250 * 1024**2))
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        return subprocess.run(['codex', 'sandbox', 'linux', '--permissions-profile', 'skilled-judge', 'sh', '-c', command], cwd=workspace, env=environment, timeout=30, preexec_fn=limits).returncode
    finally:
        shutil.rmtree(config, ignore_errors=True)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('Script sandbox unavailable: ' + str(error), file=sys.stderr)
        sys.exit(2)
