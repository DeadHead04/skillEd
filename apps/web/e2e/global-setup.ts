import fs from "node:fs/promises";
import path from "node:path";
import {
  closeDb,
  ensureIdentityWorkspace,
  getDb,
  persistSkillVersion,
  sql,
} from "@skilled/db";
import { FileSystemArtifactStore } from "@skilled/artifact-store";
import { DEFAULT_IMPORT_LIMITS } from "@skilled/domain";
import { scanSkillPackages } from "@skilled/skill-package";

export default async function globalSetup() {
  process.env.DATABASE_URL ??=
    "postgres://skilled:skilled@127.0.0.1:54329/skilled";
  process.env.ARTIFACT_ROOT = "./artifacts/e2e";
  const stateDirectory = path.resolve("./.auth");
  await fs.mkdir(stateDirectory, { recursive: true });
  await fs.rm(path.resolve("./artifacts/e2e"), {
    recursive: true,
    force: true,
  });
  await getDb().execute(sql`
    TRUNCATE audit_events, validation_findings, import_candidates, import_jobs,
      skill_versions, skills, github_connections, workspace_members, workspaces, users
    RESTART IDENTITY CASCADE
  `);

  const populated = await ensureIdentityWorkspace({
    githubUserId: "dev-user",
    name: "Alex Smith",
    email: "dev@skilled.local",
  });
  const empty = await ensureIdentityWorkspace({
    githubUserId: "empty-user",
    name: "Empty User",
    email: "empty@skilled.local",
  });
  const fixtures = await scanSkillPackages(
    path.resolve("./packages/skill-package/testdata/repository"),
    DEFAULT_IMPORT_LIMITS,
  );
  const artifacts = new FileSystemArtifactStore();
  for (const candidate of fixtures) {
    const artifactKey = await artifacts.storeDirectory(
      candidate.rootPath,
      candidate.manifest.sourceChecksum,
    );
    await persistSkillVersion({
      workspaceId: populated.workspace.id,
      sourceType: "upload",
      sourceIdentity: "phase-one-reference-package",
      sourceLocator: "phase-one-reference-package",
      sourcePath: candidate.sourcePath,
      versionKey: candidate.manifest.sourceChecksum,
      name: candidate.metadata.name ?? candidate.sourcePath,
      description: candidate.metadata.description ?? "Invalid fixture",
      metadata: candidate.metadata,
      manifest: candidate.manifest,
      validationStatus: candidate.validationStatus,
      artifactKey,
      actorId: populated.user.id,
    });
  }

  const base = fixtures.find(
    (candidate) => candidate.sourcePath === "release-notes-writer",
  )!;
  const baseArtifact = await artifacts.storeDirectory(
    base.rootPath,
    base.manifest.sourceChecksum,
  );
  for (let index = 1; index <= 10; index += 1) {
    const suffix = String(index).padStart(2, "0");
    await persistSkillVersion({
      workspaceId: populated.workspace.id,
      sourceType: index % 2 === 0 ? "github" : "upload",
      sourceIdentity: `demo-source-${suffix}`,
      sourceLocator:
        index % 2 === 0
          ? `https://github.com/acme/demo-source-${suffix}`
          : `demo-source-${suffix}`,
      sourcePath: `demo-skill-${suffix}`,
      ...(index % 2 === 0 ? { sourceCommit: `${suffix}`.repeat(20) } : {}),
      versionKey: `${suffix}`.repeat(32),
      name: `demo-skill-${suffix}`,
      description: `Phase 1 catalog fixture ${suffix} for search, sorting, and pagination.`,
      metadata: {
        name: `demo-skill-${suffix}`,
        description: `Phase 1 catalog fixture ${suffix} for search, sorting, and pagination.`,
      },
      manifest: base.manifest,
      validationStatus: "valid",
      artifactKey: baseArtifact,
      actorId: populated.user.id,
    });
  }

  await fs.writeFile(
    path.join(stateDirectory, "e2e-state.json"),
    JSON.stringify({
      workspaceId: populated.workspace.id,
      emptyWorkspaceId: empty.workspace.id,
    }),
  );
  await closeDb();
}
