import assert from "node:assert/strict";
import test from "node:test";
import { PostgresOrganizationGovernanceRepository } from "./organizationGovernanceRepository.mjs";

const ownerIdentity = { audience: "liteasy-desktop", subject: "owner_1" };

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
  return {
    calls,
    pool: { async connect() { return client; } }
  };
}

test("rejects invalid organization governance inputs before opening a transaction", async () => {
  const repository = new PostgresOrganizationGovernanceRepository({});
  await assert.rejects(() => repository.create(ownerIdentity, {
    idempotencyKey: "organization-create-0001",
    name: "\u0000invalid"
  }), /invalid_organization_name/);
  await assert.rejects(() => repository.invite(ownerIdentity, {
    expectedRevision: 0,
    idempotencyKey: "organization-invite-0001",
    organizationId: "org_1",
    role: "owner",
    targetSubject: "target_1"
  }), /organization_role_invalid/);
  await assert.rejects(() => repository.acceptInvitation(ownerIdentity, {
    expectedInvitationRevision: 0,
    idempotencyKey: "organization-accept-0001",
    invitationToken: "orginv_not-a-valid-token"
  }), /organization_invitation_invalid/);
});

test("prevents an organization administrator from granting administrator role", async () => {
  const harness = transactionHarness(async (sql) => {
    if (sql.includes("SELECT request_hash, response_body")) return { rows: [] };
    if (sql.includes("FROM organizations organization")) {
      return { rows: [{
        member_role: "admin",
        member_status: "active",
        owner_subject: "owner_1",
        revision: "4",
        status: "active"
      }] };
    }
    return { rows: [] };
  });
  const repository = new PostgresOrganizationGovernanceRepository(harness.pool);
  await assert.rejects(() => repository.invite({
    audience: "liteasy-desktop", subject: "admin_1"
  }, {
    expectedRevision: 4,
    idempotencyKey: "organization-invite-admin",
    organizationId: "org_1",
    role: "admin",
    targetSubject: "target_1",
    traceId: "trace_1"
  }), /organization_owner_required/);
  assert.equal(harness.calls.some((call) => call.sql.includes("INSERT INTO organization_invitations")), false);
  assert.equal(harness.calls.some((call) => call.sql === "ROLLBACK"), true);
});

test("stores only the invitation token hash in the invitation table and replays the same response", async () => {
  let idempotentResponse;
  const harness = transactionHarness(async (sql, values) => {
    if (sql.includes("SELECT request_hash, response_body")) {
      return { rows: idempotentResponse ? [{
        request_hash: idempotentResponse.requestHash,
        response_body: idempotentResponse.response
      }] : [] };
    }
    if (sql.includes("FROM organizations organization")) {
      return { rows: [{ owner_subject: "owner_1", revision: "0", status: "active" }] };
    }
    if (sql.includes("SELECT status FROM organization_members")) return { rows: [] };
    if (sql.includes("INSERT INTO organization_invitations")) {
      return { rows: [{
        created_at: new Date("2026-08-06T00:00:00.000Z"),
        created_by: "owner_1",
        expires_at: new Date("2026-08-13T00:00:00.000Z"),
        intended_role: values[3],
        invitation_id: values[0],
        invited_subject: values[2],
        organization_id: values[1],
        revision: "0",
        status: "pending"
      }] };
    }
    if (sql.includes("UPDATE organizations")) return { rows: [{ revision: "1" }] };
    if (sql.includes("INSERT INTO idempotency_records")) {
      idempotentResponse = { requestHash: values[3], response: JSON.parse(values[4]) };
      return { rows: [] };
    }
    return { rows: [] };
  });
  const repository = new PostgresOrganizationGovernanceRepository(harness.pool);
  const input = {
    expectedRevision: 0,
    idempotencyKey: "organization-invite-member",
    organizationId: "org_1",
    role: "member",
    targetSubject: "target_1",
    traceId: "trace_1"
  };
  const created = await repository.invite(ownerIdentity, input);
  const retried = await repository.invite(ownerIdentity, { ...input, traceId: "trace_retry" });
  assert.deepEqual(retried, created);
  assert.match(created.invitation.invitationToken, /^orginv_[A-Za-z0-9_-]{43}$/);
  const insert = harness.calls.find((call) => call.sql.includes("INSERT INTO organization_invitations"));
  assert.match(insert.values[4], /^[a-f0-9]{64}$/);
  assert.notEqual(insert.values[4], created.invitation.invitationToken);
  assert.equal(harness.calls.filter((call) => call.sql.includes("INSERT INTO organization_invitations")).length, 1);
});

test("authorizes only owners and active organization members for Intuecho visibility", async () => {
  const rows = new Map([
    ["owner_1", { owner_subject: "owner_1", role: null, status: null }],
    ["admin_1", { owner_subject: "owner_1", role: "admin", status: "active" }],
    ["member_1", { owner_subject: "owner_1", role: "member", status: "active" }],
    ["suspended_1", { owner_subject: "owner_1", role: "member", status: "suspended" }],
    ["removed_1", { owner_subject: "owner_1", role: "member", status: "removed" }]
  ]);
  const repository = new PostgresOrganizationGovernanceRepository({
    async query(_sql, values) {
      const row = rows.get(values[1]);
      return { rows: row ? [row] : [] };
    }
  });
  assert.deepEqual(await repository.authorizeIntuechoAccess({ organizationId: "org_1", userSubject: "owner_1" }), { allowed: true, role: "owner" });
  assert.deepEqual(await repository.authorizeIntuechoAccess({ organizationId: "org_1", userSubject: "admin_1" }), { allowed: true, role: "admin" });
  assert.deepEqual(await repository.authorizeIntuechoAccess({ organizationId: "org_1", userSubject: "member_1" }), { allowed: true, role: "member" });
  for (const userSubject of ["suspended_1", "removed_1", "unknown_1"]) {
    assert.deepEqual(await repository.authorizeIntuechoAccess({ organizationId: "org_1", userSubject }), { allowed: false, role: null });
  }
});

test("creates Intuecho invitations through a service identity and current locked revision", async () => {
  let idempotentResponse;
  const harness = transactionHarness(async (sql, values) => {
    if (sql.includes("SELECT request_hash, response_body")) {
      return { rows: idempotentResponse ? [{ request_hash: idempotentResponse.hash, response_body: idempotentResponse.response }] : [] };
    }
    if (sql.includes("FROM organizations organization")) {
      return { rows: [{ owner_subject: "owner_1", revision: "7", status: "active" }] };
    }
    if (sql.includes("SELECT status FROM organization_members")) return { rows: [] };
    if (sql.includes("INSERT INTO organization_invitations")) {
      return { rows: [{
        created_at: new Date("2026-08-07T00:00:00.000Z"),
        created_by: "owner_1",
        expires_at: new Date("2026-08-14T00:00:00.000Z"),
        intended_role: values[3],
        invitation_id: values[0],
        invited_subject: values[2],
        organization_id: values[1],
        revision: "0",
        status: "pending"
      }] };
    }
    if (sql.includes("UPDATE organizations")) return { rows: [{ revision: "8" }] };
    if (sql.includes("INSERT INTO idempotency_records")) {
      idempotentResponse = { hash: values[3], response: JSON.parse(values[4]) };
      return { rows: [] };
    }
    return { rows: [] };
  });
  const repository = new PostgresOrganizationGovernanceRepository(harness.pool);
  const identity = { audience: "liteasy-internal", clientId: "intuecho-organization-service" };
  const input = {
    actorSubject: "owner_1",
    idempotencyKey: "intuecho-message-0001",
    organizationId: "org_1",
    role: "member",
    targetSubject: "target_1",
    traceId: "trace_intuecho_1"
  };
  const created = await repository.inviteFromIntuecho(identity, input);
  const replayed = await repository.inviteFromIntuecho(identity, input);
  assert.deepEqual(replayed, created);
  assert.equal(created.organizationRevision, 8);
  assert.equal(harness.calls.filter((call) => call.sql.includes("INSERT INTO organization_invitations")).length, 1);
  assert.equal(harness.calls.some((call) => call.sql.includes("FOR UPDATE OF organization")), true);
  const audit = harness.calls.find((call) => call.sql.includes("INSERT INTO audit_events"));
  assert.equal(audit.values[2], "service");
  assert.throws(() => repository.inviteFromIntuecho({
    audience: "intuecho-web",
    clientId: "intuecho-organization-service"
  }, input), /service_identity_required/);
});
