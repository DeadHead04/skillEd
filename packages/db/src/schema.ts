import {
  bigint,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ImportState,
  ParsedSkillMetadata,
  SkillPackageManifest,
  SourceType,
  ValidationFinding,
  ValidationStatus,
} from "@skilled/domain";

export const sourceTypeEnum = pgEnum("source_type", ["github", "upload"]);
export const importStateEnum = pgEnum("import_state", [
  "queued",
  "acquiring",
  "scanning",
  "awaiting_selection",
  "persisting",
  "completed",
  "failed",
  "expired",
]);
export const validationStatusEnum = pgEnum("validation_status", [
  "valid",
  "valid_with_warnings",
  "invalid",
]);
export const findingSeverityEnum = pgEnum("finding_severity", [
  "error",
  "warning",
  "information",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  githubUserId: text("github_user_id").notNull().unique(),
  email: text("email"),
  name: text("name").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const githubConnections = pgTable(
  "github_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    installationId: text("installation_id").notNull(),
    accountId: text("account_id").notNull(),
    accountLogin: text("account_login").notNull(),
    status: text("status").notNull().default("connected"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_connection_workspace_unique").on(table.workspaceId),
  ],
);

export interface GithubImportSource {
  type: "github";
  repositoryUrl: string;
  owner: string;
  repository: string;
  ref?: string;
  resolvedCommit?: string;
  repositoryId?: string;
  archivePath?: string;
  extractedPath?: string;
}

export interface UploadImportSource {
  type: "upload";
  uploadName: string;
  mode: "zip" | "folder";
  stagedPath: string;
  extractedPath?: string;
}

export type ImportSource = GithubImportSource | UploadImportSource;

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceType: sourceTypeEnum("source_type").$type<SourceType>().notNull(),
    state: importStateEnum("state")
      .$type<ImportState>()
      .notNull()
      .default("queued"),
    source: jsonb("source").$type<ImportSource>().notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("import_jobs_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("import_jobs_state_idx").on(table.state, table.createdAt),
  ],
);

export const importCandidates = pgTable(
  "import_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    importJobId: uuid("import_job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    sourcePath: text("source_path").notNull(),
    stagingPath: text("staging_path").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    validationStatus: validationStatusEnum("validation_status")
      .$type<ValidationStatus>()
      .notNull(),
    metadata: jsonb("metadata").$type<ParsedSkillMetadata>().notNull(),
    manifest: jsonb("manifest").$type<SkillPackageManifest>().notNull(),
    findings: jsonb("findings").$type<ValidationFinding[]>().notNull(),
    selected: boolean("selected").notNull().default(false),
    duplicateVersionId: uuid("duplicate_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("import_candidate_job_path_unique").on(
      table.importJobId,
      table.sourcePath,
    ),
  ],
);

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    sourceType: sourceTypeEnum("source_type").$type<SourceType>().notNull(),
    sourceIdentity: text("source_identity").notNull(),
    sourceLocator: text("source_locator").notNull(),
    sourcePath: text("source_path").notNull(),
    latestVersionId: uuid("latest_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("skill_source_identity_unique").on(
      table.workspaceId,
      table.sourceType,
      table.sourceIdentity,
      table.sourcePath,
    ),
    index("skills_workspace_name_idx").on(table.workspaceId, table.name),
  ],
);

export const skillVersions = pgTable(
  "skill_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    versionKey: text("version_key").notNull(),
    sourceCommit: text("source_commit"),
    packageChecksum: text("package_checksum").notNull(),
    skillMdChecksum: text("skill_md_checksum").notNull(),
    parsedMetadata: jsonb("parsed_metadata")
      .$type<ParsedSkillMetadata>()
      .notNull(),
    packageManifest: jsonb("package_manifest")
      .$type<SkillPackageManifest>()
      .notNull(),
    validationStatus: validationStatusEnum("validation_status")
      .$type<ValidationStatus>()
      .notNull(),
    artifactKey: text("artifact_key").notNull(),
    importedBy: uuid("imported_by")
      .notNull()
      .references(() => users.id),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("skill_version_key_unique").on(table.skillId, table.versionKey),
    index("skill_versions_skill_imported_idx").on(
      table.skillId,
      table.importedAt,
    ),
  ],
);

export const validationFindings = pgTable(
  "validation_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    skillVersionId: uuid("skill_version_id")
      .notNull()
      .references(() => skillVersions.id, { onDelete: "cascade" }),
    severity: findingSeverityEnum("severity").notNull(),
    code: text("code").notNull(),
    message: text("message").notNull(),
    relativePath: text("relative_path").notNull(),
    line: bigint("line", { mode: "number" }),
  },
  (table) => [
    index("validation_findings_version_idx").on(table.skillVersionId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_events_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);
