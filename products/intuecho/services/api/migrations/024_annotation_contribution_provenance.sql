-- Existing records have unknown authorship; do not infer human verification.
ALTER TABLE annotations ADD COLUMN contribution jsonb NOT NULL DEFAULT
  '{"purpose":"explanation","origin":"unspecified","review":"unreviewed","editedByUser":false}'::jsonb;
ALTER TABLE annotations ADD CONSTRAINT annotations_contribution_shape CHECK (
  jsonb_typeof(contribution) = 'object'
  AND contribution ?& ARRAY['purpose', 'origin', 'review', 'editedByUser']
  AND contribution->>'purpose' IN ('explanation', 'question', 'replication', 'curation')
  AND contribution->>'origin' IN ('unspecified', 'human', 'ai_assisted', 'ai_generated')
  AND contribution->>'review' IN ('unreviewed', 'source_checked')
  AND jsonb_typeof(contribution->'editedByUser') = 'boolean'
);
ALTER TABLE annotation_versions ADD COLUMN contribution jsonb NOT NULL DEFAULT
  '{"purpose":"explanation","origin":"unspecified","review":"unreviewed","editedByUser":false}'::jsonb;

ALTER TABLE annotation_versions ADD CONSTRAINT annotation_versions_contribution_shape CHECK (
  jsonb_typeof(contribution) = 'object'
  AND contribution ?& ARRAY['purpose', 'origin', 'review', 'editedByUser']
  AND contribution->>'purpose' IN ('explanation', 'question', 'replication', 'curation')
  AND contribution->>'origin' IN ('unspecified', 'human', 'ai_assisted', 'ai_generated')
  AND contribution->>'review' IN ('unreviewed', 'source_checked')
  AND jsonb_typeof(contribution->'editedByUser') = 'boolean'
);
