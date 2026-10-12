// Modified for the skilled TypeScript distribution.
import type { Command } from "commander";
import type { CliContext } from "./context.js";
import { serveMcp } from "../mcp/server.js";
export function registerMcpCommand(root: Command, ctx: CliContext): void {
  root
    .command("mcp")
    .description(
      "Serve skill validation, evaluation and workflow tools over MCP stdio",
    )
    .requiredOption(
      "--workspace <directory>",
      "Root directory for tool input and report paths",
    )
    .option(
      "--allow-execution",
      "Allow trusted evaluations to execute commands and use configured model credentials",
      false,
    )
    .action(async (options: { workspace: string; allowExecution: boolean }) => {
      await serveMcp({
        workspace: options.workspace,
        allowExecution: options.allowExecution,
        signal: ctx.signal,
      });
    });
}
