// Modified for the skilled TypeScript distribution.
import { readFile } from "node:fs/promises";
import type { Command, Option } from "commander";
import type { CliContext } from "./context.js";
const hiddenCommands = new Set(["__complete", "__completeNoDesc"]);
export const isCompletionRequest = (args: string[]): boolean =>
  hiddenCommands.has(args[0]);
export function registerCompletionCommand(
  root: Command,
  ctx: CliContext,
): void {
  const completion = root
    .command("completion")
    .description("Generate the autocompletion script for the specified shell");
  completion.action(() => completion.outputHelp());
  for (const shell of ["bash", "fish", "powershell", "zsh"])
    completion
      .command(shell)
      .description(`Generate the autocompletion script for ${shell}`)
      .option("--no-descriptions", "disable completion descriptions")
      .action(async (opts) => {
        const suffix = opts.descriptions === false ? "-no-descriptions" : "";
        ctx.stdout(
          await readFile(
            new URL(
              `../../assets/completion/${shell}${suffix}.txt`,
              import.meta.url,
            ),
            "utf8",
          ),
        );
      });
}
interface CompletionFlag {
  name: string;
  short?: string;
  description: string;
  value: boolean;
  repeat: boolean;
}
function flag(option: Option): CompletionFlag {
  return {
    name: option.long ?? "",
    short: option.short,
    description: option.description,
    value: option.required,
    repeat: Array.isArray(option.defaultValue),
  };
}
export function complete(root: Command, args: string[], ctx: CliContext): void {
  const descriptions = args[0] === "__complete",
    words = args.slice(1),
    prefix = words.pop() ?? "";
  let command = root,
    pendingValue = false,
    endFlags = false;
  const seen = new Set<string>();
  const flagsFor = (cmd: Command): CompletionFlag[] => {
    const globals = root.options.filter((o) => o.long === "--config").map(flag);
    const local = cmd.options.filter((o) => o.long !== "--config").map(flag);
    local.push({
      name: "--help",
      short: "-h",
      description: `help for ${cmd.name()}`,
      value: false,
      repeat: false,
    });
    local.sort((a, b) => a.name.localeCompare(b.name));
    return [...globals, ...local];
  };
  for (const word of words) {
    if (pendingValue) {
      pendingValue = false;
      continue;
    }
    if (word === "--") {
      endFlags = true;
      continue;
    }
    if (!endFlags && word.startsWith("-")) {
      const name = word.split("=")[0],
        opt = flagsFor(command).find(
          (f) => f.name === name || f.short === name,
        );
      if (opt) {
        seen.add(opt.name);
        pendingValue = opt.value && !word.includes("=");
      }
      continue;
    }
    const child = command.commands.find((c) => c.name() === word);
    if (child) command = child;
  }
  const candidates: { name: string; description: string }[] = [];
  let directive = 0;
  if (!pendingValue && !endFlags && !prefix.includes("=")) {
    if (prefix.startsWith("-")) {
      directive = 4;
      for (const opt of flagsFor(command)) {
        if (seen.has(opt.name) && !opt.repeat) continue;
        for (const name of [opt.name, opt.short])
          if (name?.startsWith(prefix))
            candidates.push({ name, description: opt.description });
      }
    } else if (command.commands.length) {
      directive = 4;
      for (const child of command.commands) {
        if (child.name().startsWith(prefix))
          candidates.push({
            name: child.name(),
            description: child.description(),
          });
      }
      if (command === root && "help".startsWith(prefix))
        candidates.push({
          name: "help",
          description: "Help about any command",
        });
      candidates.sort((a, b) => a.name.localeCompare(b.name));
    }
  }
  for (const c of candidates)
    ctx.stdout(c.name + (descriptions ? "\t" + c.description : "") + "\n");
  ctx.stdout(`:${directive}\n`);
  ctx.stderr(
    `Completion ended with directive: ShellCompDirective${directive === 4 ? "NoFileComp" : "Default"}\n`,
  );
}
