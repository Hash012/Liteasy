import { createHash, randomUUID } from "node:crypto";
import { IdentityError } from "./identityVerifier.mjs";
import { withPostgresTransaction } from "./postgres.mjs";

const roles = new Set(["platform_admin", "developer_diagnostics"]);
const scopeTypes = new Set(["user", "organization"]);
const directModelProviderHosts = new Set([
  "api.deepseek.com",
  "api.mosshubs.com",
  "api.openai.com",
  "nowcoding.ai"
]);
const retrievalConnectorEndpoints = Object.freeze({
  crossref: "https://api.crossref.org/works",
  openalex: "https://api.openalex.org/works",
  semantic_scholar: "https://api.semanticscholar.org/graph/v1/paper/search"
});
const secretFieldPattern = /(?:api.?key|credential|password|secret|token)/i;

function identifier(value, code) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,300}$/.test(value)) {
    throw new PlatformAdminError(code);
  }
  return value;
}

function requiredText(value, minimum, maximum, code) {
  if (typeof value !== "string") throw new PlatformAdminError(code);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < minimum || normalized.length > maximum) throw new PlatformAdminError(code);
  return normalized;
}

function operationKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
    throw new PlatformAdminError("idempotency_key_invalid");
  }
  return value;
}

function role(value, environment) {
  if (!roles.has(value)) throw new PlatformAdminError("platform_role_invalid");
  if (value === "developer_diagnostics" && environment === "production") {
    throw new PlatformAdminError("production_diagnostics_forbidden", 403);
  }
  return value;
}

function auditId() {
  return `audit_${randomUUID()}`;
}

function mapRoleGrant(row) {
  return {
    activatedAt: row.activated_at?.toISOString() ?? null,
    bootstrap: row.bootstrap,
    grantId: row.grant_id,
    grantedAt: row.granted_at.toISOString(),
    grantedBy: row.granted_by,
    reason: row.reason,
    role: row.role,
    state: row.state,
    subjectId: row.subject_id
  };
}

function mapSupportGrant(row) {
  return {
    documentId: row.document_id,
    expiresAt: row.expires_at.toISOString(),
    grantId: row.grant_id,
    grantedAt: row.granted_at.toISOString(),
    grantedBy: row.granted_by,
    granteeSubject: row.grantee_subject,
    reason: row.reason,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    scopeId: row.scope_id,
    scopeType: row.scope_type
  };
}

function quotaScope(input) {
  const scopeType = scopeTypes.has(input.scopeType) ? input.scopeType : null;
  if (!scopeType) throw new PlatformAdminError("quota_scope_invalid");
  return {
    scopeId: identifier(input.scopeId, "quota_scope_invalid"),
    scopeType
  };
}

function quotaLimit(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PlatformAdminError("quota_limit_invalid");
  }
  return value;
}

function quotaRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PlatformAdminError("quota_revision_invalid");
  }
  return value;
}

function mapQuota(row, scope) {
  return {
    configured: row.limit_bytes !== null && row.limit_bytes !== undefined,
    limitBytes: row.limit_bytes === null || row.limit_bytes === undefined
      ? null
      : Number(row.limit_bytes),
    revision: row.revision === null || row.revision === undefined ? 0 : Number(row.revision),
    scopeId: scope.scopeId,
    scopeType: scope.scopeType,
    updatedAt: row.updated_at?.toISOString() ?? null,
    updatedBy: row.updated_by ?? null,
    usedBytes: Number(row.used_bytes ?? 0)
  };
}

function exactFields(input, allowed, code) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PlatformAdminError(code);
  }
  for (const key of Object.keys(input)) {
    if (secretFieldPattern.test(key)) {
      throw new PlatformAdminError("admin_secret_material_forbidden");
    }
    if (!allowed.has(key)) throw new PlatformAdminError(code);
  }
}

function nonNegativeRevision(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) throw new PlatformAdminError(code);
  return value;
}

function isPrivateHostname(value) {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") || hostname === "::1" ||
    hostname.startsWith("fc") || hostname.startsWith("fd") ||
    hostname.startsWith("fe8") || hostname.startsWith("fe9") ||
    hostname.startsWith("fea") || hostname.startsWith("feb")
  ) {
    return true;
  }
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 198 && (octets[1] === 18 || octets[1] === 19)) ||
    octets[0] >= 224;
}

function publicEndpoint(value, environment, code, { modelProxy = false } = {}) {
  if (typeof value !== "string" || value.length > 2048) throw new PlatformAdminError(code);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new PlatformAdminError(code);
  }
  const testLoopback = environment === "test" && parsed.protocol === "http:" &&
    new Set(["127.0.0.1", "[::1]", "localhost"]).has(parsed.hostname.toLowerCase());
  if (parsed.protocol !== "https:" && !testLoopback) throw new PlatformAdminError(code);
  if (
    parsed.username || parsed.password || parsed.search || parsed.hash ||
    (!testLoopback && isPrivateHostname(parsed.hostname)) ||
    (modelProxy && directModelProviderHosts.has(parsed.hostname.toLowerCase()))
  ) {
    throw new PlatformAdminError(code);
  }
  return parsed.toString().replace(/\/$/, "");
}

function mapModelPolicy(row) {
  const revision = Number(row.revision);
  return {
    cloudProxyEndpoint: row.cloud_proxy_endpoint,
    defaultProvider: row.default_provider,
    policyVersion: `policy-${revision}`,
    revision,
    syncedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by
  };
}

function mapRetrievalSource(row) {
  return {
    baseUrl: row.base_url,
    connectorType: row.connector_type,
    enabled: row.enabled,
    name: row.name,
    revision: Number(row.revision),
    sourceId: row.source_id,
    sourceKind: row.source_kind,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by
  };
}

function retrievalConnectorEndpoint(connectorType, value) {
  const expected = retrievalConnectorEndpoints[connectorType];
  if (!expected) throw new PlatformAdminError("retrieval_source_connector_invalid");
  if (value !== expected) throw new PlatformAdminError("retrieval_source_url_invalid");
  return expected;
}

function mapOrganization(row) {
  return {
    createdAt: row.created_at.toISOString(),
    limitBytes: row.limit_bytes === null || row.limit_bytes === undefined
      ? null
      : Number(row.limit_bytes),
    memberCount: Number(row.member_count ?? 0),
    name: row.name,
    organizationId: row.organization_id,
    ownerSubject: row.owner_subject,
    revision: Number(row.revision),
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
    usedBytes: Number(row.used_bytes ?? 0)
  };
}

function mapAccountStatus(row) {
  return {
    identityUpdatedAt: row.identity_updated_at.toISOString(),
    reason: row.reason,
    status: row.status,
    subjectId: row.subject_id,
    updatedAt: row.updated_at.toISOString(),
    updatedBy: row.updated_by
  };
}

async function appendAudit(client, input) {
  await client.query(`
    INSERT INTO audit_events(
      audit_id, actor_id, actor_audience, action, resource_type, resource_id,
      scope_type, scope_id, reason, trace_id, detail
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
  `, [
    auditId(), input.actorId, input.actorAudience, input.action, input.resourceType,
    input.resourceId ?? null, input.scopeType ?? null, input.scopeId ?? null,
    input.reason ?? null, input.traceId, JSON.stringify(input.detail ?? {})
  ]);
}

async function idempotentMutation(client, actorId, input, operation, requestBody, mutate) {
  const key = operationKey(input.idempotencyKey);
  const requestHash = createHash("sha256").update(JSON.stringify(requestBody)).digest("hex");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `${actorId}:${operation}:${key}`
  ]);
  const prior = await client.query(`
    SELECT request_hash, response_body FROM idempotency_records
     WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3 AND expires_at > now()
  `, [actorId, operation, key]);
  if (prior.rows[0]) {
    if (prior.rows[0].request_hash !== requestHash) {
      throw new PlatformAdminError("idempotency_key_reused", 409);
    }
    return prior.rows[0].response_body;
  }
  const response = await mutate();
  await client.query(`
    INSERT INTO idempotency_records(
      actor_id, operation, idempotency_key, request_hash, response_status,
      response_body, expires_at
    ) VALUES ($1, $2, $3, $4, 200, $5::jsonb, now() + interval '24 hours')
  `, [actorId, operation, key, requestHash, JSON.stringify(response)]);
  return response;
}

export class PlatformAdminError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export class PostgresPlatformAdminRepository {
  constructor(pool, { environment }) {
    this.pool = pool;
    this.environment = environment;
  }

  async hasRole(subjectInput, requestedRole) {
    const subjectId = identifier(subjectInput, "identity_subject_invalid");
    if (!roles.has(requestedRole)) throw new PlatformAdminError("platform_role_invalid");
    if (requestedRole === "developer_diagnostics" && this.environment === "production") {
      return false;
    }
    const result = await this.pool.query(`
      SELECT 1 FROM platform_role_grants
       WHERE subject_id = $1 AND role = $2 AND state = 'active'
       LIMIT 1
    `, [subjectId, requestedRole]);
    return Boolean(result.rows[0]);
  }

  async bootstrap(subjectInput, input) {
    const subjectId = identifier(subjectInput, "identity_subject_invalid");
    const reason = requiredText(input.reason, 8, 1000, "admin_reason_invalid");
    const traceId = identifier(input.traceId, "trace_id_invalid");
    return withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('liteasy-platform-admin-bootstrap-v1'))");
      const existing = await client.query(`
        SELECT 1 FROM platform_role_grants
         WHERE role = 'platform_admin' AND state IN ('pending_activation', 'active')
         LIMIT 1
      `);
      if (existing.rows[0]) throw new PlatformAdminError("platform_admin_already_bootstrapped", 409);
      const grantId = `rolegrant_${randomUUID()}`;
      const result = await client.query(`
        INSERT INTO platform_role_grants(
          grant_id, subject_id, role, state, bootstrap, granted_by, reason
        ) VALUES ($1, $2, 'platform_admin', 'pending_activation', true, 'bootstrap', $3)
        RETURNING *
      `, [grantId, subjectId, reason]);
      await appendAudit(client, {
        action: "platform_admin_bootstrapped",
        actorAudience: "service",
        actorId: "bootstrap",
        detail: { state: "pending_activation", subjectId },
        reason,
        resourceId: grantId,
        resourceType: "platform_role_grant",
        traceId
      });
      return { grant: mapRoleGrant(result.rows[0]) };
    });
  }

  async principal(identity, { activatePending = false, traceId } = {}) {
    if (identity?.audience !== "liteasy-admin") throw new IdentityError("admin_audience_required", 403);
    const subjectId = identifier(identity.subject, "identity_subject_invalid");
    if (activatePending) {
      return withPostgresTransaction(this.pool, async (client) => {
        const pending = await client.query(`
          UPDATE platform_role_grants
             SET state = 'active', activated_at = now()
           WHERE subject_id = $1 AND role = 'platform_admin'
             AND state = 'pending_activation' AND bootstrap = true
           RETURNING *
        `, [subjectId]);
        if (pending.rows[0]) {
          await appendAudit(client, {
            action: "platform_admin_activated",
            actorAudience: "liteasy-admin",
            actorId: subjectId,
            detail: { grantId: pending.rows[0].grant_id },
            resourceId: subjectId,
            resourceType: "platform_principal",
            traceId: identifier(traceId, "trace_id_invalid")
          });
        }
        return this.#loadPrincipal(client, subjectId);
      });
    }
    return this.#loadPrincipal(this.pool, subjectId);
  }

  async grantRole(principal, input) {
    this.#requireRoleAdministrator(principal);
    const subjectId = identifier(input.subjectId, "identity_subject_invalid");
    const grantedRole = role(input.role, this.environment);
    const reason = requiredText(input.reason, 8, 1000, "admin_reason_invalid");
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      principal.subjectId,
      input,
      "grant_platform_role",
      { reason, role: grantedRole, subjectId },
      async () => {
        const existing = await client.query(`
          SELECT * FROM platform_role_grants
           WHERE subject_id = $1 AND role = $2 AND state IN ('pending_activation', 'active')
           FOR UPDATE
        `, [subjectId, grantedRole]);
        if (existing.rows[0]) throw new PlatformAdminError("platform_role_already_granted", 409);
        const grantId = `rolegrant_${randomUUID()}`;
        const result = await client.query(`
          INSERT INTO platform_role_grants(
            grant_id, subject_id, role, state, bootstrap, granted_by, reason, activated_at
          ) VALUES ($1, $2, $3, 'active', false, $4, $5, now())
          RETURNING *
        `, [grantId, subjectId, grantedRole, principal.subjectId, reason]);
        await appendAudit(client, {
          action: "platform_role_granted",
          actorAudience: "liteasy-admin",
          actorId: principal.subjectId,
          detail: { role: grantedRole, subjectId },
          reason,
          resourceId: grantId,
          resourceType: "platform_role_grant",
          traceId: identifier(input.traceId, "trace_id_invalid")
        });
        return { grant: mapRoleGrant(result.rows[0]) };
      }
    ));
  }

  async revokeRole(principal, input) {
    this.#requirePlatformAdmin(principal);
    const grantId = identifier(input.grantId, "platform_role_grant_invalid");
    const reason = requiredText(input.reason, 8, 1000, "admin_reason_invalid");
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      principal.subjectId,
      input,
      "revoke_platform_role",
      { grantId, reason },
      async () => {
        const current = await client.query(`
          SELECT * FROM platform_role_grants WHERE grant_id = $1 FOR UPDATE
        `, [grantId]);
        const row = current.rows[0];
        if (!row || row.state === "revoked") throw new PlatformAdminError("platform_role_grant_not_found", 404);
        if (row.role === "platform_admin") {
          const remaining = await client.query(`
            SELECT count(*)::integer AS count FROM platform_role_grants
             WHERE role = 'platform_admin' AND state = 'active' AND grant_id <> $1
          `, [grantId]);
          if (remaining.rows[0].count < 1) throw new PlatformAdminError("last_platform_admin_required", 409);
        }
        const result = await client.query(`
          UPDATE platform_role_grants
             SET state = 'revoked', revoked_by = $2, revoked_reason = $3, revoked_at = now()
           WHERE grant_id = $1 RETURNING *
        `, [grantId, principal.subjectId, reason]);
        await appendAudit(client, {
          action: "platform_role_revoked",
          actorAudience: "liteasy-admin",
          actorId: principal.subjectId,
          detail: { role: row.role, subjectId: row.subject_id },
          reason,
          resourceId: grantId,
          resourceType: "platform_role_grant",
          traceId: identifier(input.traceId, "trace_id_invalid")
        });
        return { grantId, revoked: true, revokedAt: result.rows[0].revoked_at.toISOString() };
      }
    ));
  }

  async grantSupportAccess(principal, input) {
    this.#requirePlatformAdmin(principal);
    const granteeSubject = identifier(input.granteeSubject, "identity_subject_invalid");
    const documentId = identifier(input.documentId, "library_document_invalid");
    const scopeType = scopeTypes.has(input.scopeType) ? input.scopeType : null;
    if (!scopeType) throw new PlatformAdminError("support_scope_invalid");
    const scopeId = identifier(input.scopeId, "support_scope_invalid");
    const reason = requiredText(input.reason, 12, 1000, "support_reason_invalid");
    if (!Number.isSafeInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > 60) {
      throw new PlatformAdminError("support_duration_invalid");
    }
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      principal.subjectId,
      input,
      "grant_support_access",
      { documentId, durationMinutes: input.durationMinutes, granteeSubject, reason, scopeId, scopeType },
      async () => {
        const grantee = await client.query(`
          SELECT 1 FROM platform_role_grants
           WHERE subject_id = $1 AND role = 'platform_admin' AND state = 'active'
        `, [granteeSubject]);
        if (!grantee.rows[0]) throw new PlatformAdminError("support_grantee_not_admin", 409);
        const grantId = `supportgrant_${randomUUID()}`;
        const result = await client.query(`
          INSERT INTO platform_support_access_grants(
            grant_id, grantee_subject, scope_type, scope_id, document_id, reason,
            granted_by, expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8 * interval '1 minute'))
          RETURNING *
        `, [
          grantId, granteeSubject, scopeType, scopeId, documentId, reason,
          principal.subjectId, input.durationMinutes
        ]);
        await appendAudit(client, {
          action: "support_access_granted",
          actorAudience: "liteasy-admin",
          actorId: principal.subjectId,
          detail: { documentId, expiresAt: result.rows[0].expires_at.toISOString(), granteeSubject },
          reason,
          resourceId: grantId,
          resourceType: "support_access_grant",
          scopeId,
          scopeType,
          traceId: identifier(input.traceId, "trace_id_invalid")
        });
        return { grant: mapSupportGrant(result.rows[0]) };
      }
    ));
  }

  async revokeSupportAccess(principal, input) {
    this.#requirePlatformAdmin(principal);
    const grantId = identifier(input.grantId, "support_grant_invalid");
    const reason = requiredText(input.reason, 8, 1000, "support_reason_invalid");
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      principal.subjectId,
      input,
      "revoke_support_access",
      { grantId, reason },
      async () => {
        const result = await client.query(`
          UPDATE platform_support_access_grants
             SET revoked_by = $2, revoked_reason = $3, revoked_at = now()
           WHERE grant_id = $1 AND revoked_at IS NULL
           RETURNING *
        `, [grantId, principal.subjectId, reason]);
        if (!result.rows[0]) throw new PlatformAdminError("support_grant_not_found", 404);
        await appendAudit(client, {
          action: "support_access_revoked",
          actorAudience: "liteasy-admin",
          actorId: principal.subjectId,
          reason,
          resourceId: grantId,
          resourceType: "support_access_grant",
          scopeId: result.rows[0].scope_id,
          scopeType: result.rows[0].scope_type,
          traceId: identifier(input.traceId, "trace_id_invalid")
        });
        return { grantId, revoked: true, revokedAt: result.rows[0].revoked_at.toISOString() };
      }
    ));
  }

  async resolveSupportScope(principal, input) {
    this.#requirePlatformAdmin(principal);
    const grantId = identifier(input.grantId, "support_grant_invalid");
    const documentId = identifier(input.documentId, "library_document_invalid");
    const result = await this.pool.query(`
      SELECT * FROM platform_support_access_grants
       WHERE grant_id = $1 AND grantee_subject = $2
         AND document_id = $3
         AND revoked_at IS NULL AND expires_at > now()
    `, [grantId, principal.subjectId, documentId]);
    const grant = result.rows[0];
    if (!grant) throw new PlatformAdminError("support_access_required", 403);
    return {
      actorId: principal.subjectId,
      grant: mapSupportGrant(grant),
      role: "support",
      scopeId: grant.scope_id,
      scopeType: grant.scope_type
    };
  }

  async listAudit(principal, input = {}) {
    this.#requirePlatformAdmin(principal);
    const limit = input.limit === undefined ? 50 : input.limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new PlatformAdminError("audit_limit_invalid");
    }
    const before = input.before === undefined ? null : new Date(input.before);
    if (before && !Number.isFinite(before.getTime())) throw new PlatformAdminError("audit_cursor_invalid");
    const action = input.action === undefined ? null : requiredText(input.action, 1, 120, "audit_filter_invalid");
    const result = await this.pool.query(`
      SELECT audit_id, occurred_at, actor_id, actor_audience, action,
             resource_type, resource_id, scope_type, scope_id, reason, trace_id, detail
        FROM audit_events
       WHERE ($1::timestamptz IS NULL OR occurred_at < $1)
         AND ($2::text IS NULL OR action = $2)
       ORDER BY occurred_at DESC, audit_id DESC
       LIMIT $3
    `, [before?.toISOString() ?? null, action, limit]);
    return {
      events: result.rows.map((row) => ({
        action: row.action,
        actorAudience: row.actor_audience,
        actorId: row.actor_id,
        auditId: row.audit_id,
        detail: row.detail,
        occurredAt: row.occurred_at.toISOString(),
        reason: row.reason,
        resourceId: row.resource_id,
        resourceType: row.resource_type,
        scopeId: row.scope_id,
        scopeType: row.scope_type,
        traceId: row.trace_id
      })),
      nextBefore: result.rows.length === limit ? result.rows.at(-1).occurred_at.toISOString() : null
    };
  }

  async getQuota(principal, input) {
    this.#requirePlatformAdmin(principal);
    const scope = quotaScope(input);
    await this.#requireQuotaScope(this.pool, scope);
    const result = await this.pool.query(`
      SELECT quota.limit_bytes, quota.revision, quota.updated_at, quota.updated_by,
             COALESCE(SUM(entry.logical_bytes), 0) AS used_bytes
        FROM (VALUES ($1::text, $2::text)) AS target(scope_type, scope_id)
        LEFT JOIN storage_quotas quota
          ON quota.scope_type = target.scope_type AND quota.scope_id = target.scope_id
        LEFT JOIN library_entries entry
          ON entry.scope_type = target.scope_type AND entry.scope_id = target.scope_id
       GROUP BY quota.limit_bytes, quota.revision, quota.updated_at, quota.updated_by
    `, [scope.scopeType, scope.scopeId]);
    return { quota: mapQuota(result.rows[0] ?? {}, scope) };
  }

  async listGovernance(principal) {
    this.#requirePlatformAdmin(principal);
    const [organizations, rolesResult, supportResult, accountsResult] = await Promise.all([
      this.pool.query(`
        SELECT organization.organization_id, organization.owner_subject,
               organization.name, organization.status, organization.revision,
               organization.created_at, organization.updated_at,
               quota.limit_bytes,
               COALESCE(member.member_count, 0) AS member_count,
               COALESCE(entry.used_bytes, 0) AS used_bytes
          FROM organizations organization
          LEFT JOIN LATERAL (
            SELECT count(*)::integer AS member_count
              FROM organization_members
             WHERE organization_id = organization.organization_id AND status = 'active'
          ) member ON true
          LEFT JOIN storage_quotas quota
            ON quota.scope_type = 'organization' AND quota.scope_id = organization.organization_id
          LEFT JOIN LATERAL (
            SELECT COALESCE(sum(logical_bytes), 0) AS used_bytes
              FROM library_entries
             WHERE scope_type = 'organization' AND scope_id = organization.organization_id
          ) entry ON true
         ORDER BY organization.created_at DESC, organization.organization_id
         LIMIT 500
      `),
      this.pool.query(`
        SELECT * FROM platform_role_grants
         ORDER BY granted_at DESC, grant_id DESC
         LIMIT 200
      `),
      this.pool.query(`
        SELECT * FROM platform_support_access_grants
         ORDER BY granted_at DESC, grant_id DESC
         LIMIT 200
      `),
      this.pool.query(`
        SELECT * FROM account_status_projections
         ORDER BY updated_at DESC, subject_id
         LIMIT 200
      `)
    ]);
    return {
      accountStatuses: accountsResult.rows.map(mapAccountStatus),
      organizations: organizations.rows.map(mapOrganization),
      roleGrants: rolesResult.rows.map(mapRoleGrant),
      supportGrants: supportResult.rows.map(mapSupportGrant)
    };
  }

  async accountDirectoryProjection(principal, subjectIds) {
    this.#requirePlatformAdmin(principal);
    if (!Array.isArray(subjectIds) || subjectIds.length > 100 || subjectIds.some((value) => (
      typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,300}$/.test(value)
    ))) {
      throw new PlatformAdminError("account_directory_query_invalid");
    }
    if (subjectIds.length === 0) {
      return { grants: Object.create(null), roles: Object.create(null), statuses: Object.create(null) };
    }
    const [roleResult, statusResult] = await Promise.all([
      this.pool.query(`
        SELECT grant_id, subject_id, role FROM platform_role_grants
         WHERE subject_id = ANY($1::text[]) AND state = 'active'
         ORDER BY subject_id, role
      `, [subjectIds]),
      this.pool.query(`
        SELECT subject_id, status, updated_at FROM account_status_projections
         WHERE subject_id = ANY($1::text[])
      `, [subjectIds])
    ]);
    const grants = Object.create(null);
    const roles = Object.create(null);
    for (const row of roleResult.rows) {
      (grants[row.subject_id] ??= []).push({ grantId: row.grant_id, role: row.role });
      (roles[row.subject_id] ??= []).push(row.role);
    }
    const statuses = Object.create(null);
    for (const row of statusResult.rows) {
      statuses[row.subject_id] = { status: row.status, updatedAt: row.updated_at.toISOString() };
    }
    return { grants, roles, statuses };
  }

  async setOrganizationStatus(principal, input) {
    this.#requirePlatformAdmin(principal);
    exactFields(input, new Set([
      "expectedRevision", "idempotencyKey", "organizationId", "reason", "status", "traceId"
    ]), "organization_status_input_invalid");
    const organizationId = identifier(input.organizationId, "organization_id_invalid");
    const expectedRevision = nonNegativeRevision(
      input.expectedRevision,
      "organization_revision_invalid"
    );
    if (!new Set(["active", "suspended"]).has(input.status)) {
      throw new PlatformAdminError("organization_status_invalid");
    }
    const reason = requiredText(input.reason, 8, 1000, "admin_reason_invalid");
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      principal.subjectId,
      input,
      "set_organization_status",
      { expectedRevision, organizationId, reason, status: input.status },
      async () => {
        const current = await client.query(`
          SELECT * FROM organizations WHERE organization_id = $1 FOR UPDATE
        `, [organizationId]);
        if (!current.rows[0] || current.rows[0].status === "deleted") {
          throw new PlatformAdminError("organization_not_found", 404);
        }
        if (Number(current.rows[0].revision) !== expectedRevision) {
          throw new PlatformAdminError("organization_revision_conflict", 409);
        }
        const changed = await client.query(`
          UPDATE organizations
             SET status = $2, revision = revision + 1, updated_at = now()
           WHERE organization_id = $1 AND revision = $3
           RETURNING *
        `, [organizationId, input.status, expectedRevision]);
        if (!changed.rows[0]) throw new PlatformAdminError("organization_revision_conflict", 409);
        await appendAudit(client, {
          action: "organization_status_updated",
          actorAudience: "liteasy-admin",
          actorId: principal.subjectId,
          detail: {
            previousStatus: current.rows[0].status,
            revision: Number(changed.rows[0].revision),
            status: input.status
          },
          reason,
          resourceId: organizationId,
          resourceType: "organization",
          scopeId: organizationId,
          scopeType: "organization",
          traceId: identifier(input.traceId, "trace_id_invalid")
        });
        const projection = await client.query(`
          SELECT organization.organization_id, organization.owner_subject,
                 organization.name, organization.status, organization.revision,
                 organization.created_at, organization.updated_at,
                 quota.limit_bytes,
                 COALESCE(member.member_count, 0) AS member_count,
                 COALESCE(entry.used_bytes, 0) AS used_bytes
            FROM organizations organization
            LEFT JOIN LATERAL (
              SELECT count(*)::integer AS member_count
                FROM organization_members
               WHERE organization_id = organization.organization_id AND status = 'active'
            ) member ON true
            LEFT JOIN storage_quotas quota
              ON quota.scope_type = 'organization' AND quota.scope_id = organization.organization_id
            LEFT JOIN LATERAL (
              SELECT COALESCE(sum(logical_bytes), 0) AS used_bytes
                FROM library_entries
               WHERE scope_type = 'organization' AND scope_id = organization.organization_id
            ) entry ON true
           WHERE organization.organization_id = $1
        `, [organizationId]);
        return { organization: mapOrganization(projection.rows[0]) };
      }
    ));
  }

  async setQuota(principal, input) {
    this.#requirePlatformAdmin(principal);
    const scope = quotaScope(input);
    const limitBytes = quotaLimit(input.limitBytes);
    const expectedRevision = quotaRevision(input.expectedRevision);
    const reason = requiredText(input.reason, 8, 1000, "admin_reason_invalid");
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      principal.subjectId,
      input,
      "set_storage_quota",
      { expectedRevision, limitBytes, reason, ...scope },
      async () => {
        await this.#requireQuotaScope(client, scope, { lock: true });
        const current = await client.query(`
          SELECT limit_bytes, revision FROM storage_quotas
           WHERE scope_type = $1 AND scope_id = $2
           FOR UPDATE
        `, [scope.scopeType, scope.scopeId]);
        const currentRevision = current.rows[0] ? Number(current.rows[0].revision) : 0;
        if (currentRevision !== expectedRevision) {
          throw new PlatformAdminError("quota_revision_conflict", 409);
        }
        const changed = current.rows[0]
          ? await client.query(`
              UPDATE storage_quotas
                 SET limit_bytes = $3, revision = revision + 1,
                     updated_by = $4, updated_at = now()
               WHERE scope_type = $1 AND scope_id = $2 AND revision = $5
               RETURNING *
            `, [scope.scopeType, scope.scopeId, limitBytes, principal.subjectId, expectedRevision])
          : await client.query(`
              INSERT INTO storage_quotas(
                scope_type, scope_id, limit_bytes, revision, updated_by
              ) VALUES ($1, $2, $3, 1, $4)
              RETURNING *
            `, [scope.scopeType, scope.scopeId, limitBytes, principal.subjectId]);
        if (!changed.rows[0]) throw new PlatformAdminError("quota_revision_conflict", 409);
        const usage = await client.query(`
          SELECT COALESCE(SUM(logical_bytes), 0) AS used_bytes
            FROM library_entries
           WHERE scope_type = $1 AND scope_id = $2
        `, [scope.scopeType, scope.scopeId]);
        const quota = mapQuota({
          ...changed.rows[0],
          used_bytes: usage.rows[0]?.used_bytes ?? 0
        }, scope);
        await appendAudit(client, {
          action: "storage_quota_updated",
          actorAudience: "liteasy-admin",
          actorId: principal.subjectId,
          detail: {
            limitBytes,
            previousLimitBytes: current.rows[0] ? Number(current.rows[0].limit_bytes) : null,
            revision: quota.revision,
            usedBytes: quota.usedBytes
          },
          reason,
          resourceId: `${scope.scopeType}:${scope.scopeId}`,
          resourceType: "storage_quota",
          scopeId: scope.scopeId,
          scopeType: scope.scopeType,
          traceId: identifier(input.traceId, "trace_id_invalid")
        });
        return { quota };
      }
    ));
  }

  async loadModelPolicy() {
    const result = await this.pool.query(`
      SELECT * FROM platform_model_policies WHERE policy_id = 'active'
    `);
    if (!result.rows[0]) throw new PlatformAdminError("model_policy_not_configured", 503);
    return mapModelPolicy(result.rows[0]);
  }

  async getModelPolicy(principal) {
    this.#requirePlatformAdmin(principal);
    return this.loadModelPolicy();
  }

  async setModelPolicy(principal, input) {
    this.#requirePlatformAdmin(principal);
    exactFields(input, new Set([
      "cloudProxyEndpoint", "defaultProvider", "expectedRevision",
      "idempotencyKey", "reason", "traceId"
    ]), "model_policy_input_invalid");
    const cloudProxyEndpoint = publicEndpoint(
      input.cloudProxyEndpoint,
      this.environment,
      "model_proxy_endpoint_invalid",
      { modelProxy: true }
    );
    const defaultProvider = requiredText(
      input.defaultProvider,
      1,
      80,
      "model_provider_invalid"
    ).toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(defaultProvider)) {
      throw new PlatformAdminError("model_provider_invalid");
    }
    const expectedRevision = nonNegativeRevision(
      input.expectedRevision,
      "model_policy_revision_invalid"
    );
    const reason = requiredText(input.reason, 8, 1000, "admin_reason_invalid");
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      principal.subjectId,
      input,
      "set_model_policy",
      { cloudProxyEndpoint, defaultProvider, expectedRevision, reason },
      async () => {
        const current = await client.query(`
          SELECT * FROM platform_model_policies WHERE policy_id = 'active' FOR UPDATE
        `);
        const currentRevision = current.rows[0] ? Number(current.rows[0].revision) : 0;
        if (currentRevision !== expectedRevision) {
          throw new PlatformAdminError("model_policy_revision_conflict", 409);
        }
        const changed = current.rows[0]
          ? await client.query(`
              UPDATE platform_model_policies
                 SET cloud_proxy_endpoint = $1, default_provider = $2,
                     revision = revision + 1, updated_by = $3, updated_at = now()
               WHERE policy_id = 'active' AND revision = $4
               RETURNING *
            `, [cloudProxyEndpoint, defaultProvider, principal.subjectId, expectedRevision])
          : await client.query(`
              INSERT INTO platform_model_policies(
                policy_id, cloud_proxy_endpoint, default_provider, revision, updated_by
              ) VALUES ('active', $1, $2, 1, $3)
              RETURNING *
            `, [cloudProxyEndpoint, defaultProvider, principal.subjectId]);
        if (!changed.rows[0]) throw new PlatformAdminError("model_policy_revision_conflict", 409);
        const policy = mapModelPolicy(changed.rows[0]);
        await appendAudit(client, {
          action: "model_policy_updated",
          actorAudience: "liteasy-admin",
          actorId: principal.subjectId,
          detail: {
            cloudProxyEndpoint,
            defaultProvider,
            previousRevision: currentRevision,
            revision: policy.revision
          },
          reason,
          resourceId: "active",
          resourceType: "model_policy",
          traceId: identifier(input.traceId, "trace_id_invalid")
        });
        return { policy };
      }
    ));
  }

  async listRetrievalSources(principal) {
    this.#requirePlatformAdmin(principal);
    const result = await this.pool.query(`
      SELECT * FROM platform_retrieval_sources
       ORDER BY lower(name), source_id
    `);
    return { sources: result.rows.map(mapRetrievalSource) };
  }

  async saveRetrievalSource(principal, input) {
    this.#requirePlatformAdmin(principal);
    exactFields(input, new Set([
      "baseUrl", "connectorType", "enabled", "expectedRevision", "idempotencyKey",
      "name", "reason", "sourceId", "sourceKind", "traceId"
    ]), "retrieval_source_input_invalid");
    const requestedSourceId = input.sourceId === undefined
      ? null
      : identifier(input.sourceId, "retrieval_source_id_invalid");
    const name = requiredText(input.name, 1, 120, "retrieval_source_name_invalid");
    if (!new Set(["website", "database"]).has(input.sourceKind)) {
      throw new PlatformAdminError("retrieval_source_kind_invalid");
    }
    if (typeof input.enabled !== "boolean") {
      throw new PlatformAdminError("retrieval_source_enabled_invalid");
    }
    const connectorType = identifier(input.connectorType, "retrieval_source_connector_invalid");
    const baseUrl = retrievalConnectorEndpoint(connectorType, input.baseUrl);
    const expectedRevision = nonNegativeRevision(
      input.expectedRevision,
      "retrieval_source_revision_invalid"
    );
    const reason = requiredText(input.reason, 8, 1000, "admin_reason_invalid");
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      principal.subjectId,
      input,
      "save_retrieval_source",
      {
        baseUrl,
        connectorType,
        enabled: input.enabled,
        expectedRevision,
        name,
        reason,
        sourceId: requestedSourceId,
        sourceKind: input.sourceKind
      },
      async () => {
        const sourceId = requestedSourceId ?? `source_${randomUUID()}`;
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `retrieval-source-name:${name.toLocaleLowerCase("en-US")}`
        ]);
        const duplicate = await client.query(`
          SELECT source_id FROM platform_retrieval_sources
           WHERE lower(name) = lower($1) AND source_id <> $2
        `, [name, sourceId]);
        if (duplicate.rows[0]) throw new PlatformAdminError("retrieval_source_name_exists", 409);
        const connectorDuplicate = await client.query(`
          SELECT source_id FROM platform_retrieval_sources
           WHERE connector_type = $1 AND source_id <> $2
        `, [connectorType, sourceId]);
        if (connectorDuplicate.rows[0]) {
          throw new PlatformAdminError("retrieval_source_connector_exists", 409);
        }
        const current = await client.query(`
          SELECT * FROM platform_retrieval_sources WHERE source_id = $1 FOR UPDATE
        `, [sourceId]);
        const currentRevision = current.rows[0] ? Number(current.rows[0].revision) : 0;
        if (currentRevision !== expectedRevision) {
          throw new PlatformAdminError("retrieval_source_revision_conflict", 409);
        }
        const changed = current.rows[0]
          ? await client.query(`
              UPDATE platform_retrieval_sources
                 SET name = $2, source_kind = $3, base_url = $4, enabled = $5,
                     connector_type = $6, revision = revision + 1,
                     updated_by = $7, updated_at = now()
               WHERE source_id = $1 AND revision = $8
               RETURNING *
            `, [
              sourceId, name, input.sourceKind, baseUrl, input.enabled, connectorType,
              principal.subjectId, expectedRevision
            ])
          : await client.query(`
              INSERT INTO platform_retrieval_sources(
                source_id, name, source_kind, base_url, enabled, connector_type,
                revision, created_by, updated_by
              ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $7)
              RETURNING *
            `, [
              sourceId, name, input.sourceKind, baseUrl, input.enabled, connectorType,
              principal.subjectId
            ]);
        if (!changed.rows[0]) {
          throw new PlatformAdminError("retrieval_source_revision_conflict", 409);
        }
        const source = mapRetrievalSource(changed.rows[0]);
        await appendAudit(client, {
          action: "retrieval_source_saved",
          actorAudience: "liteasy-admin",
          actorId: principal.subjectId,
          detail: {
            baseUrl,
            connectorType,
            enabled: input.enabled,
            revision: source.revision,
            sourceKind: input.sourceKind
          },
          reason,
          resourceId: sourceId,
          resourceType: "retrieval_source",
          traceId: identifier(input.traceId, "trace_id_invalid")
        });
        return { source };
      }
    ));
  }

  async removeRetrievalSource(principal, input) {
    this.#requirePlatformAdmin(principal);
    exactFields(input, new Set([
      "expectedRevision", "idempotencyKey", "reason", "sourceId", "traceId"
    ]), "retrieval_source_input_invalid");
    const sourceId = identifier(input.sourceId, "retrieval_source_id_invalid");
    const expectedRevision = nonNegativeRevision(
      input.expectedRevision,
      "retrieval_source_revision_invalid"
    );
    const reason = requiredText(input.reason, 8, 1000, "admin_reason_invalid");
    return withPostgresTransaction(this.pool, (client) => idempotentMutation(
      client,
      principal.subjectId,
      input,
      "remove_retrieval_source",
      { expectedRevision, reason, sourceId },
      async () => {
        const current = await client.query(`
          SELECT * FROM platform_retrieval_sources WHERE source_id = $1 FOR UPDATE
        `, [sourceId]);
        if (!current.rows[0]) throw new PlatformAdminError("retrieval_source_not_found", 404);
        if (Number(current.rows[0].revision) !== expectedRevision) {
          throw new PlatformAdminError("retrieval_source_revision_conflict", 409);
        }
        const removed = await client.query(`
          DELETE FROM platform_retrieval_sources
           WHERE source_id = $1 AND revision = $2
           RETURNING source_id
        `, [sourceId, expectedRevision]);
        if (!removed.rows[0]) {
          throw new PlatformAdminError("retrieval_source_revision_conflict", 409);
        }
        await appendAudit(client, {
          action: "retrieval_source_removed",
          actorAudience: "liteasy-admin",
          actorId: principal.subjectId,
          detail: {
            baseUrl: current.rows[0].base_url,
            revision: expectedRevision,
            sourceKind: current.rows[0].source_kind
          },
          reason,
          resourceId: sourceId,
          resourceType: "retrieval_source",
          traceId: identifier(input.traceId, "trace_id_invalid")
        });
        return { removed: true, sourceId };
      }
    ));
  }

  async #loadPrincipal(client, subjectId) {
    const result = await client.query(`
      SELECT grant_id, role, state, bootstrap, granted_by, reason,
             granted_at, activated_at
        FROM platform_role_grants
       WHERE subject_id = $1 AND state = 'active'
       ORDER BY role, granted_at
    `, [subjectId]);
    const activeRoles = result.rows
      .map((row) => row.role)
      .filter((item) => item !== "developer_diagnostics" || this.environment !== "production");
    if (activeRoles.length === 0) throw new PlatformAdminError("platform_role_required", 403);
    return {
      grants: result.rows.map(mapRoleGrant),
      roles: activeRoles,
      subjectId
    };
  }

  async #requireQuotaScope(client, scope, { lock = false } = {}) {
    if (scope.scopeType === "organization") {
      const result = await client.query(`
        SELECT status FROM organizations
         WHERE organization_id = $1
         ${lock ? "FOR UPDATE" : ""}
      `, [scope.scopeId]);
      if (!result.rows[0] || result.rows[0].status !== "active") {
        throw new PlatformAdminError("quota_scope_not_found", 404);
      }
      return;
    }
    const result = await client.query(`
      SELECT status FROM account_status_projections
       WHERE subject_id = $1
       ${lock ? "FOR UPDATE" : ""}
    `, [scope.scopeId]);
    if (result.rows[0]?.status === "deleted") {
      throw new PlatformAdminError("quota_scope_not_found", 404);
    }
  }

  #requirePlatformAdmin(principal) {
    if (!principal?.roles?.includes("platform_admin")) {
      throw new PlatformAdminError("platform_admin_required", 403);
    }
  }

  #requireRoleAdministrator(principal) {
    if (!principal?.roles?.some((item) => roles.has(item))) {
      throw new PlatformAdminError("platform_admin_required", 403);
    }
  }
}
