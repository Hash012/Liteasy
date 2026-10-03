-- Preserve existing labels and appeal/audit rows. Legacy assignments have unknown provenance.
ALTER TABLE annotation_tags ADD COLUMN source_scope jsonb;
CREATE INDEX annotations_platform_tag_scope_idx ON annotations(visibility, organization_id, author_id, updated_at DESC) WHERE withdrawn_at IS NULL;
