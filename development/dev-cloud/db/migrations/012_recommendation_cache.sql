CREATE TABLE recommendation_cache_entries (
  owner_key TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  recommendations_json TEXT NOT NULL CHECK (json_valid(recommendations_json)),
  cached_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, scope_key)
);

CREATE INDEX recommendation_cache_expiry_idx
  ON recommendation_cache_entries(expires_at);
