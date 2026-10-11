// Modified for the skilled TypeScript distribution.
import { stringArrayFlag } from "./run.js";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import {
  JSONReporter,
  JUnitReporter,
  HTMLReporter,
  MarkdownReporter,
  overallPassRate,
  type Reporter,
  type Input,
} from "../report/index.js";
import { parseJSONInput } from "./json-input.js";
import { type CliContext, errorMessage } from "./context.js";
export function buildReporter(
  format: string,
  outputDir: string,
): { reporter: Reporter; outputPath: string } {
  const names: Record<string, string> = {
    json: "report.json",
    junit: "report.xml",
    html: "report.html",
  };
  if (!Object.hasOwn(names, format))
    throw new Error(
      `unsupported report format ${JSON.stringify(format)} (supported: json, junit, html)`,
    );
  const outputPath = path.join(outputDir, names[format]);
  return {
    outputPath,
    reporter:
      format === "json"
        ? new JSONReporter(outputPath)
        : format === "junit"
          ? new JUnitReporter(outputPath)
          : new HTMLReporter(outputPath),
  };
}
export function buildReportCommandReporter(
  format: string,
  outputDir: string,
): { reporter: Reporter; outputPath: string } {
  if (format === "markdown") {
    const outputPath = path.join(outputDir, "report.md");
    return { outputPath, reporter: new MarkdownReporter(outputPath) };
  }
  try {
    return buildReporter(format, outputDir);
  } catch {
    throw new Error(
      `unsupported report format ${JSON.stringify(format)} (supported: json, junit, html, markdown)`,
    );
  }
}
export function countByStatus(input: Input, status: string): number {
  return (input.case_results ?? []).filter((c) => c.status === status).length;
}
export function parseReportInput(data: string): Input {
  return parseJSONInput<Input>("report.Input", data, true);
}
export async function readReportInput(
  file: string,
  debug = false,
): Promise<Input> {
  let data: string;
  try {
    data = await readFile(file, "utf8");
  } catch (e) {
    throw new Error(
      `${debug ? `read input file ${JSON.stringify(file)}` : "read result file"}: ${errorMessage(e)}`,
      { cause: e },
    );
  }
  try {
    return parseReportInput(data);
  } catch (e) {
    throw new Error(
      `${debug ? "parse input JSON" : "parse result file"}: ${errorMessage(e)}`,
      { cause: e },
    );
  }
}
export function registerReportCommand(root: Command, ctx: CliContext): void {
  root
    .command("report")
    .argument("<result.json>")
    .description("Generate reports from a previous evaluation run")
    .option(
      "--format <format>",
      "Report format (json, junit, html, markdown). Can be specified multiple times. Default: json",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option(
      "--output-dir <directory>",
      "Directory for report outputs. Default: same directory as result.json",
      "",
    )
    .action(async (file: string, opts, cmd: Command) => {
      const input = await readReportInput(file),
        formats: string[] = stringArrayFlag(cmd, "format").length
          ? stringArrayFlag(cmd, "format")
          : ["json"],
        outputDir = opts.outputDir || path.dirname(file);
      try {
        await mkdir(outputDir, { recursive: true, mode: 0o755 });
      } catch (e) {
        throw new Error(
          `create output directory ${outputDir}: ${errorMessage(e)}`,
          { cause: e },
        );
      }
      for (const format of formats) {
        const { reporter, outputPath } = buildReportCommandReporter(
          format,
          outputDir,
        );
        try {
          await reporter.write(input);
        } catch (e) {
          throw new Error(`write ${format} report: ${errorMessage(e)}`, {
            cause: e,
          });
        }
        ctx.stdout(`Generated ${format} report: ${outputPath}\n`);
      }
      ctx.stdout(
        `\nPass rate: ${(overallPassRate(input) * 100).toFixed(1)}% (${countByStatus(input, "PASS")}/${input.case_results?.length ?? 0} cases)\n`,
      );
    });
}
