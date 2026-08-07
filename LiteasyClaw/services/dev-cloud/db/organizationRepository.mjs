import { randomUUID } from "node:crypto";

const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

const libraryAuditEvents = {
  attach_library_entry_pdf: ["为元数据条目补充 PDF", "medium"],
  copy_library_entry: ["复制组织文献", "medium"],
  create_library_folder: ["创建组织文献目录", "low"],
  create_metadata_entry: ["创建组织文献元数据条目", "low"],
  empty_library_trash: ["清空组织文献回收站", "high"],
  purge_library_entry: ["永久删除组织文献", "high"],
  purge_library_folder: ["永久删除组织文献目录", "high"],
  restore_library_entry: ["恢复组织文献", "medium"],
  restore_library_folder: ["恢复组织文献目录", "medium"],
  trash_library_entry: ["将组织文献移入回收站", "medium"],
  trash_library_folder: ["将组织文献目录移入回收站", "medium"],
  upload_team_annotation: ["上传组织协作批注", "low"],
  update_library_entry: ["更新组织文献", "medium"],
  update_library_folder: ["更新组织文献目录", "medium"],
  upload_library_document: ["上传组织文献", "low"],
  withdraw_team_annotation: ["撤回组织协作批注", "medium"]
};

function normalizeText(value, maximum = 240) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function normalizedName(value) {
  return normalizeText(value).normalize("NFKC").toLocaleLowerCase("en-US");
}

function publicMember(row) {
  return {
    id: row.owner_key,
    name: row.display_name,
    revision: 0,
    role: row.role,
    status: row.status === "suspended" ? "suspended" : "active",
    subject: row.owner_key
  };
}

export class OrganizationRepositoryError extends Error {
  constructor(code, statusCode = 400) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function createOrganizationRepository(database, options = {}) {
  const now = () => options.now?.() ?? new Date();
  const organizationById = database.prepare(`
    SELECT * FROM organizations WHERE organization_id = ? AND status = 'active'
  `);
  const membership = database.prepare(`
    SELECT * FROM organization_members
    WHERE organization_id = ? AND owner_key = ? AND status = 'active'
  `);
  const members = database.prepare(`
    SELECT * FROM organization_members
    WHERE organization_id = ? AND status = 'active'
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
      created_at, owner_key
  `);
  const managedMembers = database.prepare(`
    SELECT * FROM organization_members
    WHERE organization_id = ? AND status <> 'removed'
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
      created_at, owner_key
  `);

  function requireOrganization(organizationId) {
    const row = organizationById.get(normalizeText(organizationId, 180));
    if (!row) throw new OrganizationRepositoryError("organization_not_found", 404);
    return row;
  }

  function requireMembership(organizationId, ownerKey) {
    const row = membership.get(organizationId, ownerKey);
    if (!row) throw new OrganizationRepositoryError("organization_membership_required", 403);
    return row;
  }

  function recordAudit(organizationId, actorKey, action, description, risk = "low", metadata = {}) {
    database.prepare(`
      INSERT INTO organization_audit_events (
        event_id, organization_id, actor_key, action, description, risk,
        metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), organizationId, actorKey, action, description, risk,
      JSON.stringify(metadata), now().toISOString()
    );
  }

  function policyFor(organizationId) {
    return database.prepare(`
      SELECT upload_policy, export_policy, updated_by, updated_at
      FROM organization_storage_policies WHERE organization_id = ?
    `).get(organizationId);
  }

  const createTransaction = database.transaction((name, ownerKey, displayName) => {
    const timestamp = now().toISOString();
    const organizationId = `org_${randomUUID()}`;
    database.prepare(`
      INSERT INTO organizations (
        organization_id, name, normalized_name, owner_key, shared_library_name,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      organizationId,
      name,
      normalizedName(name),
      ownerKey,
      `${name} 共享文献库`,
      timestamp,
      timestamp
    );
    database.prepare(`
      INSERT INTO organization_members (
        organization_id, owner_key, display_name, role, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'owner', 'active', ?, ?)
    `).run(organizationId, ownerKey, displayName, timestamp, timestamp);
    database.prepare(`
      INSERT INTO organization_storage_policies (
        organization_id, upload_policy, export_policy, updated_by, updated_at
      ) VALUES (?, 'owner_admins', 'disabled', ?, ?)
    `).run(organizationId, ownerKey, timestamp);
    database.prepare(`
      INSERT INTO organization_active_selections (owner_key, organization_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(owner_key) DO UPDATE SET
        organization_id = excluded.organization_id,
        updated_at = excluded.updated_at
    `).run(ownerKey, organizationId, timestamp);
    recordAudit(organizationId, ownerKey, "organization_created", "创建组织");
    return organizationId;
  });

  const joinTransaction = database.transaction((organizationId, ownerKey, displayName) => {
    requireOrganization(organizationId);
    const existing = membership.get(organizationId, ownerKey);
    if (existing) return existing;
    const invitation = database.prepare(`
      SELECT * FROM organization_invitations
      WHERE organization_id = ? AND target_owner_key = ? AND status = 'pending'
        AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1
    `).get(organizationId, ownerKey, now().toISOString());
    if (!invitation) {
      throw new OrganizationRepositoryError("organization_invitation_required", 403);
    }
    const timestamp = now().toISOString();
    database.prepare(`
      INSERT INTO organization_members (
        organization_id, owner_key, display_name, role, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(organization_id, owner_key) DO UPDATE SET
        display_name = excluded.display_name,
        role = excluded.role,
        status = 'active',
        updated_at = excluded.updated_at
    `).run(
      organizationId, ownerKey, displayName, invitation.role, timestamp, timestamp
    );
    database.prepare(`
      UPDATE organization_invitations
      SET status = 'accepted', accepted_at = ? WHERE invitation_id = ?
    `).run(timestamp, invitation.invitation_id);
    database.prepare(`
      INSERT INTO organization_active_selections (owner_key, organization_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(owner_key) DO UPDATE SET
        organization_id = excluded.organization_id,
        updated_at = excluded.updated_at
    `).run(ownerKey, organizationId, timestamp);
    recordAudit(organizationId, ownerKey, "member_joined", "成员加入组织");
    return membership.get(organizationId, ownerKey);
  });

  return {
    recordLibraryAudit(organizationIdInput, actorKey, operationKindInput, metadata = {}) {
      const organizationId = normalizeText(organizationIdInput, 180);
      requireOrganization(organizationId);
      requireMembership(organizationId, actorKey);
      const operationKind = normalizeText(operationKindInput, 100);
      const event = libraryAuditEvents[operationKind];
      if (!event) {
        throw new OrganizationRepositoryError("invalid_organization_audit_event");
      }
      recordAudit(
        organizationId,
        actorKey,
        operationKind,
        event[0],
        event[1],
        metadata
      );
    },

    getMemberRole(organizationId, ownerKey) {
      return membership.get(organizationId, ownerKey)?.role ?? null;
    },

    getPolicy(organizationId, ownerKey) {
      const member = requireMembership(organizationId, ownerKey);
      const policy = policyFor(organizationId);
      return {
        exportPolicy: policy.export_policy,
        role: member.role,
        uploadPolicy: policy.upload_policy,
        updatedAt: policy.updated_at,
        updatedBy: policy.updated_by
      };
    },

    canUpload(organizationId, ownerKey) {
      const member = requireMembership(organizationId, ownerKey);
      const policy = policyFor(organizationId);
      return member.role === "owner" || member.role === "admin" || policy.upload_policy === "all_members";
    },

    canExport(organizationId, ownerKey) {
      const member = requireMembership(organizationId, ownerKey);
      const policy = policyFor(organizationId);
      return member.role === "owner" || policy.export_policy === "all_members" || (
        policy.export_policy === "admins_only" && member.role === "admin"
      );
    },

    list(ownerKey) {
      const rows = database.prepare(`
        SELECT o.*, m.role,
          (SELECT count(*) FROM organization_members cm
            WHERE cm.organization_id = o.organization_id AND cm.status = 'active') AS member_count
        FROM organization_members m
        JOIN organizations o ON o.organization_id = m.organization_id
        WHERE m.owner_key = ? AND m.status = 'active' AND o.status = 'active'
        ORDER BY o.updated_at DESC, o.organization_id
      `).all(ownerKey);
      const selected = database.prepare(`
        SELECT organization_id FROM organization_active_selections WHERE owner_key = ?
      `).get(ownerKey)?.organization_id;
      const organizations = rows.map((row) => ({
        canCreateOrganization: true,
        memberCount: row.member_count,
        myRole: row.role,
        name: row.name,
        organizationId: row.organization_id,
        ownerUserId: row.owner_key,
        sharedLibraryName: row.shared_library_name
      }));
      return {
        activeOrganizationId: organizations.some((item) => item.organizationId === selected)
          ? selected
          : organizations[0]?.organizationId ?? "",
        organizations
      };
    },

    getSummary(organizationId, ownerKey, quota = {}) {
      const organization = requireOrganization(organizationId);
      const currentMember = requireMembership(organizationId, ownerKey);
      const activeMembers = members.all(organizationId);
      const organizationMembers = managedMembers.all(organizationId);
      const notifications = database.prepare(`
        SELECT * FROM organization_notifications
        WHERE organization_id = ? ORDER BY created_at DESC, notification_id LIMIT 100
      `).all(organizationId).map((row) => ({
        id: row.notification_id,
        message: row.message,
        type: row.notification_type
      }));
      const auditEvents = database.prepare(`
        SELECT * FROM organization_audit_events
        WHERE organization_id = ? ORDER BY created_at DESC, event_id LIMIT 100
      `).all(organizationId).map((row) => ({
        actor: row.actor_key,
        description: row.description,
        id: row.event_id,
        occurredAt: row.created_at
      }));
      const documents = Array.isArray(quota.documents) ? quota.documents : [];
      const policy = policyFor(organizationId);
      return {
        auditEvents,
        canCreateOrganization: true,
        memberCount: activeMembers.length,
        members: organizationMembers.map(publicMember),
        myMemberRevision: 0,
        myRole: currentMember.role,
        name: organization.name,
        notifications,
        organizationId: organization.organization_id,
        ownerUserId: organization.owner_key,
        policy: {
          exportPolicy: policy.export_policy,
          uploadPolicy: policy.upload_policy
        },
        quota: {
          configured: Number(quota.limitBytes ?? 0) > 0,
          storageLimitGb: Number(quota.limitBytes ?? 0) / (1024 ** 3),
          storageUsedGb: Number(quota.usedBytes ?? 0) / (1024 ** 3)
        },
        sharedLibrary: {
          documentCount: documents.length,
          documents: documents.map((entry) => ({
            id: entry.documentId,
            sourcePath: entry.entryKind === "pdf"
              ? `org://${organizationId}/shared-library/${entry.documentId}.pdf`
              : `org://${organizationId}/shared-library/${entry.documentId}`,
            title: entry.title
          })),
          name: organization.shared_library_name,
          ownerUserId: organization.owner_key,
          status: "available"
        },
        revision: 0
      };
    },

    getManifestIdentity(organizationId, ownerKey) {
      const organization = requireOrganization(organizationId);
      requireMembership(organizationId, ownerKey);
      return {
        name: organization.shared_library_name,
        organizationId: organization.organization_id,
        rootFolderId: `root:${organization.organization_id}`,
        status: "available"
      };
    },

    getGovernance(organizationId, ownerKey, quota = {}) {
      const member = requireMembership(organizationId, ownerKey);
      if (member.role === "member") {
        throw new OrganizationRepositoryError("organization_role_forbidden", 403);
      }
      const policy = policyFor(organizationId);
      const recentAuditEvents = database.prepare(`
        SELECT event_id, description, risk FROM organization_audit_events
        WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100
      `).all(organizationId).map((row) => ({
        id: row.event_id,
        label: row.description,
        risk: row.risk
      }));
      return {
        auditQueue: {
          highRisk: recentAuditEvents.filter((event) => event.risk === "high").length,
          pendingReview: 0
        },
        policy: {
          exportPolicy: policy.export_policy,
          uploadPolicy: policy.upload_policy
        },
        quota: {
          modelCallsLimit: 0,
          modelCallsUsed: 0,
          storageLimitGb: Number(quota.limitBytes ?? 0) / (1024 ** 3),
          storageUsedGb: Number(quota.usedBytes ?? 0) / (1024 ** 3)
        },
        recentAuditEvents,
        runningTasks: []
      };
    },

    create(nameInput, ownerKey, displayNameInput) {
      const name = normalizeText(nameInput, 120);
      if (!name) throw new OrganizationRepositoryError("invalid_organization_name");
      const organizationId = createTransaction(
        name,
        ownerKey,
        normalizeText(displayNameInput, 120) || ownerKey
      );
      return {
        organization: {
          myRole: "owner",
          name,
          organizationId,
          ownerUserId: ownerKey
        }
      };
    },

    join(organizationIdInput, ownerKey, displayNameInput) {
      const organizationId = normalizeText(organizationIdInput, 180);
      const joined = joinTransaction(
        organizationId,
        ownerKey,
        normalizeText(displayNameInput, 120) || ownerKey
      );
      return {
        membership: {
          organizationId,
          role: joined.role,
          sessionId: ownerKey
        }
      };
    },

    invite(organizationIdInput, actorKey, targetOwnerKeyInput, roleInput = "member") {
      const organizationId = normalizeText(organizationIdInput, 180);
      const actor = requireMembership(organizationId, actorKey);
      if (actor.role === "member") {
        throw new OrganizationRepositoryError("organization_role_forbidden", 403);
      }
      const targetOwnerKey = normalizeText(targetOwnerKeyInput, 180);
      const role = roleInput === "admin" ? "admin" : "member";
      if (!targetOwnerKey || targetOwnerKey === actorKey) {
        throw new OrganizationRepositoryError("invalid_organization_invite");
      }
      const timestamp = now();
      const invitationId = randomUUID();
      database.prepare(`
        INSERT INTO organization_invitations (
          invitation_id, organization_id, target_owner_key, role, invited_by,
          status, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        ON CONFLICT(organization_id, target_owner_key) WHERE status = 'pending'
        DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by,
          expires_at = excluded.expires_at, created_at = excluded.created_at
      `).run(
        invitationId,
        organizationId,
        targetOwnerKey,
        role,
        actorKey,
        new Date(timestamp.getTime() + invitationLifetimeMs).toISOString(),
        timestamp.toISOString()
      );
      recordAudit(organizationId, actorKey, "member_invited", "邀请组织成员", "low", {
        role,
        targetOwnerKey
      });
      const invitation = database.prepare(`
        SELECT * FROM organization_invitations
        WHERE organization_id = ? AND target_owner_key = ? AND status = 'pending'
      `).get(organizationId, targetOwnerKey);
      return {
        invite: {
          organizationId,
          role,
          sessionId: actorKey,
          targetUserId: targetOwnerKey
        },
        invitation: {
          invitationToken: invitation.invitation_id,
          organizationId,
          revision: 0,
          role,
          status: "pending",
          targetSubject: targetOwnerKey
        }
      };
    },

    joinByInvitation(invitationTokenInput, ownerKey, displayNameInput) {
      const invitationToken = normalizeText(invitationTokenInput, 180);
      const invitation = database.prepare(`
        SELECT * FROM organization_invitations
        WHERE invitation_id = ? AND target_owner_key = ? AND status = 'pending'
          AND expires_at > ?
      `).get(invitationToken, ownerKey, now().toISOString());
      if (!invitation) {
        throw new OrganizationRepositoryError("organization_invitation_required", 403);
      }
      const joined = joinTransaction(
        invitation.organization_id,
        ownerKey,
        normalizeText(displayNameInput, 120) || ownerKey
      );
      return {
        membership: {
          organizationId: invitation.organization_id,
          role: joined.role,
          sessionId: ownerKey
        },
        organizationId: invitation.organization_id
      };
    },

    changeMemberRole(organizationIdInput, actorKey, targetOwnerKeyInput, roleInput) {
      const organizationId = normalizeText(organizationIdInput, 180);
      const actor = requireMembership(organizationId, actorKey);
      if (actor.role !== "owner") {
        throw new OrganizationRepositoryError("organization_owner_required", 403);
      }
      const targetOwnerKey = normalizeText(targetOwnerKeyInput, 180);
      const target = membership.get(organizationId, targetOwnerKey);
      if (!target || target.role === "owner") {
        throw new OrganizationRepositoryError("organization_member_not_found", 404);
      }
      const role = roleInput === "admin" ? "admin" : roleInput === "member" ? "member" : "";
      if (!role) throw new OrganizationRepositoryError("organization_role_invalid");
      database.transaction(() => {
        database.prepare(`
          UPDATE organization_members SET role = ?, updated_at = ?
          WHERE organization_id = ? AND owner_key = ? AND status = 'active'
        `).run(role, now().toISOString(), organizationId, targetOwnerKey);
        recordAudit(organizationId, actorKey, "member_role_changed", "修改成员角色", "medium", {
          role,
          targetOwnerKey
        });
      })();
      return { member: publicMember(membership.get(organizationId, targetOwnerKey)), organizationRevision: 0 };
    },

    setMemberStatus(organizationIdInput, actorKey, targetOwnerKeyInput, statusInput) {
      const organizationId = normalizeText(organizationIdInput, 180);
      const actor = requireMembership(organizationId, actorKey);
      if (actor.role !== "owner" && actor.role !== "admin") {
        throw new OrganizationRepositoryError("organization_role_forbidden", 403);
      }
      const targetOwnerKey = normalizeText(targetOwnerKeyInput, 180);
      const target = database.prepare(`
        SELECT * FROM organization_members WHERE organization_id = ? AND owner_key = ?
      `).get(organizationId, targetOwnerKey);
      if (!target || target.role === "owner") {
        throw new OrganizationRepositoryError("organization_member_not_found", 404);
      }
      if (targetOwnerKey === actorKey) {
        throw new OrganizationRepositoryError("organization_member_self_management_forbidden", 409);
      }
      if (actor.role === "admin" && target.role === "admin") {
        throw new OrganizationRepositoryError("organization_owner_required", 403);
      }
      const status = ["active", "removed", "suspended"].includes(statusInput) ? statusInput : "";
      if (!status || target.status === "removed" || status === "active" && target.status !== "suspended") {
        throw new OrganizationRepositoryError("organization_member_status_transition_invalid", 409);
      }
      database.transaction(() => {
        database.prepare(`
          UPDATE organization_members SET status = ?, updated_at = ?
          WHERE organization_id = ? AND owner_key = ?
        `).run(status, now().toISOString(), organizationId, targetOwnerKey);
        if (status === "removed") {
          database.prepare(`
            DELETE FROM organization_active_selections
            WHERE owner_key = ? AND organization_id = ?
          `).run(targetOwnerKey, organizationId);
        }
        recordAudit(organizationId, actorKey, "member_status_changed", "修改成员状态", "medium", {
          status,
          targetOwnerKey
        });
      })();
      const changed = database.prepare(`
        SELECT * FROM organization_members WHERE organization_id = ? AND owner_key = ?
      `).get(organizationId, targetOwnerKey);
      return { member: publicMember(changed), organizationRevision: 0 };
    },

    transferOwnership(organizationIdInput, actorKey, targetOwnerKeyInput) {
      const organizationId = normalizeText(organizationIdInput, 180);
      const actor = requireMembership(organizationId, actorKey);
      if (actor.role !== "owner") {
        throw new OrganizationRepositoryError("organization_owner_required", 403);
      }
      const targetOwnerKey = normalizeText(targetOwnerKeyInput, 180);
      const target = membership.get(organizationId, targetOwnerKey);
      if (!target || target.role === "owner") {
        throw new OrganizationRepositoryError("organization_member_not_found", 404);
      }
      database.transaction(() => {
        const timestamp = now().toISOString();
        database.prepare(`
          UPDATE organization_members SET role = 'admin', updated_at = ?
          WHERE organization_id = ? AND owner_key = ?
        `).run(timestamp, organizationId, actorKey);
        database.prepare(`
          UPDATE organization_members SET role = 'owner', updated_at = ?
          WHERE organization_id = ? AND owner_key = ? AND status = 'active'
        `).run(timestamp, organizationId, targetOwnerKey);
        database.prepare(`
          UPDATE organizations SET owner_key = ?, updated_at = ? WHERE organization_id = ?
        `).run(targetOwnerKey, timestamp, organizationId);
        recordAudit(organizationId, actorKey, "ownership_transferred", "转移组织所有权", "high", {
          targetOwnerKey
        });
      })();
      return {
        newOwnerSubject: targetOwnerKey,
        organizationId,
        organizationRevision: 0,
        previousOwnerMembership: publicMember(membership.get(organizationId, actorKey))
      };
    },

    leave(organizationIdInput, ownerKey) {
      const organizationId = normalizeText(organizationIdInput, 180);
      const member = requireMembership(organizationId, ownerKey);
      if (member.role === "owner") {
        throw new OrganizationRepositoryError("organization_owner_leave_blocked", 403);
      }
      const timestamp = now().toISOString();
      database.transaction(() => {
        database.prepare(`
          UPDATE organization_members SET status = 'removed', updated_at = ?
          WHERE organization_id = ? AND owner_key = ?
        `).run(timestamp, organizationId, ownerKey);
        database.prepare(`
          DELETE FROM organization_active_selections
          WHERE owner_key = ? AND organization_id = ?
        `).run(ownerKey, organizationId);
        recordAudit(organizationId, ownerKey, "member_left", "成员退出组织");
      })();
      return { left: true, organizationId, sessionId: ownerKey };
    },

    updatePolicy(organizationIdInput, ownerKey, changes = {}) {
      const organizationId = normalizeText(organizationIdInput, 180);
      const member = requireMembership(organizationId, ownerKey);
      if (member.role !== "owner") {
        throw new OrganizationRepositoryError("organization_policy_forbidden", 403);
      }
      const current = policyFor(organizationId);
      const uploadPolicy = changes.uploadPolicy === "all_members"
        ? "all_members"
        : changes.uploadPolicy === "owner_admins"
          ? "owner_admins"
          : current.upload_policy;
      const exportPolicy = ["disabled", "admins_only", "all_members"].includes(changes.exportPolicy)
        ? changes.exportPolicy
        : current.export_policy;
      const timestamp = now().toISOString();
      database.prepare(`
        UPDATE organization_storage_policies SET
          upload_policy = ?, export_policy = ?, updated_by = ?, updated_at = ?
        WHERE organization_id = ?
      `).run(uploadPolicy, exportPolicy, ownerKey, timestamp, organizationId);
      recordAudit(
        organizationId,
        ownerKey,
        "storage_policy_updated",
        "更新组织文献库策略",
        "medium",
        { exportPolicy, uploadPolicy }
      );
      return this.getPolicy(organizationId, ownerKey);
    }
  };
}
