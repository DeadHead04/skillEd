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
| `skilled_compare` | `before`, `after`: report JSON paths | Matched case changes, regressions, coverage and comparability warnings |

Paths are relative to the selected workspace. `skilled_run` defaults to
`dryRun: true`; `dryRun: false` needs the execution-enabled server. It runs one
evaluation at a time, with a default timeout of 300 seconds and maximum of 3,600.
Cancellation requests CLI/runtime cleanup. Full reports remain on disk when
responses are truncated. Validation and comparison do not call a model.

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
