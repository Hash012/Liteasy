ALTER TABLE community_notification_events
  ALTER COLUMN reply_id DROP NOT NULL,
  ADD COLUMN kind text NOT NULL DEFAULT 'reply' CHECK (kind IN ('reply', 'mention', 'reading_task', 'report_result', 'tag_appeal_result', 'moderation')),
  ADD COLUMN source_id text,
  ADD COLUMN target_subject_id text;
UPDATE community_notification_events SET source_id = reply_id;
ALTER TABLE community_notification_events ALTER COLUMN source_id SET NOT NULL;
ALTER TABLE community_notification_events ADD CONSTRAINT community_notification_event_source_check CHECK (
  (kind IN ('reply', 'mention') AND reply_id IS NOT NULL AND reply_id = source_id)
  OR (kind NOT IN ('reply', 'mention') AND reply_id IS NULL)
);
ALTER TABLE community_notification_events ADD CONSTRAINT community_notification_event_target_check CHECK (
  (kind IN ('reply', 'reading_task') AND target_subject_id IS NULL)
  OR (kind IN ('mention', 'report_result', 'tag_appeal_result', 'moderation') AND target_subject_id IS NOT NULL)
);
