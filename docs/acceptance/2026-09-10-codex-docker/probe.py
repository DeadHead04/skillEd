import ctypes
import json
import os
import pathlib
import platform
import selectors
import subprocess
import tempfile
import time

report = {'scope': 'Fresh container; no mounted data or credentials; no model requests; outer network disabled. This is diagnostic evidence, not isolation acceptance.', 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'kernel': platform.release(), 'architecture': platform.machine(), 'uid': os.getuid(), 'probes': {}}

def run(name, command, cwd=None, env=None):
    try:
        p = subprocess.run(command, cwd=cwd, env=env, text=True, capture_output=True, timeout=15)
        report['probes'][name] = {'exitCode': p.returncode, 'stdout': p.stdout[-4000:], 'stderr': p.stderr[-4000:]}
    except subprocess.TimeoutExpired:
        report['probes'][name] = {'error': '15 second timeout'}

with tempfile.TemporaryDirectory(prefix='skilled-docker-probe-') as directory:
    root = pathlib.Path(directory)
    home = root / 'home'
    workspace = root / 'workspace'
    sibling = root / 'sibling'
    for path in [home, workspace, sibling]:
        path.mkdir()
    (workspace / 'input.txt').write_text('synthetic fixture')
    (sibling / 'marker.txt').write_text('synthetic sibling marker')
    env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'CODEX_HOME': str(home), 'TMPDIR': str(workspace), 'TZ': 'UTC'}
    report['processSecurity'] = [line for line in pathlib.Path('/proc/self/status').read_text().splitlines() if line.startswith(('NoNewPrivs:', 'Seccomp:', 'CapEff:'))]
    report['kernelSettings'] = {}
    for file in ['/proc/sys/user/max_user_namespaces', '/proc/sys/kernel/unprivileged_userns_clone', '/proc/sys/kernel/apparmor_restrict_unprivileged_userns']:
        path = pathlib.Path(file)
        report['kernelSettings'][file] = path.read_text().strip() if path.exists() else 'not present'
    run('codex_version', ['codex', '--version'], workspace, env)
    run('skill_up_version', ['skill-up', '--version'], workspace, env)
    run('user_namespace', ['python3', '-c', 'import ctypes,os; lib=ctypes.CDLL(None,use_errno=True); result=lib.unshare(0x10000000); err=ctypes.get_errno(); print({"result": result, "errno": err, "message": os.strerror(err)}); raise SystemExit(0 if result == 0 else 1)'], workspace, env)
    process = subprocess.Popen(['codex', 'app-server'], cwd=workspace, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        process.stdin.write(json.dumps({'id': 1, 'method': 'initialize', 'params': {'clientInfo': {'name': 'skilled-diagnostic', 'version': '0.1.0'}, 'capabilities': {}}}) + '\n')
        process.stdin.flush()
        sel = selectors.DefaultSelector()
        sel.register(process.stdout, selectors.EVENT_READ)
        if sel.select(15):
            line = process.stdout.readline()
            report['probes']['app_server_initialize'] = {'response': json.loads(line) if line else None}
        else:
            report['probes']['app_server_initialize'] = {'error': '15 second timeout'}
        sel.close()
    finally:
        process.terminate()
        try:
            _, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            _, stderr = process.communicate(timeout=5)
        report['probes']['app_server_initialize']['stderr'] = stderr[-2000:]
    command = "from pathlib import Path; assert Path('input.txt').read_text() == 'synthetic fixture'; Path('output.txt').write_text('ok'); print('workspace read/write succeeded')"
    run('legacy_workspace_sandbox', ['codex', '-c', 'sandbox_mode="workspace-write"', 'sandbox', 'linux', 'python3', '-c', command], workspace, env)
    config = '\n'.join(['default_permissions = "skilled-probe"', '[permissions.skilled-probe]', 'extends = ":workspace"', '[permissions.skilled-probe.filesystem]', '\":root\" = "deny"', '\":minimal\" = "read"', '\":tmpdir\" = "deny"', '\":slash_tmp\" = "deny"', json.dumps(str(workspace)) + ' = "write"', '[permissions.skilled-probe.network]', 'enabled = false', ''])
    (home / 'config.toml').write_text(config)
    run('strict_workspace_sandbox', ['codex', 'sandbox', 'linux', '--permissions-profile', 'skilled-probe', 'python3', '-c', command], workspace, env)
    denied = 'from pathlib import Path\ntry:\n Path(' + repr(str(sibling / 'marker.txt')) + ').read_text()\nexcept (PermissionError,FileNotFoundError):\n print("sibling read denied")\nelse:\n raise RuntimeError("sibling read allowed")'
    run('strict_sibling_sandbox', ['codex', 'sandbox', 'linux', '--permissions-profile', 'skilled-probe', 'python3', '-c', denied], workspace, env)
    judge = workspace / 'judge.py'
    judge.write_text('print("synthetic judge executed")\n')
    transcript = workspace / 'transcript.txt'
    transcript.write_text('synthetic transcript')
    run('actual_script_judge_wrapper', ['/usr/local/bin/skilled-script-sandbox', str(workspace), str(judge), str(transcript), 'python3 judge.py'], workspace, env)
    report['cpuCount'] = os.cpu_count()
    native_command = ['/usr/local/bin/skilled-codex', 'sandbox', 'linux', '--permissions-profile', 'skilled-probe', 'python3', '-c', command]
    for name, setup in {
        'address_space_512m_only': 'resource.setrlimit(resource.RLIMIT_AS, (512*1024**2, 512*1024**2))',
        'processes_64_only': 'resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))',
    }.items():
        wrapper = 'import os,resource; ' + setup + '; os.execv(' + repr(native_command[0]) + ', ' + repr(native_command) + ')'
        run(name, ['python3', '-c', wrapper], workspace, env)

print(json.dumps(report, indent=2))
