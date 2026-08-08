ALTER TABLE literature_records
  ADD COLUMN IF NOT EXISTS record_source text NOT NULL DEFAULT 'legacy_metadata',
  ADD COLUMN IF NOT EXISTS source_provider text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;

ALTER TABLE literature_records
  DROP CONSTRAINT IF EXISTS literature_records_record_source_check,
  DROP CONSTRAINT IF EXISTS literature_records_revision_check;
ALTER TABLE literature_records
  ADD CONSTRAINT literature_records_record_source_check
    CHECK (record_source IN ('legacy_metadata', 'public_registry', 'manual')),
  ADD CONSTRAINT literature_records_revision_check CHECK (revision > 0);

ALTER TABLE literature_identities
  DROP CONSTRAINT IF EXISTS literature_identities_identity_kind_check,
  DROP CONSTRAINT IF EXISTS literature_identities_identity_source_check;
ALTER TABLE literature_identities
  ADD CONSTRAINT literature_identities_identity_kind_check CHECK (
    identity_kind IN ('doi', 'arxiv_id', 'semantic_scholar_id', 'openalex_id', 'title_authors_year_hash')
  ),
  ADD CONSTRAINT literature_identities_identity_source_check CHECK (
    identity_source IN ('inferred', 'metadata', 'public_registry', 'manual')
  );

CREATE TABLE IF NOT EXISTS literature_record_versions (
  id text PRIMARY KEY,
  literature_id text NOT NULL REFERENCES literature_records(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  changed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(literature_id, revision)
);

CREATE OR REPLACE FUNCTION reject_literature_record_version_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'literature_record_version_is_append_only';
END;
$$;

DROP TRIGGER IF EXISTS literature_record_versions_append_only ON literature_record_versions;
CREATE TRIGGER literature_record_versions_append_only
BEFORE UPDATE OR DELETE ON literature_record_versions
FOR EACH ROW EXECUTE FUNCTION reject_literature_record_version_mutation();

INSERT INTO literature_record_versions(id, literature_id, revision, snapshot, changed_by)
SELECT 'literature_record_version_' || id,
       id,
       revision,
       jsonb_build_object(
         'authors', authors,
         'documentType', document_type,
         'identifiers', COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'kind', identity_kind,
             'source', identity_source,
             'value', identity_value
           ) ORDER BY identity_kind, identity_value)
           FROM literature_identities
           WHERE literature_identities.literature_id = literature_records.id
         ), '[]'::jsonb),
         'literatureId', id,
         'provenance', jsonb_build_object(
           'confirmedAt', confirmed_at,
           'mode', CASE WHEN record_source = 'public_registry' THEN 'public_registry' ELSE 'manual' END,
           'provider', source_provider
         ),
         'title', title,
         'year', publication_year
       ),
       'migration_011'
FROM literature_records
ON CONFLICT (literature_id, revision) DO NOTHING;
