-- Lifecycle indexes for provider-scoped, immutable visualization cost policies.
-- Migration 021 owns the versioned primary key and its data-integrity checks.

CREATE INDEX IF NOT EXISTS visualization_cost_policies_lookup_idx
  ON visualization_cost_policies(
    modality, operation, data_class, provider_id, enabled, revision DESC
  );

CREATE INDEX IF NOT EXISTS visualization_cost_policies_provider_idx
  ON visualization_cost_policies(provider_id, enabled, revision DESC);
