ALTER TABLE external_knowledge_runs RENAME TO external_knowledge_runs_legacy;

CREATE TABLE external_knowledge_runs (
  owner_scope TEXT NOT NULL,
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
  PRIMARY KEY (owner_scope, artifact_id, request_key)
);

INSERT INTO external_knowledge_runs (
  owner_scope, artifact_id, request_key, query, target_identity_kind,
  target_identity_value, target_paper_title, status, attempts, payload_json,
  error_code, error_message, created_at, updated_at, completed_at
)
SELECT
  'legacy', artifact_id, request_key, query, target_identity_kind,
  target_identity_value, target_paper_title, status, attempts, payload_json,
  error_code, error_message, created_at, updated_at, completed_at
FROM external_knowledge_runs_legacy;

DROP TABLE external_knowledge_runs_legacy;

CREATE INDEX external_knowledge_runs_owner_artifact_idx
  ON external_knowledge_runs (owner_scope, artifact_id, updated_at DESC);
