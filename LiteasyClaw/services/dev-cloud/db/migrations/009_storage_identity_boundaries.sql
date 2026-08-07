CREATE TABLE cloud_collection_items (
  owner_key TEXT NOT NULL,
  item_id TEXT NOT NULL,
  folder_id TEXT REFERENCES library_folders(folder_id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  doi TEXT,
  external_url TEXT,
  content_hash TEXT REFERENCES storage_objects(content_hash),
  saved_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'trashed')),
  trashed_at TEXT,
  purge_after TEXT,
  PRIMARY KEY (owner_key, item_id)
);

CREATE INDEX cloud_collection_items_owner_status_idx
  ON cloud_collection_items(owner_key, status, folder_id, updated_at DESC);

CREATE TABLE organizations (
  organization_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  owner_key TEXT NOT NULL,
  shared_library_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  owner_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'removed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, owner_key)
);

CREATE INDEX organization_members_owner_idx
  ON organization_members(owner_key, status, organization_id);

CREATE TABLE organization_invitations (
  invitation_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  target_owner_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  invited_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  accepted_at TEXT
);

CREATE UNIQUE INDEX organization_pending_invitation_idx
  ON organization_invitations(organization_id, target_owner_key)
  WHERE status = 'pending';

CREATE TABLE organization_storage_policies (
  organization_id TEXT PRIMARY KEY REFERENCES organizations(organization_id) ON DELETE CASCADE,
  upload_policy TEXT NOT NULL DEFAULT 'owner_admins'
    CHECK (upload_policy IN ('owner_admins', 'all_members')),
  export_policy TEXT NOT NULL DEFAULT 'disabled'
    CHECK (export_policy IN ('disabled', 'admins_only', 'all_members')),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE organization_active_selections (
  owner_key TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL
);

CREATE TABLE organization_notifications (
  notification_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('announcement', 'document_upload', 'library_change')),
  created_at TEXT NOT NULL
);

CREATE TABLE organization_audit_events (
  event_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  actor_key TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT NOT NULL,
  risk TEXT NOT NULL DEFAULT 'low' CHECK (risk IN ('low', 'medium', 'high')),
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL
);

CREATE INDEX organization_audit_events_org_idx
  ON organization_audit_events(organization_id, created_at DESC);

CREATE TABLE library_metadata_entries (
  document_id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('user', 'organization')),
  scope_id TEXT NOT NULL,
  folder_id TEXT REFERENCES library_folders(folder_id),
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  doi TEXT,
  external_url TEXT,
  source_id TEXT,
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trashed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  trashed_at TEXT,
  purge_after TEXT
);

CREATE INDEX library_metadata_entries_scope_idx
  ON library_metadata_entries(scope_type, scope_id, status, folder_id, updated_at DESC);

ALTER TABLE library_folders ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'trashed'));
ALTER TABLE library_folders ADD COLUMN trashed_at TEXT;
ALTER TABLE library_folders ADD COLUMN purge_after TEXT;
ALTER TABLE library_folders ADD COLUMN original_parent_folder_id TEXT;

CREATE TABLE personalization_settings (
  owner_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE local_library_manifest_entries (
  owner_key TEXT NOT NULL,
  sync_document_id TEXT NOT NULL,
  content_hash TEXT,
  title TEXT NOT NULL,
  authors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(authors_json)),
  doi TEXT,
  publication_year INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_key, sync_document_id)
);

CREATE TABLE platform_role_assignments (
  owner_key TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('platform_admin', 'developer_diagnostics')),
  environment TEXT NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (owner_key, role, environment)
);
