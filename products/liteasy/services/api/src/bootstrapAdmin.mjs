import { randomUUID } from "node:crypto";
import { loadMigrationDatabaseConfig } from "./config.mjs";
import { PostgresPlatformAdminRepository } from "./platformAdminRepository.mjs";
import { createPostgresPool } from "./postgres.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`admin_bootstrap_config_missing: ${name} is required`);
  return value;
}

const environment = required("NODE_ENV").toLowerCase();
if (environment === "production" && required("LITEASY_BOOTSTRAP_CONFIRM") !== "bootstrap-first-platform-admin") {
  throw new Error("admin_bootstrap_confirmation_invalid");
}
const database = loadMigrationDatabaseConfig();
const pool = createPostgresPool(database);
try {
  const repository = new PostgresPlatformAdminRepository(pool, { environment });
  const result = await repository.bootstrap(required("LITEASY_BOOTSTRAP_ADMIN_SUBJECT"), {
    reason: required("LITEASY_BOOTSTRAP_REASON"),
    traceId: `trace_${randomUUID()}`
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}
