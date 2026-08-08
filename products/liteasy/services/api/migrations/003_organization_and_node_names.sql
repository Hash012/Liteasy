CREATE TABLE organizations (
  organization_id text PRIMARY KEY,
  owner_subject text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 255),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  organization_id text NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  member_subject text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, member_subject)
);
CREATE INDEX organization_members_subject_idx
  ON organization_members(member_subject, status, organization_id);

ALTER TABLE organization_storage_policies
  ADD CONSTRAINT organization_storage_policy_organization_fk
  FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE;

CREATE FUNCTION lock_library_sibling_names(
  target_scope_type text,
  target_scope_id text,
  target_parent_id text
) RETURNS void
LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock(
    hashtextextended(target_scope_type || ':' || target_scope_id || ':' || COALESCE(target_parent_id, ''), 0)
  );
$$;

CREATE FUNCTION validate_library_folder_sibling_name() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM lock_library_sibling_names(NEW.scope_type, NEW.scope_id, NEW.parent_folder_id);
  IF NEW.status = 'active' AND EXISTS (
    SELECT 1 FROM library_entries entry
     WHERE entry.scope_type = NEW.scope_type
       AND entry.scope_id = NEW.scope_id
       AND entry.folder_id IS NOT DISTINCT FROM NEW.parent_folder_id
       AND entry.normalized_name = NEW.normalized_name
       AND entry.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'library_sibling_name_exists';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER library_folders_cross_type_name_invariant
BEFORE INSERT OR UPDATE OF scope_type, scope_id, parent_folder_id, normalized_name, status ON library_folders
FOR EACH ROW EXECUTE FUNCTION validate_library_folder_sibling_name();

CREATE FUNCTION validate_library_entry_sibling_name() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM lock_library_sibling_names(NEW.scope_type, NEW.scope_id, NEW.folder_id);
  IF NEW.status = 'active' AND EXISTS (
    SELECT 1 FROM library_folders folder
     WHERE folder.scope_type = NEW.scope_type
       AND folder.scope_id = NEW.scope_id
       AND folder.parent_folder_id IS NOT DISTINCT FROM NEW.folder_id
       AND folder.normalized_name = NEW.normalized_name
       AND folder.status = 'active'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'library_sibling_name_exists';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER library_entries_cross_type_name_invariant
BEFORE INSERT OR UPDATE OF scope_type, scope_id, folder_id, normalized_name, status ON library_entries
FOR EACH ROW EXECUTE FUNCTION validate_library_entry_sibling_name();
