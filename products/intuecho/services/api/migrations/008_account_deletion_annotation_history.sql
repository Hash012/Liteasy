-- Annotation history remains append-only during ordinary operation. Account
-- deletion may remove history only through a parent-row cascade, or anonymize
-- the attribution fields of history whose public parent was anonymized first.

ALTER TABLE annotation_versions
  DROP CONSTRAINT annotation_versions_annotation_id_fkey,
  ADD CONSTRAINT annotation_versions_annotation_id_fkey
    FOREIGN KEY (annotation_id) REFERENCES annotations(id) ON DELETE CASCADE;

ALTER TABLE annotation_reply_versions
  DROP CONSTRAINT annotation_reply_versions_reply_id_fkey,
  ADD CONSTRAINT annotation_reply_versions_reply_id_fkey
    FOREIGN KEY (reply_id) REFERENCES annotation_replies(id) ON DELETE CASCADE;

CREATE FUNCTION guard_annotation_version_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1
     AND NOT EXISTS (SELECT 1 FROM annotations WHERE id = OLD.annotation_id) THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.annotation_id IS NOT DISTINCT FROM OLD.annotation_id
     AND NEW.revision IS NOT DISTINCT FROM OLD.revision
     AND NEW.body IS NOT DISTINCT FROM OLD.body
     AND NEW.visibility IS NOT DISTINCT FROM OLD.visibility
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.share_to_plaza IS NOT DISTINCT FROM OLD.share_to_plaza
     AND NEW.targets IS NOT DISTINCT FROM OLD.targets
     AND NEW.tags IS NOT DISTINCT FROM OLD.tags
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND NEW.changed_by LIKE 'deleted:%'
     AND NEW.author_profile_snapshot = '{"educationStage":null,"institutions":[]}'::jsonb
     AND EXISTS (
       SELECT 1 FROM annotations
        WHERE id = OLD.annotation_id AND author_id = NEW.changed_by
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'annotation_versions_are_append_only';
END;
$$;

CREATE FUNCTION guard_annotation_reply_version_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1
     AND NOT EXISTS (SELECT 1 FROM annotation_replies WHERE id = OLD.reply_id) THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.id IS NOT DISTINCT FROM OLD.id
     AND NEW.reply_id IS NOT DISTINCT FROM OLD.reply_id
     AND NEW.revision IS NOT DISTINCT FROM OLD.revision
     AND NEW.body IS NOT DISTINCT FROM OLD.body
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND NEW.changed_by LIKE 'deleted:%'
     AND NEW.author_profile_snapshot = '{"educationStage":null,"institutions":[]}'::jsonb
     AND EXISTS (
       SELECT 1 FROM annotation_replies
        WHERE id = OLD.reply_id AND author_id = NEW.changed_by
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'annotation_reply_versions_are_append_only';
END;
$$;

DROP TRIGGER annotation_versions_append_only ON annotation_versions;
CREATE TRIGGER annotation_versions_append_only
BEFORE UPDATE OR DELETE ON annotation_versions
FOR EACH ROW EXECUTE FUNCTION guard_annotation_version_mutation();

DROP TRIGGER annotation_reply_versions_append_only ON annotation_reply_versions;
CREATE TRIGGER annotation_reply_versions_append_only
BEFORE UPDATE OR DELETE ON annotation_reply_versions
FOR EACH ROW EXECUTE FUNCTION guard_annotation_reply_version_mutation();
