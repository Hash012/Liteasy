import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localPort, readLocalEnvironment, resolvedLocalEnvironment } from "./config.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const values = resolvedLocalEnvironment(readLocalEnvironment());

function postgresUrl(role, password) {
  const url = new URL("postgresql://localhost");
  url.hostname = values.LOCAL_RUNTIME_HOST;
  url.port = String(localPort(values, "LITEASY_DB_HOST_PORT"));
  url.pathname = "/liteasy_test";
  url.username = role;
  url.password = password;
  return url.toString();
}

const environment = {
  ...process.env,
  LITEASY_TEST_DATABASE_URL: postgresUrl("liteasy_app", values.LITEASY_DB_APP_PASSWORD),
  LITEASY_TEST_MIGRATION_DATABASE_URL: postgresUrl("liteasy_migrator", values.LITEASY_DB_MIGRATOR_PASSWORD)
};
const integration = spawnSync("npm", ["run", "test:postgres:integration"], {
  cwd: path.join(repositoryRoot, "products/liteasy/services/api"),
  env: environment,
  stdio: "inherit"
});

if (integration.status !== 0) process.exit(integration.status ?? 1);

const visualization = spawnSync("npm", ["run", "test:postgres:visualization"], {
  cwd: path.join(repositoryRoot, "products/liteasy/services/api"),
  env: environment,
  stdio: "inherit"
});

process.exit(visualization.status ?? 1);
