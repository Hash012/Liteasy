import assert from "node:assert/strict";
import test from "node:test";
import { StorageMaintenanceService } from "./storageMaintenance.mjs";

test("purges expired trash and finalizes only objects deleted from S3", async () => {
  const completed = [];
  const service = new StorageMaintenanceService({
    async claimUnreferencedObjects() {
      return [
        { content_hash: "a".repeat(64), storage_key: "objects/a" },
        { content_hash: "b".repeat(64), storage_key: "objects/b" }
      ];
    },
    async completeObjectGarbageCollection(hash) { completed.push(hash); },
    async purgeExpiredTrash() { return { purgedCount: 3 }; }
  }, {
    async deleteKey(key) { if (key === "objects/b") throw new Error("S3 unavailable"); }
  }, {
    async purgeExpiredCaches(limit) {
      assert.equal(limit, 100);
      return {
        idempotencyRecords: 4,
        recommendationCacheEntries: 2,
        recommendationCandidates: 1
      };
    }
  }, {
    async purgeExpiredRetrievalData(limit) {
      assert.equal(limit, 100);
      return { pdfGrants: 5, retrievalCacheEntries: 6 };
    }
  });

  assert.deepEqual(await service.run(), {
    failedObjects: ["b".repeat(64)],
    purgedIdempotencyRecords: 4,
    purgedExternalPdfGrants: 5,
    purgedExternalRetrievalCacheEntries: 6,
    purgedRecommendationCacheEntries: 2,
    purgedRecommendationCandidates: 1,
    purgedTrashNodes: 3,
    removedObjects: 1,
    scannedObjects: 2
  });
  assert.deepEqual(completed, ["a".repeat(64)]);
});
