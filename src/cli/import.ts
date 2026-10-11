// Modified for the skilled TypeScript distribution.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import type { Command } from "commander";
import {
  decode,
  defaultEvalConfig,
  findSkillDir,
  type CaseConfig,
  type EvalConfig,
} from "../config/index.js";
import { type CliContext, errorMessage } from "./context.js";
import { parseJSONInput } from "./json-input.js";
import { yamlConfiguration } from "./yaml-config.js";
export interface AnthropicEval {
  id: number;
  prompt: string;
  expected_output: string;
  files: string[];
  expectations: string[];
}
export interface AnthropicEvals {
  skill_name: string;
  evals: AnthropicEval[];
}
export function parseAnthropicEvals(data: string): AnthropicEvals {
  const value = parseJSONInput<AnthropicEvals>("cli.anthropicEvals", data);
  value.evals = (value.evals ?? []).map((e) => ({
    ...e,
    files: e.files ?? [],
    expectations: e.expectations ?? [],
  }));
  return value;
}
export const importedCaseID = (id: number): string => `case-${id}`;
export function convertEvalToCase(
  entry: AnthropicEval,
  skillName: string,
): CaseConfig {
  return decode<CaseConfig>("CaseConfig", {
    id: importedCaseID(entry.id),
    title: `${skillName} - ${entry.id}`,
    description: entry.expected_output,
    tag: "functional_test",
    input: { prompt: entry.prompt },
    context: { files: Object.fromEntries(entry.files.map((f) => [f, f])) },
    expect: {},
    judge: {
      type: "agent_judge",
      model: "anthropic/claude-sonnet-4-6",
      criteria: entry.expectations,
    },
  });
}
export async function computeOutputRelPrefix(
  outputDir: string,
): Promise<string> {
  const abs = path.resolve(outputDir);
  const found = await findSkillDir(abs);
  return found.fallback
    ? path.basename(abs)
    : path.relative(found.directory, abs);
}
export async function generateEvalConfig(
  caseIDs: string[],
  outputDir: string,
): Promise<EvalConfig> {
  const cfg = defaultEvalConfig(),
    prefix = await computeOutputRelPrefix(outputDir);
  cfg.cases.files = caseIDs.map((id) =>
    path.posix.join(prefix.split(path.sep).join("/"), "cases", id + ".yaml"),
  );
  cfg.skills = [
    { source: "local_path", path: ".", target: "", include: [], exclude: [] },
  ];
  cfg.judge.type = "agent_judge";
  if (cfg.engine.model.provider && cfg.engine.model.name)
    cfg.judge.model = `${cfg.engine.model.provider}/${cfg.engine.model.name}`;
  cfg.judge.criteria = [
    "Imported Anthropic eval cases define their own case-level criteria.",
  ];
  cfg.report.formats = ["json", "html"];
  cfg.report.artifacts = ["transcript"];
  return cfg;
}
export function registerImportCommand(root: Command, ctx: CliContext): void {
  root
    .command("import")
    .argument("<path>", "Path to evals.json")
    .description(
      "Import Anthropic evals.json format to skilled case.yaml files",
    )
    .option(
      "--output <directory>",
      "Output directory (default: same as evals.json)",
      "",
    )
    .action(async (file: string, opts) => {
      let data: string;
      try {
        data = await readFile(file, "utf8");
      } catch (e) {
        throw new Error(`failed to read evals.json: ${errorMessage(e)}`, {
          cause: e,
        });
      }
      let evals: AnthropicEvals;
      try {
        evals = parseAnthropicEvals(data);
      } catch (e) {
        throw new Error(`failed to parse evals.json: ${errorMessage(e)}`, {
          cause: e,
        });
      }
      if (!evals.skill_name)
        throw new Error("evals.json missing required field: skill_name");
      const outputDir = opts.output || path.dirname(file),
        casesDir = path.join(outputDir, "cases");
      try {
        await mkdir(casesDir, { recursive: true, mode: 0o755 });
      } catch (e) {
        throw new Error(
          `failed to create cases directory: ${errorMessage(e)}`,
          { cause: e },
        );
      }
      const ids: string[] = [];
      for (const entry of evals.evals) {
        const cfg = convertEvalToCase(entry, evals.skill_name);
        ids.push(cfg.id);
        const filePath = path.join(casesDir, cfg.id + ".yaml");
        try {
          await writeFile(
            filePath,
            stringify(yamlConfiguration("CaseConfig", cfg), { indent: 4 }),
            { mode: 0o600 },
          );
        } catch (e) {
          throw new Error(
            `failed to write case file ${filePath}: ${errorMessage(e)}`,
            { cause: e },
          );
        }
        ctx.stdout(`Imported case ${entry.id} -> ${filePath}\n`);
      }
      const cfg = await generateEvalConfig(ids, outputDir),
        evalPath = path.join(outputDir, "eval.yaml");
      try {
        await writeFile(
          evalPath,
          stringify(yamlConfiguration("EvalConfig", cfg), { indent: 4 }),
          { mode: 0o600 },
        );
      } catch (e) {
        throw new Error(`failed to write eval.yaml: ${errorMessage(e)}`, {
          cause: e,
        });
      }
      ctx.stdout(
        `\nGenerated eval.yaml -> ${evalPath}\nTotal: ${evals.evals.length} cases imported\n`,
      );
    });
}
