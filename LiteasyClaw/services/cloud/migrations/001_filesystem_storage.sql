CREATE TABLE library_scope_revisions (
  scope_type text NOT NULL CHECK (scope_type IN ('user', 'organization')),
  scope_id text NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_type, scope_id)
);

CREATE TABLE library_folders (
  folder_id text PRIMARY KEY,
  scope_type text NOT NULL CHECK (scope_type IN ('user', 'organization')),
  scope_id text NOT NULL,
  parent_folder_id text REFERENCES library_folders(folder_id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 255),
  normalized_name text NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 255),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trashed')),
  trashed_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'active' AND trashed_at IS NULL AND purge_after IS NULL) OR
         (status = 'trashed' AND trashed_at IS NOT NULL AND purge_after IS NOT NULL))
);

CREATE UNIQUE INDEX library_folders_active_name_unique
  ON library_folders(scope_type, scope_id, COALESCE(parent_folder_id, ''), normalized_name)
  WHERE status = 'active';
CREATE INDEX library_folders_scope_parent_idx
  ON library_folders(scope_type, scope_id, parent_folder_id, status);

CREATE TABLE library_entries (
  document_id text PRIMARY KEY,
  scope_type text NOT NULL CHECK (scope_type IN ('user', 'organization')),
  scope_id text NOT NULL,
  folder_id text REFERENCES library_folders(folder_id),
  entry_kind text NOT NULL CHECK (entry_kind IN ('pdf', 'metadata_only')),
  file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 255),
  normalized_name text NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 255),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 1000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  logical_bytes bigint NOT NULL DEFAULT 0 CHECK (logical_bytes >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trashed')),
  trashed_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((entry_kind = 'metadata_only' AND logical_bytes = 0) OR entry_kind = 'pdf'),
  CHECK ((status = 'active' AND trashed_at IS NULL AND purge_after IS NULL) OR
         (status = 'trashed' AND trashed_at IS NOT NULL AND purge_after IS NOT NULL))
);

CREATE UNIQUE INDEX library_entries_active_name_unique
  ON library_entries(scope_type, scope_id, COALESCE(folder_id, ''), normalized_name)
  WHERE status = 'active';
CREATE INDEX library_entries_scope_folder_idx
  ON library_entries(scope_type, scope_id, folder_id, status);
CREATE INDEX library_entries_metadata_gin_idx ON library_entries USING gin(metadata);

CREATE TABLE storage_objects (
  content_hash text PRIMARY KEY CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  storage_key text NOT NULL UNIQUE,
  media_type text NOT NULL DEFAULT 'application/pdf' CHECK (media_type = 'application/pdf'),
  checksum_verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE storage_object_references (
  document_id text PRIMARY KEY REFERENCES library_entries(document_id) ON DELETE CASCADE,
  content_hash text NOT NULL REFERENCES storage_objects(content_hash),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX storage_object_references_hash_idx ON storage_object_references(content_hash);

CREATE TABLE storage_quotas (
  scope_type text NOT NULL CHECK (scope_type IN ('user', 'organization')),
  scope_id text NOT NULL,
  limit_bytes bigint NOT NULL CHECK (limit_bytes >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_type, scope_id)
);

CREATE TABLE organization_storage_policies (
  organization_id text PRIMARY KEY,
  upload_policy text NOT NULL CHECK (upload_policy IN ('owner_admins', 'all_members')),
  export_policy text NOT NULL CHECK (export_policy IN ('disabled', 'admins_only', 'all_members')),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE team_annotations (
  annotation_id text PRIMARY KEY,
  organization_id text NOT NULL,
  document_id text NOT NULL REFERENCES library_entries(document_id) ON DELETE CASCADE,
  uploaded_by text NOT NULL,
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_annotations_document_idx ON team_annotations(organization_id, document_id);

CREATE TABLE idempotency_records (
  actor_id text NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_status integer NOT NULL CHECK (response_status BETWEEN 200 AND 599),
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (actor_id, operation, idempotency_key)
);
CREATE INDEX idempotency_records_expiry_idx ON idempotency_records(expires_at);

CREATE TABLE audit_events (
  audit_id text PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id text NOT NULL,
  actor_audience text NOT NULL CHECK (actor_audience IN ('liteasy-desktop', 'intuecho-web', 'liteasy-admin', 'service')),
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  scope_type text CHECK (scope_type IN ('user', 'organization')),
  scope_id text,
  reason text,
  trace_id text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object')
);
CREATE INDEX audit_events_time_idx ON audit_events(occurred_at, audit_id);
CREATE INDEX audit_events_resource_idx ON audit_events(resource_type, resource_id, occurred_at);

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
