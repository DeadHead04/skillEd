// Modified for the skilled TypeScript distribution.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { Command } from "commander";
import * as userconfig from "../userconfig/index.js";
import type { CliContext } from "./context.js";
import { initTemplateContent } from "./init-template.js";
export { initTemplateContent };
export async function resolveInitContent(sourcePath: string): Promise<string> {
  if (!sourcePath) return initTemplateContent;
  await userconfig.loadFile(sourcePath);
  return readFile(sourcePath, "utf8");
}
export const resolveProjectConfigTarget = (): string =>
  path.join(process.cwd(), userconfig.projectConfigFile);
export const resolveUserConfigTarget = (): string =>
  path.join(
    process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"),
    userconfig.userConfigDir,
    userconfig.userConfigFile,
  );
export function registerInitCommand(root: Command, ctx: CliContext): void {
  root
    .command("init")
    .description("Write a skilled user-config file")
    .option(
      "--local",
      "Write target is $PWD/.skilled.yaml instead of the XDG path",
    )
    .option("--print", "Print to stdout instead of writing to disk")
    .option("--force", "Overwrite an existing file")
    .allowExcessArguments(true)
    .action(async (opts, cmd: Command) => {
      const content = await resolveInitContent(
        cmd.optsWithGlobals().config || "",
      );
      if (opts.print) {
        ctx.stdout(content);
        return;
      }
      const target = path.normalize(
        opts.local ? resolveProjectConfigTarget() : resolveUserConfigTarget(),
      );
      let exists = false;
      try {
        await stat(target);
        exists = true;
      } catch {}
      if (exists && !opts.force)
        throw new Error(`${target} already exists (use --force to overwrite)`);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
      await writeFile(target, content, { mode: 0o600 });
      ctx.stdout(`wrote ${target}\n`);
    });
}
