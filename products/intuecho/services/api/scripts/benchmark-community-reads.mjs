import pg from "pg";
import { validateIntuechoPostgresIntegrationDatabases } from "./postgresIntegrationGuard.mjs";
import { verifyIntuechoMigrations } from "../src/migrations.mjs";
import { verifyCommunityReadScaling } from "./verify-community-read-scaling.mjs";
const { application } = validateIntuechoPostgresIntegrationDatabases(process.env.INTUECHO_TEST_DATABASE_URL, process.env.INTUECHO_TEST_MIGRATION_DATABASE_URL);
const pool = new pg.Pool({ ...application, max: 4, ssl: false });
try {
  await verifyIntuechoMigrations(pool);
  process.stdout.write(`${JSON.stringify(await verifyCommunityReadScaling(pool))}\n`);
} finally { await pool.end(); }
