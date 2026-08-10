CREATE TABLE literature_record_projections (
  literature_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(snapshot) = 'object'
    AND snapshot ->> 'literatureId' = literature_id
    AND (snapshot ->> 'revision')::bigint = revision
    AND snapshot ->> 'status' = 'confirmed'
  ),
  verified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (literature_id, revision)
);

CREATE OR REPLACE FUNCTION reject_literature_projection_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'literature_projection_is_append_only';
END;
$$;

CREATE TRIGGER literature_record_projections_append_only
BEFORE UPDATE OR DELETE ON literature_record_projections
FOR EACH ROW EXECUTE FUNCTION reject_literature_projection_mutation();
