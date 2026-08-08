import { loadIntuechoMigrationConfig } from "./productionConfig.mjs";
import { migrateIntuecho } from "./migrations.mjs";
import { createIntuechoPool } from "./postgres.mjs";

const config = loadIntuechoMigrationConfig();
const pool = createIntuechoPool(config);
try {
  const result = await migrateIntuecho(pool, { applicationRole: config.applicationRole });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await pool.end();
}
