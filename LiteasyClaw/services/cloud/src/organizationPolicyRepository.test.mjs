import assert from "node:assert/strict";
import test from "node:test";
import { PostgresOrganizationPolicyRepository } from "./organizationPolicyRepository.mjs";

test("maps a persisted organization policy without trusting client role data", async () => {
  const repository = new PostgresOrganizationPolicyRepository({
    async query() {
      return { rows: [{
        export_policy: "admins_only",
        revision: "3",
        updated_at: new Date("2026-08-06T00:00:00.000Z"),
        updated_by: "owner_1",
        upload_policy: "owner_admins"
      }] };
    }
  });
  assert.deepEqual(await repository.get({
    role: "member", scopeId: "org_1", scopeType: "organization"
  }), {
    exportPolicy: "admins_only",
    revision: 3,
    role: "member",
    updatedAt: "2026-08-06T00:00:00.000Z",
    updatedBy: "owner_1",
    uploadPolicy: "owner_admins"
  });
});

test("requires the organization owner and strict policy enums for updates", async () => {
  const repository = new PostgresOrganizationPolicyRepository({});
  await assert.rejects(() => repository.update({
    role: "admin", scopeId: "org_1", scopeType: "organization"
  }, {}), /organization_policy_owner_required/);
  await assert.rejects(() => repository.update({
    role: "owner", scopeId: "org_1", scopeType: "organization"
  }, {
    expectedRevision: 0,
    exportPolicy: "public",
    idempotencyKey: "policy-update-0001",
    uploadPolicy: "all_members"
  }), /organization_policy_invalid/);
});
