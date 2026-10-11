// Modified for the skilled TypeScript distribution.
import type { Command } from "commander";
import {
  Loader,
  validateAll,
  resolveCustomEngineConfig,
} from "../config/index.js";
import { type CliContext, errorMessage } from "./context.js";
import { resolveEvalPath } from "./run.js";
export function registerValidateCommand(root: Command, ctx: CliContext): void {
  root
    .command("validate")
    .argument("[path]", "Path to evals/eval.yaml")
    .description("Validate evaluation configuration and case files")
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
