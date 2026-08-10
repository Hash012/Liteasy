const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);

function forbidden() {
  throw new Error("integration_database_forbidden: use a loopback database whose name ends in _test");
}

function explicitPoolConfig(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    forbidden();
  }
  if (
    !new Set(["postgres:", "postgresql:"]).has(parsed.protocol) ||
    parsed.search || parsed.hash
  ) {
    forbidden();
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  let database;
  let password;
  let user;
  try {
    database = decodeURIComponent(parsed.pathname.slice(1));
    password = decodeURIComponent(parsed.password);
    user = decodeURIComponent(parsed.username);
  } catch {
    forbidden();
  }
  if (
    !loopbackHosts.has(host) || !database.endsWith("_test") ||
    database.includes("/") || !user || !password
  ) {
    forbidden();
  }
  return {
    database,
    host,
    password,
    port: parsed.port ? Number(parsed.port) : 5432,
    user
  };
}

export function validatePostgresIntegrationDatabases(connectionString, migrationConnectionString) {
  const application = explicitPoolConfig(connectionString);
  const migration = explicitPoolConfig(migrationConnectionString);
  if (
    migration.database !== application.database ||
    migration.host !== application.host ||
    migration.port !== application.port
  ) {
    forbidden();
  }
  if (migration.user === application.user) throw new Error("integration_migration_role_required");
  return { application, migration };
}
