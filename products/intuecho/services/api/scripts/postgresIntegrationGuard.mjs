const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);

function forbidden() {
  throw new Error("intuecho_integration_database_forbidden");
}

function explicitPoolConfig(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    forbidden();
  }
  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol) || parsed.search || parsed.hash) {
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
  return { database, host, password, port: parsed.port ? Number(parsed.port) : 5432, user };
}

export function validateIntuechoPostgresIntegrationDatabases(applicationUrl, migrationUrl) {
  const application = explicitPoolConfig(applicationUrl);
  const migration = explicitPoolConfig(migrationUrl);
  if (
    application.database !== migration.database ||
    application.host !== migration.host ||
    application.port !== migration.port ||
    application.user === migration.user
  ) {
    forbidden();
  }
  return { application, migration };
}
