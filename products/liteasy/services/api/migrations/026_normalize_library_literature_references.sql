ALTER TABLE library_entries
  ADD COLUMN literature_id text,
  ADD COLUMN literature_revision bigint;

UPDATE library_entries AS entry
   SET literature_id = projection.literature_id,
       literature_revision = projection.revision,
       metadata = entry.metadata - 'literature'
  FROM literature_record_projections AS projection
 WHERE jsonb_typeof(entry.metadata -> 'literature') = 'object'
   AND entry.metadata -> 'literature' ->> 'literatureId' = projection.literature_id
   AND CASE
         WHEN (entry.metadata -> 'literature' ->> 'revision') ~ '^[1-9][0-9]*$'
           THEN (entry.metadata -> 'literature' ->> 'revision')::bigint
         ELSE NULL
       END = projection.revision
   AND entry.metadata -> 'literature' = projection.snapshot;

ALTER TABLE library_entries
  ADD CONSTRAINT library_entries_literature_reference_pair_check
    CHECK ((literature_id IS NULL) = (literature_revision IS NULL)),
  ADD CONSTRAINT library_entries_literature_projection_fk
    FOREIGN KEY (literature_id, literature_revision)
    REFERENCES literature_record_projections(literature_id, revision);

CREATE INDEX library_entries_literature_projection_idx
  ON library_entries(literature_id, literature_revision)
  WHERE literature_id IS NOT NULL;
