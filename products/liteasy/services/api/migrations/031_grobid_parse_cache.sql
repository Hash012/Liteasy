CREATE TABLE grobid_parse_cache (
  content_fingerprint text PRIMARY KEY CHECK (content_fingerprint ~ '^[a-f0-9]{64}$'),
  parser_version integer NOT NULL CHECK (parser_version > 0),
  tei_xml text NOT NULL CHECK (length(tei_xml) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX grobid_parse_cache_updated_idx
  ON grobid_parse_cache(updated_at DESC, content_fingerprint);
