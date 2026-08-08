import { createPostgresPool, withPostgresTransaction } from "../postgres.mjs";

/**
 * Creates a pool for opt-in PostgreSQL integration tests. Focused repository
 * tests can pass an existing pool through `options.pool` and remain hermetic.
 */
export function createVisualizationTestPool(options = {}) {
  if (options.pool) return options.pool;
  const connectionString = options.connectionString ?? process.env.LITEASY_TEST_DATABASE_URL;
  if (!connectionString) throw new Error("visualization_test_database_unconfigured");
  return createPostgresPool({
    connectionString,
    sslMode: options.sslMode ?? process.env.LITEASY_TEST_DATABASE_SSL_MODE
  });
}

/** Runs a test operation in a transaction that is always rolled back. */
export async function withVisualizationTestTransaction(pool, operation) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve test failure */ }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Removes rebuildable visualization state for a test subject. Usage, provider
 * costs and audit rows are intentionally retained by account-lifecycle policy.
 */
export async function cleanupVisualizationTestSubject(client, subjectId) {
  if (typeof subjectId !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(subjectId)) {
    throw new Error("visualization_subject_invalid");
  }
  for (const table of [
    "visualization_artifacts",
    "visualization_user_preferences",
    "visualization_entitlements",
    "visualization_quota_policies",
    "visualization_quota_reservations",
    "visualization_provider_invocations"
  ]) {
    await client.query(`DELETE FROM ${table} WHERE subject_id = $1`, [subjectId]);
  }
}
