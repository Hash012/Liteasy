ALTER TABLE storage_objects
  ADD COLUMN status text NOT NULL DEFAULT 'available'
  CHECK (status IN ('staging', 'available', 'deleting'));
ALTER TABLE storage_objects
  ADD COLUMN staging_key text;
ALTER TABLE storage_objects
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE library_entries
  ADD COLUMN availability text NOT NULL DEFAULT 'available'
  CHECK (availability IN ('pending', 'available'));
ALTER TABLE library_entries
  ADD CONSTRAINT metadata_entry_always_available
  CHECK (entry_kind = 'pdf' OR availability = 'available');

CREATE TABLE storage_publish_workflows (
  workflow_id text PRIMARY KEY,
  actor_id text NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  scope_type text NOT NULL CHECK (scope_type IN ('user', 'organization')),
  scope_id text NOT NULL,
  document_id text NOT NULL REFERENCES library_entries(document_id) ON DELETE RESTRICT,
  content_hash text NOT NULL REFERENCES storage_objects(content_hash) ON DELETE RESTRICT,
  staging_key text NOT NULL,
  final_key text NOT NULL,
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  response_body jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('database_committed', 'object_published', 'completed', 'repair_required')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, operation, idempotency_key)
);
CREATE INDEX storage_publish_workflows_state_idx
  ON storage_publish_workflows(state, updated_at, workflow_id);
