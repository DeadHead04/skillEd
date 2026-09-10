#!/usr/bin/env python3
"""Trusted Docker entrypoint for task CLI and App Server; no sandbox bypass."""
import os
import pathlib
import shutil
import subprocess
import sys
from runtime_permissions import policy_args, scratch_environment


def main():
    args = sys.argv[1:]
    native = '/usr/local/bin/skilled-codex'
    if not args or args[0] not in ('exec', 'app-server'):
        os.execv(native, [native] + args)
    if args[0] == 'app-server' and len(args) > 1 and args[1].startswith('generate-'):
        os.execv(native, [native] + args)
    # Replace Skill-Up's older selector with the trusted strict profile.
    filtered = []
    index = 0
    while index < len(args):
        arg = args[index]
        if arg.startswith('--dangerously-') or arg in ('--yolo', '--full-auto'):
            raise RuntimeError('Unrestricted Codex execution is not supported')
        if arg in ('--sandbox', '-s'):
            if index + 1 >= len(args) or args[index + 1] != 'workspace-write':
                raise RuntimeError('Only the trusted workspace permission profile is supported')
            index += 2
            continue
        if arg.startswith('--sandbox='):
            raise RuntimeError('Use the trusted workspace permission profile')
        filtered.append(arg)
        index += 1
    workspace = str(pathlib.Path.cwd().resolve())
    scratch, env = scratch_environment(workspace)
    try:
        return subprocess.call([native] + policy_args(workspace) + filtered, env=env)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print('Codex launch unavailable: ' + str(error), file=sys.stderr)
        sys.exit(2)
