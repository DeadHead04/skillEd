import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";
import type {
  ImportCandidateView,
  ImportState,
  ParsedSkillMetadata,
  SkillPackageManifest,
  SourceType,
  ValidationFinding,
  ValidationStatus,
} from "@skilled/domain";
import { fileCounts } from "@skilled/domain";
import { getDb } from "./client";
import {
  auditEvents,
  githubConnections,
  importCandidates,
  importJobs,
  type ImportSource,
  skillVersions,
  skills,
  users,
  validationFindings,
  workspaceMembers,
  workspaces,
} from "./schema";

export interface IdentityProfile {
  githubUserId: string;
  email?: string | null;
  name: string;
  image?: string | null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export async function ensureIdentityWorkspace(profile: IdentityProfile) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        githubUserId: profile.githubUserId,
        email: profile.email ?? null,
        name: profile.name,
        image: profile.image ?? null,
      })
      .onConflictDoUpdate({
        target: users.githubUserId,
        set: {
          email: profile.email ?? null,
          name: profile.name,
          image: profile.image ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!user) throw new Error("Unable to create user.");

    const [membership] = await tx
      .select({ workspace: workspaces })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, user.id))
      .limit(1);
    if (membership) return { user, workspace: membership.workspace };

    const [workspace] = await tx
      .insert(workspaces)
      .values({
        name: `${profile.name}'s workspace`,
        slug: `${slugify(profile.name) || "workspace"}-${profile.githubUserId}`,
      })
      .returning();
    if (!workspace) throw new Error("Unable to create workspace.");
    await tx
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: user.id });
    return { user, workspace };
  });
}

export async function getUserByGithubId(githubUserId: string) {
  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.githubUserId, githubUserId))
    .limit(1);
  return user;
}

export async function getUserWorkspace(userId: string) {
  const [row] = await getDb()
    .select({ workspace: workspaces })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);
  return row?.workspace;
}

export async function isWorkspaceMember(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function getGithubConnection(workspaceId: string) {
  const [connection] = await getDb()
    .select()
    .from(githubConnections)
    .where(eq(githubConnections.workspaceId, workspaceId))
    .limit(1);
  return connection;
}

export async function upsertGithubConnection(input: {
  workspaceId: string;
  installationId: string;
  accountId: string;
  accountLogin: string;
}) {
  const [connection] = await getDb()
    .insert(githubConnections)
    .values(input)
    .onConflictDoUpdate({
      target: githubConnections.workspaceId,
      set: {
        installationId: input.installationId,
        accountId: input.accountId,
        accountLogin: input.accountLogin,
        status: "connected",
        updatedAt: new Date(),
      },
    })
    .returning();
  return connection;
}

export async function createImportJob(input: {
  id?: string;
  workspaceId: string;
  sourceType: SourceType;
  source: ImportSource;
  createdBy: string;
}) {
  const [job] = await getDb().insert(importJobs).values(input).returning();
  if (!job) throw new Error("Unable to create import job.");
  return job;
}

export async function getImportJob(workspaceId: string, importId: string) {
  const [job] = await getDb()
    .select()
    .from(importJobs)
    .where(
      and(eq(importJobs.id, importId), eq(importJobs.workspaceId, workspaceId)),
    )
    .limit(1);
  return job;
}

export async function getImportJobView(workspaceId: string, importId: string) {
  const job = await getImportJob(workspaceId, importId);
  if (!job) return undefined;
  const candidates = await getDb()
    .select()
    .from(importCandidates)
    .where(eq(importCandidates.importJobId, job.id))
    .orderBy(asc(importCandidates.sourcePath));
  return {
    ...job,
    candidates: candidates.map((candidate): ImportCandidateView => ({
      id: candidate.id,
      sourcePath: candidate.sourcePath,
      name: candidate.name,
      description: candidate.description,
      validationStatus: candidate.validationStatus,
      findings: candidate.findings,
      fileCounts: fileCounts(candidate.manifest),
      ...(candidate.duplicateVersionId
        ? { duplicateVersionId: candidate.duplicateVersionId }
        : {}),
    })),
  };
}

export async function updateImportJob(
  importId: string,
  values: Partial<{
    state: ImportState;
    source: ImportSource;
    errorCode: string | null;
    errorMessage: string | null;
    expiresAt: Date | null;
  }>,
) {
  const [job] = await getDb()
    .update(importJobs)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(importJobs.id, importId))
    .returning();
  return job;
}

export async function claimImportJob() {
  return getDb().transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT id
      FROM import_jobs
      WHERE state IN ('queued', 'persisting')
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const importId = (result[0] as { id?: string } | undefined)?.id;
    if (!importId) return undefined;
    const [job] = await tx
      .update(importJobs)
      .set({
        state: sql`CASE WHEN ${importJobs.state} = 'queued' THEN 'acquiring'::import_state ELSE ${importJobs.state} END`,
        updatedAt: new Date(),
      })
      .where(eq(importJobs.id, importId))
      .returning();
    return job;
  });
}

export async function replaceImportCandidates(
  importId: string,
  candidates: Array<{
    sourcePath: string;
    stagingPath: string;
    name: string;
    description: string;
    validationStatus: ValidationStatus;
    metadata: ParsedSkillMetadata;
    manifest: SkillPackageManifest;
    findings: ValidationFinding[];
    duplicateVersionId?: string;
  }>,
) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .delete(importCandidates)
      .where(eq(importCandidates.importJobId, importId));
    if (candidates.length > 0) {
      await tx.insert(importCandidates).values(
        candidates.map((candidate) => ({
          importJobId: importId,
          ...candidate,
          duplicateVersionId: candidate.duplicateVersionId ?? null,
        })),
      );
    }
    await tx
      .update(importJobs)
      .set({
        state: "awaiting_selection",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(importJobs.id, importId));
  });
}

export async function selectImportCandidates(
  workspaceId: string,
  importId: string,
  candidateIds: string[],
): Promise<"accepted" | "expired" | "invalid"> {
  if (
    candidateIds.length === 0 ||
    new Set(candidateIds).size !== candidateIds.length
  )
    return "invalid";
  const db = getDb();
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(importJobs)
      .where(
        and(
          eq(importJobs.id, importId),
          eq(importJobs.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!job) return "invalid";
    if (
      job.state === "expired" ||
      (job.expiresAt && job.expiresAt.getTime() <= Date.now())
    ) {
      return "expired";
    }
    if (job.state !== "awaiting_selection") return "invalid";

    const rows = await tx
      .select({ id: importCandidates.id })
      .from(importCandidates)
      .where(
        and(
          eq(importCandidates.importJobId, importId),
          inArray(importCandidates.id, candidateIds),
        ),
      );
    if (rows.length !== candidateIds.length) return "invalid";
    await tx
      .update(importCandidates)
      .set({ selected: true })
      .where(
        and(
          eq(importCandidates.importJobId, importId),
          inArray(importCandidates.id, candidateIds),
        ),
      );
    await tx
      .update(importJobs)
      .set({ state: "persisting", updatedAt: new Date() })
      .where(eq(importJobs.id, importId));
    return "accepted";
  });
}

export async function getSelectedCandidates(importId: string) {
  return getDb()
    .select()
    .from(importCandidates)
    .where(
      and(
        eq(importCandidates.importJobId, importId),
        eq(importCandidates.selected, true),
      ),
    );
}

export async function findDuplicateVersion(input: {
  workspaceId: string;
  sourceType: SourceType;
  sourceIdentity: string;
  sourcePath: string;
  versionKey: string;
}) {
  const [row] = await getDb()
    .select({ versionId: skillVersions.id })
    .from(skills)
    .innerJoin(skillVersions, eq(skillVersions.skillId, skills.id))
    .where(
      and(
        eq(skills.workspaceId, input.workspaceId),
        eq(skills.sourceType, input.sourceType),
        eq(skills.sourceIdentity, input.sourceIdentity),
        eq(skills.sourcePath, input.sourcePath),
        eq(skillVersions.versionKey, input.versionKey),
      ),
    )
    .limit(1);
  return row?.versionId;
}

export async function persistSkillVersion(input: {
  workspaceId: string;
  sourceType: SourceType;
  sourceIdentity: string;
  sourceLocator: string;
  sourcePath: string;
  sourceCommit?: string;
  versionKey: string;
  name: string;
  description: string;
  metadata: ParsedSkillMetadata;
  manifest: SkillPackageManifest;
  validationStatus: ValidationStatus;
  artifactKey: string;
  actorId: string;
}) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [skill] = await tx
      .insert(skills)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        description: input.description,
        sourceType: input.sourceType,
        sourceIdentity: input.sourceIdentity,
        sourceLocator: input.sourceLocator,
        sourcePath: input.sourcePath,
      })
      .onConflictDoUpdate({
        target: [
          skills.workspaceId,
          skills.sourceType,
          skills.sourceIdentity,
          skills.sourcePath,
        ],
        set: {
          name: input.name,
          description: input.description,
          sourceLocator: input.sourceLocator,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!skill) throw new Error("Unable to persist Skill identity.");

    const [existing] = await tx
      .select()
      .from(skillVersions)
      .where(
        and(
          eq(skillVersions.skillId, skill.id),
          eq(skillVersions.versionKey, input.versionKey),
        ),
      )
      .limit(1);
    if (existing) return { skill, version: existing, duplicate: true };

    const [version] = await tx
      .insert(skillVersions)
      .values({
        skillId: skill.id,
        versionKey: input.versionKey,
        sourceCommit: input.sourceCommit ?? null,
        packageChecksum: input.manifest.sourceChecksum,
        skillMdChecksum: input.manifest.skillMdChecksum,
        parsedMetadata: input.metadata,
        packageManifest: input.manifest,
        validationStatus: input.validationStatus,
        artifactKey: input.artifactKey,
        importedBy: input.actorId,
      })
      .returning();
    if (!version) throw new Error("Unable to persist Skill version.");

    if (input.manifest.validationFindings.length > 0) {
      await tx.insert(validationFindings).values(
        input.manifest.validationFindings.map((item) => ({
          skillVersionId: version.id,
          severity: item.severity,
          code: item.code,
          message: item.message,
          relativePath: item.relativePath,
          line: item.line ?? null,
        })),
      );
    }
    await tx
      .update(skills)
      .set({ latestVersionId: version.id, updatedAt: new Date() })
      .where(eq(skills.id, skill.id));
    return { skill, version, duplicate: false };
  });
}

export async function createAuditEvent(input: {
  workspaceId: string;
  actorId: string;
  action: "import.completed" | "import.failed";
  targetId: string;
  summary: Record<string, unknown>;
}) {
  await getDb().insert(auditEvents).values({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    action: input.action,
    targetType: "import_job",
    targetId: input.targetId,
    summary: input.summary,
  });
}

export interface CatalogQuery {
  q?: string;
  validation?: "valid" | "warning" | "invalid";
  source?: SourceType;
  sort: "recent" | "name_asc" | "name_desc";
  page: number;
  pageSize: 12 | 24 | 48;
}

export async function listSkills(workspaceId: string, query: CatalogQuery) {
  const db = getDb();
  const conditions = [eq(skills.workspaceId, workspaceId)];
  if (query.q) {
    const term = `%${query.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    conditions.push(
      or(
        ilike(skills.name, term),
        ilike(skills.description, term),
        ilike(skills.sourcePath, term),
      )!,
    );
  }
  if (query.source) conditions.push(eq(skills.sourceType, query.source));
  if (query.validation === "valid")
    conditions.push(eq(skillVersions.validationStatus, "valid"));
  if (query.validation === "warning") {
    conditions.push(eq(skillVersions.validationStatus, "valid_with_warnings"));
  }
  if (query.validation === "invalid")
    conditions.push(eq(skillVersions.validationStatus, "invalid"));

  const where = and(...conditions);
  const ordering =
    query.sort === "name_asc"
      ? asc(skills.name)
      : query.sort === "name_desc"
        ? desc(skills.name)
        : desc(skills.updatedAt);

  const [items, countRows] = await Promise.all([
    db
      .select({ skill: skills, version: skillVersions })
      .from(skills)
      .innerJoin(skillVersions, eq(skills.latestVersionId, skillVersions.id))
      .where(where)
      .orderBy(ordering, asc(skills.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ total: count() })
      .from(skills)
      .innerJoin(skillVersions, eq(skills.latestVersionId, skillVersions.id))
      .where(where),
  ]);
  return { items, total: countRows[0]?.total ?? 0 };
}

export async function getSkillDetail(
  workspaceId: string,
  skillId: string,
  versionId?: string,
) {
  const [skill] = await getDb()
    .select()
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.workspaceId, workspaceId)))
    .limit(1);
  if (!skill) return undefined;
  const selectedVersionId = versionId ?? skill.latestVersionId;
  if (!selectedVersionId) return undefined;
  const [version] = await getDb()
    .select()
    .from(skillVersions)
    .where(
      and(
        eq(skillVersions.id, selectedVersionId),
        eq(skillVersions.skillId, skill.id),
      ),
    )
    .limit(1);
  if (!version) return undefined;
  const findings = await getDb()
    .select()
    .from(validationFindings)
    .where(eq(validationFindings.skillVersionId, version.id))
    .orderBy(
      asc(validationFindings.severity),
      asc(validationFindings.relativePath),
    );
  const [importer] = await getDb()
    .select({ id: users.id, name: users.name, image: users.image })
    .from(users)
    .where(eq(users.id, version.importedBy))
    .limit(1);
  return { skill, version, findings, importer: importer ?? null };
}

export async function expireStaleImports(): Promise<string[]> {
  const rows = await getDb()
    .update(importJobs)
    .set({ state: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(importJobs.state, "awaiting_selection"),
        sql`${importJobs.expiresAt} IS NOT NULL AND ${importJobs.expiresAt} <= now()`,
      ),
    )
    .returning({ id: importJobs.id });
  return rows.map((row) => row.id);
}
