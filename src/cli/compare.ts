import type { Command } from "commander";
import { compareResultFiles, renderComparisonText } from "../report/compare.js";
import type { CliContext } from "./context.js";

export function registerCompareCommand(root: Command, ctx: CliContext): void {
  root.command("compare")
    .description("Compare two existing evaluation result JSON files without running agents")
    .argument("<before>", "Baseline result.json or report.json")
    .argument("<after>", "Candidate result.json or report.json")
    .option("--format <format>", "Output format: text or json", "text")
    .option("--fail-on-regression", "Exit unsuccessfully if matched cases regress", false)
    .action(async (before: string, after: string, options: { format: string; failOnRegression: boolean }) => {
      if (!["text", "json"].includes(options.format)) throw new Error("unsupported comparison format (supported: text, json)");
      const result = await compareResultFiles(before, after);
      ctx.stdout(options.format === "json" ? JSON.stringify(result, null, 2) + "\n" : renderComparisonText(result));
      if (options.failOnRegression && result.hasRegressions) throw new Error(`comparison found ${result.summary.regressions} regression(s)`);
    });
}
