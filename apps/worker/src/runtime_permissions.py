"""Permission arguments shared by the pinned CLI launcher and acceptance probes."""
import json
import os
import pathlib
import tempfile

POLICY_VERSION = 'skilled-workspace-v2'


def policy_args(workspace, readable=()):
    workspace = str(pathlib.Path(workspace).resolve(strict=True))
    rules = {':root': 'deny', ':minimal': 'read', ':slash_tmp': 'deny', ':tmpdir': 'write', workspace: 'write'}
    for path in readable:
        rules[str(pathlib.Path(path).resolve(strict=True))] = 'read'
    values = {
        'default_permissions': POLICY_VERSION,
        'permissions.' + POLICY_VERSION + '.extends': ':workspace',
        'permissions.' + POLICY_VERSION + '.network.enabled': False,
        'approval_policy': 'never',
        'web_search': 'disabled',
        # Snapshot startup would source a file from protected service home.
        # Start a clean shell instead of exposing that directory to commands.
        'features.shell_snapshot': False,
        # The private pilot permits local task tools only, with one model
        # operation at a time and no account connectors or browser sessions.
        'features.apps': False,
        'features.plugins': False,
        'features.browser_use': False,
        'features.browser_use_external': False,
        'features.computer_use': False,
        'features.multi_agent': False,
        'features.image_generation': False,
        'features.skill_mcp_dependency_install': False,
    }
    result = []
    for key, value in values.items():
        result.extend(['-c', key + '=' + json.dumps(value)])
    # CLI -c dotted keys are split literally; quote paths inside a TOML table
    # instead of treating paths (including dots) as pieces of a config key.
    table = '{' + ','.join(json.dumps(path) + '=' + json.dumps(access) for path, access in rules.items()) + '}'
    result.extend(['-c', 'permissions.' + POLICY_VERSION + '.filesystem=' + table])
    result.extend(['-c', 'permissions.' + POLICY_VERSION + '.workspace_roots={}', '-c', 'mcp_servers={}'])
    return result


def scratch_environment(workspace):
    scratch = tempfile.mkdtemp(prefix='.skilled-tmp-', dir=workspace)
    env = {key: os.environ[key] for key in ['PATH', 'HOME', 'CODEX_HOME', 'CODEX_CA_CERTIFICATE', 'SSL_CERT_FILE'] if key in os.environ}
    env.update({'TMPDIR': scratch, 'TZ': 'UTC'})
    return scratch, env
