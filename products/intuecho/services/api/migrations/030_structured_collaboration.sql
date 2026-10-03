ALTER TABLE annotations ADD COLUMN collaboration jsonb CHECK(collaboration IS NULL OR (jsonb_typeof(collaboration) = 'object' AND collaboration->>'schemaVersion' = '1'));
ALTER TABLE annotation_replies ADD COLUMN collaboration jsonb CHECK(collaboration IS NULL OR (jsonb_typeof(collaboration) = 'object' AND collaboration->>'schemaVersion' = '1'));
ALTER TABLE annotation_versions ADD COLUMN collaboration jsonb;
ALTER TABLE annotation_reply_versions ADD COLUMN collaboration jsonb;
-- Deliberately do not infer kinds from legacy labels or Markdown text.
CREATE INDEX annotations_collaboration_kind_idx ON annotations(organization_id, (collaboration->>'kind'), created_at DESC) WHERE withdrawn_at IS NULL;
