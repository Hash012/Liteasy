import pg from "pg";

const { Pool } = pg;

export function createPostgresPool(databaseConfig, PoolType = Pool) {
  if (!databaseConfig?.connectionString) throw new Error("postgres_config_missing: connectionString is required");
  return new PoolType({
    application_name: "liteasy-cloud",
    connectionString: databaseConfig.connectionString,
    max: 20,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    ssl: {
      rejectUnauthorized: databaseConfig.sslMode !== "require"
    }
  });
}

export async function verifyPostgresReadiness(pool) {
  const result = await pool.query(`
    SELECT
      current_database() AS database_name,
      current_setting('server_version_num')::integer AS server_version_num,
      current_setting('transaction_read_only') AS transaction_read_only
  `);
  const row = result.rows[0];
  if (!row || Number(row.server_version_num) < 150000) {
    throw new Error("postgres_version_unsupported: PostgreSQL 15 or newer is required");
  }
  if (row.transaction_read_only !== "off") {
    throw new Error("postgres_read_only: the primary database is not writable");
  }
  return {
    databaseName: row.database_name,
    serverVersion: Number(row.server_version_num),
    writable: true
  };
}

export async function withPostgresTransaction(pool, operation, { isolation = "SERIALIZABLE" } = {}) {
  if (!new Set(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"]).has(isolation)) {
    throw new Error("postgres_transaction_invalid_isolation");
  }
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original failure. Pool health checks expose a failed connection separately.
    }
    throw error;
  } finally {
    client.release();
  }
}
