CREATE OR REPLACE FUNCTION validate_library_entry_object_reference() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_document_id text;
  target_kind text;
  target_logical_bytes bigint;
  target_availability text;
  reference_count bigint;
  referenced_bytes bigint;
  referenced_status text;
BEGIN
  target_document_id := COALESCE(NEW.document_id, OLD.document_id);
  SELECT entry_kind, logical_bytes, availability
    INTO target_kind, target_logical_bytes, target_availability
    FROM library_entries
   WHERE document_id = target_document_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT count(*), max(object.byte_length), max(object.status)
    INTO reference_count, referenced_bytes, referenced_status
    FROM storage_object_references reference
    JOIN storage_objects object ON object.content_hash = reference.content_hash
   WHERE reference.document_id = target_document_id;

  IF target_kind = 'metadata_only' AND reference_count <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'metadata_entry_object_forbidden';
  END IF;
  IF target_kind = 'pdf' AND (reference_count <> 1 OR referenced_bytes <> target_logical_bytes) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'pdf_entry_object_reference_invalid';
  END IF;
  IF target_kind = 'pdf' AND (
    (target_availability = 'available' AND referenced_status <> 'available') OR
    (target_availability = 'pending' AND referenced_status NOT IN ('staging', 'available'))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'pdf_entry_object_status_invalid';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION validate_storage_object_reference_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM storage_object_references reference
      JOIN library_entries entry USING (document_id)
     WHERE reference.content_hash = NEW.content_hash
       AND (
         (entry.availability = 'available' AND NEW.status <> 'available') OR
         (entry.availability = 'pending' AND NEW.status NOT IN ('staging', 'available'))
       )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'storage_object_reference_status_invalid';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER storage_objects_reference_status_invariant
AFTER UPDATE OF status ON storage_objects
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_storage_object_reference_status();
