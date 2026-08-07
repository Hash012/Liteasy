CREATE TABLE platform_role_grants (
  grant_id text PRIMARY KEY,
  subject_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('platform_admin', 'developer_diagnostics')),
  state text NOT NULL CHECK (state IN ('pending_activation', 'active', 'revoked')),
  bootstrap boolean NOT NULL DEFAULT false,
  granted_by text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 1000),
  granted_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  revoked_by text,
  revoked_reason text,
  revoked_at timestamptz,
  CHECK (
    (state = 'pending_activation' AND activated_at IS NULL AND revoked_by IS NULL AND revoked_reason IS NULL AND revoked_at IS NULL) OR
    (state = 'active' AND activated_at IS NOT NULL AND revoked_by IS NULL AND revoked_reason IS NULL AND revoked_at IS NULL) OR
    (state = 'revoked' AND revoked_by IS NOT NULL AND revoked_reason IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX platform_role_grants_current_unique
  ON platform_role_grants(subject_id, role)
  WHERE state IN ('pending_activation', 'active');
CREATE INDEX platform_role_grants_subject_idx
  ON platform_role_grants(subject_id, state, role);

CREATE TABLE platform_support_access_grants (
  grant_id text PRIMARY KEY,
  grantee_subject text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('user', 'organization')),
  scope_id text NOT NULL,
  document_id text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 12 AND 1000),
  granted_by text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_by text,
  revoked_reason text,
  revoked_at timestamptz,
  CHECK (expires_at > granted_at),
  CHECK (
    (revoked_by IS NULL AND revoked_reason IS NULL AND revoked_at IS NULL) OR
    (revoked_by IS NOT NULL AND revoked_reason IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX platform_support_access_grants_active_idx
  ON platform_support_access_grants(grantee_subject, expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX platform_support_access_grants_document_idx
  ON platform_support_access_grants(document_id, expires_at);

CREATE FUNCTION validate_support_access_document() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM library_entries entry
     WHERE entry.document_id = NEW.document_id
       AND entry.scope_type = NEW.scope_type
       AND entry.scope_id = NEW.scope_id
       AND entry.entry_kind = 'pdf'
       AND entry.status = 'active'
       AND entry.availability = 'available'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'support_access_document_scope_invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_support_access_document_invariant
BEFORE INSERT OR UPDATE OF document_id, scope_type, scope_id ON platform_support_access_grants
FOR EACH ROW EXECUTE FUNCTION validate_support_access_document();

CREATE FUNCTION reject_audit_event_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'audit_events_are_append_only';
END;
$$;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();
