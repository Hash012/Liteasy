import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localPort, readLocalEnvironment, resolvedLocalEnvironment } from "./config.mjs";

const localRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(localRoot, "../..");
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

function run(cwd, script, env) {
  const result = spawnSync(process.execPath, [script], {
    cwd: path.join(repositoryRoot, cwd),
    env: { ...process.env, ...env },
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("LiteasyClaw/services/cloud", "src/migrate.mjs", {
  DATABASE_URL: postgresUrl("LITEASY_DB_HOST_PORT", "liteasy", "liteasy_app", values.LITEASY_DB_APP_PASSWORD),
  LITEASY_DATABASE_SSL_MODE: "require",
  LITEASY_MIGRATION_DATABASE_URL: postgresUrl("LITEASY_DB_HOST_PORT", "liteasy", "liteasy_migrator", values.LITEASY_DB_MIGRATOR_PASSWORD),
  NODE_ENV: "test"
});
run("Intuecho/services/api", "src/migrate.mjs", {
  INTUECHO_DATABASE_SSL_MODE: "require",
  INTUECHO_DATABASE_URL: postgresUrl("INTUECHO_DB_HOST_PORT", "intuecho", "intuecho_app", values.INTUECHO_DB_APP_PASSWORD),
  INTUECHO_MIGRATION_DATABASE_URL: postgresUrl("INTUECHO_DB_HOST_PORT", "intuecho", "intuecho_migrator", values.INTUECHO_DB_MIGRATOR_PASSWORD),
  NODE_ENV: "test"
});
process.stdout.write("Liteasy and Intuecho migrations completed with separate migrator roles.\n");
