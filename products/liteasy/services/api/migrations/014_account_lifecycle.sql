CREATE TABLE account_status_projections (
  subject_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('active', 'disabled', 'deleted')),
  updated_by text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 1000),
  identity_updated_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_lifecycle_operations (
  actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  subject_id text NOT NULL,
  requested_status text NOT NULL CHECK (requested_status IN ('active', 'disabled', 'deleted')),
  state text NOT NULL CHECK (state IN ('running', 'failed', 'completed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  response_body jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (actor_id, idempotency_key),
  CHECK (
    (state = 'running' AND response_body IS NULL AND error_code IS NULL AND completed_at IS NULL) OR
    (state = 'failed' AND response_body IS NULL AND error_code IS NOT NULL AND completed_at IS NULL) OR
    (state = 'completed' AND response_body IS NOT NULL AND error_code IS NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX account_lifecycle_operations_subject_idx
  ON account_lifecycle_operations(subject_id, updated_at DESC);

CREATE TABLE account_deletion_jobs (
  subject_id text PRIMARY KEY,
  job_id text NOT NULL UNIQUE,
  state text NOT NULL CHECK (
    state IN (
      'requested', 'identity_disabled', 'liteasy_cleaned', 'intuecho_cleaned',
      'identity_delete_requested', 'identity_deleted', 'completed', 'failed'
    )
  ),
  requested_by text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 1000),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  last_completed_stage text,
  last_error_code text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (
    (state = 'completed' AND completed_at IS NOT NULL AND last_error_code IS NULL) OR
    (state <> 'completed' AND completed_at IS NULL)
  ),
  CHECK (
    last_completed_stage IS NULL OR last_completed_stage IN (
      'identity_disabled', 'liteasy_cleaned', 'intuecho_cleaned',
      'identity_delete_requested', 'identity_deleted', 'completed'
    )
  ),
  CHECK (state <> 'completed' OR last_completed_stage = 'completed')
);
CREATE INDEX account_deletion_jobs_state_idx
  ON account_deletion_jobs(state, updated_at, job_id);
