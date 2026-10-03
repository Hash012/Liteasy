// This organization-level snapshot explains current policy; it does not authorize
// a later mutation or replace resource-specific checks in either service.
export function organizationAccessSnapshot({ role, exportPolicy, uploadPolicy, policyRevision, authorizationRevision }) {
  const owner = role === "owner";
  const manager = owner || role === "admin";
  const member = manager || role === "member";
  const decisions = {
    read_metadata: member ? null : "organization_membership_required",
    read_body: member ? null : "organization_membership_required",
    comment: member ? null : "organization_membership_required",
    edit_own: "organization_resource_context_required",
    moderate: manager ? null : "organization_role_forbidden",
    upload: member && (manager || uploadPolicy === "all_members") ? null : "organization_upload_forbidden",
    export_original: member && (owner || exportPolicy === "all_members" ||
      (role === "admin" && exportPolicy === "admins_only")) ? null : "organization_export_forbidden",
    share_excerpt: "organization_external_use_policy_unconfirmed",
    publish_public: "organization_external_use_policy_unconfirmed",
    invite: manager ? null : "organization_role_forbidden",
    change_role: owner ? null : "organization_owner_required",
    transfer_owner: owner ? null : "organization_owner_required",
    run_external_model: "organization_external_use_policy_unconfirmed"
  };
  return {
    actionConstraints: { inviteRoles: owner ? ["admin", "member"] : manager ? ["member"] : [] },
    allowedActions: Object.keys(decisions).filter((action) => decisions[action] === null),
    authorizationRevision: Number(authorizationRevision),
    denialReasons: Object.fromEntries(Object.entries(decisions).filter(([, reason]) => reason !== null)),
    policyExceptions: owner && exportPolicy === "disabled" ? ["owner_export"] : [],
    policyRevision: policyRevision == null ? null : Number(policyRevision)
  };
}
