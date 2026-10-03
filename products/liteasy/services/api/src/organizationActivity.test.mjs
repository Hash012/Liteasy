import test from "node:test";
import assert from "node:assert/strict";
import { readOrganizationActivity } from "./organizationActivity.mjs";

test("organization activity is subject-bound, read-only and strips revoked content", async () => {
  const calls = [];
  const pool = { async query(sql, values) {
    calls.push({ sql, values });
    return { rows: [
      { audit_id: "own-role-event", action: "change_organization_member_role", occurred_at: "2026-10-03", organization_name: "Synthetic Group", detail: { privateBody: "never copied" } },
      { audit_id: "removed-event", action: "change_organization_member_status", occurred_at: "2026-10-03", organization_name: null, detail: { privateBody: "never copied" } }
    ] };
  } };
  assert.deepEqual(await readOrganizationActivity(pool, { audience: "liteasy-desktop", subject: "reader-a" }), { activities: [
    { id: "own-role-event", available: true, organizationName: "Synthetic Group", kind: "permissions_changed", occurredAt: "2026-10-03" },
    { id: "removed-event", available: false }
  ] });
  assert.deepEqual(calls[0].values, ["reader-a"]);
  assert.match(calls[0].sql, /event.resource_id = \$1/);
  assert.match(calls[0].sql, /member.status = 'active'/);
  assert.match(calls[0].sql, /account_deletion_jobs/);
  await assert.rejects(readOrganizationActivity(pool, { audience: "intuecho-web", subject: "reader-a" }), /desktop_identity_required/);
  assert.equal(calls.length, 1);
});
