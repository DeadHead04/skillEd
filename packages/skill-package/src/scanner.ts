import fs from "node:fs/promises";
import path from "node:path";
import { sha256File, sha256Text } from "./checksum";
import { mediaTypeFor } from "./media";
import { parseSkillDocument } from "./frontmatter";
import { validateSkillMetadata, validationStatus } from "./validator";
import type {
  FileCategory,
  ParsedSkillMetadata,
  SkillFileManifest,
  SkillPackageManifest,
  ValidationFinding,
  ValidationStatus,
} from "@skilled/domain";
import type { ImportLimits } from "./limits";
import { ImportSafetyError } from "./errors";

export interface ScannedSkill {
  rootPath: string;
  sourcePath: string;
  metadata: ParsedSkillMetadata;
  body: string;
  validationStatus: ValidationStatus;
  findings: ValidationFinding[];
  manifest: SkillPackageManifest;
}

function categoryFor(relativePath: string): FileCategory {
  if (relativePath === "SKILL.md") return "instructions";
  const first = relativePath.split("/")[0];
  if (first === "references") return "reference";
  if (first === "scripts") return "script";
  if (first === "assets") return "asset";
  if (first === "evals") return "eval";
  return "other";
}

async function walkFiles(
  root: string,
  limits: ImportLimits,
  nestedRoots: Set<string>,
): Promise<string[]> {
  const files: string[] = [];
  let totalBytes = 0;

  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new ImportSafetyError(
          "UNSAFE_ARCHIVE",
          "Package contains a symbolic link.",
        );
      }
      if (entry.isDirectory()) {
        if (fullPath !== root && nestedRoots.has(fullPath)) continue;
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        throw new ImportSafetyError(
          "UNSAFE_ARCHIVE",
          "Package contains a special file.",
        );
      }
      const stat = await fs.stat(fullPath);
      totalBytes += stat.size;
      files.push(fullPath);
      if (
        files.length > limits.maxFiles ||
        stat.size > limits.maxFileBytes ||
        totalBytes > limits.maxUncompressedBytes
      ) {
        throw new ImportSafetyError(
          "IMPORT_LIMIT_EXCEEDED",
          "Package exceeds scanner limits.",
        );
      }
    }
  }

  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

async function findSkillRoots(scanRoot: string): Promise<string[]> {
  const roots: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md"))
      roots.push(directory);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new ImportSafetyError(
          "UNSAFE_ARCHIVE",
          "Package contains a symbolic link.",
        );
      }
      if (entry.isDirectory()) await visit(path.join(directory, entry.name));
      else if (!entry.isFile()) {
        throw new ImportSafetyError(
          "UNSAFE_ARCHIVE",
          "Package contains a special file.",
        );
      }
    }
  }
  await visit(scanRoot);
  return roots.sort((left, right) => left.localeCompare(right));
}

export async function scanSkillPackages(
  scanRoot: string,
  limits: ImportLimits,
): Promise<ScannedSkill[]> {
  const roots = await findSkillRoots(scanRoot);
  const nestedRoots = new Set(roots);
  const results: ScannedSkill[] = [];

  for (const root of roots) {
    const skillMdPath = path.join(root, "SKILL.md");
    const skillMd = await fs.readFile(skillMdPath, "utf8");
    const parsed = parseSkillDocument(skillMd);
    const findings = await validateSkillMetadata(
      root,
      parsed.metadata,
      parsed.body,
      parsed.findings,
    );
    const filePaths = await walkFiles(root, limits, nestedRoots);
    const files: SkillFileManifest[] = [];
    for (const filePath of filePaths) {
      const stat = await fs.stat(filePath);
      const relativePath = path
        .relative(root, filePath)
        .split(path.sep)
        .join("/");
      files.push({
        relativePath,
        checksum: await sha256File(filePath),
        byteSize: stat.size,
        category: categoryFor(relativePath),
        mediaType: mediaTypeFor(relativePath),
      });
    }
    if (files.some((file) => file.category === "script")) {
      findings.push({
        severity: "information",
        code: "EXECUTABLE_HELPER_DETECTED",
        message:
          "Executable helper detected; Phase 1 never executes package scripts.",
        relativePath: "scripts/",
      });
    }

    const canonical = files
      .map((file) => `${file.relativePath}\0${file.checksum}\0${file.byteSize}`)
      .join("\n");
    const sourcePath =
      path.relative(scanRoot, root).split(path.sep).join("/") || ".";
    const manifest: SkillPackageManifest = {
      sourceChecksum: sha256Text(canonical),
      skillRoot: sourcePath,
      skillMdChecksum: await sha256File(skillMdPath),
      files,
      validationFindings: findings,
    };
    results.push({
      rootPath: root,
      sourcePath,
      metadata: parsed.metadata,
      body: parsed.body,
      validationStatus: validationStatus(findings),
      findings,
      manifest,
    });
  }

  return results;
}
