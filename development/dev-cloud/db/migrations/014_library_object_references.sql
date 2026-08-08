CREATE TABLE storage_object_references (
  document_id TEXT PRIMARY KEY
    REFERENCES library_documents(document_id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL
    REFERENCES storage_objects(content_hash) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

INSERT INTO storage_object_references (document_id, content_hash, created_at)
SELECT document_id, content_hash, created_at
FROM library_documents;

CREATE INDEX storage_object_references_hash_idx
  ON storage_object_references(content_hash, document_id);

ALTER TABLE storage_objects ADD COLUMN media_type TEXT NOT NULL DEFAULT 'application/pdf';
ALTER TABLE library_documents ADD COLUMN doi TEXT;
ALTER TABLE library_documents ADD COLUMN external_url TEXT;
ALTER TABLE library_documents ADD COLUMN source_id TEXT;
ALTER TABLE library_documents ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(metadata_json));
