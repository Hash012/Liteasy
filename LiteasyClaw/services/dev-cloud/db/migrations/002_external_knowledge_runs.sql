CREATE TABLE external_knowledge_runs (
  artifact_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  query TEXT NOT NULL,
  target_identity_kind TEXT,
  target_identity_value TEXT,
  target_paper_title TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'running', 'completed', 'skipped', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (artifact_id, request_key)
);

CREATE INDEX external_knowledge_runs_artifact_idx
  ON external_knowledge_runs (artifact_id, updated_at DESC);
