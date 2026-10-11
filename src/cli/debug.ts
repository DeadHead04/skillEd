// Modified for the skilled TypeScript distribution.
import type { Command } from "commander";
import path from "node:path";
import { overallPassRate } from "../report/index.js";
import { buildReporter, readReportInput } from "./report.js";
import { type CliContext, errorMessage } from "./context.js";
import { registerJudgeDebugCommand } from "./judge-debug.js";
export function registerDebugCommand(root: Command, ctx: CliContext): void {
  const debug = root
    .command("debug")
    .description("Debug commands for module-level validation");
  debug.action(() => debug.outputHelp());
  debug
    .command("report")
    .argument("<input.json>")
    .description("Generate report from an Input JSON file")
    .option("--format <format>", "Report format: json, junit, html", "json")
    .action(async (file: string, opts) => {
      const input = await readReportInput(file, true),
        { reporter, outputPath } = buildReporter(opts.format, ".");
      try {
        await reporter.write(input);
      } catch (e) {
        throw new Error(`generate ${opts.format} report: ${errorMessage(e)}`, {
          cause: e,
        });
      }
      ctx.stderr(
        `[report] ${opts.format} format — ${input.case_results?.length ?? 0} cases (pass_rate: ${(overallPassRate(input) * 100).toFixed(0)}%)\n[output] ${path.resolve(outputPath)}\n`,
      );
    });
  registerJudgeDebugCommand(debug, ctx);
}
