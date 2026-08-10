ALTER TABLE literature_identifiers
  ADD COLUMN identifier_role text;

UPDATE literature_identifiers
SET identifier_role = CASE identifier_kind
  WHEN 'title_authors_year_hash' THEN 'candidate_alias'
  ELSE 'confirmable'
END;

ALTER TABLE literature_identifiers
  ALTER COLUMN identifier_role SET NOT NULL;

ALTER TABLE literature_identifiers
  ADD CONSTRAINT literature_identifiers_role_check
    CHECK (identifier_role IN ('confirmable', 'candidate_alias'));

ALTER TABLE literature_identifiers
  ADD CONSTRAINT literature_identifiers_kind_role_check
    CHECK (
      (identifier_kind = 'title_authors_year_hash' AND identifier_role = 'candidate_alias')
      OR
      (identifier_kind IN ('doi', 'arxiv_id', 'semantic_scholar_id', 'openalex_id') AND identifier_role = 'confirmable')
    );
