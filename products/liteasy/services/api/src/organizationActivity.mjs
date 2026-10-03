import { LibraryRepositoryError } from "./libraryRepository.mjs";

/** Read existing authority/audit records. This is not a second membership store. */
export async function readOrganizationActivity(pool, identity) {
  if (identity?.audience !== "liteasy-desktop" || !identity.subject) throw new LibraryRepositoryError("desktop_identity_required", 403);
  const result = await pool.query(`
    SELECT event.audit_id, event.action, event.occurred_at,
           CASE WHEN organization.status = 'active' AND
             (organization.owner_subject = $1 OR member.status = 'active')
             THEN organization.name ELSE NULL END AS organization_name
      FROM audit_events event
      LEFT JOIN organizations organization ON organization.organization_id = event.scope_id
      LEFT JOIN organization_members member ON member.organization_id = event.scope_id AND member.member_subject = $1
     WHERE event.scope_type = 'organization'
       AND NOT EXISTS (SELECT 1 FROM account_deletion_jobs WHERE subject_id = $1)
       AND ((event.resource_type = 'organization_member' AND event.resource_id = $1
         AND event.action IN ('accept_organization_invitation', 'leave_organization', 'change_organization_member_role', 'change_organization_member_status'))
         OR (event.action = 'transfer_organization_ownership' AND
           (event.detail->>'newOwnerSubject' = $1 OR event.detail->>'previousOwnerSubject' = $1)))
     ORDER BY event.occurred_at DESC, event.audit_id DESC LIMIT 50
  `, [identity.subject]);
  return { activities: result.rows.map((row) => row.organization_name ? {
    id: row.audit_id, available: true, organizationName: row.organization_name,
    kind: row.action === 'accept_organization_invitation' ? 'invitation_accepted' : 'permissions_changed',
    occurredAt: row.occurred_at
  } : { id: row.audit_id, available: false }) };
}
