CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  login_id text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('administrator', 'operator')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  session_version integer NOT NULL DEFAULT 1,
  last_login_at timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_login_id_format CHECK (login_id = lower(login_id))
);
CREATE UNIQUE INDEX IF NOT EXISTS users_login_id_unique ON users(lower(login_id));
CREATE INDEX IF NOT EXISTS users_active_role_idx ON users(active, role);

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  login_id text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_audit_events_created_idx ON user_audit_events(created_at DESC);

CREATE TABLE IF NOT EXISTS skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  active_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id uuid REFERENCES skills(id),
  version integer NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  selected_root text NOT NULL,
  root_candidates jsonb NOT NULL DEFAULT '[]',
  manifest jsonb NOT NULL DEFAULT '{}',
  readiness jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'ready',
  checksum text NOT NULL,
  original_key text NOT NULL,
  installable_key text,
  base_version_id uuid REFERENCES skill_versions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(skill_id, version), UNIQUE(checksum)
);
ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_active_version_id_fkey;
ALTER TABLE skills ADD CONSTRAINT skills_active_version_id_fkey FOREIGN KEY(active_version_id) REFERENCES skill_versions(id);

CREATE TABLE IF NOT EXISTS eval_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_version_id uuid NOT NULL REFERENCES skill_versions(id),
  version integer,
  revision integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'collecting',
  evidence_level text NOT NULL DEFAULT 'Provisional',
  task_understanding jsonb NOT NULL DEFAULT '{}',
  coverage_plan jsonb NOT NULL DEFAULT '{}',
  answers jsonb NOT NULL DEFAULT '{}',
  bundle_key text,
  checksum text,
  validation jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);
ALTER TABLE eval_versions ADD COLUMN IF NOT EXISTS questions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE eval_versions ADD COLUMN IF NOT EXISTS generation_notes jsonb NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS eval_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), eval_version_id uuid NOT NULL REFERENCES eval_versions(id) ON DELETE CASCADE,
  kind text NOT NULL, filename text NOT NULL, artifact_key text, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS eval_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), eval_version_id uuid NOT NULL REFERENCES eval_versions(id) ON DELETE CASCADE,
  case_id text NOT NULL, title text NOT NULL, coverage_group text NOT NULL, enabled boolean NOT NULL DEFAULT true,
  judge_type text NOT NULL, evidence_provenance jsonb NOT NULL DEFAULT '[]', required_dimensions jsonb NOT NULL DEFAULT '[]',
  yaml_path text NOT NULL, assertion_mapping jsonb NOT NULL DEFAULT '{}', source jsonb NOT NULL DEFAULT '{}',
  UNIQUE(eval_version_id, case_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, resource_id uuid NOT NULL,
  codex_thread_id text, summary jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL, content text NOT NULL, structured jsonb, completed boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), type text NOT NULL, resource_id uuid, status text NOT NULL DEFAULT 'queued',
  payload jsonb NOT NULL DEFAULT '{}', result jsonb, error jsonb, attempt integer NOT NULL DEFAULT 0,
  lease_owner text, lease_expires_at timestamptz, cancel_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs(status, created_at);
CREATE TABLE IF NOT EXISTS job_events (
  sequence bigserial PRIMARY KEY, job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type text NOT NULL, data jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_events_replay_idx ON job_events(job_id, sequence);
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id text PRIMARY KEY, versions jsonb NOT NULL DEFAULT '{}', readiness jsonb NOT NULL DEFAULT '{}', last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), skill_version_id uuid NOT NULL REFERENCES skill_versions(id), eval_version_id uuid NOT NULL REFERENCES eval_versions(id),
  job_id uuid REFERENCES jobs(id), status text NOT NULL DEFAULT 'queued', model text NOT NULL, settings jsonb NOT NULL,
  skill_checksum text NOT NULL, eval_checksum text NOT NULL, engine_versions jsonb NOT NULL DEFAULT '{}', baseline boolean NOT NULL DEFAULT false,
  iterations integer NOT NULL DEFAULT 1, raw_report_key text, normalized_key text, started_at timestamptz, completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS case_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  case_id text NOT NULL, configuration text NOT NULL DEFAULT 'skill', iteration integer NOT NULL,
  result text NOT NULL, assertions jsonb NOT NULL DEFAULT '[]', dimensions jsonb NOT NULL DEFAULT '{}', stable boolean,
  artifacts jsonb NOT NULL DEFAULT '[]', transcript_key text, tokens jsonb NOT NULL DEFAULT '{}', duration_ms integer,
  error_class text, detail jsonb NOT NULL DEFAULT '{}', UNIQUE(run_id, case_id, configuration, iteration)
);

CREATE TABLE IF NOT EXISTS update_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_run_id uuid NOT NULL REFERENCES runs(id), base_version_id uuid NOT NULL REFERENCES skill_versions(id),
  eval_version_id uuid NOT NULL REFERENCES eval_versions(id), status text NOT NULL DEFAULT 'generating', summary jsonb NOT NULL DEFAULT '{}', risks jsonb NOT NULL DEFAULT '[]',
  skill_patch_key text, eval_patch_key text, skill_decision text, eval_decision text, candidate_version_id uuid REFERENCES skill_versions(id),
  current_verification_run_id uuid REFERENCES runs(id), candidate_verification_run_id uuid REFERENCES runs(id), comparison jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE update_proposals ADD COLUMN IF NOT EXISTS skill_changes jsonb NOT NULL DEFAULT '[]';
ALTER TABLE update_proposals ADD COLUMN IF NOT EXISTS eval_changes jsonb NOT NULL DEFAULT '[]';
ALTER TABLE update_proposals ADD COLUMN IF NOT EXISTS activated_at timestamptz;
