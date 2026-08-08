CREATE TABLE platform_retrieval_sources (
  source_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('website', 'database')),
  base_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX platform_retrieval_sources_name_idx
  ON platform_retrieval_sources(name COLLATE NOCASE);

CREATE TABLE platform_runtime_settings (
  setting_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
