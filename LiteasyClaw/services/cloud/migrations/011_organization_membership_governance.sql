ALTER TABLE organizations
  ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0);

ALTER TABLE organization_members
  ADD COLUMN revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0);

CREATE TABLE organization_invitations (
  invitation_id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
  invited_subject text NOT NULL,
  intended_role text NOT NULL CHECK (intended_role IN ('admin', 'member')),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_by text,
  accepted_at timestamptz,
  revoked_by text,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (
    (status = 'pending' AND accepted_by IS NULL AND accepted_at IS NULL AND revoked_by IS NULL AND revoked_at IS NULL) OR
    (status = 'accepted' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL AND revoked_by IS NULL AND revoked_at IS NULL) OR
    (status = 'revoked' AND accepted_by IS NULL AND accepted_at IS NULL AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL) OR
    (status = 'expired' AND accepted_by IS NULL AND accepted_at IS NULL AND revoked_by IS NULL AND revoked_at IS NULL)
  )
);

CREATE UNIQUE INDEX organization_invitations_pending_subject_unique
  ON organization_invitations(organization_id, invited_subject)
  WHERE status = 'pending';
CREATE INDEX organization_invitations_subject_status_idx
  ON organization_invitations(invited_subject, status, expires_at);
CREATE INDEX organization_invitations_organization_status_idx
  ON organization_invitations(organization_id, status, created_at);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM organization_members member
      JOIN organizations organization USING (organization_id)
     WHERE member.member_subject = organization.owner_subject
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'organization_owner_member_duplicate';
  END IF;
END;
$$;

CREATE FUNCTION validate_organization_owner_membership() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM organizations
     WHERE organization_id = NEW.organization_id
       AND owner_subject = NEW.member_subject
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'organization_owner_member_duplicate';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_members_owner_invariant
BEFORE INSERT OR UPDATE OF organization_id, member_subject ON organization_members
FOR EACH ROW EXECUTE FUNCTION validate_organization_owner_membership();

CREATE FUNCTION validate_organization_owner_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM organization_members
     WHERE organization_id = NEW.organization_id
       AND member_subject = NEW.owner_subject
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'organization_owner_member_duplicate';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_owner_invariant
BEFORE UPDATE OF owner_subject ON organizations
FOR EACH ROW EXECUTE FUNCTION validate_organization_owner_change();
