CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  membership_tier TEXT NOT NULL DEFAULT 'pro'
    CHECK (membership_tier IN ('basic', 'pro')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE password_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'argon2id',
  updated_at TEXT NOT NULL
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  client_label TEXT
);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE INDEX projects_owner_user_id_idx ON projects(owner_user_id);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  artifact_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'generating', 'ready', 'failed', 'archived')),
  current_version INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX artifacts_owner_user_id_idx ON artifacts(owner_user_id);
CREATE INDEX artifacts_project_id_idx ON artifacts(project_id);
CREATE INDEX artifacts_type_idx ON artifacts(artifact_type);

CREATE TABLE artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  source_kind TEXT NOT NULL DEFAULT 'ai'
    CHECK (source_kind IN ('ai', 'user', 'import', 'system')),
  content_json TEXT
    CHECK (content_json IS NULL OR json_valid(content_json)),
  content_text TEXT,
  content_hash TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  UNIQUE (artifact_id, version),
  CHECK (content_json IS NOT NULL OR content_text IS NOT NULL)
);

CREATE INDEX artifact_versions_artifact_id_idx ON artifact_versions(artifact_id);

CREATE TABLE generation_runs (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  output_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  provider TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  input_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(input_json)),
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE INDEX generation_runs_owner_user_id_idx ON generation_runs(owner_user_id);
CREATE INDEX generation_runs_project_id_idx ON generation_runs(project_id);
CREATE INDEX generation_runs_status_idx ON generation_runs(status);

CREATE TABLE generation_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES generation_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  step_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  payload_json TEXT
    CHECK (payload_json IS NULL OR json_valid(payload_json)),
  error_json TEXT
    CHECK (error_json IS NULL OR json_valid(error_json)),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (run_id, sequence)
);

CREATE INDEX generation_steps_run_id_idx ON generation_steps(run_id);
