-- A reply remains canonical thread content. Its annotation projection is optional
-- and moderation must keep an immutable link back to the projected reply.

ALTER TABLE annotation_replies
  ADD COLUMN moderated_at timestamptz,
  ADD COLUMN moderation_reason text,
  ADD COLUMN moderated_by text,
  ADD CONSTRAINT annotation_replies_moderation_state_check CHECK (
    (moderated_at IS NULL AND moderation_reason IS NULL AND moderated_by IS NULL) OR
    (
      moderated_at IS NOT NULL AND
      length(btrim(moderation_reason)) BETWEEN 3 AND 1000 AND
      length(btrim(moderated_by)) BETWEEN 1 AND 200
    )
  );

ALTER TABLE annotation_moderation_audit
  ADD COLUMN linked_reply_id text;

CREATE OR REPLACE FUNCTION validate_annotation_moderation_audit_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM annotations WHERE id = NEW.annotation_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'annotation_moderation_audit_annotation_not_found';
  END IF;
  IF NEW.linked_reply_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM annotation_replies
     WHERE id = NEW.linked_reply_id
       AND derived_annotation_id = NEW.annotation_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'annotation_moderation_audit_linked_reply_invalid';
  END IF;
  RETURN NEW;
END;
$$;
