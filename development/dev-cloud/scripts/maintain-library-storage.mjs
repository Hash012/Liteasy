import { createDatabase } from "../db/database.mjs";
import { createLibraryStorageRepository } from "../db/libraryStorageRepository.mjs";
import { assertDevCloudDeploymentBoundary } from "../deploymentBoundary.mjs";

assertDevCloudDeploymentBoundary();
const database = createDatabase();
try {
  const repository = createLibraryStorageRepository(database);
  const expiredTrash = repository.purgeExpired();
  const objectConsistency = repository.reconcileObjects();
  process.stdout.write(`${JSON.stringify({ expiredTrash, objectConsistency })}\n`);
  if (objectConsistency.missingObjects.length > 0) {
    process.exitCode = 2;
  }
} finally {
  database.close();
}
