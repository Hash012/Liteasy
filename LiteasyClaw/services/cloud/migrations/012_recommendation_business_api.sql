ALTER TABLE recommendation_candidates
  DROP CONSTRAINT recommendation_candidates_pkey;

ALTER TABLE recommendation_candidates
  ADD PRIMARY KEY (subject_id, candidate_id);

CREATE INDEX recommendation_candidates_id_idx
  ON recommendation_candidates(candidate_id);
