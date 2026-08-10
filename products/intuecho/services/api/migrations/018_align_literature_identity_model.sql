ALTER TABLE literature_records
  RENAME COLUMN document_type TO version_kind;

ALTER TABLE literature_records
  RENAME COLUMN identity_status TO confirmation_status;

ALTER TABLE literature_records
  RENAME CONSTRAINT literature_records_identity_status_check
  TO literature_records_confirmation_status_check;

ALTER TABLE literature_identifiers
  ADD COLUMN id text;

UPDATE literature_identifiers
SET id = 'literature_identifier_' || md5(
  literature_id || ':' || identifier_kind || ':' || normalized_value
);

ALTER TABLE literature_identifiers
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE literature_identifiers
  DROP CONSTRAINT literature_identifiers_pkey;

ALTER TABLE literature_identifiers
  ADD PRIMARY KEY (id);

ALTER TABLE literature_identifiers
  ADD CONSTRAINT literature_identifiers_owner_kind_value_key
    UNIQUE (literature_id, identifier_kind, normalized_value);

ALTER TABLE literature_identity_claims
  ADD COLUMN identifier_id text;

UPDATE literature_identity_claims AS claim
SET identifier_id = (
  SELECT identifier.id
  FROM literature_identifiers AS identifier
  WHERE identifier.literature_id = claim.literature_id
  ORDER BY CASE
    WHEN claim.provider = 'crossref' AND identifier.identifier_kind = 'doi' THEN 0
    WHEN claim.provider = 'arxiv' AND identifier.identifier_kind = 'arxiv_id' THEN 0
    WHEN claim.provider IN ('openalex', 'semantic_scholar') AND identifier.identifier_kind = 'doi' THEN 0
    WHEN claim.provider IN ('openalex', 'semantic_scholar') AND identifier.identifier_kind = 'arxiv_id' THEN 1
    WHEN claim.provider = 'openalex' AND identifier.identifier_kind = 'openalex_id' THEN 2
    WHEN claim.provider = 'semantic_scholar' AND identifier.identifier_kind = 'semantic_scholar_id' THEN 2
    ELSE 3
  END,
  identifier.identifier_kind,
  identifier.normalized_value
  LIMIT 1
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM literature_identity_claims WHERE identifier_id IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'literature_claim_identifier_migration_failed';
  END IF;
END
$$;

DROP INDEX literature_identity_claims_literature_idx;

ALTER TABLE literature_identity_claims
  ALTER COLUMN identifier_id SET NOT NULL;

ALTER TABLE literature_identity_claims
  ADD CONSTRAINT literature_identity_claims_identifier_id_fkey
    FOREIGN KEY (identifier_id) REFERENCES literature_identifiers(id) ON DELETE CASCADE;

ALTER TABLE literature_identity_claims
  DROP COLUMN literature_id;

CREATE INDEX literature_identity_claims_identifier_idx
  ON literature_identity_claims(identifier_id, observed_at DESC);
