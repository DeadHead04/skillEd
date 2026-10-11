// Modified for the skilled TypeScript distribution.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { dirPerm, filePerm, writeJSONFile } from "./helpers.js";
import {
  writeGradingJSON,
  writeEvalMetadata,
  type AnthropicGrading,
  type EvalMetadata,
} from "./grading.js";
import {
  writeAnthropicBenchmark,
  type AnthropicBenchmark,
} from "./benchmark-anthropic.js";
import { writeBenchmarkMarkdownFile } from "./benchmark-md.js";
import type { GroupedEvaluation } from "./grouped-evaluation.js";
export const isRootedPath = (p: string) =>
  p.startsWith("/") || p.startsWith("\\");
export function validateCaseID(caseID: string): void {
  const clean = path.normalize(caseID || ".");
  if (path.isAbsolute(clean) || clean.includes("..") || /[\\/]/.test(clean))
    throw new Error("invalid case ID: " + JSON.stringify(caseID));
}
async function makeDir(dir: string, label: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true, mode: dirPerm });
  } catch (e) {
    throw new Error(label + ": " + (e as Error).message, { cause: e });
  }
}
export class IterationWorkspace {
  constructor(
    public rootDir: string,
    public iterationNum: number,
    public skillName: string,
  ) {}
  iterationDir(): string {
    return path.join(this.rootDir, `iteration-${this.iterationNum}`);
  }
  caseDir(caseID: string): string {
    return path.join(this.iterationDir(), path.normalize(caseID || "."));
  }
  withSkillDir(caseID: string): string {
    return path.join(this.caseDir(caseID), "with_skill");
  }
  withoutSkillDir(caseID: string): string {
    return path.join(this.caseDir(caseID), "without_skill");
  }
  configDir(caseID: string, config: string): string {
    return path.join(this.caseDir(caseID), config);
  }
  async ensureDirs(caseIDs: string[]): Promise<void> {
    await this.ensureIterationDir();
    for (const id of caseIDs) {
      validateCaseID(id);
      await this.ensureWithSkillOutputs(id);
    }
  }
  async ensureDirsWithBaseline(caseIDs: string[]): Promise<void> {
    await this.ensureDirs(caseIDs);
    for (const id of caseIDs) await this.ensureWithoutSkillOutputs(id);
  }
  async ensureIterationDir(): Promise<void> {
    await makeDir(this.iterationDir(), "create iteration dir");
  }
  async ensureWithSkillOutputs(id: string): Promise<void> {
    await makeDir(
      path.join(this.withSkillDir(id), "outputs"),
      "create with_skill outputs dir for " + id,
    );
  }
  async ensureWithoutSkillOutputs(id: string): Promise<void> {
    await makeDir(
      path.join(this.withoutSkillDir(id), "outputs"),
      "create without_skill outputs dir for " + id,
    );
  }
  async writeResponse(
    id: string,
    config: string,
    content: string,
  ): Promise<void> {
    validateCaseID(id);
    const dir = path.join(this.configDir(id, config), "outputs");
    await makeDir(dir, "create outputs dir");
    const p = path.join(dir, "response.md");
    try {
      await writeFile(p, content + "\n", { mode: filePerm });
    } catch (e) {
      throw new Error(`write response ${p}: ${(e as Error).message}`, {
        cause: e,
      });
    }
  }
  async writeGrading(
    id: string,
    config: string,
    grading: AnthropicGrading | null,
  ): Promise<void> {
    validateCaseID(id);
    await writeGradingJSON(
      path.join(this.configDir(id, config), "grading.json"),
      grading,
    );
  }
  async writeEvaluation(
    id: string,
    config: string,
    evaluation: GroupedEvaluation | null,
  ): Promise<void> {
    validateCaseID(id);
    await writeJSONFile(
      path.join(this.configDir(id, config), "evaluation.json"),
      evaluation,
      "grouped evaluation",
    );
  }
  async writeEvalMeta(id: string, meta: EvalMetadata | null): Promise<void> {
    validateCaseID(id);
    await writeEvalMetadata(
      path.join(this.caseDir(id), "eval_metadata.json"),
      meta,
    );
  }
  async writeBenchmark(bm: AnthropicBenchmark | null): Promise<void> {
    await writeAnthropicBenchmark(
      path.join(this.iterationDir(), "benchmark.json"),
      bm,
    );
  }
  async writeBenchmarkMD(bm: AnthropicBenchmark): Promise<void> {
    await writeBenchmarkMarkdownFile(
      path.join(this.iterationDir(), "benchmark.md"),
      bm,
    );
  }
  async writeFile(relPath: string, data: Uint8Array): Promise<void> {
    const clean = path.normalize(relPath || ".");
    if (path.isAbsolute(clean) || isRootedPath(clean) || clean.startsWith(".."))
      throw new Error("invalid relative path: " + relPath);
    const p = path.join(this.iterationDir(), clean);
    await makeDir(path.dirname(p), "create dir for " + relPath);
    try {
      await writeFile(p, data, { mode: filePerm });
    } catch (e) {
      throw new Error(`write file ${p}: ${(e as Error).message}`, { cause: e });
    }
  }
}
export async function newIterationWorkspace(
  outputDir: string,
  skillName: string,
  iterNum: number,
): Promise<IterationWorkspace> {
  outputDir ||= skillName + "-workspace";
  if (iterNum < 1)
    throw new Error("iteration number must be >= 1, got " + iterNum);
  await makeDir(outputDir, "create workspace root " + outputDir);
  return new IterationWorkspace(outputDir, iterNum, skillName);
}
