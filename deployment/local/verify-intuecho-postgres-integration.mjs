import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { localPort, readLocalEnvironment, resolvedLocalEnvironment } from "./config.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const values = resolvedLocalEnvironment(readLocalEnvironment());

function postgresUrl(role, password) {
  const url = new URL("postgresql://localhost");
  url.hostname = values.LOCAL_RUNTIME_HOST;
  url.port = String(localPort(values, "INTUECHO_DB_HOST_PORT"));
  url.pathname = "/intuecho_test";
  url.username = role;
  url.password = password;
  return url.toString();
}

const result = spawnSync(process.execPath, ["services/api/scripts/verify-postgres-integration.mjs"], {
  cwd: path.join(repositoryRoot, "Intuecho"),
  env: {
    ...process.env,
    INTUECHO_TEST_DATABASE_URL: postgresUrl("intuecho_app", values.INTUECHO_DB_APP_PASSWORD),
    INTUECHO_TEST_MIGRATION_DATABASE_URL: postgresUrl("intuecho_migrator", values.INTUECHO_DB_MIGRATOR_PASSWORD)
  },
  stdio: "inherit"
});

process.exit(result.status ?? 1);
