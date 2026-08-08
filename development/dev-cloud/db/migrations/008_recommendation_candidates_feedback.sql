-- M6: 推荐候选池与反馈从 JSON 整文件重写迁移到 SQLite，候选携带 surfacing tag 溯源。
CREATE TABLE recommendation_candidates (
  owner_key TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  last_discovered_at TEXT NOT NULL,
  document_json TEXT NOT NULL CHECK (json_valid(document_json)),
  PRIMARY KEY (owner_key, canonical_id)
);

CREATE INDEX recommendation_candidates_owner_idx
  ON recommendation_candidates(owner_key, last_discovered_at DESC);

CREATE TABLE recommendation_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_key TEXT NOT NULL,
  feedback_key TEXT NOT NULL,
  canonical_id TEXT,
  candidate_id TEXT,
  action TEXT NOT NULL,
  source TEXT,
  title TEXT,
  context_json TEXT CHECK (context_json IS NULL OR json_valid(context_json)),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (owner_key, feedback_key)
);

CREATE INDEX recommendation_feedback_owner_idx
  ON recommendation_feedback(owner_key, created_at DESC);
CREATE INDEX recommendation_feedback_canonical_idx
  ON recommendation_feedback(owner_key, canonical_id);
