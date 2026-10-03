import { AccountLifecycleError } from "./accountLifecycleError.mjs";
import { withPostgresTransaction } from "./postgres.mjs";

// beginDeletion holds this same lock when it creates the durable deletion job.
// Keep the lock through the write: a delayed authenticated request cannot recreate
// private data after deletion, including when a retained job is restored from backup.
export async function withAccountWriteTransaction(pool, subject, operation) {
  if (typeof subject !== "string" || !subject) {
    throw new AccountLifecycleError("identity_subject_invalid", 400);
  }
  return withPostgresTransaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`account-deletion:${subject}`]);
    const deletion = await client.query("SELECT 1 FROM account_deletion_jobs WHERE subject_id = $1", [subject]);
    if (deletion.rows[0]) throw new AccountLifecycleError("account_deletion_started", 409);
    return operation(client);
  // The tombstone query must see a deletion committed while the lock was waiting.
  }, { isolation: "READ COMMITTED" });
}
