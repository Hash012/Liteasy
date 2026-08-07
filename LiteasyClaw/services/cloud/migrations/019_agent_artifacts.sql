CREATE TABLE agent_artifacts (
  subject_id text NOT NULL,
  artifact_id text NOT NULL CHECK (artifact_id ~ '^[A-Za-z0-9._-]{1,120}$'),
  artifact_type text NOT NULL CHECK (
    artifact_type IN ('comparison_table', 'layered_graph', 'mindmap', 'ppt', 'thin_reading', 'tree')
  ),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  body jsonb NOT NULL CHECK (
    jsonb_typeof(body) = 'object' AND
    body->>'version' = 'liteasy.agent-artifact/v1' AND
    body->>'artifactId' = artifact_id
  ),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject_id, artifact_id)
);

CREATE INDEX agent_artifacts_subject_updated_idx
  ON agent_artifacts(subject_id, updated_at DESC, artifact_id);
