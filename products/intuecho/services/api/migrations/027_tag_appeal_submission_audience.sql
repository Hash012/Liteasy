-- Historical reasons have no proven submission audience. Keep NULL rather than
-- interpreting an annotation's current public visibility as consent for them.
ALTER TABLE annotation_tag_appeals
  ADD COLUMN submitted_visibility text,
  ADD COLUMN submitted_organization_id text,
  ADD COLUMN submitted_revision bigint,
  ADD CONSTRAINT annotation_tag_appeals_submission_audience_check CHECK (
    (submitted_visibility IS NULL AND submitted_organization_id IS NULL AND submitted_revision IS NULL)
    OR (
      submitted_visibility IN ('private', 'organization', 'mutual_followers', 'public')
      AND submitted_revision > 0
      AND ((submitted_visibility = 'organization') = (submitted_organization_id IS NOT NULL))
    )
  );
