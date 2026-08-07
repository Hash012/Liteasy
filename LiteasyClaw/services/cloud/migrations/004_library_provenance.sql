ALTER TABLE library_entries
  ADD COLUMN created_by text NOT NULL DEFAULT 'migration';
ALTER TABLE library_entries
  ALTER COLUMN created_by DROP DEFAULT;

ALTER TABLE library_folders
  ADD COLUMN created_by text NOT NULL DEFAULT 'migration';
ALTER TABLE library_folders
  ALTER COLUMN created_by DROP DEFAULT;
