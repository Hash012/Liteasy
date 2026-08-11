CREATE TABLE literature_source_artifacts (
  artifact_hash text PRIMARY KEY CHECK (artifact_hash ~ '^sha256:[a-f0-9]{64}$'),
  artifact_url text NOT NULL CHECK (artifact_url ~ '^https://proceedings\.mlr\.press/'),
  media_type text NOT NULL CHECK (media_type = 'application/x-bibtex'),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 20971520),
  byte_length integer NOT NULL CHECK (byte_length = octet_length(content)),
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reject_literature_source_artifact_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'literature_source_artifact_is_append_only';
END;
$$;

CREATE TRIGGER literature_source_artifacts_append_only
BEFORE UPDATE OR DELETE ON literature_source_artifacts
FOR EACH ROW EXECUTE FUNCTION reject_literature_source_artifact_mutation();
