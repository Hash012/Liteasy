export function storageMaintenanceHasFailures(result) {
  return (result?.failedObjects?.length ?? 0) > 0 ||
    (result?.failedStagingObjects?.length ?? 0) > 0;
}

export class StorageMaintenanceService {
  constructor(repository, objectStore, personalizationRepository, externalKnowledgeRepository) {
    this.repository = repository;
    this.objectStore = objectStore;
    this.personalizationRepository = personalizationRepository;
    this.externalKnowledgeRepository = externalKnowledgeRepository;
  }

  async run({ limit = 100, now = new Date(), stagingRetentionHours = 24 } = {}) {
    const currentTime = now instanceof Date ? now : new Date(now);
    if (!Number.isFinite(currentTime.getTime()) ||
      !Number.isFinite(stagingRetentionHours) || stagingRetentionHours <= 0) {
      throw new Error("storage_maintenance_retention_invalid");
    }
    const trash = await this.repository.purgeExpiredTrash();
    const expired = this.personalizationRepository
      ? await this.personalizationRepository.purgeExpiredCaches(limit)
      : {
          idempotencyRecords: 0,
          recommendationCacheEntries: 0,
          recommendationCandidates: 0
        };
    const retrieval = this.externalKnowledgeRepository
      ? await this.externalKnowledgeRepository.purgeExpiredRetrievalData(limit)
      : { pdfGrants: 0, retrievalCacheEntries: 0 };
    const staging = await this.objectStore.listStagingObjects({
      before: new Date(currentTime.getTime() - stagingRetentionHours * 60 * 60 * 1000),
      limit
    });
    const referencedStagingKeys = new Set(await this.repository.listReferencedStagingKeys(
      staging.map((object) => object.storageKey)
    ));
    const failedStagingObjects = [];
    let removedStagingObjects = 0;
    for (const object of staging) {
      if (referencedStagingKeys.has(object.storageKey)) continue;
      try {
        await this.objectStore.deleteKey(object.storageKey);
        removedStagingObjects += 1;
      } catch {
        failedStagingObjects.push(object.storageKey);
      }
    }
    const candidates = await this.repository.claimUnreferencedObjects(limit);
    const failures = [];
    let removedObjects = 0;
    for (const candidate of candidates) {
      try {
        await this.objectStore.deleteKey(candidate.storage_key);
        await this.repository.completeObjectGarbageCollection(candidate.content_hash);
        removedObjects += 1;
      } catch {
        failures.push(candidate.content_hash);
      }
    }
    return {
      failedObjects: failures,
      failedStagingObjects,
      purgedIdempotencyRecords: expired.idempotencyRecords,
      purgedExternalPdfGrants: retrieval.pdfGrants,
      purgedExternalRetrievalCacheEntries: retrieval.retrievalCacheEntries,
      purgedRecommendationCacheEntries: expired.recommendationCacheEntries,
      purgedRecommendationCandidates: expired.recommendationCandidates,
      purgedTrashNodes: trash.purgedCount,
      removedObjects,
      removedStagingObjects,
      scannedObjects: candidates.length,
      scannedStagingObjects: staging.length
    };
  }
}
