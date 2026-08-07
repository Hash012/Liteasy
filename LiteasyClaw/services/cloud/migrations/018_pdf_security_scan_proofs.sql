ALTER TABLE storage_objects
  ADD COLUMN security_scanned_at timestamptz,
  ADD COLUMN security_scanner text,
  ADD COLUMN security_scanner_version text,
  ADD COLUMN security_scan_hash text;

ALTER TABLE storage_objects
  ADD CONSTRAINT storage_objects_security_scan_proof_valid CHECK (
    (
      security_scanned_at IS NULL AND security_scanner IS NULL AND
      security_scanner_version IS NULL AND security_scan_hash IS NULL
    ) OR (
      security_scanned_at IS NOT NULL AND
      security_scanner ~ '^[A-Za-z0-9][A-Za-z0-9._:/+ -]{0,99}$' AND
      security_scanner_version ~ '^[A-Za-z0-9][A-Za-z0-9._:/+ -]{0,99}$' AND
      security_scan_hash = content_hash
    )
  );

CREATE INDEX storage_objects_unscanned_pdf_idx
  ON storage_objects(created_at, content_hash)
  WHERE status = 'available' AND security_scanned_at IS NULL;

ALTER TABLE storage_publish_workflows
  ADD COLUMN security_scanned_at timestamptz,
  ADD COLUMN security_scanner text,
  ADD COLUMN security_scanner_version text,
  ADD COLUMN security_scan_hash text;

ALTER TABLE storage_publish_workflows
  ADD CONSTRAINT storage_publish_workflows_security_scan_proof_valid CHECK (
    (
      security_scanned_at IS NULL AND security_scanner IS NULL AND
      security_scanner_version IS NULL AND security_scan_hash IS NULL
    ) OR (
      security_scanned_at IS NOT NULL AND
      security_scanner ~ '^[A-Za-z0-9][A-Za-z0-9._:/+ -]{0,99}$' AND
      security_scanner_version ~ '^[A-Za-z0-9][A-Za-z0-9._:/+ -]{0,99}$' AND
      security_scan_hash = content_hash
    )
  );
