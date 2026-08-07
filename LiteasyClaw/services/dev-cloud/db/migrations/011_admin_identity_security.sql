ALTER TABLE auth_sessions ADD COLUMN audience TEXT NOT NULL DEFAULT 'liteasy-desktop'
  CHECK (audience IN ('liteasy-desktop', 'intuecho-web', 'liteasy-admin'));
ALTER TABLE auth_sessions ADD COLUMN mfa_verified_at TEXT;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0
  CHECK (must_change_password IN (0, 1));

CREATE TABLE user_mfa_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_salt TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  enrolled_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE platform_audit_events (
  event_id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
  reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  occurred_at TEXT NOT NULL
);

CREATE INDEX platform_audit_events_time_idx
  ON platform_audit_events(occurred_at DESC, event_id);

CREATE TABLE platform_support_access_grants (
  grant_id TEXT PRIMARY KEY,
  grantee_user_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'organization')),
  scope_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
