CREATE TABLE visualization_generation_requests (
  subject_id text NOT NULL CHECK (length(btrim(subject_id)) BETWEEN 1 AND 300),
  request_id text NOT NULL CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
  artifact_id text NOT NULL CHECK (artifact_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  artifact_revision bigint NOT NULL CHECK (artifact_revision > 0),
  node_id text NOT NULL CHECK (node_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  intent_hash text NOT NULL CHECK (intent_hash ~ '^[a-f0-9]{64}$'),
  requested_artifact_count smallint NOT NULL CHECK (requested_artifact_count BETWEEN 1 AND 2),
  state text NOT NULL CHECK (state IN (
    'queued','running','cancel_requested','succeeded','cancelled','omitted','failed'
  )),
  cancellation_idempotency_key text CHECK (
    cancellation_idempotency_key IS NULL OR
    cancellation_idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'
  ),
  cancellation_hash text CHECK (
    cancellation_hash IS NULL OR cancellation_hash ~ '^[a-f0-9]{64}$'
  ),
  cancellation_requested_at timestamptz,
  terminal_reason text CHECK (
    terminal_reason IS NULL OR length(btrim(terminal_reason)) BETWEEN 1 AND 120
  ),
  result_artifact_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(result_artifact_ids) = 'array' AND
    jsonb_array_length(result_artifact_ids) <= 2
  ),
  lease_owner text CHECK (lease_owner IS NULL OR length(btrim(lease_owner)) BETWEEN 1 AND 160),
  lease_expires_at timestamptz,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  trace_id text NOT NULL CHECK (length(btrim(trace_id)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, request_id),
  CHECK (
    (cancellation_idempotency_key IS NULL AND cancellation_hash IS NULL AND cancellation_requested_at IS NULL) OR
    (cancellation_idempotency_key IS NOT NULL AND cancellation_hash IS NOT NULL AND cancellation_requested_at IS NOT NULL)
  ),
  CHECK (
    (state IN ('running','cancel_requested') AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR
    (state NOT IN ('running','cancel_requested') AND lease_owner IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX visualization_generation_requests_claim_idx
  ON visualization_generation_requests(state, lease_expires_at, created_at)
  WHERE state IN ('queued','running','cancel_requested');

CREATE UNIQUE INDEX visualization_generation_requests_cancel_key_idx
  ON visualization_generation_requests(subject_id, cancellation_idempotency_key)
  WHERE cancellation_idempotency_key IS NOT NULL;

CREATE TABLE visualization_artifact_sources (
  subject_id text NOT NULL,
  artifact_id text NOT NULL,
  document_id text NOT NULL CHECK (document_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  source_identity_hash text NOT NULL CHECK (source_identity_hash ~ '^[a-f0-9]{64}$'),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, artifact_id, document_id),
  FOREIGN KEY (subject_id, artifact_id)
    REFERENCES visualization_artifacts(subject_id, artifact_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX visualization_artifact_sources_primary_idx
  ON visualization_artifact_sources(subject_id, artifact_id)
  WHERE is_primary = true;
