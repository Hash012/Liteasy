import assert from "node:assert/strict";
import test from "node:test";
import {
  PlatformAdminError,
  PostgresPlatformAdminRepository
} from "./platformAdminRepository.mjs";

function transactionHarness(query) {
  const calls = [];
  const client = {
    async query(sql, values) {
      const normalized = sql.trim();
      calls.push({ sql: normalized, values });
      if (new Set(["BEGIN ISOLATION LEVEL SERIALIZABLE", "COMMIT", "ROLLBACK"]).has(normalized)) {
        return { rows: [] };
      }
      return query(normalized, values, calls);
    },
    release() {}
  };
  return { calls, pool: { async connect() { return client; } } };
}

function roleRow(overrides = {}) {
  return {
    activated_at: null,
    bootstrap: true,
    grant_id: "rolegrant_1",
    granted_at: new Date("2026-08-06T00:00:00.000Z"),
    granted_by: "bootstrap",
    reason: "Initial production administrator",
    role: "platform_admin",
    state: "pending_activation",
    subject_id: "admin_1",
    ...overrides
  };
}

test("bootstraps exactly one pending administrator and appends a service audit event", async () => {
  const harness = transactionHarness(async (sql) => {
    if (sql.includes("SELECT 1 FROM platform_role_grants")) return { rows: [] };
    if (sql.includes("INSERT INTO platform_role_grants")) return { rows: [roleRow()] };
    return { rows: [] };
  });
  const repository = new PostgresPlatformAdminRepository(harness.pool, { environment: "production" });
  const result = await repository.bootstrap("admin_1", {
    reason: "Initial production administrator",
    traceId: "trace_bootstrap"
  });
  assert.equal(result.grant.state, "pending_activation");
  assert.equal(result.grant.bootstrap, true);
  const audit = harness.calls.find((call) => call.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit.values[2], "service");
  assert.equal(audit.values[3], "platform_admin_bootstrapped");
  assert.equal(harness.calls.some((call) => call.sql === "COMMIT"), true);
});

test("refuses a second bootstrap and production developer diagnostics", async () => {
  const harness = transactionHarness(async (sql) => (
    sql.includes("SELECT 1 FROM platform_role_grants") ? { rows: [{ exists: true }] } : { rows: [] }
  ));
  const repository = new PostgresPlatformAdminRepository(harness.pool, { environment: "production" });
  await assert.rejects(() => repository.bootstrap("admin_2", {
    reason: "Second production administrator",
    traceId: "trace_bootstrap"
  }), /platform_admin_already_bootstrapped/);
  await assert.rejects(() => repository.grantRole({ roles: ["platform_admin"], subjectId: "admin_1" }, {
    idempotencyKey: "grant-role-0001",
    reason: "Temporary production diagnostics",
    role: "developer_diagnostics",
    subjectId: "developer_1",
    traceId: "trace_grant"
  }), /production_diagnostics_forbidden/);
});

test("queries active developer diagnostics outside production and fails closed in production", async () => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      return { rows: [{ exists: true }] };
    }
  };
  const staging = new PostgresPlatformAdminRepository(pool, { environment: "staging" });
  assert.equal(await staging.hasRole("developer_1", "developer_diagnostics"), true);
  assert.deepEqual(queries[0].values, ["developer_1", "developer_diagnostics"]);

  const production = new PostgresPlatformAdminRepository(pool, { environment: "production" });
  assert.equal(await production.hasRole("developer_1", "developer_diagnostics"), false);
  assert.equal(queries.length, 1);
});

test("does not allow revoking the final active platform administrator", async () => {
  const harness = transactionHarness(async (sql) => {
    if (sql.includes("SELECT request_hash, response_body")) return { rows: [] };
    if (sql.includes("SELECT * FROM platform_role_grants WHERE grant_id")) {
      return { rows: [roleRow({ activated_at: new Date(), state: "active" })] };
    }
    if (sql.includes("count(*)::integer AS count")) return { rows: [{ count: 0 }] };
    return { rows: [] };
  });
  const repository = new PostgresPlatformAdminRepository(harness.pool, { environment: "production" });
  await assert.rejects(() => repository.revokeRole({
    roles: ["platform_admin"], subjectId: "admin_1"
  }, {
    grantId: "rolegrant_1",
    idempotencyKey: "revoke-role-0001",
    reason: "Administrator is leaving the company",
    traceId: "trace_revoke"
  }), /last_platform_admin_required/);
  assert.equal(harness.calls.some((call) => call.sql.includes("UPDATE platform_role_grants")), false);
  assert.equal(harness.calls.some((call) => call.sql === "ROLLBACK"), true);
});

test("resolves only a current support grant assigned to the authenticated administrator", async () => {
  const row = {
    document_id: "document_1",
    expires_at: new Date("2026-08-06T01:00:00.000Z"),
    grant_id: "supportgrant_1",
    granted_at: new Date("2026-08-06T00:00:00.000Z"),
    granted_by: "admin_2",
    grantee_subject: "admin_1",
    reason: "Investigate user reported PDF corruption",
    revoked_at: null,
    scope_id: "user_1",
    scope_type: "user"
  };
  const queries = [];
  const repository = new PostgresPlatformAdminRepository({
    async query(sql, values) {
      queries.push({ sql, values });
      return { rows: [row] };
    }
  }, { environment: "production" });
  const scope = await repository.resolveSupportScope({
    roles: ["platform_admin"], subjectId: "admin_1"
  }, { documentId: "document_1", grantId: "supportgrant_1" });
  assert.deepEqual({ role: scope.role, scopeId: scope.scopeId, scopeType: scope.scopeType }, {
    role: "support", scopeId: "user_1", scopeType: "user"
  });
  assert.deepEqual(queries[0].values, ["supportgrant_1", "admin_1", "document_1"]);
  await assert.rejects(() => repository.resolveSupportScope({ roles: [], subjectId: "admin_1" }, {
    documentId: "document_1", grantId: "supportgrant_1"
  }), PlatformAdminError);
});

test("updates a storage quota with optimistic revision and an audit in one transaction", async () => {
  const updatedAt = new Date("2026-08-07T01:00:00.000Z");
  const harness = transactionHarness(async (sql) => {
    if (sql.includes("SELECT request_hash, response_body")) return { rows: [] };
    if (sql.includes("FROM account_status_projections")) return { rows: [] };
    if (sql.includes("SELECT limit_bytes, revision FROM storage_quotas")) {
      return { rows: [{ limit_bytes: "1048576", revision: "2" }] };
    }
    if (sql.includes("UPDATE storage_quotas")) {
      return { rows: [{
        limit_bytes: "2097152",
        revision: "3",
        scope_id: "user_1",
        scope_type: "user",
        updated_at: updatedAt,
        updated_by: "admin_1"
      }] };
    }
    if (sql.includes("SUM(logical_bytes)")) {
      return { rows: [{
        used_bytes: sql.includes("status = 'active'") ? "524288" : "786432"
      }] };
    }
    return { rows: [] };
  });
  const repository = new PostgresPlatformAdminRepository(harness.pool, { environment: "production" });
  const result = await repository.setQuota({
    roles: ["platform_admin"], subjectId: "admin_1"
  }, {
    expectedRevision: 2,
    idempotencyKey: "set-quota-0001",
    limitBytes: 2097152,
    reason: "Approved storage increase",
    scopeId: "user_1",
    scopeType: "user",
    traceId: "trace_quota"
  });

  assert.deepEqual(result.quota, {
    configured: true,
    limitBytes: 2097152,
    revision: 3,
    scopeId: "user_1",
    scopeType: "user",
    updatedAt: updatedAt.toISOString(),
    updatedBy: "admin_1",
    usedBytes: 786432
  });
  const audit = harness.calls.find((call) => call.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit.values[3], "storage_quota_updated");
  assert.equal(audit.values[6], "user");
  assert.equal(audit.values[7], "user_1");
  assert.equal(harness.calls.some((call) => call.sql === "COMMIT"), true);
});

test("rejects stale quota revisions and deleted user targets", async () => {
  const staleHarness = transactionHarness(async (sql) => {
    if (sql.includes("SELECT request_hash, response_body")) return { rows: [] };
    if (sql.includes("FROM account_status_projections")) return { rows: [] };
    if (sql.includes("SELECT limit_bytes, revision FROM storage_quotas")) {
      return { rows: [{ limit_bytes: "1048576", revision: "3" }] };
    }
    return { rows: [] };
  });
  const staleRepository = new PostgresPlatformAdminRepository(staleHarness.pool, {
    environment: "production"
  });
  await assert.rejects(() => staleRepository.setQuota({
    roles: ["platform_admin"], subjectId: "admin_1"
  }, {
    expectedRevision: 2,
    idempotencyKey: "set-quota-stale",
    limitBytes: 2097152,
    reason: "Approved storage increase",
    scopeId: "user_1",
    scopeType: "user",
    traceId: "trace_quota_stale"
  }), /quota_revision_conflict/);
  assert.equal(staleHarness.calls.some((call) => call.sql.includes("UPDATE storage_quotas")), false);

  const deletedRepository = new PostgresPlatformAdminRepository({
    async query(sql) {
      if (sql.includes("FROM account_status_projections")) {
        return { rows: [{ status: "deleted" }] };
      }
      return { rows: [] };
    }
  }, { environment: "production" });
  await assert.rejects(() => deletedRepository.getQuota({
    roles: ["platform_admin"], subjectId: "admin_1"
  }, { scopeId: "deleted_user", scopeType: "user" }), /quota_scope_not_found/);
});

test("reports trashed library entries as used quota", async () => {
  const repository = new PostgresPlatformAdminRepository({
    async query(sql) {
      if (sql.includes("FROM account_status_projections")) return { rows: [] };
      if (sql.includes("SELECT quota.limit_bytes")) {
        return { rows: [{
          limit_bytes: "1048576",
          revision: "2",
          updated_at: new Date("2026-08-11T00:00:00.000Z"),
          updated_by: "admin_1",
          used_bytes: sql.includes("status = 'active'") ? "524288" : "786432"
        }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  }, { environment: "production" });

  const result = await repository.getQuota({
    roles: ["platform_admin"], subjectId: "admin_1"
  }, { scopeId: "user_1", scopeType: "user" });

  assert.equal(result.quota.usedBytes, 786432);
});

test("lists bounded governance metadata without reading document content", async () => {
  const timestamp = new Date("2026-08-07T03:00:00.000Z");
  const queries = [];
  const repository = new PostgresPlatformAdminRepository({
    async query(sql) {
      queries.push(sql);
      if (sql.includes("FROM organizations organization")) return { rows: [{
        created_at: timestamp,
        limit_bytes: "2097152",
        member_count: 3,
        name: "Research Team",
        organization_id: "organization_1",
        owner_subject: "owner_1",
        revision: "4",
        status: "active",
        updated_at: timestamp,
        used_bytes: /FROM library_entries[\s\S]*status = 'active'/.test(sql) ? "1048576" : "1572864"
      }] };
      if (sql.includes("FROM platform_role_grants")) return { rows: [roleRow({
        activated_at: timestamp,
        state: "active"
      })] };
      if (sql.includes("FROM platform_support_access_grants")) return { rows: [{
        document_id: "document_1",
        expires_at: timestamp,
        grant_id: "supportgrant_1",
        granted_at: timestamp,
        granted_by: "admin_1",
        grantee_subject: "admin_1",
        reason: "Investigate document availability",
        revoked_at: null,
        scope_id: "organization_1",
        scope_type: "organization"
      }] };
      if (sql.includes("FROM account_status_projections")) return { rows: [{
        identity_updated_at: timestamp,
        reason: "Approved account suspension",
        status: "disabled",
        subject_id: "user_1",
        updated_at: timestamp,
        updated_by: "admin_1"
      }] };
      return { rows: [] };
    }
  }, { environment: "production" });

  const result = await repository.listGovernance({
    roles: ["platform_admin"], subjectId: "admin_1"
  });
  assert.equal(result.organizations[0].memberCount, 3);
  assert.equal(result.organizations[0].usedBytes, 1572864);
  assert.equal(result.roleGrants[0].grantId, "rolegrant_1");
  assert.equal(result.supportGrants[0].documentId, "document_1");
  assert.equal(result.accountStatuses[0].subjectId, "user_1");
  assert.equal(queries.every((sql) => !/storage_key|content_hash|body/i.test(sql)), true);
});

test("projects active roles and latest account status for a bounded identity page", async () => {
  const timestamp = new Date("2026-08-12T01:00:00.000Z");
  const calls = [];
  const repository = new PostgresPlatformAdminRepository({
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM platform_role_grants")) return { rows: [
        { grant_id: "rolegrant_1", role: "platform_admin", subject_id: "user_1" },
        { grant_id: "rolegrant_2", role: "platform_admin", subject_id: "user_2" }
      ] };
      return { rows: [{ status: "disabled", subject_id: "user_2", updated_at: timestamp }] };
    }
  }, { environment: "production" });
  const result = await repository.accountDirectoryProjection({
    roles: ["platform_admin"], subjectId: "admin_1"
  }, ["user_1", "user_2"]);
  assert.deepEqual(Object.fromEntries(Object.entries(result.roles)), {
    user_1: ["platform_admin"], user_2: ["platform_admin"]
  });
  assert.deepEqual(result.grants.user_2, [{ grantId: "rolegrant_2", role: "platform_admin" }]);
  assert.deepEqual(result.statuses.user_2, { status: "disabled", updatedAt: timestamp.toISOString() });
  assert.deepEqual(calls[0].values, [["user_1", "user_2"]]);
  await assert.rejects(() => repository.accountDirectoryProjection({
    roles: ["platform_admin"], subjectId: "admin_1"
  }, Array.from({ length: 101 }, (_, index) => `user_${index}`)), /account_directory_query_invalid/);
});

test("suspends an organization with optimistic revision and audit in one transaction", async () => {
  const timestamp = new Date("2026-08-07T03:00:00.000Z");
  const harness = transactionHarness(async (sql) => {
    if (sql.includes("SELECT request_hash, response_body")) return { rows: [] };
    if (sql.includes("SELECT * FROM organizations")) return { rows: [{
      created_at: timestamp,
      name: "Research Team",
      organization_id: "organization_1",
      owner_subject: "owner_1",
      revision: "2",
      status: "active",
      updated_at: timestamp
    }] };
    if (sql.includes("UPDATE organizations")) return { rows: [{
      created_at: timestamp,
      name: "Research Team",
      organization_id: "organization_1",
      owner_subject: "owner_1",
      revision: "3",
      status: "suspended",
      updated_at: timestamp
    }] };
    if (sql.includes("COALESCE(member.member_count")) return { rows: [{
      created_at: timestamp,
      limit_bytes: "2097152",
      member_count: 4,
      name: "Research Team",
      organization_id: "organization_1",
      owner_subject: "owner_1",
      revision: "3",
      status: "suspended",
      updated_at: timestamp,
      used_bytes: /FROM library_entries[\s\S]*status = 'active'/.test(sql) ? "1048576" : "1572864"
    }] };
    return { rows: [] };
  });
  const repository = new PostgresPlatformAdminRepository(harness.pool, { environment: "production" });
  const result = await repository.setOrganizationStatus({
    roles: ["platform_admin"], subjectId: "admin_1"
  }, {
    expectedRevision: 2,
    idempotencyKey: "suspend-organization-0001",
    organizationId: "organization_1",
    reason: "Approved security response suspension",
    status: "suspended",
    traceId: "trace_organization"
  });

  assert.equal(result.organization.status, "suspended");
  assert.equal(result.organization.revision, 3);
  assert.equal(result.organization.limitBytes, 2097152);
  assert.equal(result.organization.memberCount, 4);
  assert.equal(result.organization.usedBytes, 1572864);
  const audit = harness.calls.find((call) => call.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit.values[3], "organization_status_updated");
  assert.equal(audit.values[6], "organization");
  assert.equal(harness.calls.some((call) => call.sql === "COMMIT"), true);
});

test("creates a public model policy without accepting upstream credentials", async () => {
  const updatedAt = new Date("2026-08-07T02:00:00.000Z");
  const harness = transactionHarness(async (sql, values) => {
    if (sql.includes("SELECT request_hash, response_body")) return { rows: [] };
    if (sql.includes("FROM platform_model_policies") && sql.includes("FOR UPDATE")) {
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO platform_model_policies")) {
      return { rows: [{
        cloud_proxy_endpoint: values[0],
        default_provider: values[1],
        policy_id: "active",
        revision: "1",
        updated_at: updatedAt,
        updated_by: values[2]
      }] };
    }
    return { rows: [] };
  });
  const repository = new PostgresPlatformAdminRepository(harness.pool, { environment: "production" });
  const result = await repository.setModelPolicy({
    roles: ["platform_admin"], subjectId: "admin_1"
  }, {
    cloudProxyEndpoint: "https://models.example.com/liteasy",
    defaultProvider: "OpenAI",
    expectedRevision: 0,
    idempotencyKey: "set-model-policy-0001",
    reason: "Approved model proxy configuration",
    traceId: "trace_model_policy"
  });
  assert.deepEqual(result.policy, {
    cloudProxyEndpoint: "https://models.example.com/liteasy",
    defaultProvider: "openai",
    policyVersion: "policy-1",
    revision: 1,
    syncedAt: updatedAt.toISOString(),
    updatedBy: "admin_1"
  });
  assert.equal(
    harness.calls.find((call) => call.sql.includes("INSERT INTO audit_events")).values[3],
    "model_policy_updated"
  );

  await assert.rejects(() => repository.setModelPolicy({
    roles: ["platform_admin"], subjectId: "admin_1"
  }, {
    apiKey: "must-never-be-accepted",
    cloudProxyEndpoint: "https://models.example.com/liteasy",
    defaultProvider: "openai",
    expectedRevision: 0,
    idempotencyKey: "set-model-secret-0001",
    reason: "This request must be rejected",
    traceId: "trace_model_secret"
  }), /admin_secret_material_forbidden/);
  await assert.rejects(() => repository.setModelPolicy({
    roles: ["platform_admin"], subjectId: "admin_1"
  }, {
    cloudProxyEndpoint: "https://api.openai.com/v1",
    defaultProvider: "openai",
    expectedRevision: 0,
    idempotencyKey: "set-model-direct-0001",
    reason: "This request must be rejected",
    traceId: "trace_model_direct"
  }), /model_proxy_endpoint_invalid/);
});

test("stores only validated public retrieval source metadata", async () => {
  const updatedAt = new Date("2026-08-07T02:30:00.000Z");
  const harness = transactionHarness(async (sql, values) => {
    if (sql.includes("SELECT request_hash, response_body")) return { rows: [] };
    if (sql.includes("source_id <>")) return { rows: [] };
    if (sql.includes("WHERE source_id = $1 FOR UPDATE")) return { rows: [] };
    if (sql.includes("INSERT INTO platform_retrieval_sources")) {
      return { rows: [{
        base_url: values[3],
        connector_type: values[5],
        enabled: values[4],
        name: values[1],
        revision: "1",
        source_id: values[0],
        source_kind: values[2],
        updated_at: updatedAt,
        updated_by: values[6]
      }] };
    }
    return { rows: [] };
  });
  const repository = new PostgresPlatformAdminRepository(harness.pool, { environment: "production" });
  const result = await repository.saveRetrievalSource({
    roles: ["platform_admin"], subjectId: "admin_1"
  }, {
    baseUrl: "https://api.openalex.org/works",
    connectorType: "openalex",
    enabled: true,
    expectedRevision: 0,
    idempotencyKey: "save-source-0001",
    name: "OpenAlex",
    reason: "Approved scholarly retrieval source",
    sourceId: "source_openalex",
    sourceKind: "database",
    traceId: "trace_source"
  });
  assert.equal(result.source.sourceId, "source_openalex");
  assert.equal(result.source.revision, 1);
  assert.equal(
    harness.calls.find((call) => call.sql.includes("INSERT INTO audit_events")).values[3],
    "retrieval_source_saved"
  );

  await assert.rejects(() => repository.saveRetrievalSource({
    roles: ["platform_admin"], subjectId: "admin_1"
  }, {
    baseUrl: "http://127.0.0.1:3000",
    connectorType: "openalex",
    enabled: true,
    expectedRevision: 0,
    idempotencyKey: "save-private-source",
    name: "Private endpoint",
    reason: "This request must be rejected",
    sourceKind: "website",
    traceId: "trace_private_source"
  }), /retrieval_source_url_invalid/);
});
