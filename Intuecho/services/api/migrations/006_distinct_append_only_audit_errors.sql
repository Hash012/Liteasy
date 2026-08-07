CREATE FUNCTION reject_annotation_moderation_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'annotation_moderation_audit_is_append_only';
END;
$$;

DROP TRIGGER annotation_moderation_audit_append_only ON annotation_moderation_audit;
CREATE TRIGGER annotation_moderation_audit_append_only
BEFORE UPDATE OR DELETE ON annotation_moderation_audit
FOR EACH ROW EXECUTE FUNCTION reject_annotation_moderation_audit_mutation();

CREATE FUNCTION reject_annotation_tag_appeal_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'annotation_tag_appeal_audit_is_append_only';
END;
$$;

DROP TRIGGER annotation_tag_appeal_audit_append_only ON annotation_tag_appeal_audit;
CREATE TRIGGER annotation_tag_appeal_audit_append_only
BEFORE UPDATE OR DELETE ON annotation_tag_appeal_audit
FOR EACH ROW EXECUTE FUNCTION reject_annotation_tag_appeal_audit_mutation();
