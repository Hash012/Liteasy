import assert from "node:assert/strict";
import test from "node:test";
import { authorizeLibraryScope } from "./libraryAuthorization.mjs";

const identity = { audience: "liteasy-desktop", subject: "user_1" };

function pool(row) {
  return { async query(_sql, values) { assert.deepEqual(values, ["org_1", "user_1"]); return { rows: row ? [row] : [] }; } };
}

test("derives personal scope exclusively from the signed subject", async () => {
  assert.deepEqual(await authorizeLibraryScope({}, identity, { scopeType: "user" }), {
    actorId: "user_1", role: "owner", scopeId: "user_1", scopeType: "user"
  });
  await assert.rejects(
    () => authorizeLibraryScope({}, identity, { scopeId: "user_2", scopeType: "user" }),
    /user_scope_forbidden/
  );
});

test("rejects the wrong audience and inactive organization membership", async () => {
  await assert.rejects(
    () => authorizeLibraryScope({}, { ...identity, audience: "liteasy-admin" }, { scopeType: "user" }),
    /desktop_identity_required/
  );
  const activeMember = {
    export_policy: "all_members",
    member_role: "member",
    member_status: "active",
    organization_status: "active",
    owner_subject: "owner_1",
    upload_policy: "all_members"
  };
  await assert.rejects(
    () => authorizeLibraryScope(
      pool({ ...activeMember, member_status: "suspended" }),
      identity,
      { scopeId: "org_1", scopeType: "organization" }
    ),
    /organization_membership_required/
  );
  await assert.rejects(
    () => authorizeLibraryScope(
      pool({ ...activeMember, organization_status: "suspended" }),
      identity,
      { scopeId: "org_1", scopeType: "organization" }
    ),
    /organization_not_available/
  );
});

test("enforces organization upload and export policy from PostgreSQL", async () => {
  const member = {
    export_policy: "disabled",
    member_role: "member",
    member_status: "active",
    organization_status: "active",
    owner_subject: "owner_1",
    upload_policy: "all_members"
  };
  assert.equal((await authorizeLibraryScope(pool(member), identity, { scopeId: "org_1", scopeType: "organization" }, "upload")).role, "member");
  await assert.rejects(
    () => authorizeLibraryScope(pool(member), identity, { scopeId: "org_1", scopeType: "organization" }, "export"),
    /organization_export_forbidden/
  );
  const admin = { ...member, export_policy: "admins_only", member_role: "admin", upload_policy: "owner_admins" };
  assert.equal((await authorizeLibraryScope(pool(admin), identity, { scopeId: "org_1", scopeType: "organization" }, "manage")).role, "admin");
  assert.equal((await authorizeLibraryScope(pool(admin), identity, { scopeId: "org_1", scopeType: "organization" }, "export")).role, "admin");
});

test("does not grant platform roles implicit organization access", async () => {
  await assert.rejects(
    () => authorizeLibraryScope(pool(null), { ...identity, roles: ["platform_admin"] }, { scopeId: "org_1", scopeType: "organization" }),
    /organization_not_available/
  );
});
