import assert from "node:assert/strict";
import test from "node:test";
import { PostgresOrganizationGovernanceRepository } from "./organizationGovernanceRepository.mjs";

const targetIdentity = { audience: "liteasy-desktop", subject: "target_1" };
const acceptInput = {
  expectedInvitationRevision: 0,
  idempotencyKey: "accept-invitation-current-authority",
  invitationToken: `orginv_${"x".repeat(43)}`,
  traceId: "trace_invitation_acceptance"
};

function invitationHarness({ inviterRole = "admin", inviterStatus = "active", intendedRole = "member", invitation = {} } = {}) {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM organization_invitations invitation")) {
        return { rows: [{
          created_by: "inviter_1",
          expires_at: new Date(Date.now() + 60_000),
          intended_role: intendedRole,
          invitation_id: "invitation_1",
          invited_subject: "target_1",
          inviter_role: inviterRole === "owner" ? null : inviterRole,
          inviter_status: inviterStatus,
          organization_id: "org_1",
          organization_revision: "4",
          organization_status: "active",
          owner_subject: inviterRole === "owner" ? "inviter_1" : "owner_1",
          revision: "0",
          status: "pending",
          ...invitation
        }] };
      }
      if (sql.includes("INSERT INTO organization_members")) {
        return { rows: [{ member_subject: "target_1", revision: "0", role: intendedRole, status: "active" }] };
      }
      if (sql.includes("UPDATE organization_invitations")) return { rows: [{ invitation_id: "invitation_1" }] };
      if (sql.includes("UPDATE organizations")) return { rows: [{ revision: "5" }] };
      return { rows: [] };
    },
    release() {}
  };
  return {
    calls,
    repository: new PostgresOrganizationGovernanceRepository({ async connect() { return client; } })
  };
}

test("accepting an invitation cannot restore authority withdrawn from its inviter", async () => {
  for (const fixture of [
    { inviterRole: "member" },
    { inviterRole: "admin", inviterStatus: "suspended" },
    { inviterRole: "admin", inviterStatus: "removed" },
    { inviterRole: null, inviterStatus: null }
  ]) {
    const { repository, calls } = invitationHarness(fixture);
    await assert.rejects(() => repository.acceptInvitation(targetIdentity, acceptInput), (error) => {
      assert.equal(error.code, "organization_invitation_inviter_forbidden");
      assert.equal(error.status, 403);
      return true;
    });
    assert.equal(calls.some(({ sql }) => sql.includes("INSERT INTO organization_members")), false);
    assert.equal(calls.some(({ sql }) => sql === "ROLLBACK"), true);
  }
});

test("a former owner can still invite members as an administrator but cannot grant administrator role", async () => {
  const adminInvitation = invitationHarness({ inviterRole: "admin", intendedRole: "admin" });
  await assert.rejects(
    () => adminInvitation.repository.acceptInvitation(targetIdentity, acceptInput),
    /organization_invitation_inviter_forbidden/
  );
  const memberInvitation = invitationHarness({ inviterRole: "admin", intendedRole: "member" });
  const accepted = await memberInvitation.repository.acceptInvitation(targetIdentity, acceptInput);
  assert.equal(accepted.membership.role, "member");
  assert.equal(accepted.organizationRevision, 5);
});

test("current owners and administrators retain their existing invitation powers", async () => {
  for (const fixture of [
    { inviterRole: "owner", intendedRole: "admin" },
    { inviterRole: "owner", intendedRole: "member" },
    { inviterRole: "admin", intendedRole: "member" }
  ]) {
    const { repository, calls } = invitationHarness(fixture);
    const accepted = await repository.acceptInvitation(targetIdentity, acceptInput);
    assert.equal(accepted.membership.role, fixture.intendedRole);
    assert.ok(calls.some(({ sql }) => sql.includes("FOR UPDATE OF invitation, organization")));
  }
});

test("target binding and revoked, expired, or stale invitations cannot add a membership", async () => {
  for (const [invitation, code] of [
    [{ invited_subject: "someone_else" }, "organization_invitation_required"],
    [{ status: "revoked" }, "organization_invitation_not_pending"],
    [{ status: "accepted" }, "organization_invitation_not_pending"],
    [{ expires_at: new Date(Date.now() - 1) }, "organization_invitation_not_pending"],
    [{ revision: "1" }, "organization_invitation_not_pending"]
  ]) {
    const { repository, calls } = invitationHarness({ invitation });
    await assert.rejects(() => repository.acceptInvitation(targetIdentity, acceptInput), (error) => error.code === code);
    assert.equal(calls.some(({ sql }) => sql.includes("INSERT INTO organization_members")), false);
  }
});
