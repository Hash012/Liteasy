DROP TRIGGER IF EXISTS literature_record_versions_append_only ON literature_record_versions;

UPDATE literature_record_versions AS version
SET snapshot = (version.snapshot - 'provenance')
    || jsonb_build_object('recordSource', 'legacy_metadata')
WHERE version.changed_by = 'migration_011'
  AND (
    version.snapshot ? 'provenance'
    OR version.snapshot ->> 'recordSource' IS DISTINCT FROM 'legacy_metadata'
  );

CREATE TRIGGER literature_record_versions_append_only
BEFORE UPDATE OR DELETE ON literature_record_versions
FOR EACH ROW EXECUTE FUNCTION reject_literature_record_version_mutation();
