CREATE TABLE community_command_receipts (
  actor_id text NOT NULL,
  operation_type text NOT NULL CHECK(operation_type IN ('create_annotation', 'create_reply')),
  operation_id uuid NOT NULL,
  body_digest text NOT NULL CHECK(body_digest ~ '^[a-f0-9]{64}$'),
  resource_id text NOT NULL,
  target_id text,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id, operation_type, operation_id)
);
-- Resource identifiers remain as tombstone receipts after removal; no body snapshots.
