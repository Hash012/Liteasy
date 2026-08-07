CREATE FUNCTION validate_library_folder_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_scope_type text;
  parent_scope_id text;
  creates_cycle boolean;
BEGIN
  IF NEW.parent_folder_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT scope_type, scope_id
    INTO parent_scope_type, parent_scope_id
    FROM library_folders
   WHERE folder_id = NEW.parent_folder_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'library_parent_folder_missing';
  END IF;
  IF parent_scope_type <> NEW.scope_type OR parent_scope_id <> NEW.scope_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'library_parent_scope_mismatch';
  END IF;

  WITH RECURSIVE ancestors(folder_id, parent_folder_id) AS (
    SELECT folder_id, parent_folder_id FROM library_folders WHERE folder_id = NEW.parent_folder_id
    UNION ALL
    SELECT parent.folder_id, parent.parent_folder_id
      FROM library_folders parent
      JOIN ancestors child ON parent.folder_id = child.parent_folder_id
  )
  SELECT EXISTS(SELECT 1 FROM ancestors WHERE folder_id = NEW.folder_id) INTO creates_cycle;
  IF creates_cycle THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'library_folder_cycle';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER library_folders_parent_invariant
BEFORE INSERT OR UPDATE OF parent_folder_id, scope_type, scope_id ON library_folders
FOR EACH ROW EXECUTE FUNCTION validate_library_folder_parent();

CREATE FUNCTION validate_library_entry_folder() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_scope_type text;
  target_scope_id text;
BEGIN
  IF NEW.folder_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT scope_type, scope_id
    INTO target_scope_type, target_scope_id
    FROM library_folders
   WHERE folder_id = NEW.folder_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'library_entry_folder_missing';
  END IF;
  IF target_scope_type <> NEW.scope_type OR target_scope_id <> NEW.scope_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'library_entry_scope_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER library_entries_folder_invariant
BEFORE INSERT OR UPDATE OF folder_id, scope_type, scope_id ON library_entries
FOR EACH ROW EXECUTE FUNCTION validate_library_entry_folder();

CREATE FUNCTION validate_library_entry_object_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_document_id text;
  target_kind text;
  target_logical_bytes bigint;
  reference_count bigint;
  referenced_bytes bigint;
BEGIN
  target_document_id := COALESCE(NEW.document_id, OLD.document_id);
  SELECT entry_kind, logical_bytes
    INTO target_kind, target_logical_bytes
    FROM library_entries
   WHERE document_id = target_document_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*), max(object.byte_length)
    INTO reference_count, referenced_bytes
    FROM storage_object_references reference
    JOIN storage_objects object ON object.content_hash = reference.content_hash
   WHERE reference.document_id = target_document_id;

  IF target_kind = 'metadata_only' AND reference_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'metadata_entry_object_forbidden';
  END IF;
  IF target_kind = 'pdf' AND (reference_count <> 1 OR referenced_bytes <> target_logical_bytes) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'pdf_entry_object_reference_invalid';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER library_entries_object_reference_invariant
AFTER INSERT OR UPDATE OF entry_kind, logical_bytes ON library_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_library_entry_object_reference();

CREATE CONSTRAINT TRIGGER storage_object_references_entry_invariant
AFTER INSERT OR UPDATE OR DELETE ON storage_object_references
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_library_entry_object_reference();
