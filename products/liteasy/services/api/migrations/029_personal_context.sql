CREATE TABLE context_entries (
  entry_id uuid PRIMARY KEY,
  subject_id text NOT NULL,
  scope_key text NOT NULL CHECK (scope_key ~ '^(personal|project/[a-z0-9][a-z0-9-]{0,63})$'),
  revision bigint NOT NULL CHECK (revision > 0),
  content jsonb,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK ((deleted_at IS NULL AND content IS NOT NULL) OR (deleted_at IS NOT NULL AND content IS NULL))
);
CREATE INDEX context_entries_owner_updated ON context_entries(subject_id, updated_at DESC, entry_id DESC) WHERE deleted_at IS NULL;
CREATE INDEX context_entries_owner_scope ON context_entries(subject_id, scope_key) WHERE deleted_at IS NULL;

CREATE TABLE context_revisions (
  entry_id uuid NOT NULL REFERENCES context_entries(entry_id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision > 0),
  content jsonb NOT NULL,
  actor text NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, revision)
);

-- Receipts never contain entry text or the submitted request body.
CREATE TABLE context_operations (
  subject_id text NOT NULL,
  operation_id uuid NOT NULL,
  request_hash char(64) NOT NULL,
  entry_id uuid NOT NULL REFERENCES context_entries(entry_id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision > 0),
  scope_key text NOT NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  committed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (subject_id, operation_id)
);
CREATE INDEX context_operations_expiry ON context_operations(expires_at);

CREATE TABLE context_grants (
  grant_id uuid PRIMARY KEY,
  subject_id text NOT NULL,
  name text NOT NULL,
  secret_hash char(64) NOT NULL UNIQUE,
  read_scopes jsonb NOT NULL,
  write_scopes jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz
);
CREATE INDEX context_grants_owner ON context_grants(subject_id, created_at DESC);
