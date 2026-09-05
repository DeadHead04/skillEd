ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_token bigint NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS adapter text NOT NULL DEFAULT 'unknown';
ALTER TABLE runs ADD COLUMN IF NOT EXISTS provenance_status text NOT NULL DEFAULT 'legacy_unverified';
ALTER TABLE skill_versions ADD COLUMN IF NOT EXISTS installable_checksum text;
ALTER TABLE update_proposals ADD COLUMN IF NOT EXISTS source_eval_version_id uuid REFERENCES eval_versions(id);
ALTER TABLE update_proposals ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1;
ALTER TABLE skill_versions DROP CONSTRAINT IF EXISTS skill_versions_checksum_key;
CREATE UNIQUE INDEX IF NOT EXISTS skill_version_identity ON skill_versions(skill_id,checksum,selected_root);
CREATE INDEX IF NOT EXISTS eval_versions_skill_idx ON eval_versions(skill_version_id,created_at DESC);
CREATE INDEX IF NOT EXISTS eval_files_eval_idx ON eval_files(eval_version_id);
CREATE INDEX IF NOT EXISTS runs_skill_created_idx ON runs(skill_version_id,created_at DESC);
CREATE INDEX IF NOT EXISTS conversations_resource_idx ON conversations(resource_id,kind);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON conversation_messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS jobs_resource_active_idx ON jobs(resource_id,status);
CREATE TABLE IF NOT EXISTS decision_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid REFERENCES users(id),
 resource_id uuid NOT NULL, action text NOT NULL, revision integer,
 input_hashes jsonb NOT NULL DEFAULT '{}', detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS request_receipts (
 actor_id text NOT NULL, request_key text NOT NULL, fingerprint text NOT NULL,
 response jsonb NOT NULL, status integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(actor_id,request_key)
);
CREATE TABLE IF NOT EXISTS history_assessments (
 resource_id uuid PRIMARY KEY, resource_type text NOT NULL, assessment text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO history_assessments(resource_id,resource_type,assessment)
 SELECT id,'run','legacy_unverified' FROM runs ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION skilled_immutable_eval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='approved' THEN RAISE EXCEPTION 'Approved evaluations are immutable; clone a draft' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS immutable_eval ON eval_versions;
CREATE TRIGGER immutable_eval BEFORE UPDATE OR DELETE ON eval_versions FOR EACH ROW EXECUTE FUNCTION skilled_immutable_eval();
CREATE OR REPLACE FUNCTION skilled_immutable_eval_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid;
BEGIN
 IF TG_OP='INSERT' THEN parent_id:=NEW.eval_version_id; ELSE parent_id:=OLD.eval_version_id; END IF;
 PERFORM 1 FROM eval_versions WHERE id=parent_id AND status='approved' FOR SHARE;
 IF FOUND THEN RAISE EXCEPTION 'Approved evaluation contents are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
   PERFORM 1 FROM eval_versions WHERE id=NEW.eval_version_id AND status='approved' FOR SHARE;
   IF FOUND THEN RAISE EXCEPTION 'Cannot move content into an approved evaluation' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS immutable_eval_cases ON eval_cases;
CREATE TRIGGER immutable_eval_cases BEFORE INSERT OR UPDATE OR DELETE ON eval_cases FOR EACH ROW EXECUTE FUNCTION skilled_immutable_eval_child();
DROP TRIGGER IF EXISTS immutable_eval_files ON eval_files;
CREATE TRIGGER immutable_eval_files BEFORE INSERT OR UPDATE OR DELETE ON eval_files FOR EACH ROW EXECUTE FUNCTION skilled_immutable_eval_child();
CREATE OR REPLACE FUNCTION skilled_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable record cannot be changed' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS immutable_skill_version ON skill_versions;
CREATE TRIGGER immutable_skill_version BEFORE UPDATE OR DELETE ON skill_versions FOR EACH ROW EXECUTE FUNCTION skilled_immutable_record();
DROP TRIGGER IF EXISTS immutable_decision ON decision_records;
CREATE TRIGGER immutable_decision BEFORE UPDATE OR DELETE ON decision_records FOR EACH ROW EXECUTE FUNCTION skilled_immutable_record();
CREATE OR REPLACE FUNCTION skilled_immutable_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IN ('completed','failed','cancelled','interrupted') THEN RAISE EXCEPTION 'Terminal runs are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS immutable_run ON runs;
CREATE TRIGGER immutable_run BEFORE UPDATE OR DELETE ON runs FOR EACH ROW EXECUTE FUNCTION skilled_immutable_run();
CREATE OR REPLACE FUNCTION skilled_immutable_case_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid;
BEGIN
 IF TG_OP='INSERT' THEN parent_id:=NEW.run_id; ELSE parent_id:=OLD.run_id; END IF;
 PERFORM 1 FROM runs WHERE id=parent_id AND status IN ('completed','failed','cancelled','interrupted') FOR SHARE;
 IF FOUND THEN RAISE EXCEPTION 'Terminal run evidence is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
   PERFORM 1 FROM runs WHERE id=NEW.run_id AND status IN ('completed','failed','cancelled','interrupted') FOR SHARE;
   IF FOUND THEN RAISE EXCEPTION 'Cannot move evidence into a terminal run' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS immutable_case_result ON case_results;
CREATE TRIGGER immutable_case_result BEFORE INSERT OR UPDATE OR DELETE ON case_results FOR EACH ROW EXECUTE FUNCTION skilled_immutable_case_result();
CREATE OR REPLACE FUNCTION skilled_immutable_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND (OLD.skill_decision IS NOT NULL OR OLD.status IN ('verified','rejected')) THEN
   RAISE EXCEPTION 'Decided proposals are immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF OLD.skill_decision IS NOT NULL AND
   ROW(NEW.source_run_id,NEW.base_version_id,NEW.summary,NEW.risks,NEW.skill_patch_key,NEW.eval_patch_key,NEW.skill_changes,NEW.eval_changes,NEW.skill_decision,NEW.eval_decision,NEW.candidate_version_id,NEW.eval_version_id)
   IS DISTINCT FROM
   ROW(OLD.source_run_id,OLD.base_version_id,OLD.summary,OLD.risks,OLD.skill_patch_key,OLD.eval_patch_key,OLD.skill_changes,OLD.eval_changes,OLD.skill_decision,OLD.eval_decision,OLD.candidate_version_id,OLD.eval_version_id)
 THEN RAISE EXCEPTION 'Decided proposal contents cannot change' USING ERRCODE='23514'; END IF;
 IF OLD.status IN ('verified','rejected') AND NEW.status<>OLD.status THEN
   RAISE EXCEPTION 'Terminal proposal decision cannot change' USING ERRCODE='23514';
 END IF;
 IF ROW(NEW.summary,NEW.risks,NEW.skill_changes,NEW.eval_changes) IS DISTINCT FROM ROW(OLD.summary,OLD.risks,OLD.skill_changes,OLD.eval_changes) THEN NEW.revision:=OLD.revision+1; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS immutable_proposal ON update_proposals;
CREATE TRIGGER immutable_proposal BEFORE UPDATE OR DELETE ON update_proposals FOR EACH ROW EXECUTE FUNCTION skilled_immutable_proposal();
