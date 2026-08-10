import assert from "node:assert/strict";
import test from "node:test";
import * as storageMaintenance from "./storageMaintenance.mjs";

const { StorageMaintenanceService } = storageMaintenance;

test("purges expired trash and finalizes only objects deleted from S3", async () => {
  const completed = [];
  const deleted = [];
  const service = new StorageMaintenanceService({
    async claimUnreferencedObjects() {
      return [
        { content_hash: "a".repeat(64), storage_key: "objects/a" },
        { content_hash: "b".repeat(64), storage_key: "objects/b" }
      ];
    },
    async completeObjectGarbageCollection(hash) { completed.push(hash); },
    async listReferencedStagingKeys(keys) {
      assert.deepEqual(keys, ["staging/referenced", "staging/orphan", "staging/failed"]);
      return ["staging/referenced"];
    },
    async purgeExpiredTrash() { return { purgedCount: 3 }; }
  }, {
    async deleteKey(key) {
      deleted.push(key);
      if (key === "objects/b" || key === "staging/failed") throw new Error("S3 unavailable");
    },
    async listStagingObjects({ before, limit }) {
      assert.equal(before.toISOString(), "2026-08-10T00:00:00.000Z");
      assert.equal(limit, 100);
      return [
        { lastModified: "2026-08-09T00:00:00.000Z", storageKey: "staging/referenced" },
        { lastModified: "2026-08-09T00:00:00.000Z", storageKey: "staging/orphan" },
        { lastModified: "2026-08-09T00:00:00.000Z", storageKey: "staging/failed" }
      ];
    }
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

  const result = await service.run({ now: new Date("2026-08-11T00:00:00.000Z") });
  assert.deepEqual(result, {
    failedObjects: ["b".repeat(64)],
    failedStagingObjects: ["staging/failed"],
    purgedIdempotencyRecords: 4,
    purgedExternalPdfGrants: 5,
    purgedExternalRetrievalCacheEntries: 6,
    purgedRecommendationCacheEntries: 2,
    purgedRecommendationCandidates: 1,
    purgedTrashNodes: 3,
    removedObjects: 1,
    removedStagingObjects: 1,
    scannedObjects: 2,
    scannedStagingObjects: 3
  });
  assert.deepEqual(completed, ["a".repeat(64)]);
  assert.deepEqual(deleted, ["staging/orphan", "staging/failed", "objects/a", "objects/b"]);
  assert.equal(typeof storageMaintenance.storageMaintenanceHasFailures, "function");
  assert.equal(storageMaintenance.storageMaintenanceHasFailures(result), true);
});
