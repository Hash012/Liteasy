-- These references deliberately contain no annotation title, excerpt, or body.
CREATE TABLE community_preferences (
  user_id text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('thread', 'literature', 'organization', 'author')),
  target_id text NOT NULL,
  subscribed boolean NOT NULL DEFAULT false,
  muted boolean NOT NULL DEFAULT false,
  blocked boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_kind, target_id),
  CHECK (NOT blocked OR target_kind = 'author'),
  CHECK (NOT subscribed OR target_kind <> 'author')
);
CREATE TABLE community_notification_events (
  id text PRIMARY KEY,
  annotation_id text NOT NULL,
  reply_id text NOT NULL,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community_notifications (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES community_notification_events(id) ON DELETE CASCADE,
  recipient_id text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, recipient_id)
);
CREATE INDEX community_notifications_recipient_idx ON community_notifications(recipient_id, created_at DESC, id);
CREATE TABLE community_reports (
  id text PRIMARY KEY,
  annotation_id text NOT NULL,
  annotation_revision integer NOT NULL CHECK (annotation_revision > 0),
  audience text NOT NULL CHECK (audience IN ('private', 'organization', 'mutual_followers', 'public')),
  organization_id text,
  reporter_id text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('spam', 'harassment', 'privacy', 'other')),
  detail text NOT NULL CHECK (length(btrim(detail)) BETWEEN 8 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'dismissed')),
  resolution_reason text CHECK (resolution_reason IN ('reviewed', 'insufficient_evidence', 'duplicate', 'outside_scope')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK ((audience = 'organization') = (organization_id IS NOT NULL)),
  CHECK ((status = 'pending') = (resolved_at IS NULL)),
  CHECK ((status = 'pending') = (resolution_reason IS NULL))
);
CREATE UNIQUE INDEX community_reports_pending_idx ON community_reports(reporter_id, annotation_id, annotation_revision) WHERE status = 'pending';
CREATE INDEX community_reports_reporter_idx ON community_reports(reporter_id, created_at DESC);
CREATE TABLE community_report_audit (
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('submitted', 'resolved', 'dismissed')),
  report_id text NOT NULL,
  annotation_id text NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('spam', 'harassment', 'privacy', 'other', 'reviewed', 'insufficient_evidence', 'duplicate', 'outside_scope')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER community_report_audit_append_only BEFORE UPDATE OR DELETE ON community_report_audit
FOR EACH ROW EXECUTE FUNCTION reject_moderation_audit_mutation();
