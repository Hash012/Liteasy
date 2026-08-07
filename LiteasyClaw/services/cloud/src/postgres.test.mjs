import assert from "node:assert/strict";
import test from "node:test";
import { verifyPostgresReadiness, withPostgresTransaction } from "./postgres.mjs";

test("requires PostgreSQL 15 or newer and a writable primary", async () => {
  await assert.rejects(
    () => verifyPostgresReadiness({ query: async () => ({ rows: [{ server_version_num: 140000, transaction_read_only: "off" }] }) }),
    /version_unsupported/
  );
  await assert.rejects(
    () => verifyPostgresReadiness({ query: async () => ({ rows: [{ server_version_num: 150000, transaction_read_only: "on" }] }) }),
    /read_only/
  );
});

test("commits successful transactions and rolls back failures", async () => {
  const events = [];
  const client = {
    async query(sql) { events.push(sql); },
    release() { events.push("release"); }
  };
  const pool = { async connect() { return client; } };
  assert.equal(await withPostgresTransaction(pool, async () => "ok"), "ok");
  assert.deepEqual(events, ["BEGIN ISOLATION LEVEL SERIALIZABLE", "COMMIT", "release"]);

  events.length = 0;
  await assert.rejects(
    () => withPostgresTransaction(pool, async () => { throw new Error("failed"); }),
    /failed/
  );
  assert.deepEqual(events, ["BEGIN ISOLATION LEVEL SERIALIZABLE", "ROLLBACK", "release"]);
});
