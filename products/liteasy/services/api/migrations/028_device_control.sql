CREATE TABLE device_control_accounts (
  subject_id text PRIMARY KEY CHECK (length(subject_id) BETWEEN 1 AND 512),
  state jsonb NOT NULL CHECK (
    jsonb_typeof(state) = 'object' AND state->>'version' = '1'
    AND jsonb_typeof(state->'devices') = 'object'
    AND jsonb_typeof(state->'pairs') = 'object'
    AND jsonb_typeof(state->'tasks') = 'object'
    AND octet_length(state::text) <= 33554432
  ),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
