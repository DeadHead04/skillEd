// Modified for the skilled TypeScript distribution.
import type { Command } from "commander";
import { Loader, type CaseConfig } from "../config/index.js";
import { type CliContext, errorMessage } from "./context.js";
import { resolveEvalPath } from "./run.js";
export function formatCaseTable(cases: CaseConfig[]): string {
  const rows = [
    ["ID", "Title", "Tag", "Prompt"],
    ...cases.map((c) => {
      const runes = Array.from(c.input.prompt);
      return [
        c.id,
        c.title || c.id,
        c.tag || "functional_test",
        runes.length > 50
          ? runes.slice(0, 47).join("") + "..."
          : c.input.prompt,
      ];
    }),
  ];
  // Preserve Go tabwriter column blocks even when prompts contain tabs/newlines.
  return rows
    .map((row) => row.join("\t"))
    .join("\n")
    .concat("\n")
    .split("\f")
    .map((block) => {
      const lines = block.split("\n").map((line) => line.split(/[\t\v]/));
      const widths = new Map<string, number>();
      function align(begin: number, end: number, column: number): void {
        for (let i = begin; i < end; ) {
          if (lines[i].length <= column + 1) {
            i++;
            continue;
          }
          let stop = i,
            width = 0;
          while (stop < end && lines[stop].length > column + 1) {
            width = Math.max(width, Array.from(lines[stop][column]).length + 2);
            stop++;
          }
          for (let j = i; j < stop; j++) widths.set(`${j}:${column}`, width);
          align(i, stop, column + 1);
          i = stop;
        }
      }
      align(0, lines.length, 0);
      return lines
        .map((line, i) =>
          line
            .map(
              (cell, column) =>
                cell +
                " ".repeat(
                  Math.max(
                    0,
                    (widths.get(`${i}:${column}`) ?? Array.from(cell).length) -
                      Array.from(cell).length,
                  ),
                ),
            )
            .join(""),
        )
        .join("\n");
    })
    .join("\n");
}
export function registerListCasesCommand(root: Command, ctx: CliContext): void {
  root
    .command("list-cases")
    .argument("[path]", "Path to evals/eval.yaml")
    .description("List evaluation cases referenced by the config")
    .action(async (file: string | undefined) => {
      const evalPath = await resolveEvalPath(ctx, file ? [file] : []);
      let result;
      try {
        result = await (await Loader.create(evalPath)).loadAll();
      } catch (e) {
        throw new Error(`failed to load config: ${errorMessage(e)}`, {
          cause: e,
        });
      }
      ctx.stdout(formatCaseTable(result.cases));
    });
}
