import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import type { Command } from "commander";
import type { CliContext } from "./context.js";
import { VERSION } from "../brand.js";

const source = fileURLToPath(new URL("../../bundled-plugins/codex-skilled/skills/skilled-improve/", import.meta.url));
const marker = ".skilled-install.json";
type Host = "codex" | "claude-code";
interface Manifest { product: "skilled"; version: string; files: Record<string, string> }

async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function files(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(relative: string) {
    for (const item of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      const key = path.posix.join(relative, item.name);
      if (key === marker) continue;
      if (item.isSymbolicLink()) throw new Error(`Refusing symlink in workflow: ${key}`);
      if (item.isDirectory()) await visit(key);
      else if (item.isFile()) result[key] = createHash("sha256").update(await readFile(path.join(directory, key))).digest("hex");
      else throw new Error(`Unsupported workflow entry: ${key}`);
    }
  }
  await visit("");
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

/** Install only the bundled workflow, without modifying global or host settings. */
export async function setupWorkflow(project: string, host: Host, remove = false): Promise<string> {
  if (host !== "codex" && host !== "claude-code") throw new Error("Host must be codex or claude-code");
  const root = await realpath(project);
  let parent = root;
  for (const name of [host === "codex" ? ".agents" : ".claude", "skills"]) {
    parent = path.join(parent, name);
    if (await exists(parent)) {
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Expected a real directory: ${parent}`);
    } else if (remove) return "Workflow is not installed";
    else await mkdir(parent);
  }
  const destination = path.join(parent, "skilled-improve");
  const installed = await exists(destination);
  if (installed) {
    if ((await lstat(destination)).isSymbolicLink()) throw new Error(`Refusing to replace symlink: ${destination}`);
    let manifest: Manifest;
    try { manifest = JSON.parse(await readFile(path.join(destination, marker), "utf8")) as Manifest; }
    catch { throw new Error(`Existing workflow is not managed by skilled setup: ${destination}`); }
    if (manifest.product !== "skilled" || JSON.stringify(await files(destination)) !== JSON.stringify(manifest.files))
      throw new Error(`Workflow has local changes; preserve or move it before setup: ${destination}`);
  }
  if (remove) {
    if (installed) await rm(destination, { recursive: true });
    return installed ? `Removed ${destination}` : "Workflow is not installed";
  }
  const staging = await mkdtemp(path.join(parent, ".skilled-setup-"));
  const prepared = path.join(staging, "workflow"), backup = path.join(staging, "previous");
  let preserveBackup = false;
  try {
    await mkdir(prepared);
    for (const name of ["SKILL.md", "references", "assets"])
      await cp(path.join(source, name), path.join(prepared, name), { recursive: true });
    const manifest: Manifest = { product: "skilled", version: VERSION, files: await files(prepared) };
    await writeFile(path.join(prepared, marker), JSON.stringify(manifest, null, 2) + "\n");
    if (installed) await rename(destination, backup);
    try { await rename(prepared, destination); }
    catch (error) {
      if (installed) {
        try { await rename(backup, destination); }
        catch (restoreError) {
          preserveBackup = true;
          throw new AggregateError([error, restoreError], `Setup rollback failed; previous workflow preserved at ${backup}`);
        }
      }
      throw error;
    }
    return `Installed skilled-improve for ${host} at ${destination}\nStart a new ${host} session in ${root} and ask: Use skilled-improve to evaluate this Skill.\nLive evaluations use your engine's existing login. MCP is optional.`;
  } finally { if (!preserveBackup) await rm(staging, { recursive: true, force: true }); }
}

export function registerSetupCommand(root: Command, ctx: CliContext): void {
  root.command("setup").description("Activate skilled-improve in this project for an agent host")
    .requiredOption("--host <host>", "codex or claude-code")
    .option("--project <path>", "Existing project directory", ".")
    .option("--remove", "Remove an unmodified workflow installed by skilled setup", false)
    .action(async (options: { host: Host; project: string; remove: boolean }) => {
      ctx.stdout(await setupWorkflow(options.project, options.host, options.remove) + "\n");
    });
}
