ALTER TABLE platform_retrieval_sources
  ADD COLUMN connector_type text;

UPDATE platform_retrieval_sources
   SET enabled = false
 WHERE connector_type IS NULL;

ALTER TABLE platform_retrieval_sources
  ADD CONSTRAINT platform_retrieval_sources_connector_type_check
  CHECK (
    connector_type IN ('crossref', 'openalex', 'semantic_scholar') OR
    (connector_type IS NULL AND enabled = false)
  );

CREATE UNIQUE INDEX platform_retrieval_sources_connector_unique
  ON platform_retrieval_sources(connector_type)
  WHERE connector_type IS NOT NULL;

CREATE TABLE external_retrieval_pdf_grants (
  grant_id text PRIMARY KEY,
  subject_id text NOT NULL,
  source_id text NOT NULL,
  source_record_id text NOT NULL,
  connector_source_id text NOT NULL
    REFERENCES platform_retrieval_sources(source_id) ON DELETE CASCADE,
  connector_type text NOT NULL
    CHECK (connector_type IN ('crossref', 'openalex', 'semantic_scholar')),
  source_url text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX external_retrieval_pdf_grants_subject_expiry_idx
  ON external_retrieval_pdf_grants(subject_id, expires_at);

CREATE INDEX external_retrieval_pdf_grants_expiry_idx
  ON external_retrieval_pdf_grants(expires_at);

CREATE TABLE external_retrieval_cache (
  subject_id text NOT NULL,
  cache_key text NOT NULL CHECK (cache_key ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_accessed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, cache_key)
);

CREATE INDEX external_retrieval_cache_expiry_idx
  ON external_retrieval_cache(expires_at);

CREATE INDEX external_retrieval_cache_subject_access_idx
  ON external_retrieval_cache(subject_id, last_accessed_at DESC, created_at DESC, cache_key DESC);
