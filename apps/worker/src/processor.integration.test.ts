import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import yazl from "yazl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimImportJob,
  closeDb,
  createImportJob,
  ensureIdentityWorkspace,
  expireStaleImports,
  getDb,
  getImportJob,
  getImportJobView,
  getSkillDetail,
  isWorkspaceMember,
  listSkills,
  selectImportCandidates,
  sql,
  updateImportJob,
  upsertGithubConnection,
} from "@skilled/db";
import { processImportJob, removeExpiredStaging } from "./processor";

const stagingRoot = path.resolve("./tmp/integration-imports");
const artifactRoot = path.resolve("./artifacts/integration");
const fixtureRoot = path.resolve(
  "./packages/skill-package/testdata/repository",
);

async function resetDatabase() {
  await getDb().execute(sql`
    TRUNCATE audit_events, validation_findings, import_candidates, import_jobs,
      skill_versions, skills, github_connections, workspace_members, workspaces, users
    RESTART IDENTITY CASCADE
  `);
}

async function stageFolderImport(input: {
  workspaceId: string;
  userId: string;
  uploadName?: string;
  mutate?: (root: string) => Promise<void>;
}) {
  const id = randomUUID();
  const folder = path.join(stagingRoot, id, "folder");
  await fs.mkdir(folder, { recursive: true });
  await fs.cp(fixtureRoot, folder, { recursive: true });
  await input.mutate?.(folder);
  return createImportJob({
    id,
    workspaceId: input.workspaceId,
    sourceType: "upload",
    source: {
      type: "upload",
      uploadName: input.uploadName ?? "phase-one-fixtures",
      mode: "folder",
      stagedPath: path.relative(stagingRoot, folder),
    },
    createdBy: input.userId,
  });
}

async function makeSkillZip(jobId: string) {
  const jobRoot = path.join(stagingRoot, jobId);
  await fs.mkdir(jobRoot, { recursive: true });
  const archivePath = path.join(jobRoot, "source.zip");
  const archive = new yazl.ZipFile();
  archive.addBuffer(
    Buffer.from(
      "---\nname: zip-skill\ndescription: Imported from a bounded ZIP.\n---\n\n# ZIP Skill\n",
    ),
    "zip-package/zip-skill/SKILL.md",
  );
  archive.end();
  const output = createWriteStream(archivePath);
  archive.outputStream.pipe(output);
  await finished(output);
  return path.relative(stagingRoot, archivePath);
}

beforeAll(async () => {
  process.env.IMPORT_STAGING_ROOT = stagingRoot;
  process.env.ARTIFACT_ROOT = artifactRoot;
  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.rm(artifactRoot, { recursive: true, force: true });
  await resetDatabase();
});

afterAll(async () => {
  await fs.rm(stagingRoot, { recursive: true, force: true });
  await fs.rm(artifactRoot, { recursive: true, force: true });
  await closeDb();
});

describe("Phase 1 persistence and authorization", () => {
  it("creates a personal workspace and enforces workspace membership", async () => {
    const first = await ensureIdentityWorkspace({
      githubUserId: "integration-one",
      name: "One",
    });
    const repeated = await ensureIdentityWorkspace({
      githubUserId: "integration-one",
      name: "One",
    });
    const second = await ensureIdentityWorkspace({
      githubUserId: "integration-two",
      name: "Two",
    });

    expect(repeated.workspace.id).toBe(first.workspace.id);
    await expect(
      isWorkspaceMember(first.user.id, first.workspace.id),
    ).resolves.toBe(true);
    await expect(
      isWorkspaceMember(second.user.id, first.workspace.id),
    ).resolves.toBe(false);

    const connection = await upsertGithubConnection({
      workspaceId: first.workspace.id,
      installationId: "1001",
      accountId: "2002",
      accountLogin: "example-org",
    });
    expect(connection?.accountLogin).toBe("example-org");
  });

  it("processes folder imports, subset selection, invalid safe Skills, and immutable deduplication", async () => {
    const primary = await ensureIdentityWorkspace({
      githubUserId: "integration-one",
      name: "One",
    });
    const outsider = await ensureIdentityWorkspace({
      githubUserId: "integration-two",
      name: "Two",
    });
    const job = await stageFolderImport({
      workspaceId: primary.workspace.id,
      userId: primary.user.id,
    });

    const claimed = await claimImportJob();
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.state).toBe("acquiring");
    await processImportJob(claimed!);

    const scanned = await getImportJobView(primary.workspace.id, job.id);
    expect(scanned?.state).toBe("awaiting_selection");
    expect(scanned?.candidates).toHaveLength(3);
    expect(
      scanned?.candidates.map((item) => item.validationStatus).sort(),
    ).toEqual(["invalid", "valid_with_warnings", "valid_with_warnings"]);

    const selected = scanned!.candidates.filter((candidate) =>
      ["release-notes-writer", "legacy_helper"].includes(candidate.name),
    );
    await expect(
      selectImportCandidates(
        primary.workspace.id,
        job.id,
        selected.map((item) => item.id),
      ),
    ).resolves.toBe("accepted");
    await expect(
      selectImportCandidates(
        outsider.workspace.id,
        job.id,
        selected.map((item) => item.id),
      ),
    ).resolves.toBe("invalid");

    const persisting = await getImportJob(primary.workspace.id, job.id);
    await processImportJob(persisting!);
    await expect(
      getImportJob(primary.workspace.id, job.id),
    ).resolves.toMatchObject({
      state: "completed",
    });
    await expect(fs.stat(path.join(stagingRoot, job.id))).rejects.toThrow();

    const catalog = await listSkills(primary.workspace.id, {
      sort: "name_asc",
      page: 1,
      pageSize: 12,
    });
    expect(catalog.total).toBe(2);
    expect(catalog.items.map((item) => item.skill.name)).toEqual([
      "legacy_helper",
      "release-notes-writer",
    ]);
    expect(catalog.items[0]?.version.validationStatus).toBe("invalid");
    expect(
      (
        await listSkills(primary.workspace.id, {
          q: "release",
          sort: "recent",
          page: 1,
          pageSize: 12,
        })
      ).total,
    ).toBe(1);
    expect(
      (
        await listSkills(primary.workspace.id, {
          validation: "invalid",
          sort: "recent",
          page: 1,
          pageSize: 12,
        })
      ).total,
    ).toBe(1);
    expect(
      (
        await listSkills(primary.workspace.id, {
          source: "github",
          sort: "recent",
          page: 1,
          pageSize: 12,
        })
      ).total,
    ).toBe(0);

    const release = catalog.items.find(
      (item) => item.skill.name === "release-notes-writer",
    )!;
    await expect(
      getSkillDetail(outsider.workspace.id, release.skill.id),
    ).resolves.toBeUndefined();
    await expect(
      fs.stat(path.join(artifactRoot, release.version.artifactKey, "SKILL.md")),
    ).resolves.toBeTruthy();

    const duplicateJob = await stageFolderImport({
      workspaceId: primary.workspace.id,
      userId: primary.user.id,
    });
    await processImportJob((await claimImportJob())!);
    const duplicateScan = await getImportJobView(
      primary.workspace.id,
      duplicateJob.id,
    );
    expect(
      duplicateScan?.candidates
        .filter((candidate) =>
          ["release-notes-writer", "legacy_helper"].includes(candidate.name),
        )
        .every((candidate) => candidate.duplicateVersionId),
    ).toBe(true);
    const duplicateCandidate = duplicateScan!.candidates.find(
      (candidate) => candidate.name === "release-notes-writer",
    )!;
    await selectImportCandidates(primary.workspace.id, duplicateJob.id, [
      duplicateCandidate.id,
    ]);
    await processImportJob(
      (await getImportJob(primary.workspace.id, duplicateJob.id))!,
    );

    const changedJob = await stageFolderImport({
      workspaceId: primary.workspace.id,
      userId: primary.user.id,
      mutate: async (root) => {
        await fs.appendFile(
          path.join(root, "release-notes-writer/SKILL.md"),
          "\nA changed upload.\n",
        );
      },
    });
    await processImportJob((await claimImportJob())!);
    const changedScan = await getImportJobView(
      primary.workspace.id,
      changedJob.id,
    );
    const changedCandidate = changedScan!.candidates.find(
      (candidate) => candidate.name === "release-notes-writer",
    )!;
    expect(changedCandidate.duplicateVersionId).toBeUndefined();
    await selectImportCandidates(primary.workspace.id, changedJob.id, [
      changedCandidate.id,
    ]);
    await processImportJob(
      (await getImportJob(primary.workspace.id, changedJob.id))!,
    );

    const versionCount = await getDb().execute(sql`
      SELECT count(*)::int AS count FROM skill_versions WHERE skill_id = ${release.skill.id}
    `);
    expect(versionCount[0]?.count).toBe(2);
    const auditCount = await getDb().execute(sql`
      SELECT count(*)::int AS count FROM audit_events WHERE workspace_id = ${primary.workspace.id}
    `);
    expect(auditCount[0]?.count).toBe(3);
  });

  it("imports a ZIP and cleans staging, then rejects an unsafe folder without leakage", async () => {
    const primary = await ensureIdentityWorkspace({
      githubUserId: "integration-one",
      name: "One",
    });
    const zipId = randomUUID();
    const stagedPath = await makeSkillZip(zipId);
    const zipJob = await createImportJob({
      id: zipId,
      workspaceId: primary.workspace.id,
      sourceType: "upload",
      source: {
        type: "upload",
        uploadName: "zip-package",
        mode: "zip",
        stagedPath,
      },
      createdBy: primary.user.id,
    });
    await processImportJob((await claimImportJob())!);
    const scan = await getImportJobView(primary.workspace.id, zipJob.id);
    expect(scan?.candidates).toHaveLength(1);
    await selectImportCandidates(primary.workspace.id, zipJob.id, [
      scan!.candidates[0]!.id,
    ]);
    await processImportJob(
      (await getImportJob(primary.workspace.id, zipJob.id))!,
    );
    await expect(fs.stat(path.join(stagingRoot, zipJob.id))).rejects.toThrow();

    const unsafeId = randomUUID();
    const unsafeRoot = path.join(
      stagingRoot,
      unsafeId,
      "folder",
      "unsafe-skill",
    );
    await fs.mkdir(unsafeRoot, { recursive: true });
    await fs.writeFile(
      path.join(unsafeRoot, "SKILL.md"),
      "---\nname: unsafe-skill\ndescription: A safe description with an unsafe package entry.\n---\n",
    );
    await fs.symlink("../outside", path.join(unsafeRoot, "escape"));
    const unsafeJob = await createImportJob({
      id: unsafeId,
      workspaceId: primary.workspace.id,
      sourceType: "upload",
      source: {
        type: "upload",
        uploadName: "unsafe",
        mode: "folder",
        stagedPath: path.relative(
          stagingRoot,
          path.join(stagingRoot, unsafeId, "folder"),
        ),
      },
      createdBy: primary.user.id,
    });
    await processImportJob((await claimImportJob())!);
    await expect(
      getImportJob(primary.workspace.id, unsafeJob.id),
    ).resolves.toMatchObject({
      state: "failed",
      errorCode: "UNSAFE_ARCHIVE",
    });
    await expect(
      fs.stat(path.join(stagingRoot, unsafeJob.id)),
    ).rejects.toThrow();
    expect(
      (
        await listSkills(primary.workspace.id, {
          q: "unsafe",
          sort: "recent",
          page: 1,
          pageSize: 12,
        })
      ).total,
    ).toBe(0);

    const expiringJob = await stageFolderImport({
      workspaceId: primary.workspace.id,
      userId: primary.user.id,
      uploadName: "expiring",
    });
    await processImportJob((await claimImportJob())!);
    const expiringScan = await getImportJobView(
      primary.workspace.id,
      expiringJob.id,
    );
    await updateImportJob(expiringJob.id, { expiresAt: new Date(0) });
    await expect(
      selectImportCandidates(primary.workspace.id, expiringJob.id, [
        expiringScan!.candidates[0]!.id,
      ]),
    ).resolves.toBe("expired");
    const expiredIds = await expireStaleImports();
    expect(expiredIds).toContain(expiringJob.id);
    await removeExpiredStaging(expiredIds);
    await expect(
      getImportJob(primary.workspace.id, expiringJob.id),
    ).resolves.toMatchObject({
      state: "expired",
    });
    await expect(
      fs.stat(path.join(stagingRoot, expiringJob.id)),
    ).rejects.toThrow();
  });
});
