\set ON_ERROR_STOP on

INSERT INTO library_folders(folder_id, scope_type, scope_id, name, normalized_name)
VALUES
  ('folder_user_root', 'user', 'user_1', 'User root', 'user root'),
  ('folder_org_root', 'organization', 'org_1', 'Organization root', 'organization root'),
  ('folder_user_child', 'user', 'user_1', 'Child', 'child');

DO $$
BEGIN
  BEGIN
    INSERT INTO library_folders(folder_id, scope_type, scope_id, parent_folder_id, name, normalized_name)
    VALUES ('folder_cross_scope', 'user', 'user_1', 'folder_org_root', 'Invalid', 'invalid');
    RAISE EXCEPTION 'expected cross-scope folder rejection';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'library_parent_scope_mismatch' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE library_folders SET parent_folder_id = 'folder_user_child' WHERE folder_id = 'folder_user_root';
    UPDATE library_folders SET parent_folder_id = 'folder_user_root' WHERE folder_id = 'folder_user_child';
    RAISE EXCEPTION 'expected folder cycle rejection';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'library_folder_cycle' THEN RAISE; END IF;
  END;

  BEGIN
    INSERT INTO library_entries(
      document_id, scope_type, scope_id, folder_id, entry_kind, file_name, normalized_name, title, created_by
    ) VALUES (
      'document_cross_scope', 'user', 'user_1', 'folder_org_root', 'metadata_only',
      'invalid.pdf', 'invalid.pdf', 'Invalid', 'user_1'
    );
    RAISE EXCEPTION 'expected cross-scope entry rejection';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'library_entry_scope_mismatch' THEN RAISE; END IF;
  END;
END;
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO library_entries(
      document_id, scope_type, scope_id, folder_id, entry_kind, file_name, normalized_name, title, created_by
    ) VALUES (
      'document_folder_name_collision', 'user', 'user_1', NULL, 'metadata_only',
      'User root', 'user root', 'User root', 'user_1'
    );
    RAISE EXCEPTION 'expected cross-type sibling name rejection';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'library_sibling_name_exists' THEN RAISE; END IF;
  END;
END;
$$;

INSERT INTO storage_objects(
  content_hash, byte_length, storage_key, checksum_verified_at
) VALUES (
  repeat('a', 64), 12, 'documents/objects/aa/' || repeat('a', 64), now()
);

DO $$
BEGIN
  BEGIN
    INSERT INTO library_entries(
      document_id, scope_type, scope_id, folder_id, entry_kind, file_name, normalized_name, title, created_by
    ) VALUES (
      'document_metadata', 'user', 'user_1', 'folder_user_root', 'metadata_only',
      'metadata.pdf', 'metadata.pdf', 'Metadata only', 'user_1'
    );
    INSERT INTO storage_object_references(document_id, content_hash)
    VALUES ('document_metadata', repeat('a', 64));
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'expected metadata object rejection';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'metadata_entry_object_forbidden' THEN RAISE; END IF;
  END;
END;
$$;

BEGIN;
INSERT INTO library_entries(
  document_id, scope_type, scope_id, folder_id, entry_kind, file_name, normalized_name, title, logical_bytes, created_by
) VALUES (
  'document_pdf', 'user', 'user_1', 'folder_user_root', 'pdf',
  'paper.pdf', 'paper.pdf', 'Paper', 12, 'user_1'
);
INSERT INTO storage_object_references(document_id, content_hash)
VALUES ('document_pdf', repeat('a', 64));
COMMIT;

DO $$
DECLARE
  valid_count integer;
BEGIN
  SELECT count(*) INTO valid_count
    FROM library_entries entry
    JOIN storage_object_references reference USING (document_id)
   WHERE entry.document_id = 'document_pdf'
     AND entry.entry_kind = 'pdf'
     AND entry.logical_bytes = 12;
  IF valid_count <> 1 THEN RAISE EXCEPTION 'valid PDF reference was not committed'; END IF;
END;
$$;
