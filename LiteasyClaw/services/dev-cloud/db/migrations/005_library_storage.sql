CREATE TABLE storage_quotas (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'organization')),
  scope_id TEXT NOT NULL,
  limit_bytes INTEGER NOT NULL CHECK (limit_bytes >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_id)
);

CREATE TABLE storage_objects (
  content_hash TEXT PRIMARY KEY,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  storage_key TEXT NOT NULL UNIQUE,
  reference_count INTEGER NOT NULL CHECK (reference_count > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE library_folders (
  folder_id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'organization')),
  scope_id TEXT NOT NULL,
  parent_folder_id TEXT REFERENCES library_folders(folder_id),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (scope_type, scope_id, parent_folder_id, normalized_name)
);

CREATE UNIQUE INDEX library_folders_scope_name_idx
  ON library_folders (scope_type, scope_id, ifnull(parent_folder_id, ''), normalized_name);

CREATE TABLE library_documents (
  document_id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'organization')),
  scope_id TEXT NOT NULL,
  folder_id TEXT REFERENCES library_folders(folder_id),
  content_hash TEXT NOT NULL REFERENCES storage_objects(content_hash),
  file_name TEXT NOT NULL,
  normalized_file_name TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  uploaded_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'trashed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  trashed_at TEXT,
  purge_after TEXT
);

CREATE INDEX library_documents_scope_idx
  ON library_documents (scope_type, scope_id, status, folder_id, updated_at DESC);
CREATE INDEX library_documents_hash_idx
  ON library_documents (scope_type, scope_id, content_hash);
CREATE UNIQUE INDEX library_documents_active_name_idx
  ON library_documents (scope_type, scope_id, ifnull(folder_id, ''), normalized_file_name)
  WHERE status = 'active';

CREATE TABLE team_annotations (
  annotation_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  document_id TEXT NOT NULL REFERENCES library_documents(document_id) ON DELETE CASCADE,
  uploaded_by TEXT NOT NULL,
  body_json TEXT NOT NULL CHECK (json_valid(body_json)),
  status TEXT NOT NULL CHECK (status IN ('active', 'withdrawn')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  withdrawn_at TEXT
);

CREATE INDEX team_annotations_document_idx
  ON team_annotations (organization_id, document_id, status, updated_at DESC);
