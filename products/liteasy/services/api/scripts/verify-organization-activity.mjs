import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readOrganizationActivity } from "../src/organizationActivity.mjs";

export async function verifyOrganizationActivity(pool) {
  const client = await pool.connect();
  const suffix = randomUUID();
  const organization = `activity-org-${suffix}`;
  const subject = `activity-reader-${suffix}`;
  const other = `activity-other-${suffix}`;
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO organizations(organization_id, owner_subject, name) VALUES ($1, $2, 'Synthetic activity group')", [organization, other]);
    await client.query("INSERT INTO organization_members(organization_id, member_subject, role, status) VALUES ($1, $2, 'member', 'active')", [organization, subject]);
    for (const member of [subject, other]) {
      await client.query(`INSERT INTO audit_events(audit_id, actor_id, actor_audience, action, resource_type, resource_id, scope_type, scope_id, trace_id, detail)
        VALUES ($1, $2, 'liteasy-desktop', 'change_organization_member_role', 'organization_member', $3, 'organization', $4, 'synthetic-activity', '{}')`, [`audit-${member}`, other, member, organization]);
    }
    const identity = { audience: "liteasy-desktop", subject };
    const before = await readOrganizationActivity(client, identity);
    assert.equal(before.activities.length, 1);
    assert.equal(before.activities[0].organizationName, "Synthetic activity group");
    await client.query("UPDATE organization_members SET status = 'removed' WHERE organization_id = $1 AND member_subject = $2", [organization, subject]);
    assert.deepEqual(await readOrganizationActivity(client, identity), { activities: [{ id: `audit-${subject}`, available: false }] });
    assert.deepEqual(await readOrganizationActivity(client, { ...identity, subject: "unrelated-reader" }), { activities: [] });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
