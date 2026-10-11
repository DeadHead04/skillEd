// Modified for the skilled TypeScript distribution.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { warnf } from "../logging/index.js";
import { decode, parseYAML } from "../contracts/decode.js";
import type {
  EvalConfig,
  CaseConfig,
  Environment,
} from "../contracts/schema.js";
export interface EvalResult {
  eval: EvalConfig;
  cases: CaseConfig[];
}
const defaultsURL = new URL(
  "../../assets/config/defaults.yaml",
  import.meta.url,
);
const defaultConfiguration = decode<EvalConfig>(
  "EvalConfig",
  parseYAML(await readFile(defaultsURL, "utf8")),
);
export function defaultEvalConfig(): EvalConfig {
  return structuredClone(defaultConfiguration);
}
export function parseEvalConfig(source: string): EvalConfig {
  const raw = parseYAML(source);
  const cfg = decode<EvalConfig>("EvalConfig", raw);
  if (cfg.cases.defaults.timeout_seconds === 0)
    cfg.cases.defaults.timeout_seconds =
      defaultConfiguration.cases.defaults.timeout_seconds;
  if (cfg.cases.defaults.max_turns === 0)
    cfg.cases.defaults.max_turns =
      defaultConfiguration.cases.defaults.max_turns;
  if (cfg.cases.parallelism === 0)
    cfg.cases.parallelism = defaultConfiguration.cases.parallelism;
  const report = (raw as { report?: { formats?: unknown } } | null)?.report;
  if (report?.formats == null)
    cfg.report.formats = [...defaultConfiguration.report.formats];
  return cfg;
}
export function parseCaseConfig(source: string): CaseConfig {
  return decode<CaseConfig>("CaseConfig", parseYAML(source));
}
export async function findSkillDir(
  startDir: string,
): Promise<{ directory: string; fallback: boolean }> {
  let dir = path.normalize(startDir);
  for (let depth = 0; depth <= 10; depth++) {
    try {
      await stat(path.join(dir, "SKILL.md"));
      return { directory: dir, fallback: false };
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { directory: path.dirname(startDir), fallback: true };
}
export function extractFrontmatter(data: string): string | undefined {
  const lines = data.split("\n");
  const fence = (s: string) => s.replace(/[ \t\r]+$/, "") === "---";
  if (!fence(lines[0] ?? "")) return undefined;
  const end = lines.findIndex((s, i) => i > 0 && fence(s));
  return end < 0 ? undefined : lines.slice(1, end).join("\n");
}
export async function parseSkillName(
  skillDir: string,
): Promise<string | undefined> {
  try {
    const fm = extractFrontmatter(
      await readFile(path.join(skillDir, "SKILL.md"), "utf8"),
    );
    if (fm === undefined) return undefined;
    const raw = parseYAML(fm) as { name?: unknown };
    return typeof raw?.name === "string"
      ? raw.name.trim() || undefined
      : undefined;
  } catch {
    return undefined;
  }
}
export class Loader {
  readonly evalPath: string;
  readonly evalDir: string;
  readonly skillDir: string;
  private constructor(evalPath: string, skillDir: string) {
    this.evalPath = evalPath;
    this.evalDir = path.dirname(evalPath);
    this.skillDir = skillDir;
  }
  static async create(evalPath: string): Promise<Loader> {
    const absolute = path.resolve(evalPath);
    const found = await findSkillDir(path.dirname(absolute));
    if (found.fallback)
      warnf(
        "SKILL.md not found within 10 levels above %s; falling back to %s",
        path.dirname(absolute),
        found.directory,
      );
    return new Loader(absolute, found.directory);
  }
  get casesDir(): string {
    return path.join(this.skillDir, "evals", "cases");
  }
  get fixtureDir(): string {
    return path.join(this.evalDir, "fixtures");
  }
  async skillName(): Promise<string | undefined> {
    return parseSkillName(this.skillDir);
  }
  async loadEvalConfig(): Promise<EvalConfig> {
    let source: string;
    try {
      source = await readFile(this.evalPath, "utf8");
    } catch (e) {
      throw new Error(`failed to read eval.yaml: ${e}`, { cause: e });
    }
    try {
      return parseEvalConfig(source);
    } catch (e) {
      throw new Error(`failed to parse eval.yaml: ${e}`, { cause: e });
    }
  }
  async loadCaseConfig(casePath: string): Promise<CaseConfig> {
    let source: string;
    try {
      source = await readFile(path.join(this.skillDir, casePath), "utf8");
    } catch (e) {
      throw new Error(`failed to read case file ${casePath}: ${e}`, {
        cause: e,
      });
    }
    let cfg: CaseConfig;
    try {
      cfg = parseCaseConfig(source);
    } catch (e) {
      throw new Error(`failed to parse case file ${casePath}: ${e}`, {
        cause: e,
      });
    }
    if (!cfg.id) cfg.id = path.basename(casePath, path.extname(casePath));
    cfg.sourceFile = casePath;
    return cfg;
  }
  async loadAllCases(evalConfig: EvalConfig): Promise<CaseConfig[]> {
    const cases: CaseConfig[] = [];
    for (const file of evalConfig.cases.files)
      cases.push(await this.loadCaseConfig(file));
    return cases;
  }
  async loadAll(): Promise<EvalResult> {
    const evalConfig = await this.loadEvalConfig();
    return { eval: evalConfig, cases: await this.loadAllCases(evalConfig) };
  }
}
export function toRuntimeConfig(e: Environment) {
  return {
    type: e.type,
    image: e.image,
    workspaceMount: e.workspace_mount,
    env: { ...e.env },
    setupSteps: structuredClone(e.setup_steps),
    sandboxTemplate: e.sandbox_template,
    useServerProxy: e.use_server_proxy,
    readyTimeoutMs: e.ready_timeout_seconds * 1000,
    sandboxTimeoutMs: e.sandbox_timeout_seconds * 1000,
    entrypoint: [...e.entrypoint],
    metadata: { ...e.metadata },
    kwargs: { ...e.kwargs },
    networkPolicy: e.network_policy,
    allowedEgress: [...e.allowed_egress],
    delete: true,
  };
}
