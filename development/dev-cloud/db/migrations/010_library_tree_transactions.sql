CREATE TABLE library_scope_revisions (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'organization')),
  scope_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_id)
);

CREATE TABLE library_idempotency_keys (
  actor_key TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_key, operation_key)
);

ALTER TABLE library_folders ADD COLUMN original_name TEXT;
ALTER TABLE library_folders ADD COLUMN trashed_by_folder_id TEXT;
ALTER TABLE library_documents ADD COLUMN trashed_by_folder_id TEXT;
ALTER TABLE library_metadata_entries ADD COLUMN trashed_by_folder_id TEXT;

CREATE UNIQUE INDEX library_metadata_entries_active_title_idx
  ON library_metadata_entries (
    scope_type,
    scope_id,
    ifnull(folder_id, ''),
    normalized_title
  )
  WHERE status = 'active';
