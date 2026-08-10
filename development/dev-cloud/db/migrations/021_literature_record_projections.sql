CREATE TABLE literature_record_projections (
  literature_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  snapshot_json TEXT NOT NULL CHECK (
    json_valid(snapshot_json)
    AND json_type(snapshot_json) = 'object'
    AND json_extract(snapshot_json, '$.literatureId') = literature_id
    AND json_extract(snapshot_json, '$.revision') = revision
    AND json_extract(snapshot_json, '$.status') = 'confirmed'
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY (literature_id, revision)
);

CREATE TRIGGER literature_record_projections_reject_update
BEFORE UPDATE ON literature_record_projections
BEGIN
  SELECT RAISE(ABORT, 'literature_projection_is_append_only');
END;

CREATE TRIGGER literature_record_projections_reject_delete
BEFORE DELETE ON literature_record_projections
BEGIN
  SELECT RAISE(ABORT, 'literature_projection_is_append_only');
END;
