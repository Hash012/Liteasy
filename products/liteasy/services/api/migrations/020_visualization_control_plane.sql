-- Visualization generation is an API-owned control plane. Identity subjects are
-- deliberately represented as opaque text because identity lifecycle remains in
-- the identity service and uses a separate database.

CREATE TABLE visualization_provider_configs (
  route_id text PRIMARY KEY CHECK (route_id ~ '^[A-Za-z0-9._:-]{1,120}$'),
  provider_id text NOT NULL CHECK (provider_id ~ '^[A-Za-z0-9._:-]{1,120}$'),
  endpoint text NOT NULL CHECK (endpoint ~ '^https://[^[:space:]]+$'),
  model text NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 160),
  secret_ref text NOT NULL CHECK (secret_ref ~ '^viz-secret:[a-z0-9._-]{1,80}$'),
  operations jsonb NOT NULL CHECK (
    jsonb_typeof(operations) = 'array' AND
    operations <@ '["structured_generation","image_generation","validation"]'::jsonb
  ),
  modalities jsonb NOT NULL CHECK (
    jsonb_typeof(modalities) = 'array' AND
    modalities <@ '["semantic_graph","circuit","physics_diagram","biology_structure","geometry_2d","function_plot","geometry_3d","physics_process","reaction_process","raster_illustration"]'::jsonb
  ),
  data_classes jsonb NOT NULL DEFAULT '["paper"]'::jsonb CHECK (jsonb_typeof(data_classes) = 'array'),
  region text NOT NULL CHECK (length(btrim(region)) BETWEEN 1 AND 80),
  priority integer NOT NULL DEFAULT 100 CHECK (priority >= 0),
  timeout_ms integer NOT NULL DEFAULT 30000 CHECK (timeout_ms BETWEEN 100 AND 300000),
  max_concurrency integer NOT NULL DEFAULT 1 CHECK (max_concurrency > 0),
  enabled boolean NOT NULL DEFAULT false,
  circuit_state text NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed','open','half_open')),
  circuit_failures integer NOT NULL DEFAULT 0 CHECK (circuit_failures >= 0),
  circuit_open_until timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((circuit_state = 'open' AND circuit_open_until IS NOT NULL) OR circuit_state <> 'open')
);

CREATE INDEX visualization_provider_routes_idx
  ON visualization_provider_configs(enabled, circuit_state, priority, route_id);
CREATE INDEX visualization_provider_modalities_idx
  ON visualization_provider_configs USING gin (modalities);

CREATE TABLE visualization_entitlements (
  subject_id text PRIMARY KEY,
  allowed boolean NOT NULL DEFAULT false,
  explicit_requests_allowed boolean NOT NULL DEFAULT false,
  allowed_modalities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(allowed_modalities) = 'array'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  granted_by text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (granted_by IS NULL OR length(btrim(granted_by)) BETWEEN 1 AND 160),
  CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 8 AND 1000)
);

CREATE TABLE visualization_user_preferences (
  subject_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE visualization_quota_policies (
  subject_id text PRIMARY KEY,
  daily_units integer NOT NULL CHECK (daily_units >= 0),
  monthly_units integer NOT NULL CHECK (monthly_units >= 0),
  max_concurrency integer NOT NULL CHECK (max_concurrency > 0),
  timezone text NOT NULL DEFAULT 'UTC',
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (timezone ~ '^[A-Za-z0-9_+./-]{1,80}$')
);

CREATE TABLE visualization_quota_reservations (
  reservation_id text PRIMARY KEY CHECK (reservation_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  subject_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
  modality text NOT NULL CHECK (length(btrim(modality)) BETWEEN 1 AND 80),
  route_id text NOT NULL,
  route_revision bigint NOT NULL CHECK (route_revision > 0),
  policy_revision bigint NOT NULL CHECK (policy_revision > 0),
  reserved_units integer NOT NULL CHECK (reserved_units > 0),
  settled_units integer CHECK (settled_units >= 0 AND settled_units <= reserved_units),
  state text NOT NULL CHECK (state IN ('reserved','settled','rolled_back','expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_id, idempotency_key),
  CHECK ((state = 'reserved' AND settled_units IS NULL) OR (state = 'settled' AND settled_units IS NOT NULL) OR state IN ('rolled_back','expired'))
);

CREATE INDEX visualization_quota_reservations_active_idx
  ON visualization_quota_reservations(subject_id, expires_at)
  WHERE state = 'reserved';
CREATE INDEX visualization_quota_reservations_route_idx
  ON visualization_quota_reservations(route_id, state, expires_at);

CREATE TABLE visualization_provider_invocations (
  invocation_id text PRIMARY KEY CHECK (invocation_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  reservation_id text NOT NULL,
  subject_id text NOT NULL,
  route_id text NOT NULL,
  route_revision bigint NOT NULL CHECK (route_revision > 0),
  idempotency_key text NOT NULL,
  provider_request_id text NOT NULL CHECK (length(btrim(provider_request_id)) BETWEEN 1 AND 240),
  operation text NOT NULL CHECK (operation IN ('structured_generation','image_generation','validation')),
  state text NOT NULL CHECK (state IN ('started','succeeded','failed','cancelled','timed_out')),
  provider_units integer NOT NULL DEFAULT 0 CHECK (provider_units >= 0),
  response_hash text CHECK (response_hash IS NULL OR response_hash ~ '^[a-f0-9]{64}$'),
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (route_id, provider_request_id),
  UNIQUE (reservation_id, idempotency_key),
  CHECK ((state = 'started' AND completed_at IS NULL) OR (state <> 'started' AND completed_at IS NOT NULL))
);

CREATE INDEX visualization_provider_invocations_reservation_idx
  ON visualization_provider_invocations(reservation_id, started_at DESC);
CREATE INDEX visualization_provider_invocations_route_health_idx
  ON visualization_provider_invocations(route_id, state, started_at DESC);

CREATE TABLE visualization_usage_ledger (
  event_id text PRIMARY KEY CHECK (event_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  subject_id text NOT NULL,
  reservation_id text,
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{8,200}$'),
  event_type text NOT NULL CHECK (event_type IN ('reserved','settled','rollback','expired','adjustment','cache_reuse')),
  units_delta integer NOT NULL,
  units_before integer CHECK (units_before IS NULL OR units_before >= 0),
  units_after integer CHECK (units_after IS NULL OR units_after >= 0),
  policy_revision bigint CHECK (policy_revision IS NULL OR policy_revision > 0),
  cost_table_revision bigint CHECK (cost_table_revision IS NULL OR cost_table_revision > 0),
  reason_code text,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_id, idempotency_key),
  CHECK (event_type = 'cache_reuse' OR units_delta <> 0 OR event_type = 'reserved'),
  CHECK (units_after IS NULL OR units_before IS NULL OR units_after = units_before + units_delta)
);

CREATE INDEX visualization_usage_ledger_subject_window_idx
  ON visualization_usage_ledger(subject_id, created_at DESC, event_type);
CREATE INDEX visualization_usage_ledger_reservation_idx
  ON visualization_usage_ledger(reservation_id, created_at);

CREATE TABLE visualization_provider_cost_ledger (
  cost_event_id text PRIMARY KEY CHECK (cost_event_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  invocation_id text NOT NULL,
  route_id text NOT NULL,
  provider_id text NOT NULL,
  provider_request_id text NOT NULL,
  amount numeric(18,8) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  units integer NOT NULL DEFAULT 0 CHECK (units >= 0),
  reason_code text NOT NULL CHECK (length(btrim(reason_code)) BETWEEN 1 AND 120),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invocation_id, provider_request_id)
);

CREATE INDEX visualization_provider_cost_ledger_route_idx
  ON visualization_provider_cost_ledger(route_id, created_at DESC);

CREATE TABLE visualization_artifacts (
  subject_id text NOT NULL,
  artifact_id text NOT NULL CHECK (artifact_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  document_id text NOT NULL,
  node_id text,
  modality text NOT NULL CHECK (length(btrim(modality)) BETWEEN 1 AND 80),
  state text NOT NULL CHECK (state IN ('ready','degraded','pending_revalidation','hidden')),
  spec_hash text NOT NULL CHECK (spec_hash ~ '^[a-f0-9]{64}$'),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  content_hash text CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  validation jsonb NOT NULL CHECK (jsonb_typeof(validation) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, artifact_id)
);

CREATE INDEX visualization_artifacts_node_lookup_idx
  ON visualization_artifacts(subject_id, document_id, node_id, updated_at DESC);
CREATE INDEX visualization_artifacts_revalidation_idx
  ON visualization_artifacts(state, updated_at)
  WHERE state = 'pending_revalidation';

CREATE FUNCTION reject_visualization_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'visualization_ledger_is_append_only';
END;
$$;

CREATE TRIGGER visualization_usage_ledger_append_only
BEFORE UPDATE OR DELETE ON visualization_usage_ledger
FOR EACH ROW EXECUTE FUNCTION reject_visualization_ledger_mutation();

CREATE TRIGGER visualization_provider_cost_ledger_append_only
BEFORE UPDATE OR DELETE ON visualization_provider_cost_ledger
FOR EACH ROW EXECUTE FUNCTION reject_visualization_ledger_mutation();
