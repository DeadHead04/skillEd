ALTER TABLE skill_versions ADD COLUMN normalization_version text;
DROP INDEX IF EXISTS skill_version_identity;
-- Legacy NULL normalization versions do not block a newly normalized immutable version.
CREATE UNIQUE INDEX skill_version_identity ON skill_versions(skill_id,checksum,selected_root,normalization_version);
INSERT INTO history_assessments(resource_id,resource_type,assessment)
 SELECT id,'skill_versions','legacy_unverified' FROM skill_versions WHERE installable_checksum IS NULL ON CONFLICT DO NOTHING;
