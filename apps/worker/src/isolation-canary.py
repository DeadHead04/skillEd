#!/usr/bin/env python3
"""Credential-free acceptance of the actual Docker permission and judge paths."""
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
sys.path.insert(0, '/usr/local/bin')
from runtime_permissions import POLICY_VERSION, policy_args, scratch_environment

CHECKS = ['non_root', 'workspace', 'hidden_reads', 'process_isolation', 'network_denial', 'script_judge', 'resource_limits', 'codex_initial', 'codex_resume', 'app_server', 'judge_correction', 'login_persistence', 'conversation_recovery']


def run_canary():
    identity = pathlib.Path('/opt/skilled/image-revision')
    revision = (identity.read_text().strip() if identity.exists() else '') or os.environ.get('SKILLED_IMAGE_REVISION') or os.environ.get('RENDER_GIT_COMMIT') or 'unidentified-image'
    report = {'schemaVersion': 'skilled-readiness-v1', 'status': 'blocked', 'checkedAt': datetime.now(timezone.utc).isoformat(), 'imageRevision': revision, 'policyVersion': POLICY_VERSION, 'checks': []}
    results = {name: {'name': name, 'status': 'pending', 'detail': 'Authenticated acceptance not yet run'} for name in CHECKS}
    def check(name, operation):
        try:
            detail = operation()
            results[name] = {'name': name, 'status': 'passed', 'detail': detail or 'Measured check passed'}
        except Exception as error:
            results[name] = {'name': name, 'status': 'failed', 'detail': str(error)[-2000:]}
    root = pathlib.Path(tempfile.mkdtemp(prefix='isolation-', dir=os.environ.get('WORK_ROOT', '/data/work')))
    workspace = root / 'workspace'
    home = root / 'synthetic-home'
    sibling = root / 'sibling'
    for directory in [workspace, home, sibling]: directory.mkdir()
    (workspace / 'input.txt').write_text('fixture')
    (sibling / 'marker.txt').write_text('synthetic hidden answer')
    (home / 'marker.txt').write_text('synthetic service marker')
    scratch, env = scratch_environment(str(workspace))
    env.update({'HOME': str(home), 'CODEX_HOME': str(home)})
    def execute(code):
        args = ['/usr/local/bin/skilled-codex'] + policy_args(workspace) + ['sandbox', '--', 'python3', '-c', code]
        result = subprocess.run(args, cwd=workspace, env=env, capture_output=True, text=True, timeout=15)
        if result.returncode: raise RuntimeError(result.stderr or 'Sandbox command failed')
        return result.stdout.strip()
    def non_root():
        assert os.getuid() > 0, 'Executor must run as non-root'
        status = dict(line.split(':', 1) for line in pathlib.Path('/proc/self/status').read_text().splitlines() if ':' in line)
        assert int(status['CapEff'].strip(), 16) == 0, 'Executor must not have effective capabilities'
        assert status['NoNewPrivs'].strip() == '1', 'Enable no-new-privileges for the executor'
        assert status['Seccomp'].strip() == '2', 'Executor must retain seccomp filtering'
        return 'Non-root executor, no effective capabilities, no-new-privileges and seccomp enabled'
    def hidden_reads():
        paths = [str(sibling / 'marker.txt'), str(home / 'marker.txt')]
        return execute('from pathlib import Path\nfor name in ' + repr(paths) + ':\n try: Path(name).read_text()\n except (PermissionError,FileNotFoundError): pass\n else: raise RuntimeError("Hidden synthetic file was readable")\nprint("Synthetic home and sibling reads denied")')
    def process_isolation():
        # The strict policy intentionally hides /proc. Check an outside PID
        # against the fresh inner PID numbering without granting /proc reads.
        sentinel = subprocess.Popen(['sleep', '20'])
        try:
            assert sentinel.pid > 3, 'Sentinel PID overlaps sandbox init range'
            return execute('import os\nassert 1 <= os.getpid() <= 3, "Expected fresh PID namespace"\ntry: os.kill(' + str(sentinel.pid) + ',0)\nexcept (ProcessLookupError,PermissionError): pass\nelse: raise RuntimeError("Outside sentinel process was reachable")\nprint("Fresh PID numbering; outside process inaccessible")')
        finally:
            sentinel.terminate(); sentinel.wait(timeout=3)
    def network():
        with socket.socket() as server:
            server.bind(('127.0.0.1', 0)); server.listen()
            port = server.getsockname()[1]
            with socket.create_connection(('127.0.0.1', port), 2): pass
            return execute('import socket\ns=None\ntry:\n s=socket.socket(); s.settimeout(2); s.connect(("127.0.0.1",' + str(port) + '))\nexcept OSError as e:\n assert e.errno in (1,13,101,111), str(e)\nelse: raise RuntimeError("Sandbox reached host listener")\nfinally:\n if s: s.close()\nprint("Host-reachable listener inaccessible to sandbox")')
    def judge(code):
        script = root / 'judge.py'; script.write_text(code)
        transcript = root / 'transcript.txt'; transcript.write_text('synthetic transcript')
        result = subprocess.run(['/usr/local/bin/skilled-script-sandbox', str(workspace), str(script), str(transcript), 'python3 ' + str(script)], env=env, capture_output=True, text=True, timeout=35)
        if result.returncode: raise RuntimeError(result.stderr or 'Actual judge wrapper failed')
        return result.stdout.strip()
    def resources():
        limits = {name: pathlib.Path('/sys/fs/cgroup/' + name).read_text().strip() for name in ['memory.max', 'pids.max', 'cpu.max']}
        assert limits['memory.max'] != 'max' and int(limits['memory.max']) <= 4*1024**3, 'Set Docker memory limit to at most 4 GiB'
        assert limits['pids.max'] != 'max' and int(limits['pids.max']) <= 512, 'Set Docker pids_limit to at most 512'
        quota, period = limits['cpu.max'].split()
        assert quota != 'max' and int(quota)/int(period) <= 2, 'Set Docker CPU limit to at most 2 CPUs'
        detail = judge('import resource\nassert resource.getrlimit(resource.RLIMIT_NPROC)==(64,64)\nassert resource.getrlimit(resource.RLIMIT_CPU)==(30,30)\nassert resource.getrlimit(resource.RLIMIT_FSIZE)==(250*1024**2,250*1024**2)\ntry: bytearray(600*1024**2)\nexcept MemoryError: pass\nelse: raise RuntimeError("Memory limit not enforced")\nprint("Judge resource limits active; oversized allocation denied")\n')
        process_probe = subprocess.run(['node', '--import', '/app/node_modules/tsx/dist/loader.mjs', '/app/apps/worker/src/sandbox-process-canary.ts', json.dumps(policy_args(workspace) + ['sandbox', '--'])], cwd=workspace, env=env, capture_output=True, text=True, timeout=25)
        assert process_probe.returncode == 0, process_probe.stderr[-2000:]
        return detail + '; Docker limits ' + json.dumps(limits) + '; ' + process_probe.stdout.strip()
    def skillup_judge():
        script = root / 'cli-judge.py'
        script.write_text('#!/usr/bin/env python3\n' + '\n'.join([
            'import os,sys',
            'from pathlib import Path',
            'assert Path(os.environ["EVAL_TRANSCRIPT_PATH"]).is_file()',
            'for name in [__file__, os.environ["EVAL_TRANSCRIPT_PATH"]]:',
            ' try: Path(name).open("a").close()',
            ' except (PermissionError,OSError): pass',
            ' else: raise RuntimeError("Judge truth is writable")',
            'for name in ' + repr([str(home / 'marker.txt'), str(sibling / 'marker.txt')]) + ':',
            ' try: Path(name).read_text()',
            ' except (PermissionError,FileNotFoundError): pass',
            ' else: raise RuntimeError("Hidden service data readable")',
            'passed = Path("output.txt").read_text() == os.environ["EVAL_FINAL_MESSAGE"]',
            'print("ISOLATED_JUDGE_PASS" if passed else "ISOLATED_JUDGE_FAIL")',
            'sys.exit(0 if passed else 1)',
        ]) + '\n')
        staging = root / 'staging'; staging.mkdir()
        cli_env = dict(env, TMPDIR=str(staging), SKILLED_SCRIPT_SANDBOX='/usr/local/bin/skilled-script-sandbox')
        for expected, outcome in [('result', 'PASS'), ('deliberately wrong', 'FAIL')]:
            run_dir = root / ('judge-' + outcome); run_dir.mkdir()
            request = run_dir / 'input.json'
            request.write_text(json.dumps({'case_id': 'isolation-script', 'workspace_path': str(workspace), 'final_message': expected, 'exit_code': 0, 'transcript': [{'role': 'assistant', 'content': 'synthetic output', 'turn': 1}], 'judge': {'type': 'script', 'script_path': str(script), 'timeout_seconds': 30}}))
            result = subprocess.run(['skill-up', 'debug', 'judge', str(request)], cwd=run_dir, env=cli_env, capture_output=True, text=True, timeout=40)
            assert result.returncode == 0, result.stderr[-1200:]
            grading = json.loads((run_dir / 'grading.json').read_text())
            assert grading['status'] == outcome, json.dumps(grading)
            assertions = grading['assertion_results']
            assert len(assertions) == 1 and 'ISOLATED_JUDGE_' + outcome in assertions[0]['evidence'], json.dumps(grading)
        return 'Actual Skill-Up script judge: PASS and intentional FAIL; staged validator/transcript read-only, hidden reads denied'
    try:
        check('non_root', non_root)
        check('workspace', lambda: execute('from pathlib import Path; assert Path("input.txt").read_text()=="fixture"; Path("output.txt").write_text("result"); print("Workspace read/write passed")'))
        check('hidden_reads', hidden_reads)
        check('process_isolation', process_isolation)
        check('network_denial', network)
        check('script_judge', skillup_judge)
        check('resource_limits', resources)
    finally:
        shutil.rmtree(root, ignore_errors=True)
    report['checks'] = [results[name] for name in CHECKS]
    report['deterministicReady'] = all(results[name]['status'] == 'passed' for name in CHECKS[:7])
    return report


if __name__ == '__main__':
    report = run_canary()
    print(json.dumps(report))
    sys.exit(0 if report['deterministicReady'] else 1)
