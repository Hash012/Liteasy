CREATE TABLE auth_sessions_mobile (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  client_label TEXT,
  audience TEXT NOT NULL DEFAULT 'liteasy-desktop'
    CHECK (audience IN ('liteasy-desktop', 'liteasy-mobile', 'intuecho-web', 'liteasy-admin')),
  mfa_verified_at TEXT
);
INSERT INTO auth_sessions_mobile SELECT id, user_id, token_hash, created_at, expires_at,
  last_seen_at, revoked_at, client_label, audience, mfa_verified_at FROM auth_sessions;
DROP TABLE auth_sessions;
ALTER TABLE auth_sessions_mobile RENAME TO auth_sessions;
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at);
