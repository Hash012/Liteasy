-- Migration 014 introduced the validated metadata_json column. Keep that immutable
-- history and add the lookup needed by literature-aware document hydration here.
ALTER TABLE library_idempotency_keys ADD COLUMN request_hash TEXT
  CHECK (request_hash IS NULL OR length(request_hash) = 64);

CREATE INDEX IF NOT EXISTS library_documents_literature_id_idx
  ON library_documents(json_extract(metadata_json, '$.literature.literatureId'))
  WHERE json_extract(metadata_json, '$.literature.literatureId') IS NOT NULL;
