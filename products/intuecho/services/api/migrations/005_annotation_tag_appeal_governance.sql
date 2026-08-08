CREATE UNIQUE INDEX annotation_tag_appeals_one_pending_idx
  ON annotation_tag_appeals(annotation_id, tag_id)
  WHERE status = 'pending';

ALTER TABLE annotation_tag_appeals
  ADD CONSTRAINT annotation_tag_appeals_resolution_reason_required CHECK (
    (status = 'pending' AND resolution_reason IS NULL) OR
    (status <> 'pending' AND length(btrim(resolution_reason)) BETWEEN 8 AND 2000)
  );

CREATE TABLE annotation_tag_appeal_audit (
  id text PRIMARY KEY,
  appeal_id text NOT NULL,
  annotation_id text NOT NULL,
  tag_id text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  admin_user_id text NOT NULL CHECK (length(admin_user_id) BETWEEN 1 AND 200),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 2000),
  trace_id text NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX annotation_tag_appeal_audit_appeal_idx
  ON annotation_tag_appeal_audit(appeal_id, created_at, id);

CREATE TRIGGER annotation_tag_appeal_audit_append_only
BEFORE UPDATE OR DELETE ON annotation_tag_appeal_audit
FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation();
