# Set up skilled in this project

These are setup instructions for an agent whose user has asked to install and
try skilled. The release bundles the CLI, Node runtime, MCP tools and the
skilled-improve workflow. Do not install an unrelated package from npm.

1. Identify the current project and operating system. If `skilled --version`
   already works, keep that installation unless the user requested an update.
   Otherwise install the latest public release using the appropriate command:

   macOS or Linux:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/DeadHead04/skillEd/main/install.sh | bash
   export PATH="$HOME/.local/bin:$PATH"
   skilled --version
   ```

   Windows PowerShell:

   ```powershell
   $installer = Join-Path $env:TEMP 'skilled-install.ps1'
   Invoke-WebRequest https://raw.githubusercontent.com/DeadHead04/skillEd/main/install.ps1 -OutFile $installer
   & $installer
   $env:Path = "$(Join-Path $HOME '.local/bin');$env:Path"
   skilled --version
   ```

2. If the host supports MCP configuration, add a server named `skilled` using the
   absolute installed launcher and arguments `mcp --workspace <absolute-project>`.
   Use the host's supported setup method; preserve existing servers. If the host
   cannot configure MCP, continue through the CLI. Host-specific instructions and
   Windows executable alternatives are at
   https://deadhead04.github.io/skillEd/guide/mcp.

3. Load the `skilled-improve` MCP prompt, or read its workflow resource at
   `skilled://workflow/skilled-improve`. References and templates are additional
   resources beneath that URI. For CLI-only use, the installed release also
   contains `app/skills/skilled-improve/SKILL.md`; the canonical source is
   https://raw.githubusercontent.com/DeadHead04/skillEd/main/skills/skilled-improve/SKILL.md.

4. If this project has a Skill, validate its source and existing suite with
   `skilled validate --skill <skill-directory>` and
   `skilled validate <skill-directory>/evals/eval.yaml`. Explain actionable
   errors. Preserve existing files and test assertions. If no suite exists,
   follow the bundled workflow to create a small relevant evaluation suite.
   For a standalone trial, create a new directory and follow the Hello World
   example at https://deadhead04.github.io/skillEd/guide/getting-started.

5. Run `skilled run <eval.yaml> --dry-run` (or MCP `skilled_run` with `dryRun:true`).
   Show the selected cases and engine. This is useful without model credentials;
   clearly label it validation, not a successful model evaluation.

6. If the user requested a real evaluation and the selected engine is installed
   and authenticated, run it with JSON and HTML reports. MCP execution requires
   `--allow-execution` in the server configuration and `dryRun:false`. Credentials
   stay in the user's configuration or environment. Respect their model budget.
   If access is missing, identify the single missing prerequisite; do not invent
   success or copy credentials between unrelated applications.

7. Open the generated HTML report using the host's file/browser feature and
   summarize actual verdicts. Preserve this run as a baseline. When the user
   requests improvement, use skilled-improve to revise the Skill, rerun the same
   cases into another output directory, and compare the two reports with
   `skilled compare <before.json> <after.json> --fail-on-regression`. Include
   coverage changes and comparability warnings in the conclusion.

No separate `skilled-improve` executable is needed. MCP supplies the tools and
workflow; it does not silently monitor unrelated conversations or run a background
drift detector.
