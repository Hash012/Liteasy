ALTER TABLE literature_identifiers
  DROP CONSTRAINT IF EXISTS literature_identifiers_identifier_kind_normalized_value_key;

UPDATE literature_identifiers
SET is_legacy_alias = true
WHERE identifier_kind = 'arxiv_id'
  AND normalized_value !~ 'v[1-9][0-9]*$';

CREATE UNIQUE INDEX literature_identifiers_confirmable_kind_value_key
  ON literature_identifiers(identifier_kind, normalized_value)
  WHERE identifier_role = 'confirmable'
    AND NOT (identifier_kind = 'arxiv_id' AND is_legacy_alias);

UPDATE literature_records AS record
SET confirmation_status = 'legacy_unverified'
WHERE record.confirmation_status = 'confirmed'
  AND NOT EXISTS (
    SELECT 1
    FROM literature_identifiers AS identifier
    WHERE identifier.literature_id = record.id
      AND identifier.identifier_role = 'confirmable'
      AND NOT (identifier.identifier_kind = 'arxiv_id' AND identifier.is_legacy_alias)
      AND CASE identifier.identifier_kind
        WHEN 'doi' THEN identifier.normalized_value ~ '^10\.[0-9]{4,9}/[^[:space:]?#]+$'
        WHEN 'arxiv_id' THEN identifier.normalized_value ~ '^([0-9]{4}\.[0-9]{4,5}|[a-z][a-z0-9.-]*/[0-9]{7})v[1-9][0-9]*$'
        WHEN 'semantic_scholar_id' THEN identifier.normalized_value ~ '^(corpus:[1-9][0-9]*|[a-f0-9]{40})$'
        WHEN 'openalex_id' THEN identifier.normalized_value ~ '^W[0-9]+$'
        WHEN 'openreview_id' THEN identifier.normalized_value ~ '^[A-Za-z0-9_-]{6,200}$'
        WHEN 'dblp_key' THEN identifier.normalized_value ~ '^(conf|journals)/[A-Za-z0-9_.-]+/[A-Za-z0-9_.:+-]+$'
          AND identifier.normalized_value NOT LIKE '%..%'
        WHEN 'pmlr_id' THEN identifier.normalized_value ~ '^v[1-9][0-9]{0,3}/[a-z0-9][a-z0-9._-]{0,199}$'
          AND identifier.normalized_value NOT LIKE '%..%'
        ELSE false
      END
  );

ALTER TABLE literature_identifiers
  ADD CONSTRAINT literature_identifiers_normalized_format_check
  CHECK (
    (identifier_kind <> 'doi' OR normalized_value ~ '^10\.[0-9]{4,9}/[^[:space:]?#]+$')
    AND (identifier_kind <> 'arxiv_id' OR normalized_value ~ '^([0-9]{4}\.[0-9]{4,5}|[a-z][a-z0-9.-]*/[0-9]{7})(v[1-9][0-9]*)?$')
    AND (identifier_kind <> 'semantic_scholar_id' OR normalized_value ~ '^(corpus:[1-9][0-9]*|[a-f0-9]{40})$')
    AND (identifier_kind <> 'openalex_id' OR normalized_value ~ '^W[0-9]+$')
    AND (identifier_kind <> 'openreview_id' OR normalized_value ~ '^[A-Za-z0-9_-]{6,200}$')
    AND (identifier_kind <> 'dblp_key' OR (
      normalized_value ~ '^(conf|journals)/[A-Za-z0-9_.-]+/[A-Za-z0-9_.:+-]+$'
      AND normalized_value NOT LIKE '%..%'
    ))
    AND (identifier_kind <> 'pmlr_id' OR (
      normalized_value ~ '^v[1-9][0-9]{0,3}/[a-z0-9][a-z0-9._-]{0,199}$'
      AND normalized_value NOT LIKE '%..%'
    ))
    AND (identifier_kind <> 'title_authors_year_hash' OR normalized_value ~ '^(sha256:[a-f0-9]{64}|[a-f0-9]{8})$')
    AND (
      identifier_kind <> 'arxiv_id'
      OR is_legacy_alias
      OR normalized_value ~ 'v[1-9][0-9]*$'
    )
  ) NOT VALID;
