"""Build-time fingerprint of pinned runtime binaries, lockfile and product source."""
import hashlib
import importlib.metadata
import pathlib

digest = hashlib.sha256()
files = [pathlib.Path(p) for p in ['/usr/local/bin/skilled-codex', '/usr/local/bin/skill-up', '/usr/local/bin/node', '/usr/bin/python3', '/app/apps/worker/Dockerfile', '/app/pnpm-lock.yaml', '/opt/skilled/canary.mjs', '/opt/skilled/docker-seccomp.json']]
for directory in ['/app/apps/worker/src', '/app/packages/core/src']:
    files.extend(p for p in pathlib.Path(directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
for distribution in importlib.metadata.distributions():
    for entry in distribution.files or []:
        path = pathlib.Path(distribution.locate_file(entry)).resolve()
        if path.is_file() and path.suffix != '.pyc':
            files.append(path)
for path in sorted(set(files)):
    digest.update(str(path).encode() + b'\0')
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''): digest.update(block)
print('skilled-runtime-' + digest.hexdigest())
