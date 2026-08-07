ALTER TABLE team_annotations
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0);
