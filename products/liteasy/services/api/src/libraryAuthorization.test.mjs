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

test("locks organization authorization rows and evaluates the current upload policy", async () => {
  const queries = [];
  const queryable = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("LEFT JOIN organization_members")) {
        return { rows: [{
          export_policy: "disabled",
          member_role: "member",
          member_status: "active",
          organization_status: "active",
          owner_subject: "owner_1",
          upload_policy: "all_members"
        }] };
      }
      if (sql.includes("FROM organizations")) {
        return { rows: [{ organization_status: "active", owner_subject: "owner_1" }] };
      }
      if (sql.includes("FROM organization_members")) {
        return { rows: [{ member_role: "member", member_status: "active" }] };
      }
      if (sql.includes("FROM organization_storage_policies")) {
        return { rows: [{ export_policy: "disabled", upload_policy: "owner_admins" }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
  const scope = { scopeId: "org_1", scopeType: "organization" };

  assert.equal((await authorizeLibraryScope(queryable, identity, scope, "upload")).role, "member");
  await assert.rejects(
    () => authorizeLibraryScope(queryable, identity, scope, "upload", { lock: true }),
    /organization_upload_forbidden/
  );

  const lockedQueries = queries.filter(({ sql }) => sql.includes("FOR SHARE"));
  assert.equal(lockedQueries.length, 3);
  assert.deepEqual(lockedQueries.map(({ values }) => values), [
    ["org_1"],
    ["org_1", "user_1"],
    ["org_1"]
  ]);
});
