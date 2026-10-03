import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PostgresAccountLifecycleRepository } from "../src/accountLifecycleRepository.mjs";
import { PostgresAgentArtifactRepository } from "../src/agentArtifactRepository.mjs";

export function deferred() {
  let resolve;
  const promise = new Promise((finish) => { resolve = finish; });
  return { promise, resolve };
}

export async function within(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("account deletion concurrency barrier timed out")), 5_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

export function observedPool(pool, { commitReached, allowCommit, lockReached } = {}) {
  return {
    async connect() {
      const client = await pool.connect();
      const { rows: [{ pid }] } = await client.query("SELECT pg_backend_pid() AS pid");
      return {
        async query(sql, values) {
          if (sql.includes("pg_advisory_xact_lock") && values?.[0]?.startsWith("account-deletion:")) lockReached?.resolve(pid);
          if (sql === "COMMIT" && allowCommit) {
            commitReached.resolve();
            await allowCommit.promise;
          }
          return client.query(sql, values);
        },
        release() { client.release(); }
      };
    }
  };
}

export async function assertBlocked(pool, pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await pool.query("SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked", [pid]);
    if (result.rows[0].blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("account write and deletion must wait on the same PostgreSQL lock");
}

export async function verifyAccountDeletionConcurrency(pool) {
  for (const deletionFirst of [true, false]) {
    const subject = `deletion-race-${randomUUID()}`;
    const commitReached = deferred();
    const allowCommit = deferred();
    const lockReached = deferred();
    const firstPool = observedPool(pool, { commitReached, allowCommit });
    const secondPool = observedPool(pool, { lockReached });
    const lifecycle = new PostgresAccountLifecycleRepository(pool);
    const deletion = {
      actorId: "deletion-race-admin", idempotencyKey: `delete-${randomUUID()}`,
      reason: "Synthetic account deletion concurrency verification", status: "deleted",
      subjectId: subject, traceId: "deletion-race"
    };
    const artifact = {
      agent: { runId: "race-run", status: "completed" }, artifactId: "late-artifact", artifactType: "tree",
      createdAt: new Date().toISOString(), title: "Synthetic late artifact", version: "liteasy.agent-artifact/v1"
    };
    let first;
    let second;
    try {
      first = deletionFirst
        ? new PostgresAccountLifecycleRepository(firstPool).beginDeletion(deletion)
        : new PostgresAgentArtifactRepository(firstPool).save(subject, artifact, "deletion-race");
      await within(commitReached.promise);
      second = (deletionFirst
        ? new PostgresAgentArtifactRepository(secondPool).save(subject, artifact, "deletion-race")
        : new PostgresAccountLifecycleRepository(secondPool).beginDeletion(deletion)
      ).then((value) => ({ value }), (error) => ({ error }));
      await assertBlocked(pool, await within(lockReached.promise));
      allowCommit.resolve();
      await first;
      const result = await second;
      if (deletionFirst) {
        assert.equal(result.error?.code, "account_deletion_started");
      } else {
        assert.equal(result.error, undefined);
        assert.equal(result.value.state, "requested");
        assert.equal((await pool.query("SELECT count(*)::int AS count FROM agent_artifacts WHERE subject_id = $1", [subject])).rows[0].count, 1);
        await lifecycle.purgeLiteasyData(deletion);
      }
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM agent_artifacts WHERE subject_id = $1", [subject])).rows[0].count, 0);
      // The retained tombstone also rejects a later authenticated request, not just the waiter.
      await assert.rejects(() => new PostgresAgentArtifactRepository(pool).save(subject, artifact, "after-deletion"), /account_deletion_started/);
    } finally {
      allowCommit.resolve();
      await Promise.allSettled([first, second].filter(Boolean));
      await pool.query("DELETE FROM agent_artifacts WHERE subject_id = $1", [subject]);
      await pool.query("DELETE FROM account_deletion_jobs WHERE subject_id = $1", [subject]);
    }
  }
}
