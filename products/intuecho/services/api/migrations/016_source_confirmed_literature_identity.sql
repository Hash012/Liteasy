ALTER TABLE literature_records
  ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT 'legacy_unverified';

UPDATE literature_records
SET identity_status = 'legacy_unverified';

ALTER TABLE literature_records
  DROP CONSTRAINT IF EXISTS literature_records_identity_status_check;
ALTER TABLE literature_records
  ADD CONSTRAINT literature_records_identity_status_check
    CHECK (identity_status IN ('confirmed', 'legacy_unverified'));

CREATE FUNCTION normalize_legacy_literature_identifier(kind text, value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE kind
    WHEN 'doi' THEN lower(regexp_replace(
      regexp_replace(btrim(value), '^(https?://)?(dx\.)?doi\.org/|^doi:\s*', '', 'i'),
      '[.,;:]+$', ''
    ))
    WHEN 'arxiv_id' THEN lower(regexp_replace(
      regexp_replace(
        regexp_replace(btrim(value), '^https?://(www\.)?arxiv\.org/(abs|pdf)/|^arxiv:\s*', '', 'i'),
        '\.pdf$', '', 'i'
      ),
      'v[0-9]+$', '', 'i'
    ))
    WHEN 'semantic_scholar_id' THEN lower(regexp_replace(
      regexp_replace(btrim(value), '^corpusid\s*:', 'corpus:', 'i'),
      '\s*:\s*', ':', 'g'
    ))
    WHEN 'openalex_id' THEN upper(regexp_replace(
      btrim(value), '^https?://(www\.)?openalex\.org/', '', 'i'
    ))
    ELSE lower(btrim(value))
  END
$$;

CREATE TABLE literature_identifiers (
  literature_id text NOT NULL REFERENCES literature_records(id) ON DELETE CASCADE,
  identifier_kind text NOT NULL CHECK (
    identifier_kind IN ('doi', 'arxiv_id', 'semantic_scholar_id', 'openalex_id', 'title_authors_year_hash')
  ),
  normalized_value text NOT NULL CHECK (length(btrim(normalized_value)) BETWEEN 1 AND 1000),
  is_legacy_alias boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (literature_id, identifier_kind, normalized_value),
  UNIQUE (identifier_kind, normalized_value)
);

INSERT INTO literature_identifiers(
  literature_id,
  identifier_kind,
  normalized_value,
  is_legacy_alias,
  created_at
)
SELECT literature_id,
       identity_kind,
       normalize_legacy_literature_identifier(identity_kind, identity_value),
       identity_kind = 'title_authors_year_hash'
         AND normalize_legacy_literature_identifier(identity_kind, identity_value)
           !~ '^sha256:[a-f0-9]{64}$',
       created_at
FROM literature_identities
ON CONFLICT (identifier_kind, normalized_value) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM literature_identities AS legacy
    JOIN literature_identifiers AS canonical
      ON canonical.identifier_kind = legacy.identity_kind
     AND canonical.normalized_value = normalize_legacy_literature_identifier(
       legacy.identity_kind,
       legacy.identity_value
     )
    WHERE canonical.literature_id <> legacy.literature_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'literature_identifier_migration_conflict';
  END IF;
END
$$;

UPDATE literature_records AS record
SET identity_status = 'confirmed'
WHERE record.record_source = 'public_registry'
  AND (
    (record.source_provider = 'crossref' AND EXISTS (
      SELECT 1 FROM literature_identifiers identifier
      WHERE identifier.literature_id = record.id AND identifier.identifier_kind = 'doi'
    ))
    OR (record.source_provider = 'arxiv' AND EXISTS (
      SELECT 1 FROM literature_identifiers identifier
      WHERE identifier.literature_id = record.id AND identifier.identifier_kind = 'arxiv_id'
    ))
    OR (record.source_provider = 'openalex' AND EXISTS (
      SELECT 1 FROM literature_identifiers identifier
      WHERE identifier.literature_id = record.id AND identifier.identifier_kind = 'openalex_id'
    ))
    OR (record.source_provider = 'semantic_scholar' AND EXISTS (
      SELECT 1 FROM literature_identifiers identifier
      WHERE identifier.literature_id = record.id AND identifier.identifier_kind = 'semantic_scholar_id'
    ))
  );

CREATE TABLE literature_identity_claims (
  id text PRIMARY KEY,
  literature_id text NOT NULL REFERENCES literature_records(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (
    provider IN ('crossref', 'arxiv', 'openalex', 'semantic_scholar')
  ),
  provider_record_id text NOT NULL CHECK (length(btrim(provider_record_id)) BETWEEN 1 AND 1000),
  verification_status text NOT NULL CHECK (verification_status = 'confirmed'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_record_id)
);
CREATE INDEX literature_identity_claims_literature_idx
  ON literature_identity_claims(literature_id, observed_at DESC);

INSERT INTO literature_identity_claims(
  id,
  literature_id,
  provider,
  provider_record_id,
  verification_status,
  evidence,
  observed_at
)
SELECT 'literature_claim_' || md5(
         record.id || ':' || record.source_provider || ':' || provider_identity.normalized_value
       ),
       record.id,
       record.source_provider,
       provider_identity.normalized_value,
       'confirmed',
       jsonb_build_object('migration', '016_source_confirmed_literature_identity'),
       COALESCE(record.confirmed_at, record.updated_at)
FROM literature_records AS record
JOIN LATERAL (
  SELECT normalized_value
  FROM literature_identifiers
  WHERE literature_id = record.id
    AND identifier_kind = CASE record.source_provider
      WHEN 'crossref' THEN 'doi'
      WHEN 'arxiv' THEN 'arxiv_id'
      WHEN 'openalex' THEN 'openalex_id'
      WHEN 'semantic_scholar' THEN 'semantic_scholar_id'
    END
  ORDER BY normalized_value
  LIMIT 1
) AS provider_identity ON true
WHERE record.identity_status = 'confirmed'
  AND record.source_provider IN ('crossref', 'arxiv', 'openalex', 'semantic_scholar')
ON CONFLICT (provider, provider_record_id) DO NOTHING;

CREATE TABLE literature_relations (
  id text PRIMARY KEY,
  from_literature_id text NOT NULL REFERENCES literature_records(id) ON DELETE CASCADE,
  to_literature_id text NOT NULL REFERENCES literature_records(id) ON DELETE CASCADE,
  relation_type text NOT NULL CHECK (
    relation_type IN ('is_preprint_of', 'version_of', 'translation_of')
  ),
  provider text NOT NULL CHECK (
    provider IN ('intuecho', 'crossref', 'arxiv', 'openalex', 'semantic_scholar')
  ),
  verification_status text NOT NULL CHECK (verification_status = 'confirmed'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_literature_id <> to_literature_id),
  UNIQUE (from_literature_id, to_literature_id, relation_type)
);
CREATE INDEX literature_relations_from_idx
  ON literature_relations(from_literature_id, relation_type, to_literature_id);
CREATE INDEX literature_relations_to_idx
  ON literature_relations(to_literature_id, relation_type, from_literature_id);

CREATE OR REPLACE FUNCTION reject_legacy_literature_identity_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'legacy_literature_identity_is_read_only';
END;
$$;

DROP TRIGGER IF EXISTS literature_identities_read_only ON literature_identities;
CREATE TRIGGER literature_identities_read_only
BEFORE INSERT OR UPDATE OR DELETE ON literature_identities
FOR EACH ROW EXECUTE FUNCTION reject_legacy_literature_identity_mutation();

DROP FUNCTION normalize_legacy_literature_identifier(text, text);
