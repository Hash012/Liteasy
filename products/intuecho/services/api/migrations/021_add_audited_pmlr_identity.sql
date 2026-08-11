ALTER TABLE literature_identifiers
  DROP CONSTRAINT IF EXISTS literature_identifiers_identifier_kind_check,
  DROP CONSTRAINT IF EXISTS literature_identifiers_kind_role_check;

ALTER TABLE literature_identifiers
  ADD CONSTRAINT literature_identifiers_identifier_kind_check
    CHECK (identifier_kind IN (
      'doi',
      'arxiv_id',
      'semantic_scholar_id',
      'openalex_id',
      'openreview_id',
      'dblp_key',
      'pmlr_id',
      'title_authors_year_hash'
    )),
  ADD CONSTRAINT literature_identifiers_kind_role_check
    CHECK (
      (identifier_kind = 'title_authors_year_hash' AND identifier_role = 'candidate_alias')
      OR
      (identifier_kind IN (
        'doi',
        'arxiv_id',
        'semantic_scholar_id',
        'openalex_id',
        'openreview_id',
        'dblp_key',
        'pmlr_id'
      ) AND identifier_role = 'confirmable')
    );

ALTER TABLE literature_identity_claims
  DROP CONSTRAINT IF EXISTS literature_identity_claims_provider_check;

ALTER TABLE literature_identity_claims
  ADD CONSTRAINT literature_identity_claims_provider_check
    CHECK (provider IN (
      'crossref',
      'arxiv',
      'openalex',
      'semantic_scholar',
      'openreview',
      'dblp',
      'pmlr'
    ));

ALTER TABLE literature_relations
  DROP CONSTRAINT IF EXISTS literature_relations_provider_check;

ALTER TABLE literature_relations
  ADD CONSTRAINT literature_relations_provider_check
    CHECK (provider IN (
      'intuecho',
      'crossref',
      'arxiv',
      'openalex',
      'semantic_scholar',
      'openreview',
      'dblp',
      'pmlr'
    ));
