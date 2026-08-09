DROP TRIGGER IF EXISTS literature_record_versions_append_only ON literature_record_versions;

UPDATE literature_record_versions AS version
SET snapshot = jsonb_build_object(
      'authors', record.authors,
      'identifiers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'kind', identity.identity_kind,
          'source', identity.identity_source,
          'value', identity.identity_value
        ) ORDER BY identity.identity_kind, identity.identity_value)
        FROM literature_identities AS identity
        WHERE identity.literature_id = record.id
      ), '[]'::jsonb),
      'literatureId', record.id,
      'recordSource', 'legacy_metadata',
      'title', record.title
    )
    || CASE
      WHEN record.document_type IS NULL OR record.document_type = '' THEN '{}'::jsonb
      ELSE jsonb_build_object('documentType', record.document_type)
    END
    || CASE
      WHEN record.publication_year IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object('year', record.publication_year)
    END
FROM literature_records AS record
WHERE version.literature_id = record.id
  AND version.changed_by = 'migration_011'
  AND record.record_source = 'legacy_metadata';

CREATE TRIGGER literature_record_versions_append_only
BEFORE UPDATE OR DELETE ON literature_record_versions
FOR EACH ROW EXECUTE FUNCTION reject_literature_record_version_mutation();
