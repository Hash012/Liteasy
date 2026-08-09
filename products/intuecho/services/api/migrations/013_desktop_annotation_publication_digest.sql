ALTER TABLE desktop_annotation_publications
  ADD COLUMN operation_digest text NOT NULL DEFAULT repeat('0', 64)
    CHECK (operation_digest ~ '^[a-f0-9]{64}$');

ALTER TABLE desktop_annotation_publications
  ALTER COLUMN operation_digest DROP DEFAULT;
