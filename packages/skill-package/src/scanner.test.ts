import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_IMPORT_LIMITS } from "@skilled/domain";
import { scanSkillPackages } from "./scanner";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function tempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "skilled-scanner-"),
  );
  temporary.push(directory);
  return directory;
}

describe("scanSkillPackages", () => {
  it("discovers multiple Skills and builds stable manifests", async () => {
    const root = await tempDirectory();
    await fs.cp(
      path.resolve("packages/skill-package/testdata/repository"),
      root,
      { recursive: true },
    );
    const first = await scanSkillPackages(root, DEFAULT_IMPORT_LIMITS);
    const second = await scanSkillPackages(root, DEFAULT_IMPORT_LIMITS);

    expect(first.map((skill) => skill.sourcePath)).toEqual([
      "api-contract-reviewer",
      "legacy-helper",
      "release-notes-writer",
    ]);
    expect(first.map((skill) => skill.manifest.sourceChecksum)).toEqual(
      second.map((skill) => skill.manifest.sourceChecksum),
    );
    expect(
      first.find((skill) => skill.sourcePath === "release-notes-writer")
        ?.validationStatus,
    ).toBe("valid_with_warnings");
    expect(
      first.find((skill) => skill.sourcePath === "legacy-helper")
        ?.validationStatus,
    ).toBe("invalid");
  });

  it("reports required metadata, name constraints, optional types, and references", async () => {
    const root = await tempDirectory();
    const skill = path.join(root, "bad-skill");
    await fs.mkdir(skill);
    await fs.writeFile(
      path.join(skill, "SKILL.md"),
      "---\nname: Bad--Skill\ndescription: ok\nmetadata:\n  count: 3\nallowed-tools:\n  - Bash\n---\n[missing](references/nope.md)",
    );
    const [result] = await scanSkillPackages(root, DEFAULT_IMPORT_LIMITS);
    const codes = result?.findings.map((finding) => finding.code);
    expect(codes).toContain("NAME_INVALID");
    expect(codes).toContain("NAME_DIRECTORY_MISMATCH");
    expect(codes).toContain("METADATA_INVALID");
    expect(codes).toContain("REFERENCE_MISSING");
  });

  it("does not fold a nested Skill into its parent manifest", async () => {
    const root = await tempDirectory();
    const parent = path.join(root, "parent-skill");
    const child = path.join(parent, "references", "child-skill");
    await fs.mkdir(child, { recursive: true });
    await fs.writeFile(
      path.join(parent, "SKILL.md"),
      "---\nname: parent-skill\ndescription: Parent.\n---\nParent",
    );
    await fs.writeFile(
      path.join(child, "SKILL.md"),
      "---\nname: child-skill\ndescription: Child.\n---\nChild",
    );
    const results = await scanSkillPackages(root, DEFAULT_IMPORT_LIMITS);
    const parentResult = results.find(
      (skill) => skill.sourcePath === "parent-skill",
    );
    expect(results).toHaveLength(2);
    expect(
      parentResult?.manifest.files.map((file) => file.relativePath),
    ).toEqual(["SKILL.md"]);
  });

  it("enforces name boundaries, description, compatibility, and tool declarations", async () => {
    const root = await tempDirectory();
    const names = [
      "-leading",
      "trailing-",
      "double--hyphen",
      "Uppercase",
      "a".repeat(65),
    ];
    for (const name of names) {
      const directory = path.join(root, name);
      await fs.mkdir(directory);
      await fs.writeFile(
        path.join(directory, "SKILL.md"),
        `---\nname: ${name}\ndescription: Valid description.\n---\nBody`,
      );
    }
    const constrained = path.join(root, "constrained-skill");
    await fs.mkdir(constrained);
    await fs.writeFile(
      path.join(constrained, "SKILL.md"),
      `---\nname: constrained-skill\ndescription: ${"x".repeat(1025)}\ncompatibility: ${"y".repeat(501)}\nallowed-tools: Bash(git:*)\n---\nBody`,
    );

    const results = await scanSkillPackages(root, DEFAULT_IMPORT_LIMITS);
    for (const name of names) {
      expect(
        results
          .find((skill) => skill.sourcePath === name)
          ?.findings.map((item) => item.code),
      ).toContain("NAME_INVALID");
    }
    const codes = results
      .find((skill) => skill.sourcePath === "constrained-skill")
      ?.findings.map((item) => item.code);
    expect(codes).toContain("DESCRIPTION_TOO_LONG");
    expect(codes).toContain("COMPATIBILITY_TOO_LONG");
    expect(codes).toContain("TOOLS_DECLARED");
  });
});
