CREATE TABLE works (
  id TEXT PRIMARY KEY,
  title TEXT,
  year INTEGER,
  type TEXT,
  canonical_provider TEXT,
  canonical_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX works_canonical_idx ON works(canonical_provider, canonical_id);

CREATE TABLE work_identifiers (
  work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  identifier_kind TEXT NOT NULL
    CHECK (identifier_kind IN (
      'doi',
      'arxiv',
      'semantic_scholar',
      'openalex',
      'crossref',
      'local',
      'title_authors_year_hash'
    )),
  identifier_value TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'same_as'
    CHECK (relation IN ('same_as', 'is_version_of', 'has_version', 'is_preprint_of')),
  source_provider TEXT,
  verified INTEGER NOT NULL DEFAULT 0
    CHECK (verified IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (identifier_kind, identifier_value)
);

CREATE INDEX work_identifiers_work_idx ON work_identifiers(work_id);

CREATE TABLE citation_edges (
  source_work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  target_work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL
    CHECK (relation_type IN ('cites', 'cited_by', 'related', 'is_version_of')),
  source_provider TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0
    CHECK (verified IN (0, 1)),
  weight REAL NOT NULL DEFAULT 1,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (source_work_id, target_work_id, relation_type)
);

CREATE INDEX citation_edges_target_idx ON citation_edges(target_work_id, relation_type);
