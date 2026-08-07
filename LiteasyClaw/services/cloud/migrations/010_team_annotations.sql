ALTER TABLE team_annotations
  ADD CONSTRAINT team_annotations_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM team_annotations annotation
      JOIN library_entries entry ON entry.document_id = annotation.document_id
     WHERE entry.scope_type <> 'organization' OR entry.scope_id <> annotation.organization_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'annotation_document_scope_mismatch';
  END IF;
END;
$$;

CREATE FUNCTION validate_team_annotation_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_scope_type text;
  target_scope_id text;
BEGIN
  SELECT scope_type, scope_id
    INTO target_scope_type, target_scope_id
    FROM library_entries
   WHERE document_id = NEW.document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'annotation_document_missing';
  END IF;
  IF target_scope_type <> 'organization' OR target_scope_id <> NEW.organization_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'annotation_document_scope_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER team_annotations_scope_invariant
BEFORE INSERT OR UPDATE OF organization_id, document_id ON team_annotations
FOR EACH ROW EXECUTE FUNCTION validate_team_annotation_scope();
