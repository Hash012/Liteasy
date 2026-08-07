CREATE TABLE account_deletion_jobs (
  subject_id text PRIMARY KEY,
  operation_id text NOT NULL UNIQUE,
  anonymized_author_id text NOT NULL UNIQUE,
  requested_by text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 1000),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_lifecycle_audit (
  event_id text PRIMARY KEY,
  operation_id text NOT NULL,
  action text NOT NULL CHECK (action = 'forum_account_data_deleted'),
  subject_id text NOT NULL,
  requested_by text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 1000),
  trace_id text NOT NULL,
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_lifecycle_audit_subject_idx
  ON account_lifecycle_audit(subject_id, created_at DESC, event_id);

CREATE FUNCTION reject_account_lifecycle_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'account_lifecycle_audit_is_append_only';
END;
$$;

CREATE TRIGGER account_lifecycle_audit_append_only
BEFORE UPDATE OR DELETE ON account_lifecycle_audit
FOR EACH ROW EXECUTE FUNCTION reject_account_lifecycle_audit_mutation();
