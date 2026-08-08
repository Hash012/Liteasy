import { loadCloudConfig } from "./config.mjs";
import { PostgresLibraryRepository } from "./libraryRepository.mjs";
import { verifyPostgresMigrations } from "./migrations.mjs";
import { createPostgresPool, verifyPostgresReadiness } from "./postgres.mjs";
import { S3ObjectStore } from "./s3ObjectStore.mjs";
import { PdfUploadService } from "./pdfUploadService.mjs";
import { HttpsPdfSecurityScanner } from "./pdfSecurityScanner.mjs";
import { StorageMaintenanceService } from "./storageMaintenance.mjs";
import { PostgresPersonalizationRepository } from "./personalizationRepository.mjs";
import { PostgresExternalKnowledgeRepository } from "./externalKnowledgeService.mjs";

const config = loadCloudConfig();
const pool = createPostgresPool(config.database);
const objectStore = new S3ObjectStore(config.s3);
try {
  await verifyPostgresReadiness(pool);
  await verifyPostgresMigrations(pool);
  await objectStore.assertSecurityConfiguration();
  const libraryRepository = new PostgresLibraryRepository(pool);
  const pdfUploadService = new PdfUploadService(
    libraryRepository,
    objectStore,
    new HttpsPdfSecurityScanner(config.pdfSecurity)
  );
  const pdfSecurity = await pdfUploadService.scanUnverifiedObjects({ limit: 100 });
  const result = await new StorageMaintenanceService(
    libraryRepository,
    objectStore,
    new PostgresPersonalizationRepository(pool),
    new PostgresExternalKnowledgeRepository(pool)
  ).run();
  process.stdout.write(`${JSON.stringify({ ...result, pdfSecurity })}\n`);
  if (result.failedObjects.length > 0 || pdfSecurity.failures.length > 0 || pdfSecurity.remaining > 0) {
    throw new Error("storage_maintenance_incomplete");
  }
} finally {
  await pool.end();
  objectStore.client.destroy();
}
