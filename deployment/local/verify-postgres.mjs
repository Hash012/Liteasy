import assert from "node:assert/strict";
import { createPostgresPool } from "../../products/liteasy/services/api/src/postgres.mjs";
import { createIntuechoPool } from "../../products/intuecho/services/api/src/postgres.mjs";
import { localPort, readLocalEnvironment, resolvedLocalEnvironment } from "./config.mjs";

const values = resolvedLocalEnvironment(readLocalEnvironment());

function postgresUrl(portName, database, role, password) {
  const url = new URL("postgresql://localhost");
  url.hostname = values.LOCAL_RUNTIME_HOST;
  url.port = String(localPort(values, portName));
  url.pathname = `/${database}`;
  url.username = role;
  url.password = password;
  return url.toString();
}

async function verify(pool, expected) {
  const status = await pool.query(`
    SELECT current_database() AS database_name,
           current_user AS role_name,
           has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema,
           EXISTS(SELECT 1 FROM pg_stat_ssl WHERE pid = pg_backend_pid() AND ssl) AS tls
  `);
  const migrations = await pool.query("SELECT count(*)::integer AS count FROM schema_migrations");
  const row = status.rows[0];
  assert.equal(row.database_name, expected.database);
  assert.equal(row.role_name, expected.role);
  assert.equal(row.can_create_schema, false);
  assert.equal(row.tls, true);
  assert.equal(migrations.rows[0].count, expected.migrations);
  return {
    database: row.database_name,
    migrations: migrations.rows[0].count,
    role: row.role_name,
    schemaCreate: false,
    tls: true
  };
}

const liteasy = createPostgresPool({
  connectionString: postgresUrl("LITEASY_DB_HOST_PORT", "liteasy", "liteasy_app", values.LITEASY_DB_APP_PASSWORD),
  sslMode: "require"
});
const intuecho = createIntuechoPool({
  connectionString: postgresUrl("INTUECHO_DB_HOST_PORT", "intuecho", "intuecho_app", values.INTUECHO_DB_APP_PASSWORD),
  sslMode: "require"
});
try {
  const result = {
    intuecho: await verify(intuecho, { database: "intuecho", migrations: 9, role: "intuecho_app" }),
    liteasy: await verify(liteasy, { database: "liteasy", migrations: 19, role: "liteasy_app" }),
    verified: true
  };
  assert.notEqual(result.intuecho.database, result.liteasy.database);
  assert.notEqual(result.intuecho.role, result.liteasy.role);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await Promise.all([intuecho.end(), liteasy.end()]);
}
