import { createHash, randomBytes, randomUUID } from "node:crypto";
import { LibraryRepositoryError } from "./libraryRepository.mjs";
import { withPostgresTransaction } from "./postgres.mjs";

const memberRoles = new Set(["admin", "member"]);
const memberStatuses = new Set(["active", "removed", "suspended"]);

function requiredIdentity(identity, allowedAudiences = new Set(["liteasy-desktop"])) {
  if (!allowedAudiences.has(identity?.audience) || typeof identity.subject !== "string" || !identity.subject) {
    throw new LibraryRepositoryError("desktop_identity_required", 403);
  }
  return identity;
}

function requiredSubject(value, code = "organization_subject_invalid") {
  if (typeof value !== "string" || value.length < 1 || value.length > 255 || value.trim() !== value ||
    /[\u0000-\u001f\u007f\s]/.test(value)) {
    throw new LibraryRepositoryError(code);
  }
  return value;
}

function requiredOrganizationId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(value)) {
    throw new LibraryRepositoryError("organization_id_invalid");
  }
  return value;
}

function organizationName(value) {
  if (typeof value !== "string") throw new LibraryRepositoryError("invalid_organization_name");
  const name = value.normalize("NFKC").trim();
  if (!name || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new LibraryRepositoryError("invalid_organization_name");
  }
  return name;
}

function memberRole(value) {
  if (!memberRoles.has(value)) throw new LibraryRepositoryError("organization_role_invalid");
  return value;
}

function memberStatus(value) {
  if (!memberStatuses.has(value)) throw new LibraryRepositoryError("organization_member_status_invalid");
  return value;
}

function expectedRevision(value, code = "organization_revision_invalid") {
  if (!Number.isSafeInteger(value) || value < 0) throw new LibraryRepositoryError(code);
  return value;
}

function operationKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
    throw new LibraryRepositoryError("idempotency_key_invalid");
  }
  return value;
}

function invitationToken(value) {
  if (typeof value !== "string" || !/^orginv_[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new LibraryRepositoryError("organization_invitation_invalid");
  }
  return value;
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashToken(value) {
  return createHash("sha256").update(value).digest("hex");
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapInvitation(row, { includeToken } = {}) {
  return {
    ...(includeToken ? { invitationToken: includeToken } : {}),
    createdAt: iso(row.created_at),
    createdBy: row.created_by,
    expiresAt: iso(row.expires_at),
    invitationId: row.invitation_id,
    organizationId: row.organization_id,
    revision: Number(row.revision),
    role: row.intended_role,
    status: row.status,
    targetSubject: row.invited_subject
  };
}

function mapMember(row) {
  return {
    revision: Number(row.revision),
    role: row.role,
    status: row.status,
    subject: row.member_subject
  };
}

function actorRole(organization, subject) {
  if (organization.owner_subject === subject) return "owner";
  if (organization.member_status === "active") return organization.member_role;
  return null;
}

async function requireOrganization(client, organizationId, subject, { lock = false } = {}) {
  const result = await client.query(`
    SELECT organization.*,
           member.role AS member_role,
           member.status AS member_status,
           member.revision AS member_revision
      FROM organizations organization
      LEFT JOIN organization_members member
        ON member.organization_id = organization.organization_id
       AND member.member_subject = $2
     WHERE organization.organization_id = $1
     ${lock ? "FOR UPDATE OF organization" : ""}
  `, [organizationId, subject]);
  const organization = result.rows[0];
  if (!organization || organization.status !== "active") {
    throw new LibraryRepositoryError("organization_not_found", 404);
  }
  const role = actorRole(organization, subject);
  if (!role) throw new LibraryRepositoryError("organization_membership_required", 403);
  return { organization, role };
}

function assertRevision(row, revision) {
  if (Number(row.revision) !== revision) {
    throw new LibraryRepositoryError("organization_revision_conflict", 409);
  }
}

function assertManager(role) {
  if (role !== "owner" && role !== "admin") {
    throw new LibraryRepositoryError("organization_role_forbidden", 403);
  }
}

async function writeAudit(client, identity, input, audit) {
  await client.query(`
    INSERT INTO audit_events(
      audit_id, actor_id, actor_audience, action, resource_type, resource_id,
      scope_type, scope_id, trace_id, detail
    ) VALUES ($1, $2, $3, $4, $5, $6, 'organization', $7, $8, $9::jsonb)
  `, [
    `audit_${randomUUID()}`,
    identity.subject,
    identity.audience,
    audit.action,
    audit.resourceType,
    audit.resourceId,
    audit.organizationId,
    input.traceId,
    JSON.stringify(audit.detail ?? {})
  ]);
}

async function idempotentMutation(client, identity, input, operation, requestBody, mutate) {
  const key = operationKey(input.idempotencyKey);
  const requestHash = hashJson(requestBody);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${identity.subject}:${operation}:${key}`
  ]);
  const prior = await client.query(`
    SELECT request_hash, response_body FROM idempotency_records
     WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3 AND expires_at > now()
  `, [identity.subject, operation, key]);
  if (prior.rows[0]) {
    if (prior.rows[0].request_hash !== requestHash) {
      throw new LibraryRepositoryError("idempotency_key_reused", 409);
    }
    return prior.rows[0].response_body;
  }
  const { audit, response } = await mutate();
  await client.query(`
    INSERT INTO idempotency_records(
      actor_id, operation, idempotency_key, request_hash, response_status,
      response_body, expires_at
    ) VALUES ($1, $2, $3, $4, 200, $5::jsonb, now() + interval '24 hours')
  `, [identity.subject, operation, key, requestHash, JSON.stringify(response)]);
  await writeAudit(client, identity, input, audit);
  return response;
}

async function advanceOrganizationRevision(client, organizationId, revision) {
  const result = await client.query(`
    UPDATE organizations
       SET revision = revision + 1, updated_at = now()
     WHERE organization_id = $1 AND revision = $2
     RETURNING revision
  `, [organizationId, revision]);
  if (!result.rows[0]) throw new LibraryRepositoryError("organization_revision_conflict", 409);
  return Number(result.rows[0].revision);
}

export class PostgresOrganizationGovernanceRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create(identityValue, input) {
    const identity = requiredIdentity(identityValue);
    const name = organizationName(input.name);
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      identity,
      input,
      "create_organization",
      { name },
      async () => {
        const organizationId = `org_${randomUUID()}`;
        const created = await client.query(`
          INSERT INTO organizations(organization_id, owner_subject, name)
          VALUES ($1, $2, $3)
          RETURNING *
        `, [organizationId, identity.subject, name]);
        await client.query(`
          INSERT INTO organization_storage_policies(
            organization_id, upload_policy, export_policy, updated_by
          ) VALUES ($1, 'owner_admins', 'disabled', $2)
        `, [organizationId, identity.subject]);
        const response = {
          organization: {
            myRole: "owner",
            name: created.rows[0].name,
            organizationId,
            revision: Number(created.rows[0].revision)
          }
        };
        return {
          audit: {
            action: "create_organization",
            detail: { name },
            organizationId,
            resourceId: organizationId,
            resourceType: "organization"
          },
          response
        };
      }
    ));
  }

  async list(identityValue) {
    const identity = requiredIdentity(identityValue);
    return this.#listForSubject(identity.subject);
  }

  async listForIntuecho(input) {
    return this.#listForSubject(requiredSubject(input.userSubject));
  }

  async #listForSubject(subject) {
    const result = await this.pool.query(`
      SELECT organization.organization_id, organization.name, organization.owner_subject,
             organization.revision,
             CASE WHEN organization.owner_subject = $1 THEN 'owner' ELSE member.role END AS my_role,
             1 + COUNT(active_member.member_subject)::integer AS member_count
        FROM organizations organization
        LEFT JOIN organization_members member
          ON member.organization_id = organization.organization_id
         AND member.member_subject = $1 AND member.status = 'active'
        LEFT JOIN organization_members active_member
          ON active_member.organization_id = organization.organization_id
         AND active_member.status = 'active'
       WHERE organization.status = 'active'
         AND (organization.owner_subject = $1 OR member.member_subject IS NOT NULL)
       GROUP BY organization.organization_id, member.role
       ORDER BY lower(organization.name), organization.organization_id
    `, [subject]);
    return {
      activeOrganizationId: result.rows[0]?.organization_id ?? "",
      organizations: result.rows.map((row) => ({
        memberCount: Number(row.member_count),
        myRole: row.my_role,
        name: row.name,
        organizationId: row.organization_id,
        ownerSubject: row.owner_subject,
        revision: Number(row.revision),
        sharedLibraryName: `${row.name} 共享文献库`
      }))
    };
  }

  async summary(identityValue, input) {
    const identity = requiredIdentity(identityValue);
    const organizationId = requiredOrganizationId(input.organizationId);
    return withPostgresTransaction(this.pool, async (client) => {
      const { organization, role } = await requireOrganization(client, organizationId, identity.subject);
      const members = await client.query(`
        SELECT member_subject, role, status, revision
          FROM organization_members
         WHERE organization_id = $1 AND status <> 'removed'
         ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, member_subject
      `, [organizationId]);
      const policy = await client.query(`
        SELECT upload_policy, export_policy, revision, updated_by, updated_at
          FROM organization_storage_policies WHERE organization_id = $1
      `, [organizationId]);
      const quota = await client.query(`
        SELECT limit_bytes FROM storage_quotas
         WHERE scope_type = 'organization' AND scope_id = $1
      `, [organizationId]);
      const usage = await client.query(`
        SELECT COALESCE(SUM(logical_bytes), 0) AS used_bytes
          FROM library_entries
         WHERE scope_type = 'organization' AND scope_id = $1 AND status = 'active'
      `, [organizationId]);
      const documents = await client.query(`
        SELECT document_id, entry_kind, title
          FROM library_entries
         WHERE scope_type = 'organization' AND scope_id = $1 AND status = 'active'
         ORDER BY updated_at DESC, document_id
      `, [organizationId]);
      const audits = await client.query(`
        SELECT audit_id, actor_id, action, occurred_at
          FROM audit_events
         WHERE scope_type = 'organization' AND scope_id = $1
         ORDER BY occurred_at DESC, audit_id DESC LIMIT 20
      `, [organizationId]);
      return {
        summary: {
          auditEvents: audits.rows.map((row) => ({
            action: row.action,
            actorSubject: row.actor_id,
            auditId: row.audit_id,
            occurredAt: iso(row.occurred_at)
          })),
          memberCount: 1 + members.rows.filter((row) => row.status === "active").length,
          members: [
            { revision: Number(organization.revision), role: "owner", status: "active", subject: organization.owner_subject },
            ...members.rows.map(mapMember)
          ],
          myMemberRevision: role === "owner" ? null : Number(organization.member_revision),
          myRole: role,
          name: organization.name,
          organizationId,
          ownerSubject: organization.owner_subject,
          policy: policy.rows[0] ? {
            exportPolicy: policy.rows[0].export_policy,
            revision: Number(policy.rows[0].revision),
            updatedAt: iso(policy.rows[0].updated_at),
            updatedBy: policy.rows[0].updated_by,
            uploadPolicy: policy.rows[0].upload_policy
          } : null,
          quota: {
            configured: Boolean(quota.rows[0]),
            limitBytes: quota.rows[0] ? Number(quota.rows[0].limit_bytes) : null,
            usedBytes: Number(usage.rows[0]?.used_bytes ?? 0)
          },
          revision: Number(organization.revision),
          sharedLibrary: {
            documentCount: documents.rowCount,
            documents: documents.rows.map((row) => ({
              entryKind: row.entry_kind,
              id: row.document_id,
              sourcePath: row.entry_kind === "pdf"
                ? `org://${organizationId}/shared-library/${row.document_id}.pdf`
                : `org://${organizationId}/shared-library/${row.document_id}`,
              title: row.title
            })),
            name: `${organization.name} 共享文献库`,
            status: "available"
          },
          status: organization.status
        }
      };
    }, { isolation: "REPEATABLE READ" });
  }

  async invite(identityValue, input) {
    const identity = requiredIdentity(identityValue, new Set(["liteasy-desktop", "service"]));
    const organizationId = requiredOrganizationId(input.organizationId);
    const role = memberRole(input.role);
    const targetSubject = requiredSubject(input.targetSubject, "invalid_organization_invite");
    const revision = identity.audience === "service" && input.expectedRevision === undefined
      ? null
      : expectedRevision(input.expectedRevision);
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      identity,
      input,
      "create_organization_invitation",
      { organizationId, revision, role, targetSubject },
      async () => {
        const actor = await requireOrganization(client, organizationId, identity.subject, { lock: true });
        assertManager(actor.role);
        if (revision !== null) assertRevision(actor.organization, revision);
        if (actor.role === "admin" && role === "admin") {
          throw new LibraryRepositoryError("organization_owner_required", 403);
        }
        if (actor.organization.owner_subject === targetSubject) {
          throw new LibraryRepositoryError("organization_member_exists", 409);
        }
        const existing = await client.query(`
          SELECT status FROM organization_members
           WHERE organization_id = $1 AND member_subject = $2
        `, [organizationId, targetSubject]);
        if (existing.rows[0]?.status === "active") {
          throw new LibraryRepositoryError("organization_member_exists", 409);
        }
        await client.query(`
          UPDATE organization_invitations
             SET status = 'expired', revision = revision + 1
           WHERE organization_id = $1 AND invited_subject = $2
             AND status = 'pending' AND expires_at <= now()
        `, [organizationId, targetSubject]);
        const token = `orginv_${randomBytes(32).toString("base64url")}`;
        const invitationId = `orginvite_${randomUUID()}`;
        const created = await client.query(`
          INSERT INTO organization_invitations(
            invitation_id, organization_id, invited_subject, intended_role,
            token_hash, created_by, expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, now() + interval '7 days')
          RETURNING *
        `, [invitationId, organizationId, targetSubject, role, hashToken(token), identity.subject]);
        const nextRevision = await advanceOrganizationRevision(
          client,
          organizationId,
          Number(actor.organization.revision)
        );
        const response = {
          invitation: mapInvitation(created.rows[0], { includeToken: token }),
          organizationRevision: nextRevision
        };
        return {
          audit: {
            action: "create_organization_invitation",
            detail: { invitationId, role, targetSubject },
            organizationId,
            resourceId: invitationId,
            resourceType: "organization_invitation"
          },
          response
        };
      }
    ));
  }

  async authorizeIntuechoAccess(input) {
    const organizationId = requiredOrganizationId(input.organizationId);
    const userSubject = requiredSubject(input.userSubject);
    const result = await this.pool.query(`
      SELECT organization.owner_subject, member.role, member.status
        FROM organizations organization
        LEFT JOIN organization_members member
          ON member.organization_id = organization.organization_id
         AND member.member_subject = $2
       WHERE organization.organization_id = $1
         AND organization.status = 'active'
    `, [organizationId, userSubject]);
    const row = result.rows[0];
    if (!row) return { allowed: false, role: null };
    if (row.owner_subject === userSubject) return { allowed: true, role: "owner" };
    if (row.status === "active" && memberRoles.has(row.role)) {
      return { allowed: true, role: row.role };
    }
    return { allowed: false, role: null };
  }

  inviteFromIntuecho(serviceIdentity, input) {
    if (serviceIdentity?.audience !== "liteasy-internal" || !serviceIdentity.clientId) {
      throw new LibraryRepositoryError("service_identity_required", 403);
    }
    return this.invite({
      audience: "service",
      serviceClientId: serviceIdentity.clientId,
      subject: requiredSubject(input.actorSubject)
    }, {
      idempotencyKey: input.idempotencyKey,
      organizationId: input.organizationId,
      role: input.role,
      targetSubject: input.targetSubject,
      traceId: input.traceId
    });
  }

  async listInvitations(identityValue, input) {
    const identity = requiredIdentity(identityValue);
    const organizationId = requiredOrganizationId(input.organizationId);
    const actor = await requireOrganization(this.pool, organizationId, identity.subject);
    assertManager(actor.role);
    const result = await this.pool.query(`
      SELECT * FROM organization_invitations
       WHERE organization_id = $1
       ORDER BY created_at DESC, invitation_id DESC
       LIMIT 200
    `, [organizationId]);
    return { invitations: result.rows.map((row) => mapInvitation({
      ...row,
      status: row.status === "pending" && Date.parse(row.expires_at) <= Date.now() ? "expired" : row.status
    })) };
  }

  async acceptInvitation(identityValue, input) {
    const identity = requiredIdentity(identityValue);
    const token = invitationToken(input.invitationToken);
    const invitationRevision = expectedRevision(
      input.expectedInvitationRevision,
      "organization_invitation_revision_invalid"
    );
    const tokenHash = hashToken(token);
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      identity,
      input,
      "accept_organization_invitation",
      { invitationRevision, tokenHash },
      async () => {
        const result = await client.query(`
          SELECT invitation.*, organization.status AS organization_status,
                 organization.owner_subject, organization.revision AS organization_revision
            FROM organization_invitations invitation
            JOIN organizations organization USING (organization_id)
           WHERE invitation.token_hash = $1
           FOR UPDATE OF invitation, organization
        `, [tokenHash]);
        const invitation = result.rows[0];
        if (!invitation || invitation.invited_subject !== identity.subject) {
          throw new LibraryRepositoryError("organization_invitation_required", 403);
        }
        if (invitation.organization_status !== "active") {
          throw new LibraryRepositoryError("organization_not_found", 404);
        }
        if (invitation.status !== "pending" || Number(invitation.revision) !== invitationRevision ||
          Date.parse(invitation.expires_at) <= Date.now()) {
          throw new LibraryRepositoryError("organization_invitation_not_pending", 409);
        }
        if (invitation.owner_subject === identity.subject) {
          throw new LibraryRepositoryError("organization_member_exists", 409);
        }
        const member = await client.query(`
          INSERT INTO organization_members(
            organization_id, member_subject, role, status
          ) VALUES ($1, $2, $3, 'active')
          ON CONFLICT (organization_id, member_subject) DO UPDATE
            SET role = EXCLUDED.role, status = 'active',
                revision = organization_members.revision + 1, updated_at = now()
          RETURNING *
        `, [invitation.organization_id, identity.subject, invitation.intended_role]);
        const accepted = await client.query(`
          UPDATE organization_invitations
             SET status = 'accepted', accepted_by = $2, accepted_at = now(),
                 revision = revision + 1
           WHERE invitation_id = $1 AND revision = $3 AND status = 'pending'
           RETURNING *
        `, [invitation.invitation_id, identity.subject, invitationRevision]);
        if (!accepted.rows[0]) {
          throw new LibraryRepositoryError("organization_invitation_revision_conflict", 409);
        }
        const nextRevision = await advanceOrganizationRevision(
          client,
          invitation.organization_id,
          Number(invitation.organization_revision)
        );
        const response = {
          membership: mapMember(member.rows[0]),
          organizationId: invitation.organization_id,
          organizationRevision: nextRevision
        };
        return {
          audit: {
            action: "accept_organization_invitation",
            detail: { invitationId: invitation.invitation_id, role: invitation.intended_role },
            organizationId: invitation.organization_id,
            resourceId: identity.subject,
            resourceType: "organization_member"
          },
          response
        };
      }
    ));
  }

  async revokeInvitation(identityValue, input) {
    const identity = requiredIdentity(identityValue);
    const organizationId = requiredOrganizationId(input.organizationId);
    const organizationRevision = expectedRevision(input.expectedRevision);
    const invitationRevision = expectedRevision(
      input.expectedInvitationRevision,
      "organization_invitation_revision_invalid"
    );
    const invitationId = requiredOrganizationId(input.invitationId);
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      identity,
      input,
      "revoke_organization_invitation",
      { invitationId, invitationRevision, organizationId, organizationRevision },
      async () => {
        const actor = await requireOrganization(client, organizationId, identity.subject, { lock: true });
        assertManager(actor.role);
        assertRevision(actor.organization, organizationRevision);
        const current = await client.query(`
          SELECT * FROM organization_invitations
           WHERE invitation_id = $1 AND organization_id = $2 FOR UPDATE
        `, [invitationId, organizationId]);
        const invitation = current.rows[0];
        if (!invitation) throw new LibraryRepositoryError("organization_invitation_not_found", 404);
        if (actor.role === "admin" && invitation.intended_role === "admin") {
          throw new LibraryRepositoryError("organization_owner_required", 403);
        }
        const revoked = await client.query(`
          UPDATE organization_invitations
             SET status = 'revoked', revoked_by = $3, revoked_at = now(), revision = revision + 1
           WHERE invitation_id = $1 AND organization_id = $2
             AND status = 'pending' AND revision = $4
           RETURNING *
        `, [invitationId, organizationId, identity.subject, invitationRevision]);
        if (!revoked.rows[0]) {
          throw new LibraryRepositoryError("organization_invitation_revision_conflict", 409);
        }
        const nextRevision = await advanceOrganizationRevision(client, organizationId, organizationRevision);
        const response = {
          invitation: mapInvitation(revoked.rows[0]),
          organizationRevision: nextRevision
        };
        return {
          audit: {
            action: "revoke_organization_invitation",
            detail: { invitationId },
            organizationId,
            resourceId: invitationId,
            resourceType: "organization_invitation"
          },
          response
        };
      }
    ));
  }

  async leave(identityValue, input) {
    const identity = requiredIdentity(identityValue);
    const organizationId = requiredOrganizationId(input.organizationId);
    const organizationRevision = expectedRevision(input.expectedRevision);
    const memberRevision = expectedRevision(input.expectedMemberRevision, "organization_member_revision_invalid");
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      identity,
      input,
      "leave_organization",
      { memberRevision, organizationId, organizationRevision },
      async () => {
        const actor = await requireOrganization(client, organizationId, identity.subject, { lock: true });
        if (actor.role === "owner") throw new LibraryRepositoryError("organization_owner_leave_blocked", 409);
        assertRevision(actor.organization, organizationRevision);
        const removed = await client.query(`
          UPDATE organization_members
             SET status = 'removed', revision = revision + 1, updated_at = now()
           WHERE organization_id = $1 AND member_subject = $2
             AND status = 'active' AND revision = $3
           RETURNING *
        `, [organizationId, identity.subject, memberRevision]);
        if (!removed.rows[0]) throw new LibraryRepositoryError("organization_member_revision_conflict", 409);
        const nextRevision = await advanceOrganizationRevision(client, organizationId, organizationRevision);
        const response = { left: true, organizationId, organizationRevision: nextRevision };
        return {
          audit: {
            action: "leave_organization",
            organizationId,
            resourceId: identity.subject,
            resourceType: "organization_member"
          },
          response
        };
      }
    ));
  }

  async changeMemberRole(identityValue, input) {
    const identity = requiredIdentity(identityValue);
    const organizationId = requiredOrganizationId(input.organizationId);
    const organizationRevision = expectedRevision(input.expectedRevision);
    const targetSubject = requiredSubject(input.targetSubject);
    const targetRevision = expectedRevision(input.expectedMemberRevision, "organization_member_revision_invalid");
    const role = memberRole(input.role);
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      identity,
      input,
      "change_organization_member_role",
      { organizationId, organizationRevision, role, targetRevision, targetSubject },
      async () => {
        const actor = await requireOrganization(client, organizationId, identity.subject, { lock: true });
        if (actor.role !== "owner") throw new LibraryRepositoryError("organization_owner_required", 403);
        assertRevision(actor.organization, organizationRevision);
        const changed = await client.query(`
          UPDATE organization_members
             SET role = $3, revision = revision + 1, updated_at = now()
           WHERE organization_id = $1 AND member_subject = $2
             AND status = 'active' AND revision = $4
           RETURNING *
        `, [organizationId, targetSubject, role, targetRevision]);
        if (!changed.rows[0]) throw new LibraryRepositoryError("organization_member_revision_conflict", 409);
        const nextRevision = await advanceOrganizationRevision(client, organizationId, organizationRevision);
        const response = { member: mapMember(changed.rows[0]), organizationRevision: nextRevision };
        return {
          audit: {
            action: "change_organization_member_role",
            detail: { role },
            organizationId,
            resourceId: targetSubject,
            resourceType: "organization_member"
          },
          response
        };
      }
    ));
  }

  async setMemberStatus(identityValue, input) {
    const identity = requiredIdentity(identityValue);
    const organizationId = requiredOrganizationId(input.organizationId);
    const organizationRevision = expectedRevision(input.expectedRevision);
    const targetSubject = requiredSubject(input.targetSubject);
    const targetRevision = expectedRevision(input.expectedMemberRevision, "organization_member_revision_invalid");
    const status = memberStatus(input.status);
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      identity,
      input,
      "change_organization_member_status",
      { organizationId, organizationRevision, status, targetRevision, targetSubject },
      async () => {
        const actor = await requireOrganization(client, organizationId, identity.subject, { lock: true });
        assertManager(actor.role);
        assertRevision(actor.organization, organizationRevision);
        if (targetSubject === identity.subject) {
          throw new LibraryRepositoryError("organization_member_self_management_forbidden", 409);
        }
        const current = await client.query(`
          SELECT * FROM organization_members
           WHERE organization_id = $1 AND member_subject = $2 FOR UPDATE
        `, [organizationId, targetSubject]);
        const target = current.rows[0];
        if (!target) throw new LibraryRepositoryError("organization_member_not_found", 404);
        if (actor.role === "admin" && target.role === "admin") {
          throw new LibraryRepositoryError("organization_owner_required", 403);
        }
        if (target.status === "removed" || status === "active" && target.status !== "suspended") {
          throw new LibraryRepositoryError("organization_member_status_transition_invalid", 409);
        }
        const changed = await client.query(`
          UPDATE organization_members
             SET status = $3, revision = revision + 1, updated_at = now()
           WHERE organization_id = $1 AND member_subject = $2 AND revision = $4
           RETURNING *
        `, [organizationId, targetSubject, status, targetRevision]);
        if (!changed.rows[0]) throw new LibraryRepositoryError("organization_member_revision_conflict", 409);
        const nextRevision = await advanceOrganizationRevision(client, organizationId, organizationRevision);
        const response = { member: mapMember(changed.rows[0]), organizationRevision: nextRevision };
        return {
          audit: {
            action: "change_organization_member_status",
            detail: { status },
            organizationId,
            resourceId: targetSubject,
            resourceType: "organization_member"
          },
          response
        };
      }
    ));
  }

  async transferOwnership(identityValue, input) {
    const identity = requiredIdentity(identityValue);
    const organizationId = requiredOrganizationId(input.organizationId);
    const organizationRevision = expectedRevision(input.expectedRevision);
    const targetSubject = requiredSubject(input.targetSubject);
    const targetRevision = expectedRevision(input.expectedMemberRevision, "organization_member_revision_invalid");
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      identity,
      input,
      "transfer_organization_ownership",
      { organizationId, organizationRevision, targetRevision, targetSubject },
      async () => {
        const actor = await requireOrganization(client, organizationId, identity.subject, { lock: true });
        if (actor.role !== "owner") throw new LibraryRepositoryError("organization_owner_required", 403);
        assertRevision(actor.organization, organizationRevision);
        const removedTarget = await client.query(`
          DELETE FROM organization_members
           WHERE organization_id = $1 AND member_subject = $2
             AND status = 'active' AND revision = $3
           RETURNING *
        `, [organizationId, targetSubject, targetRevision]);
        if (!removedTarget.rows[0]) throw new LibraryRepositoryError("organization_member_revision_conflict", 409);
        const changed = await client.query(`
          UPDATE organizations
             SET owner_subject = $2, revision = revision + 1, updated_at = now()
           WHERE organization_id = $1 AND revision = $3
           RETURNING *
        `, [organizationId, targetSubject, organizationRevision]);
        if (!changed.rows[0]) throw new LibraryRepositoryError("organization_revision_conflict", 409);
        const priorOwner = await client.query(`
          INSERT INTO organization_members(
            organization_id, member_subject, role, status
          ) VALUES ($1, $2, 'admin', 'active')
          ON CONFLICT (organization_id, member_subject) DO UPDATE
            SET role = 'admin', status = 'active',
                revision = organization_members.revision + 1, updated_at = now()
          RETURNING *
        `, [organizationId, identity.subject]);
        const response = {
          newOwnerSubject: targetSubject,
          organizationId,
          organizationRevision: Number(changed.rows[0].revision),
          previousOwnerMembership: mapMember(priorOwner.rows[0])
        };
        return {
          audit: {
            action: "transfer_organization_ownership",
            detail: { newOwnerSubject: targetSubject, previousOwnerSubject: identity.subject },
            organizationId,
            resourceId: organizationId,
            resourceType: "organization"
          },
          response
        };
      }
    ));
  }
}
