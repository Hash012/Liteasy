CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  normalized TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'extracted'
    CHECK (source IN ('extracted', 'recommended', 'explicit')),
  source_kind TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 0
    CHECK (occurrence_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX tags_normalized_idx ON tags(normalized);
CREATE INDEX tags_occurrence_idx ON tags(occurrence_count DESC);

CREATE TABLE paper_tags (
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'title'
    CHECK (source IN ('title', 'abstract')),
  weight REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  PRIMARY KEY (work_id, tag_id)
);

CREATE INDEX paper_tags_tag_idx ON paper_tags(tag_id);
CREATE INDEX paper_tags_work_idx ON paper_tags(work_id);
