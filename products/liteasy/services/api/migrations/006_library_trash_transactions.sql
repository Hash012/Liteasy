ALTER TABLE library_folders
  ADD COLUMN trashed_by_folder_id text REFERENCES library_folders(folder_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE library_folders
  ADD COLUMN original_parent_folder_id text REFERENCES library_folders(folder_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE library_entries
  ADD COLUMN trashed_by_folder_id text REFERENCES library_folders(folder_id) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE library_folders
  ADD CONSTRAINT library_folder_trash_origin_valid CHECK (
    (status = 'active' AND trashed_by_folder_id IS NULL AND original_parent_folder_id IS NULL) OR
    (status = 'trashed' AND trashed_by_folder_id IS NOT NULL)
  );
ALTER TABLE library_entries
  ADD CONSTRAINT library_entry_trash_origin_valid CHECK (
    status = 'trashed' OR (status = 'active' AND trashed_by_folder_id IS NULL)
  );

CREATE INDEX library_folders_trash_transaction_idx
  ON library_folders(scope_type, scope_id, trashed_by_folder_id);
CREATE INDEX library_entries_trash_transaction_idx
  ON library_entries(scope_type, scope_id, trashed_by_folder_id);
