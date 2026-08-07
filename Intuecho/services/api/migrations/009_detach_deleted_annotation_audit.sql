-- Moderation evidence keeps the original annotation id after account deletion.
-- New audit rows still require a live annotation, while the append-only trigger
-- continues to reject any later update or deletion of the audit event.

ALTER TABLE annotation_moderation_audit
  DROP CONSTRAINT annotation_moderation_audit_annotation_id_fkey;

CREATE FUNCTION validate_annotation_moderation_audit_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM annotations WHERE id = NEW.annotation_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'annotation_moderation_audit_annotation_not_found';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER annotation_moderation_audit_reference_guard
BEFORE INSERT ON annotation_moderation_audit
FOR EACH ROW EXECUTE FUNCTION validate_annotation_moderation_audit_reference();
