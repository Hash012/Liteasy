ALTER TABLE organization_members RENAME TO organization_members_legacy;

CREATE TABLE organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  owner_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'invited', 'suspended', 'removed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, owner_key)
);

INSERT INTO organization_members (
  organization_id, owner_key, display_name, role, status, created_at, updated_at
)
SELECT organization_id, owner_key, display_name, role, status, created_at, updated_at
FROM organization_members_legacy;

DROP TABLE organization_members_legacy;

CREATE INDEX organization_members_owner_idx
  ON organization_members(owner_key, status, organization_id);
