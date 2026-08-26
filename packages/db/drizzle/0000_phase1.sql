CREATE TYPE "source_type" AS ENUM ('github', 'upload');
CREATE TYPE "import_state" AS ENUM ('queued', 'acquiring', 'scanning', 'awaiting_selection', 'persisting', 'completed', 'failed', 'expired');
CREATE TYPE "validation_status" AS ENUM ('valid', 'valid_with_warnings', 'invalid');
CREATE TYPE "finding_severity" AS ENUM ('error', 'warning', 'information');

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "github_user_id" text NOT NULL UNIQUE,
  "email" text,
  "name" text NOT NULL,
  "image" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "workspace_members" (
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'user',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspace_id", "user_id")
);

CREATE TABLE "github_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "installation_id" text NOT NULL,
  "account_id" text NOT NULL,
  "account_login" text NOT NULL,
  "status" text NOT NULL DEFAULT 'connected',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "github_connection_workspace_unique" ON "github_connections" ("workspace_id");

CREATE TABLE "import_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "source_type" "source_type" NOT NULL,
  "state" "import_state" NOT NULL DEFAULT 'queued',
  "source" jsonb NOT NULL,
  "error_code" text,
  "error_message" text,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "import_jobs_workspace_created_idx" ON "import_jobs" ("workspace_id", "created_at");
CREATE INDEX "import_jobs_state_idx" ON "import_jobs" ("state", "created_at");

CREATE TABLE "import_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "import_job_id" uuid NOT NULL REFERENCES "import_jobs"("id") ON DELETE CASCADE,
  "source_path" text NOT NULL,
  "staging_path" text NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "validation_status" "validation_status" NOT NULL,
  "metadata" jsonb NOT NULL,
  "manifest" jsonb NOT NULL,
  "findings" jsonb NOT NULL,
  "selected" boolean NOT NULL DEFAULT false,
  "duplicate_version_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "import_candidate_job_path_unique" ON "import_candidates" ("import_job_id", "source_path");

CREATE TABLE "skills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text NOT NULL,
  "source_type" "source_type" NOT NULL,
  "source_identity" text NOT NULL,
  "source_path" text NOT NULL,
  "latest_version_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "skill_source_identity_unique" ON "skills" ("workspace_id", "source_type", "source_identity", "source_path");
CREATE INDEX "skills_workspace_name_idx" ON "skills" ("workspace_id", "name");

CREATE TABLE "skill_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "skill_id" uuid NOT NULL REFERENCES "skills"("id") ON DELETE CASCADE,
  "version_key" text NOT NULL,
  "source_commit" text,
  "package_checksum" text NOT NULL,
  "skill_md_checksum" text NOT NULL,
  "parsed_metadata" jsonb NOT NULL,
  "package_manifest" jsonb NOT NULL,
  "validation_status" "validation_status" NOT NULL,
  "artifact_key" text NOT NULL,
  "imported_by" uuid NOT NULL REFERENCES "users"("id"),
  "imported_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "skill_version_key_unique" ON "skill_versions" ("skill_id", "version_key");
CREATE INDEX "skill_versions_skill_imported_idx" ON "skill_versions" ("skill_id", "imported_at");
ALTER TABLE "skills" ADD CONSTRAINT "skills_latest_version_id_fkey" FOREIGN KEY ("latest_version_id") REFERENCES "skill_versions"("id") ON DELETE SET NULL;

CREATE TABLE "validation_findings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "skill_version_id" uuid NOT NULL REFERENCES "skill_versions"("id") ON DELETE CASCADE,
  "severity" "finding_severity" NOT NULL,
  "code" text NOT NULL,
  "message" text NOT NULL,
  "relative_path" text NOT NULL,
  "line" bigint
);
CREATE INDEX "validation_findings_version_idx" ON "validation_findings" ("skill_version_id");

CREATE TABLE "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "actor_id" uuid REFERENCES "users"("id"),
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "summary" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "audit_events_workspace_created_idx" ON "audit_events" ("workspace_id", "created_at");
