CREATE TABLE desktop_annotation_publications (
  owner_id text NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
  queue_key text NOT NULL CHECK (length(queue_key) BETWEEN 1 AND 500),
  source_annotation_id text NOT NULL CHECK (length(source_annotation_id) BETWEEN 1 AND 200),
  annotation_id text NOT NULL UNIQUE REFERENCES annotations(id) ON DELETE CASCADE,
  source_revision bigint NOT NULL CHECK (source_revision > 0),
  source_updated_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('published', 'retracted')),
  remote_revision bigint NOT NULL CHECK (remote_revision > 0),
  synced_at timestamptz NOT NULL,
  PRIMARY KEY(owner_id, queue_key)
);
