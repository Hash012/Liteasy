export class StorageMaintenanceService {
  constructor(repository, objectStore, personalizationRepository, externalKnowledgeRepository) {
    this.repository = repository;
    this.objectStore = objectStore;
    this.personalizationRepository = personalizationRepository;
    this.externalKnowledgeRepository = externalKnowledgeRepository;
  }

  async run({ limit = 100 } = {}) {
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
      purgedIdempotencyRecords: expired.idempotencyRecords,
      purgedExternalPdfGrants: retrieval.pdfGrants,
      purgedExternalRetrievalCacheEntries: retrieval.retrievalCacheEntries,
      purgedRecommendationCacheEntries: expired.recommendationCacheEntries,
      purgedRecommendationCandidates: expired.recommendationCandidates,
      purgedTrashNodes: trash.purgedCount,
      removedObjects,
      scannedObjects: candidates.length
    };
  }
}
