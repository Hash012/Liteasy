import { loadMigrationDatabaseConfig } from "./config.mjs";
import { migratePostgres } from "./migrations.mjs";
import { createPostgresPool } from "./postgres.mjs";

const databaseConfig = loadMigrationDatabaseConfig();
const pool = createPostgresPool(databaseConfig);
try {
  const result = await migratePostgres(pool, { applicationRole: databaseConfig.applicationRole });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}
