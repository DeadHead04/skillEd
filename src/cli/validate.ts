// Modified for the skilled TypeScript distribution.
import type { Command } from "commander";
import {
  Loader,
  validateAll,
  resolveCustomEngineConfig,
} from "../config/index.js";
import { type CliContext, errorMessage } from "./context.js";
import { resolveEvalPath } from "./run.js";
import { validateSkillSource } from "../skill/integrity.js";
export function registerValidateCommand(root: Command, ctx: CliContext): void {
  root
    .command("validate")
    .argument("[path]", "Path to evals/eval.yaml")
    .option("--skill <directory>", "Validate SKILL.md metadata and declared local references")
    .description("Validate evaluation configuration or a Skill source directory")
    .action(async (file: string | undefined, options: { skill?: string }) => {
      if (options.skill) {
        if (file) throw new Error("provide either an evaluation path or --skill <directory>, not both");
        const result = await validateSkillSource(options.skill);
        if (!result.valid) throw new Error(`Skill validation failed:\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
        ctx.stdout(`✓ SKILL.md is valid (${result.references.length} declared local reference(s))\n`);
        return;
      }
      const evalPath = await resolveEvalPath(ctx, file ? [file] : []);
      let result;
      try {
        result = await (await Loader.create(evalPath)).loadAll();
      } catch (e) {
        throw new Error(`failed to load config: ${errorMessage(e)}`, {
          cause: e,
        });
      }
      try {
        validateAll(result);
        resolveCustomEngineConfig(result.eval);
      } catch (e) {
        throw new Error(`validation failed: ${errorMessage(e)}`, { cause: e });
      }
      ctx.stdout(
        `✓ eval.yaml is valid (loaded ${result.cases.length} case(s))\n`,
      );
    });
}
