CREATE TABLE IF NOT EXISTS grobid_parse_cache (
  content_fingerprint TEXT PRIMARY KEY,
  parser_version INTEGER NOT NULL,
  tei_xml TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

