# Use skilled from your agent

The release bundle includes the CLI, its Node runtime, the MCP server, and the
`skilled-improve` workflow with its references and YAML templates. Install once
with the [release installer](./installation.md), then connect your agent host to
the installed executable. No additional npm package or Skill download is needed.

## Connect

In a host that supports local stdio MCP servers, add a server named `skilled`
with these executable arguments:

```json
{
  "mcpServers": {
    "skilled": {
      "command": "/absolute/path/to/.local/bin/skilled",
      "args": ["mcp", "--workspace", "/absolute/path/to/my-project"]
    }
  }
}
```

Replace both absolute paths. The configuration file location and outer JSON
structure depend on your host; use its supported MCP setup screen or configuration.
The workspace directory must already exist. On Windows, point a host that can
launch command scripts at `skilled.cmd`; otherwise use the extracted bundle's
`runtime/node.exe` as the command and `app/dist/src/bootstrap.js` as the first
argument, with absolute paths to both files.

The default connection supports source validation, evaluation validation, dry
runs, report comparison and the improvement workflow. To let your agent execute
trusted evaluations, add `--allow-execution` to the server arguments. Execution
uses your configured engine and existing credentials; keep provider keys in your
local configuration or environment. The workspace restricts tool file paths; it
does not sandbox commands declared by an evaluation. The execution time limit is
not a provider spending limit.

## Ask your agent

> Use the skilled-improve prompt. Validate this Skill and its eval suite, explain
> any problems, and suggest regression cases. Start without calling a model.

Then, when ready:

> Run the suite, preserve the baseline report, improve the Skill using the failed
> cases, rerun the same suite, and compare the reports. Show me regressions and
> changes in case coverage before claiming an improvement.

Hosts supporting MCP prompts can load `skilled-improve` directly. Its resource is
`skilled://workflow/skilled-improve`. Referenced files are available as additional
resources under that URI, including `references/cli.md`,
`references/eval-yaml.md` and `assets/case.yaml.tmpl`. If a host does not expose
prompts, have the agent read the workflow resource.

## Available tools

| Tool | Input | Result |
| --- | --- | --- |
| `skilled_validate_skill` | `path`: Skill directory | Metadata and declared file-reference errors |
| `skilled_validate` | `path`: eval YAML or Skill directory | Validated cases and engine name |
| `skilled_run` | `path`, optional `dryRun`, `outputDir`, `timeoutSeconds`, `model`, `provider` | Dry-run case list or real CLI outcome and report location |
| `skilled_start` | `path`, `idempotencyKey`, optional `outputDir`, `timeoutSeconds`, `model`, `provider` | Persistent background run ID and state |
| `skilled_status` / `skilled_results` | `runId` | Saved lifecycle state, outcome and report paths |
| `skilled_cancel` | `runId` | Cancellation request; poll status until cleanup finishes |
| `skilled_compare` | `before`, `after`: report JSON paths | Matched case changes, regressions, coverage and comparability warnings |

Paths are relative to the selected workspace. `skilled_run` defaults to
`dryRun: true`; `dryRun: false` needs the execution-enabled server. Synchronous execution runs one
evaluation per server at a time, with a default timeout of 300 seconds and maximum of 3,600.
Cancellation requests CLI/runtime cleanup. Full reports remain on disk when
responses are truncated. Validation and comparison do not call a model.

## Long evaluations and reconnecting

Use `skilled_start` for evaluations that may outlast a host's MCP tool timeout:

```json
{"path":"skills/refund-policy", "idempotencyKey":"refund-policy-baseline-1", "timeoutSeconds":1200}
```

The execution-enabled server returns a `runId` promptly. Call `skilled_status`
with that ID until the state is terminal, then read `skilled_results`. Both return
saved state and report paths; they never run the evaluation again. The suite's
HTML and JUnit formats are preserved, and JSON is always included for comparison.

The worker continues after the client disconnects or the MCP server closes.
Reconnect to the **same workspace**, then use the saved run ID. If the initial
response was lost, repeat `skilled_start` with the same idempotency key and
arguments. It returns the existing job; changed arguments with the same key are
rejected. Use a new key for an intentional rerun. Each distinct key starts an
independent job, so limit concurrent starts to your available resources.

Job state is stored under `.skilled-mcp/jobs`. `outputDir` is a **base** directory;
each synchronous or background run receives its own `.skilled-runs/<id>` child.
The default base is `.skilled-mcp/runs`. Always use the returned `outputDir` and
report paths. Concurrent requests with the same base cannot overwrite one
another. Passing a directory inside an existing `.skilled-runs` tree is rejected. Keep these local runtime files out of source control. Responses include bounded
stdout/stderr previews and at most 256 report paths (32 KiB); `truncated` and
`reportsTruncated` identify shortened listings. Full reports remain in `outputDir`. Jobs
have states `starting`, `running`, `completed`, `failed`, `cancelled`,
`timed_out`, or `interrupted`. A stale heartbeat yields `unresponsive`; do not
launch a duplicate while execution is uncertain. Cancellation still requests
cleanup, and a recovered worker can resume reporting its actual state. A failed verdict gives a nonzero CLI exit and a
`failed` job; inspect its report to distinguish case failures from execution
errors. A machine restart does not resume model execution automatically: a dead
worker is reported as interrupted, with partial reports retained.

To stop a background run, use `skilled_cancel` on an execution-enabled server.
Cancellation is a request; poll until terminal state confirms cleanup. Closing
the client is not cancellation for these explicit background jobs. Synchronous
`skilled_run` retains its original request cancellation and server shutdown
behavior.

If using synchronous execution, the host's tool timeout must exceed
`timeoutSeconds` plus cleanup time. For a 1,200-second budget, a Codex server
configuration can set `tool_timeout_sec = 1500` under `[mcp_servers.skilled]`.
That host setting is separate from the evaluation budget; increasing one does
not increase the other. See the [Codex MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp).

## Where drift detection fits

`skilled compare` and its MCP tool detect changes between evaluation reports you
supply. They do not run continuously or watch other agent conversations. Keep a
baseline and rerun the same cases after changes to a Skill, engine or model.
Inspect input and grading differences alongside the reported verdict changes.
See [comparison and scoring](./comparison.md).

`skilled-improve` is the instruction workflow your agent follows to diagnose
failures, propose edits, add cases and verify changes using these tools. It is
not a second executable or an autonomous background service. Optional host
observation plugins capture explicitly attributed usage; MCP alone does not
capture unrelated host interactions.
