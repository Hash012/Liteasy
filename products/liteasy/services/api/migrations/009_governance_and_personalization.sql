ALTER TABLE organization_storage_policies
  ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0);

CREATE TABLE personalization_states (
  subject_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE academic_profiles (
  subject_id text PRIMARY KEY,
  stage text NOT NULL,
  disciplines jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(disciplines) = 'array'),
  profile_version bigint NOT NULL DEFAULT 1 CHECK (profile_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE personalization_terms (
  subject_id text NOT NULL,
  term text NOT NULL CHECK (length(term) BETWEEN 1 AND 200),
  weight double precision NOT NULL DEFAULT 0,
  evidence_count bigint NOT NULL DEFAULT 1 CHECK (evidence_count > 0),
  signal_source text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, term)
);

CREATE TABLE personalization_signals (
  signal_id text PRIMARY KEY,
  subject_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('paper_opened', 'recommendation_saved', 'recommendation_dismissed')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX personalization_signals_subject_idx
  ON personalization_signals(subject_id, created_at, signal_id);

CREATE TABLE recommendation_feedback (
  feedback_id text PRIMARY KEY,
  subject_id text NOT NULL,
  recommendation_id text NOT NULL,
  body jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(body) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recommendation_feedback_subject_idx ON recommendation_feedback(subject_id);

CREATE TABLE recommendation_suppressions (
  subject_id text NOT NULL,
  recommendation_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, recommendation_id)
);

CREATE TABLE recommendation_candidates (
  candidate_id text PRIMARY KEY,
  subject_id text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recommendation_candidates_expiry_idx
  ON recommendation_candidates(subject_id, expires_at);

CREATE TABLE recommendation_cache_entries (
  subject_id text NOT NULL,
  cache_key text NOT NULL,
  personalization_version bigint NOT NULL CHECK (personalization_version >= 0),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, cache_key)
);
CREATE INDEX recommendation_cache_expiry_idx ON recommendation_cache_entries(expires_at);

CREATE TABLE local_library_manifest_entries (
  subject_id text NOT NULL,
  sync_document_id text NOT NULL,
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  authors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(authors) = 'array'),
  doi text,
  publication_year integer CHECK (publication_year IS NULL OR publication_year BETWEEN 1000 AND 9999),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, sync_document_id)
);

CREATE INDEX local_library_manifest_hash_idx
  ON local_library_manifest_entries(subject_id, content_hash);
