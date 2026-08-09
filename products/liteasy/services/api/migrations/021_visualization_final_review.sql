-- Final-review hardening keeps the original 020 migration immutable while
-- pinning weighted pricing and binding provider/accounting records.

CREATE TABLE visualization_cost_policies (
  modality text NOT NULL CHECK (length(btrim(modality)) BETWEEN 1 AND 80),
  operation text NOT NULL CHECK (operation IN ('structured_generation','image_generation','validation')),
  data_class text NOT NULL CHECK (length(btrim(data_class)) BETWEEN 1 AND 80),
  provider_id text NOT NULL CHECK (length(btrim(provider_id)) BETWEEN 1 AND 120),
  unit_cost integer NOT NULL CHECK (unit_cost > 0),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  enabled boolean NOT NULL DEFAULT true,
  updated_by text NOT NULL CHECK (length(btrim(updated_by)) BETWEEN 1 AND 160),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (modality, operation, data_class, provider_id, revision)
);

CREATE INDEX visualization_cost_policies_revision_idx
  ON visualization_cost_policies(revision, enabled, modality, operation, data_class, provider_id);

INSERT INTO visualization_cost_policies(modality, operation, data_class, provider_id, unit_cost, revision, updated_by, reason)
SELECT modality, operation, 'paper', route.provider_id,
       CASE operation WHEN 'image_generation' THEN 4 ELSE 1 END,
       1, 'system', 'Initial versioned visualization cost policy'
  FROM (VALUES
    ('semantic_graph'), ('circuit'), ('physics_diagram'), ('biology_structure'),
    ('geometry_2d'), ('function_plot'), ('geometry_3d'), ('physics_process'),
    ('reaction_process'), ('raster_illustration')
  ) AS modalities(modality)
 CROSS JOIN (VALUES ('structured_generation'), ('image_generation'), ('validation')) AS operations(operation)
 CROSS JOIN (SELECT DISTINCT provider_id FROM visualization_provider_configs) AS route
ON CONFLICT (modality, operation, data_class, provider_id, revision) DO NOTHING;

ALTER TABLE visualization_quota_reservations
  ADD COLUMN IF NOT EXISTS requested_by text NOT NULL DEFAULT 'automatic'
    CHECK (requested_by IN ('automatic','explicit')),
  ADD COLUMN IF NOT EXISTS cost_table_revision bigint NOT NULL DEFAULT 1
    CHECK (cost_table_revision > 0);

ALTER TABLE visualization_provider_invocations
  ADD COLUMN IF NOT EXISTS response_max_bytes integer NOT NULL DEFAULT 2097152
    CHECK (response_max_bytes > 0),
  ADD COLUMN IF NOT EXISTS data_class text,
  ADD COLUMN IF NOT EXISTS modality text;

ALTER TABLE visualization_artifacts
  ADD COLUMN IF NOT EXISTS reservation_id text;

CREATE INDEX IF NOT EXISTS visualization_artifacts_reservation_idx
  ON visualization_artifacts(reservation_id, subject_id);

-- Replace the generated checks from 020 by named, independent constraints.
-- Keep the event-type whitelist while allowing a zero-delta full settlement.
DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'visualization_usage_ledger'::regclass
       AND contype = 'c'
       AND (pg_get_constraintdef(oid) ILIKE '%event_type%' OR pg_get_constraintdef(oid) ILIKE '%cache_reuse%')
  LOOP
    EXECUTE format('ALTER TABLE visualization_usage_ledger DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END
$$;

ALTER TABLE visualization_usage_ledger
  ADD CONSTRAINT visualization_usage_ledger_event_type_check CHECK (
    event_type IN ('reserved','settled','rollback','expired','adjustment','cache_reuse')
  ),
  ADD CONSTRAINT visualization_usage_ledger_units_delta_state_check CHECK (
    event_type IN ('cache_reuse','settled') OR units_delta <> 0 OR event_type = 'reserved'
  );
