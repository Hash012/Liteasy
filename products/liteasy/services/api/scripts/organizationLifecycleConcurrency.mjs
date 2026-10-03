import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PostgresAccountLifecycleRepository } from "../src/accountLifecycleRepository.mjs";
import { PostgresOrganizationGovernanceRepository } from "../src/organizationGovernanceRepository.mjs";
import { assertBlocked, deferred, observedPool, within } from "./accountDeletionConcurrency.mjs";

// Called only by the guarded, disposable PostgreSQL integration runner.
export async function verifyOrganizationLifecycleConcurrency(pool) {
  const prefix = `review-org-${randomUUID()}`;
  const identities = [];
  const organizations = [];
  const identity = (name) => {
    const subject = `${prefix}-${name}`;
    identities.push(subject);
    return { audience: "liteasy-desktop", subject };
  };
  const command = () => ({ idempotencyKey: randomUUID(), traceId: "review-organization-race" });
  const deletion = (actor) => ({ ...command(), subjectId: actor.subject, actorId: actor.subject,
    reason: "Synthetic isolated organization lifecycle verification" });
  const governance = new PostgresOrganizationGovernanceRepository(pool);
  const lifecycle = new PostgresAccountLifecycleRepository(pool);
  const setup = async (suffix) => {
    const owner = identity(`${suffix}-owner`);
    const target = identity(`${suffix}-target`);
    const { organization } = await governance.create(owner, { ...command(), name: "Same display name" });
    organizations.push(organization.organizationId);
    await pool.query(`INSERT INTO organization_members(organization_id, member_subject, role)
      VALUES ($1, $2, 'member')`, [organization.organizationId, target.subject]);
    return { owner, target, organization, transfer: { ...command(), organizationId: organization.organizationId,
      expectedRevision: organization.revision, expectedMemberRevision: 0, targetSubject: target.subject } };
  };
  try {
    const late = await setup("deleted-target");
    await lifecycle.beginDeletion(deletion(late.target));
    await assert.rejects(() => governance.transferOwnership(late.owner, late.transfer), /account_deletion_started/);
    await assert.rejects(() => governance.create(late.target, { ...command(), name: "Late creation" }), /account_deletion_started/);

    for (const deletionFirst of [true, false]) {
      const fixture = await setup(`ordering-${deletionFirst}`);
      const commitReached = deferred();
      const allowCommit = deferred();
      const lockReached = deferred();
      const firstPool = observedPool(pool, { commitReached, allowCommit });
      const secondPool = observedPool(pool, { lockReached });
      let first;
      let second;
      try {
        first = deletionFirst
          ? new PostgresAccountLifecycleRepository(firstPool).beginDeletion(deletion(fixture.target))
          : new PostgresOrganizationGovernanceRepository(firstPool).transferOwnership(fixture.owner, fixture.transfer);
        await within(commitReached.promise);
        second = (deletionFirst
          ? new PostgresOrganizationGovernanceRepository(secondPool).transferOwnership(fixture.owner, fixture.transfer)
          : new PostgresAccountLifecycleRepository(secondPool).beginDeletion(deletion(fixture.target)))
          .then((value) => ({ value }), (error) => ({ error }));
        await assertBlocked(pool, await within(lockReached.promise));
        allowCommit.resolve();
        await first;
        assert.equal((await second).error?.code, deletionFirst ? "account_deletion_started" : "account_owns_organization");
        const { rows: [current] } = await pool.query("SELECT owner_subject FROM organizations WHERE organization_id = $1", [fixture.organization.organizationId]);
        assert.equal(current.owner_subject, deletionFirst ? fixture.owner.subject : fixture.target.subject);
      } finally {
        allowCommit.resolve();
        await Promise.allSettled([first, second].filter(Boolean));
      }
    }

    const racing = await setup("leave-transfer");
    const outcomes = await Promise.allSettled([
      governance.leave(racing.target, { ...command(), organizationId: racing.organization.organizationId,
        expectedRevision: 0, expectedMemberRevision: 0 }),
      governance.transferOwnership(racing.owner, racing.transfer)
    ]);
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    const { rows: [current] } = await pool.query("SELECT owner_subject FROM organizations WHERE organization_id = $1", [racing.organization.organizationId]);
    assert.ok([racing.owner.subject, racing.target.subject].includes(current.owner_subject));
    await assert.rejects(() => lifecycle.beginDeletion(deletion({ subject: current.owner_subject })), /account_owns_organization/);
    // Same display name is deliberately repeated: all writes remain ID-scoped.
    const { rows } = await pool.query("SELECT organization_id FROM organizations WHERE organization_id = ANY($1::text[])", [organizations]);
    assert.equal(rows.length, organizations.length);
    return { deletedActor: true, deletedTarget: true, deletionTransferBothOrders: true, leaveTransfer: true, distinctOrganizationIds: true };
  } finally {
    await pool.query("DELETE FROM organizations WHERE organization_id = ANY($1::text[])", [organizations]);
    await pool.query("DELETE FROM account_deletion_jobs WHERE subject_id = ANY($1::text[])", [identities]);
  }
}
