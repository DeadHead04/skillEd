#!/usr/bin/env python3
"""Acceptance-only transport fault; both judge attempts still call real Codex.

The harness prepends STATE_FILE and puts this proxy on PATH only during its
synthetic Skill-Up recovery case. It is never installed as the service launcher.
"""
import json
import pathlib
import subprocess
import sys

args = sys.argv[1:]
payload = sys.stdin.buffer.read()
result = subprocess.run(['/usr/local/bin/codex'] + args, input=payload, capture_output=True)
sys.stderr.buffer.write(result.stderr)
state = pathlib.Path(STATE_FILE)
trigger = 'SKILLED_CORRECTION_CANARY' in (' '.join(args) + payload.decode(errors='replace'))
if result.returncode == 0 and trigger and not state.exists():
    lines = []
    corrupted = False
    for line in result.stdout.decode().splitlines():
        try:
            item = json.loads(line)
            if item.get('type') == 'item.completed' and item.get('item', {}).get('type') == 'agent_message':
                item['item']['text'] = '{injected-invalid-transport'
                corrupted = True
            lines.append(json.dumps(item))
        except ValueError:
            lines.append(line)
    if not corrupted:
        print('Acceptance fault injection did not find a completed agent response', file=sys.stderr)
        sys.exit(2)
    if '--output-last-message' in args:
        output = pathlib.Path(args[args.index('--output-last-message') + 1])
        if output.name == 'auth.json': raise RuntimeError('Invalid acceptance output path')
        output.write_text('{injected-invalid-transport')
    state.write_text('One deliberate malformed transport response injected; no model response fabricated.')
    sys.stdout.write('\n'.join(lines) + '\n')
else:
    sys.stdout.buffer.write(result.stdout)
sys.exit(result.returncode)
