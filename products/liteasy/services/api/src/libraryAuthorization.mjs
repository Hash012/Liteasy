export class LibraryAuthorizationError extends Error {
  constructor(code, status = 403) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function requestedScope(value, subject) {
  if (value?.scopeType === "user") {
    if (value.scopeId && value.scopeId !== subject) throw new LibraryAuthorizationError("user_scope_forbidden");
    return { scopeId: subject, scopeType: "user" };
  }
  if (value?.scopeType === "organization" && typeof value.scopeId === "string" && value.scopeId.trim()) {
    return { scopeId: value.scopeId.trim(), scopeType: "organization" };
  }
  throw new LibraryAuthorizationError("library_scope_invalid", 400);
}

async function readOrganizationAuthorization(queryable, scope, subject, lock) {
  if (!lock) {
    const result = await queryable.query(`
      SELECT
        organization.owner_subject,
        organization.status AS organization_status,
        member.role AS member_role,
        member.status AS member_status,
        COALESCE(policy.upload_policy, 'owner_admins') AS upload_policy,
        COALESCE(policy.export_policy, 'disabled') AS export_policy
      FROM organizations organization
      LEFT JOIN organization_members member
        ON member.organization_id = organization.organization_id
       AND member.member_subject = $2
      LEFT JOIN organization_storage_policies policy
        ON policy.organization_id = organization.organization_id
      WHERE organization.organization_id = $1
    `, [scope.scopeId, subject]);
    return result.rows[0];
  }

  const organization = await queryable.query(`
    SELECT owner_subject, status AS organization_status
      FROM organizations
     WHERE organization_id = $1
     FOR SHARE
  `, [scope.scopeId]);
  if (!organization.rows[0]) return undefined;
  const member = await queryable.query(`
    SELECT role AS member_role, status AS member_status
      FROM organization_members
     WHERE organization_id = $1 AND member_subject = $2
     FOR SHARE
  `, [scope.scopeId, subject]);
  const policy = await queryable.query(`
    SELECT export_policy, upload_policy
      FROM organization_storage_policies
     WHERE organization_id = $1
     FOR SHARE
  `, [scope.scopeId]);
  return {
    export_policy: policy.rows[0]?.export_policy ?? "disabled",
    member_role: member.rows[0]?.member_role,
    member_status: member.rows[0]?.member_status,
    organization_status: organization.rows[0].organization_status,
    owner_subject: organization.rows[0].owner_subject,
    upload_policy: policy.rows[0]?.upload_policy ?? "owner_admins"
  };
}

export async function authorizeLibraryScope(queryable, identity, input, capability = "read", { lock = false } = {}) {
  if (identity?.audience !== "liteasy-desktop" || !identity.subject) {
    throw new LibraryAuthorizationError("desktop_identity_required", 403);
  }
  const scope = requestedScope(input, identity.subject);
  if (scope.scopeType === "user") {
    return { ...scope, actorId: identity.subject, role: "owner" };
  }

  const row = await readOrganizationAuthorization(queryable, scope, identity.subject, lock);
  if (!row || row.organization_status !== "active") {
    throw new LibraryAuthorizationError("organization_not_available", 404);
  }
  const role = row.owner_subject === identity.subject
    ? "owner"
    : row.member_status === "active"
      ? row.member_role
      : null;
  if (!role) throw new LibraryAuthorizationError("organization_membership_required");

  const allowed = capability === "read" ||
    (capability === "upload" && (
      role === "owner" || role === "admin" || row.upload_policy === "all_members"
    )) ||
    (capability === "manage" && (role === "owner" || role === "admin")) ||
    (capability === "export" && (
      role === "owner" || row.export_policy === "all_members" ||
      (row.export_policy === "admins_only" && role === "admin")
    ));
  if (!allowed) throw new LibraryAuthorizationError(`organization_${capability}_forbidden`);
  return {
    ...scope,
    actorId: identity.subject,
    exportPolicy: row.export_policy,
    role,
    uploadPolicy: row.upload_policy
  };
}
