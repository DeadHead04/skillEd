import fs from "node:fs/promises";
import path from "node:path";
import { FileSystemArtifactStore } from "@skilled/artifact-store";
import {
  createAuditEvent,
  findDuplicateVersion,
  getGithubConnection,
  getSelectedCandidates,
  persistSkillVersion,
  replaceImportCandidates,
  updateImportJob,
  type ImportSource,
  type importJobs,
} from "@skilled/db";
import {
  downloadRepositoryZip,
  GithubApiError,
  resolveRepository,
} from "@skilled/github";
import {
  extractZipSafely,
  importLimitsFromEnv,
  ImportSafetyError,
  resolveInside,
  resolveWorkspacePath,
  scanSkillPackages,
} from "@skilled/skill-package";

type ImportJob = typeof importJobs.$inferSelect;

function stagingRoot(): string {
  return resolveWorkspacePath(process.env.IMPORT_STAGING_ROOT, "./tmp/imports");
}

function jobDirectory(jobId: string): string {
  return resolveInside(stagingRoot(), jobId);
}

async function contentRoot(extractedRoot: string): Promise<string> {
  const entries = await fs.readdir(extractedRoot, { withFileTypes: true });
  if (entries.length === 1 && entries[0]?.isDirectory()) {
    return path.join(extractedRoot, entries[0].name);
  }
  return extractedRoot;
}

async function acquireAndScan(job: ImportJob): Promise<void> {
  const limits = importLimitsFromEnv();
  const root = stagingRoot();
  const jobRoot = jobDirectory(job.id);
  await fs.mkdir(jobRoot, { recursive: true });
  let source: ImportSource = job.source;
  let scanRoot: string;

  if (source.type === "github") {
    const connection = await getGithubConnection(job.workspaceId);
    if (!connection) throw new Error("GITHUB_NOT_CONNECTED");
    const resolved = await resolveRepository({
      installationId: connection.installationId,
      owner: source.owner,
      repository: source.repository,
      ...(source.ref ? { ref: source.ref } : {}),
    });
    const archive = path.join(jobRoot, "source.zip");
    const extracted = path.join(jobRoot, "extracted");
    await downloadRepositoryZip({
      token: resolved.token,
      owner: source.owner,
      repository: source.repository,
      commit: resolved.commit,
      destination: archive,
      maxBytes: limits.maxArchiveBytes,
    });
    await updateImportJob(job.id, { state: "scanning" });
    await extractZipSafely(archive, extracted, limits);
    scanRoot = await contentRoot(extracted);
    source = {
      ...source,
      repositoryId: resolved.repositoryId,
      resolvedCommit: resolved.commit,
      archivePath: path.relative(root, archive),
      extractedPath: path.relative(root, scanRoot),
    };
  } else if (source.mode === "zip") {
    const archive = resolveInside(root, source.stagedPath);
    const extracted = path.join(jobRoot, "extracted");
    await updateImportJob(job.id, { state: "scanning" });
    await extractZipSafely(archive, extracted, limits);
    scanRoot = await contentRoot(extracted);
    source = { ...source, extractedPath: path.relative(root, scanRoot) };
  } else {
    scanRoot = resolveInside(root, source.stagedPath);
    await updateImportJob(job.id, { state: "scanning" });
    source = { ...source, extractedPath: source.stagedPath };
  }

  await updateImportJob(job.id, { source });
  const scanned = await scanSkillPackages(scanRoot, limits);
  if (scanned.length === 0) throw new Error("NO_SKILLS_FOUND");

  const sourceIdentity =
    source.type === "github"
      ? (source.repositoryId ?? `${source.owner}/${source.repository}`)
      : source.uploadName.toLocaleLowerCase("en-US");
  const versionKeyFor = (checksum: string) =>
    source.type === "github" ? (source.resolvedCommit ?? checksum) : checksum;

  const candidates = await Promise.all(
    scanned.map(async (candidate) => {
      const versionKey = versionKeyFor(candidate.manifest.sourceChecksum);
      const duplicateVersionId = await findDuplicateVersion({
        workspaceId: job.workspaceId,
        sourceType: source.type,
        sourceIdentity,
        sourcePath: candidate.sourcePath,
        versionKey,
      });
      return {
        sourcePath: candidate.sourcePath,
        stagingPath: path.relative(root, candidate.rootPath),
        name: candidate.metadata.name ?? path.basename(candidate.rootPath),
        description: candidate.metadata.description ?? "Invalid Skill package",
        validationStatus: candidate.validationStatus,
        metadata: candidate.metadata,
        manifest: candidate.manifest,
        findings: candidate.findings,
        ...(duplicateVersionId ? { duplicateVersionId } : {}),
      };
    }),
  );
  await replaceImportCandidates(job.id, candidates);
}

async function persistSelection(job: ImportJob): Promise<void> {
  const source = job.source;
  const selected = await getSelectedCandidates(job.id);
  if (selected.length === 0) throw new Error("INVALID_SELECTION");
  const artifacts = new FileSystemArtifactStore();
  const root = stagingRoot();
  const sourceIdentity =
    source.type === "github"
      ? (source.repositoryId ?? `${source.owner}/${source.repository}`)
      : source.uploadName.toLocaleLowerCase("en-US");

  let created = 0;
  let duplicates = 0;
  for (const candidate of selected) {
    const artifactKey = await artifacts.storeDirectory(
      resolveInside(root, candidate.stagingPath),
      candidate.manifest.sourceChecksum,
    );
    const versionKey =
      source.type === "github"
        ? (source.resolvedCommit ?? candidate.manifest.sourceChecksum)
        : candidate.manifest.sourceChecksum;
    const persisted = await persistSkillVersion({
      workspaceId: job.workspaceId,
      sourceType: source.type,
      sourceIdentity,
      sourceLocator:
        source.type === "github" ? source.repositoryUrl : source.uploadName,
      sourcePath: candidate.sourcePath,
      ...(source.type === "github" && source.resolvedCommit
        ? { sourceCommit: source.resolvedCommit }
        : {}),
      versionKey,
      name: candidate.name,
      description: candidate.description,
      metadata: candidate.metadata,
      manifest: candidate.manifest,
      validationStatus: candidate.validationStatus,
      artifactKey,
      actorId: job.createdBy,
    });
    if (persisted.duplicate) duplicates += 1;
    else created += 1;
  }
  await updateImportJob(job.id, {
    state: "completed",
    expiresAt: null,
    errorCode: null,
    errorMessage: null,
  });
  await createAuditEvent({
    workspaceId: job.workspaceId,
    actorId: job.createdBy,
    action: "import.completed",
    targetId: job.id,
    summary: {
      sourceType: source.type,
      selected: selected.length,
      created,
      duplicates,
    },
  });
  await fs.rm(jobDirectory(job.id), { recursive: true, force: true });
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ImportSafetyError)
    return { code: error.code, message: error.message };
  if (error instanceof GithubApiError) {
    if (error.safeCode === "REF_NOT_FOUND") {
      return {
        code: "REF_NOT_FOUND",
        message: "The requested branch, tag, or commit was not found.",
      };
    }
    if (error.safeCode === "REPOSITORY_NOT_FOUND" || error.status === 404) {
      return {
        code: "REPOSITORY_NOT_FOUND",
        message: "Repository was not found or is not authorized.",
      };
    }
    if (error.safeCode === "IMPORT_LIMIT_EXCEEDED") {
      return {
        code: "IMPORT_LIMIT_EXCEEDED",
        message: "Repository archive exceeds the configured limit.",
      };
    }
    return {
      code: "INTERNAL_ERROR",
      message: "GitHub could not complete the import.",
    };
  }
  const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (
    ["GITHUB_NOT_CONNECTED", "NO_SKILLS_FOUND", "INVALID_SELECTION"].includes(
      message,
    )
  ) {
    return {
      code: message,
      message:
        message === "NO_SKILLS_FOUND"
          ? "No SKILL.md files were found."
          : message === "INVALID_SELECTION"
            ? "No valid import candidates were selected."
            : "Connect the GitHub App before importing.",
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "The import could not be completed.",
  };
}

export async function processImportJob(job: ImportJob): Promise<void> {
  try {
    if (job.state === "persisting") await persistSelection(job);
    else await acquireAndScan(job);
  } catch (error) {
    const failure = safeFailure(error);
    await updateImportJob(job.id, {
      state: "failed",
      errorCode: failure.code,
      errorMessage: failure.message,
      expiresAt: null,
    });
    await createAuditEvent({
      workspaceId: job.workspaceId,
      actorId: job.createdBy,
      action: "import.failed",
      targetId: job.id,
      summary: { sourceType: job.sourceType, errorCode: failure.code },
    });
    await fs.rm(jobDirectory(job.id), { recursive: true, force: true });
  }
}

export async function removeExpiredStaging(importIds: string[]): Promise<void> {
  await Promise.all(
    importIds.map((id) =>
      fs.rm(jobDirectory(id), { recursive: true, force: true }),
    ),
  );
}
