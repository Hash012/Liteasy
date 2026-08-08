import { randomUUID } from "node:crypto";

export class PlatformAuthorizationError extends Error {
  constructor(code, statusCode = 403) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function createPlatformAdminRepository(database, options = {}) {
  const environment = options.environment ?? process.env.NODE_ENV ?? "development";
  const now = () => options.now?.() ?? new Date();

  function activeRole(ownerKey, role) {
    if (role === "developer_diagnostics" && environment === "production") {
      return false;
    }
    return database.prepare(`
      SELECT 1 FROM platform_role_assignments
      WHERE owner_key = ? AND role = ? AND environment = ? AND revoked_at IS NULL
    `).get(ownerKey, role, environment) !== undefined;
  }

  function audit(actorId, action, targetType, targetId, risk, reason, metadata = {}) {
    database.prepare(`
      INSERT INTO platform_audit_events (
        event_id, actor_user_id, action, target_type, target_id, risk,
        reason, metadata_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), actorId, action, targetType, targetId ?? null, risk,
      reason ?? null, JSON.stringify(metadata), now().toISOString()
    );
  }

  return {
    environment,

    hasRole(ownerKey, role) {
      return activeRole(ownerKey, role);
    },

    requirePlatformAdmin(ownerKey) {
      if (!activeRole(ownerKey, "platform_admin")) {
        throw new PlatformAuthorizationError("platform_admin_required");
      }
    },

    grantRole(ownerKey, role, grantedBy) {
      if (!["platform_admin", "developer_diagnostics"].includes(role)) {
        throw new PlatformAuthorizationError("invalid_platform_role", 400);
      }
      if (role === "developer_diagnostics" && environment === "production") {
        throw new PlatformAuthorizationError("production_diagnostics_forbidden", 403);
      }
      const timestamp = now().toISOString();
      database.prepare(`
        INSERT INTO platform_role_assignments (
          owner_key, role, environment, granted_by, granted_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, NULL)
        ON CONFLICT(owner_key, role, environment) DO UPDATE SET
          granted_by = excluded.granted_by,
          granted_at = excluded.granted_at,
          revoked_at = NULL
      `).run(ownerKey, role, environment, grantedBy, timestamp);
      audit(grantedBy, "platform_role_granted", "user", ownerKey, "high", null, { role });
    },

    grantSupportAccess(input) {
      const durationMinutes = Number(input.durationMinutes);
      const reason = typeof input.reason === "string" ? input.reason.trim() : "";
      if (
        !["user", "organization"].includes(input.scopeType) ||
        typeof input.scopeId !== "string" ||
        !input.scopeId.trim() ||
        !reason ||
        reason.length > 1000 ||
        !Number.isInteger(durationMinutes) ||
        durationMinutes < 1 ||
        durationMinutes > 60
      ) {
        throw new PlatformAuthorizationError("invalid_support_access_grant", 400);
      }
      const grantee = database.prepare(
        "SELECT status FROM users WHERE id = ?"
      ).get(input.granteeUserId);
      const scopedTargetExists = input.scopeType === "organization"
        ? database.prepare(
            "SELECT 1 FROM organizations WHERE organization_id = ? AND status = 'active'"
          ).get(input.scopeId.trim())
        : database.prepare(
            "SELECT 1 FROM users WHERE id = ? AND status = 'active'"
          ).get(input.scopeId.trim().replace(/^user:/, ""));
      if (
        grantee?.status !== "active" ||
        !activeRole(`user:${input.granteeUserId}`, "platform_admin") ||
        !scopedTargetExists
      ) {
        throw new PlatformAuthorizationError("invalid_support_access_target", 400);
      }
      const grantId = randomUUID();
      const grantedAt = now();
      const expiresAt = new Date(grantedAt.getTime() + durationMinutes * 60 * 1000);
      database.prepare(`
        INSERT INTO platform_support_access_grants (
          grant_id, grantee_user_id, scope_type, scope_id, reason,
          granted_by, granted_at, expires_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `).run(
        grantId,
        input.granteeUserId,
        input.scopeType,
        input.scopeId.trim(),
        reason,
        input.grantedBy,
        grantedAt.toISOString(),
        expiresAt.toISOString()
      );
      audit(input.grantedBy, "support_access_granted", input.scopeType, input.scopeId, "high", reason, {
        expiresAt: expiresAt.toISOString(),
        granteeUserId: input.granteeUserId,
        grantId
      });
      return {
        expiresAt: expiresAt.toISOString(),
        grantId,
        reason,
        scopeId: input.scopeId.trim(),
        scopeType: input.scopeType
      };
    },

    requireSupportAccess(granteeUserId, scopeType, scopeId) {
      const row = database.prepare(`
        SELECT * FROM platform_support_access_grants
        WHERE grantee_user_id = ? AND scope_type = ? AND scope_id = ?
          AND revoked_at IS NULL AND expires_at > ?
        ORDER BY expires_at DESC LIMIT 1
      `).get(granteeUserId, scopeType, scopeId, now().toISOString());
      if (!row) {
        throw new PlatformAuthorizationError("support_access_required", 403);
      }
      return {
        expiresAt: row.expires_at,
        grantId: row.grant_id,
        reason: row.reason
      };
    },

    revokeSupportAccess(grantId, revokedBy, reason) {
      const timestamp = now().toISOString();
      const result = database.prepare(`
        UPDATE platform_support_access_grants SET revoked_at = ?
        WHERE grant_id = ? AND revoked_at IS NULL
      `).run(timestamp, grantId);
      if (result.changes === 0) {
        throw new PlatformAuthorizationError("support_access_not_found", 404);
      }
      audit(revokedBy, "support_access_revoked", "support_grant", grantId, "high", reason);
      return { grantId, revoked: true };
    },

    listRetrievalSources() {
      return database.prepare(`
        SELECT source_id, name, source_kind, base_url, enabled, updated_at, updated_by
        FROM platform_retrieval_sources ORDER BY name COLLATE NOCASE, source_id
      `).all().map((row) => ({
        baseUrl: row.base_url,
        enabled: row.enabled === 1,
        name: row.name,
        sourceId: row.source_id,
        sourceKind: row.source_kind,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by
      }));
    },

    loadModelPolicy() {
      const row = database.prepare(
        "SELECT value_json FROM platform_runtime_settings WHERE setting_key = 'model_policy'"
      ).get();
      if (!row) return null;
      try {
        return JSON.parse(row.value_json);
      } catch {
        throw new PlatformAuthorizationError("stored_model_policy_invalid", 500);
      }
    },

    saveModelPolicy(policy, actorId) {
      const stored = {
        defaultProvider: policy.defaultProvider,
        localDirectEnabled: policy.localDirectEnabled,
        modelAccessMode: policy.modelAccessMode,
        policyVersion: policy.policyVersion,
        syncedAt: policy.syncedAt
      };
      database.prepare(`
        INSERT INTO platform_runtime_settings (setting_key, value_json, updated_by, updated_at)
        VALUES ('model_policy', ?, ?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `).run(JSON.stringify(stored), actorId, now().toISOString());
      return stored;
    },

    saveRetrievalSource(input, actorId) {
      const name = typeof input.name === "string" ? input.name.trim() : "";
      const sourceKind = input.sourceKind;
      const sourceId = typeof input.sourceId === "string" && input.sourceId.trim()
        ? input.sourceId.trim()
        : `source_${randomUUID()}`;
      if (!name || name.length > 120 || !["website", "database"].includes(sourceKind)) {
        throw new PlatformAuthorizationError("invalid_retrieval_source", 400);
      }
      let baseUrl;
      try {
        const parsed = new URL(String(input.baseUrl ?? ""));
        if (parsed.protocol !== "https:" && !(environment !== "production" && parsed.protocol === "http:")) {
          throw new Error("unsupported protocol");
        }
        if (parsed.username || parsed.password || parsed.search || parsed.hash) {
          throw new Error("credentials and query parameters are not allowed");
        }
        baseUrl = parsed.toString().replace(/\/$/, "");
      } catch {
        throw new PlatformAuthorizationError("invalid_retrieval_source_url", 400);
      }
      const timestamp = now().toISOString();
      database.prepare(`
        INSERT INTO platform_retrieval_sources (
          source_id, name, source_kind, base_url, enabled,
          created_by, created_at, updated_by, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET
          name = excluded.name,
          source_kind = excluded.source_kind,
          base_url = excluded.base_url,
          enabled = excluded.enabled,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `).run(
        sourceId, name, sourceKind, baseUrl, input.enabled === false ? 0 : 1,
        actorId, timestamp, actorId, timestamp
      );
      audit(actorId, "retrieval_source_saved", "retrieval_source", sourceId, "high", input.reason, {
        baseUrl,
        enabled: input.enabled !== false,
        sourceKind
      });
      return this.listRetrievalSources().find((source) => source.sourceId === sourceId);
    },

    removeRetrievalSource(sourceId, actorId, reason) {
      const result = database.prepare(
        "DELETE FROM platform_retrieval_sources WHERE source_id = ?"
      ).run(sourceId);
      if (result.changes === 0) {
        throw new PlatformAuthorizationError("retrieval_source_not_found", 404);
      }
      audit(actorId, "retrieval_source_removed", "retrieval_source", sourceId, "high", reason);
      return { removed: true, sourceId };
    },

    recordAudit(input) {
      audit(
        input.actorId,
        input.action,
        input.targetType,
        input.targetId,
        input.risk ?? "low",
        input.reason,
        input.metadata
      );
    },

    dashboard() {
      return {
        auditEvents: database.prepare(`
          SELECT actor_user_id, action, risk, occurred_at
          FROM platform_audit_events ORDER BY occurred_at DESC, event_id LIMIT 100
        `).all().map((row) => ({
          action: row.action,
          actorId: row.actor_user_id,
          occurredAt: row.occurred_at,
          risk: row.risk
        })),
        organizations: {
          items: database.prepare(`
            SELECT organization_id, name, owner_key, status, created_at
            FROM organizations ORDER BY created_at DESC, organization_id
          `).all().map((row) => ({
            createdAt: row.created_at,
            name: row.name,
            organizationId: row.organization_id,
            ownerKey: row.owner_key,
            status: row.status
          })),
          total: database.prepare(
            "SELECT count(*) AS count FROM organizations WHERE status = 'active'"
          ).get().count
        },
        sessions: {
          active: database.prepare(`
            SELECT count(*) AS count FROM auth_sessions
            WHERE revoked_at IS NULL AND expires_at > ?
          `).get(now().toISOString()).count
        },
        users: {
          active: database.prepare(
            "SELECT count(*) AS count FROM users WHERE status = 'active'"
          ).get().count,
          total: database.prepare("SELECT count(*) AS count FROM users").get().count,
          items: database.prepare(`
            SELECT id, email, display_name, membership_tier, status, created_at
            FROM users ORDER BY created_at DESC, id
          `).all().map((row) => ({
            createdAt: row.created_at,
            displayName: row.display_name,
            email: row.email,
            id: row.id,
            membershipTier: row.membership_tier,
            status: row.status
          }))
        },
        supportGrants: database.prepare(`
          SELECT grant_id, grantee_user_id, scope_type, scope_id, reason,
            granted_at, expires_at, revoked_at
          FROM platform_support_access_grants
          ORDER BY granted_at DESC, grant_id LIMIT 100
        `).all().map((row) => ({
          expiresAt: row.expires_at,
          grantId: row.grant_id,
          grantedAt: row.granted_at,
          granteeUserId: row.grantee_user_id,
          reason: row.reason,
          revokedAt: row.revoked_at,
          scopeId: row.scope_id,
          scopeType: row.scope_type
        }))
      };
    }
  };
}
