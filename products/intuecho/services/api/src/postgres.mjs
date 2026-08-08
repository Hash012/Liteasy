import pg from "pg";

const { Pool } = pg;

export function createIntuechoPool(config, PoolType = Pool) {
  if (!config?.connectionString) throw new Error("intuecho_postgres_config_missing");
  return new PoolType({
    application_name: "intuecho-api",
    connectionString: config.connectionString,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    max: 20,
    ssl: { rejectUnauthorized: config.sslMode !== "require" }
  });
}

export async function verifyIntuechoPostgres(pool) {
  const result = await pool.query(`
    SELECT current_database() AS database_name,
           current_setting('server_version_num')::integer AS server_version_num,
           current_setting('transaction_read_only') AS transaction_read_only
  `);
  const row = result.rows[0];
  if (!row || Number(row.server_version_num) < 150000) {
    throw new Error("intuecho_postgres_version_unsupported");
  }
  if (row.transaction_read_only !== "off") throw new Error("intuecho_postgres_read_only");
  return { databaseName: row.database_name, serverVersion: Number(row.server_version_num), writable: true };
}

export async function withTransaction(pool, operation, isolation = "READ COMMITTED") {
  if (!new Set(["READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"]).has(isolation)) {
    throw new Error("intuecho_transaction_isolation_invalid");
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
      // Preserve the business failure. Readiness will expose a broken pool separately.
    }
    throw error;
  } finally {
    client.release();
  }
}
