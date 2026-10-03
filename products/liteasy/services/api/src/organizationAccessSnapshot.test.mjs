import assert from "node:assert/strict";
import test from "node:test";
import { authorizeLibraryScope } from "./libraryAuthorization.mjs";
import { PostgresOrganizationGovernanceRepository } from "./organizationGovernanceRepository.mjs";

const identity = { audience: "liteasy-desktop", subject: "member_1" };
const organizationRow = {
  export_policy: "disabled",
  member_count: 3,
  my_role: "member",
  name: "Synthetic research group",
  organization_id: "org_1",
  owner_subject: "owner_1",
  policy_revision: "7",
  revision: "12",
  upload_policy: "owner_admins"
};

function listRepository(row) {
  return new PostgresOrganizationGovernanceRepository({
    async query(_sql, values) {
      assert.deepEqual(values, [identity.subject]);
      return { rows: row ? [row] : [] };
    }
  });
}

test("organization list explains current member permissions without trusting a requested role", async () => {
  const repository = listRepository(organizationRow);
  const { organizations: [organization] } = await repository.list({ ...identity, role: "owner" });
  assert.deepEqual(organization.allowedActions, ["read_metadata", "read_body", "comment"]);
  assert.equal(organization.policyRevision, 7);
  assert.equal(organization.authorizationRevision, 12);
  assert.deepEqual(organization.actionConstraints, { inviteRoles: [] });
  assert.deepEqual(organization.policyExceptions, []);
  assert.deepEqual(organization.denialReasons, {
    change_role: "organization_owner_required",
    edit_own: "organization_resource_context_required",
    export_original: "organization_export_forbidden",
    invite: "organization_role_forbidden",
    moderate: "organization_role_forbidden",
    publish_public: "organization_external_use_policy_unconfirmed",
    run_external_model: "organization_external_use_policy_unconfirmed",
    share_excerpt: "organization_external_use_policy_unconfirmed",
    transfer_owner: "organization_owner_required",
    upload: "organization_upload_forbidden"
  });
});

test("owner export exception agrees with actual export authorization while external use remains closed", async () => {
  const repository = listRepository({ ...organizationRow, my_role: "owner" });
  const { organizations: [organization] } = await repository.list(identity);
  assert.ok(organization.allowedActions.includes("export_original"));
  assert.ok(organization.allowedActions.includes("transfer_owner"));
  assert.deepEqual(organization.policyExceptions, ["owner_export"]);
  assert.deepEqual(organization.actionConstraints, { inviteRoles: ["admin", "member"] });
  for (const action of ["share_excerpt", "publish_public", "run_external_model"]) {
    assert.equal(organization.allowedActions.includes(action), false);
    assert.equal(organization.denialReasons[action], "organization_external_use_policy_unconfirmed");
  }
  const scope = await authorizeLibraryScope({
    async query() {
      return { rows: [{ ...organizationRow, organization_status: "active" }] };
    }
  }, { ...identity, subject: "owner_1" }, { scopeType: "organization", scopeId: "org_1" }, "export");
  assert.equal(scope.role, "owner");
});

test("administrator permissions explain restricted invitations and export policy changes", async () => {
  let currentPolicy = { ...organizationRow, my_role: "admin" };
  const repository = new PostgresOrganizationGovernanceRepository({
    async query() { return { rows: [currentPolicy] }; }
  });
  const first = (await repository.list(identity)).organizations[0];
  assert.ok(first.allowedActions.includes("invite"));
  assert.ok(first.allowedActions.includes("moderate"));
  assert.ok(first.allowedActions.includes("upload"));
  assert.equal(first.allowedActions.includes("export_original"), false);
  assert.deepEqual(first.actionConstraints.inviteRoles, ["member"]);
  assert.equal(first.denialReasons.change_role, "organization_owner_required");
  currentPolicy = { ...currentPolicy, export_policy: "admins_only", policy_revision: "8" };
  const next = (await repository.list(identity)).organizations[0];
  assert.equal(next.policyRevision, 8);
  assert.ok(next.allowedActions.includes("export_original"));
  assert.equal(next.denialReasons.export_original, undefined);
});

test("Intuecho membership choices contain only authorized organization metadata and permission explanations", async () => {
  const repository = listRepository(organizationRow);
  const { organizations: [organization] } = await repository.listForIntuecho({
    userSubject: identity.subject,
    organizationId: "org_unauthorized",
    role: "owner"
  });
  assert.deepEqual(Object.keys(organization).sort(), [
    "actionConstraints", "allowedActions", "authorizationRevision", "denialReasons", "myRole",
    "name", "organizationId", "policyExceptions", "policyRevision"
  ]);
  assert.equal(organization.organizationId, "org_1");
  assert.equal(organization.myRole, "member");
  assert.deepEqual((await listRepository(null).listForIntuecho({ userSubject: identity.subject })).organizations, []);
});

test("organization summary uses the same policy snapshot as the membership choice", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM organizations organization")) {
        return { rows: [{ ...organizationRow, member_role: "member", member_status: "active", member_revision: "2", status: "active" }] };
      }
      if (sql.includes("FROM organization_storage_policies")) {
        return { rows: [{ ...organizationRow, revision: "7", updated_at: new Date("2026-10-03T00:00:00.000Z"), updated_by: "owner_1" }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() {}
  };
  const repository = new PostgresOrganizationGovernanceRepository({ async connect() { return client; } });
  const { summary } = await repository.summary(identity, { organizationId: "org_1" });
  const { organizations: [choice] } = await listRepository(organizationRow).list(identity);
  assert.equal(summary.policyRevision, 7);
  for (const field of ["allowedActions", "denialReasons", "policyRevision", "authorizationRevision", "policyExceptions", "actionConstraints"]) {
    assert.deepEqual(summary[field], choice[field]);
  }
});

test("all existing role and storage policy combinations agree with actual library authorization", async () => {
  for (const role of ["owner", "admin", "member"]) {
    for (const exportPolicy of ["disabled", "admins_only", "all_members"]) {
      for (const uploadPolicy of ["owner_admins", "all_members"]) {
        const row = { ...organizationRow, my_role: role, export_policy: exportPolicy, upload_policy: uploadPolicy };
        const { organizations: [organization] } = await listRepository(row).list(identity);
        const authorizationPool = {
          async query() {
            return { rows: [{
              ...row,
              member_role: role === "owner" ? null : role,
              member_status: role === "owner" ? null : "active",
              organization_status: "active",
              owner_subject: role === "owner" ? identity.subject : "owner_1"
            }] };
          }
        };
        for (const [capability, action] of [["read", "read_body"], ["upload", "upload"], ["export", "export_original"]]) {
          let allowed = true;
          try {
            await authorizeLibraryScope(authorizationPool, identity, { scopeType: "organization", scopeId: "org_1" }, capability);
          } catch (error) {
            assert.equal(error.code, `organization_${capability}_forbidden`);
            allowed = false;
          }
          assert.equal(organization.allowedActions.includes(action), allowed, `${role}/${exportPolicy}/${uploadPolicy}/${action}`);
        }
      }
    }
  }
});
