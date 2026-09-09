-- Additive only: preserve historical labels, immutable versions and decisions.
ALTER TABLE eval_versions ADD COLUMN IF NOT EXISTS profile_hash text;
ALTER TABLE skill_versions ADD COLUMN IF NOT EXISTS package_assessment jsonb;
CREATE INDEX IF NOT EXISTS studio_package_history_idx ON skill_versions(skill_id,version DESC);
