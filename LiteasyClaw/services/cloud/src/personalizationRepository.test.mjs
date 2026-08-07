import assert from "node:assert/strict";
import test from "node:test";
import { PostgresPersonalizationRepository } from "./personalizationRepository.mjs";

test("returns a default privacy state without creating account data", async () => {
  const queries = [];
  const repository = new PostgresPersonalizationRepository({
    async query(sql) { queries.push(sql); return { rows: [] }; }
  });
  assert.deepEqual(await repository.get("user_1"), {
    enabled: true,
    personalizationVersion: 0,
    profile: { disciplines: [], profileVersion: 0, stage: "未设置" },
    tags: []
  });
  assert.equal(queries.some((sql) => /INSERT|UPDATE|DELETE/.test(sql)), false);
});

test("strictly rejects path-like or unknown local manifest fields before persistence", async () => {
  const repository = new PostgresPersonalizationRepository({});
  await assert.rejects(() => repository.syncLocalManifest("user_1", {
    documents: [{
      sourcePath: "C:\\Users\\person\\paper.pdf",
      syncDocumentId: "sync_1",
      title: "Private path"
    }],
    idempotencyKey: "manifest-sync-0001"
  }), /local_manifest_forbidden_field/);
  await assert.rejects(() => repository.syncLocalManifest("user_1", {
    documents: [{ documentId: "local_document_1", syncDocumentId: "sync_1", title: "Raw id" }],
    idempotencyKey: "manifest-sync-0002"
  }), /local_manifest_forbidden_field/);
});

test("validates profile disciplines and personalization versions before a transaction", async () => {
  const repository = new PostgresPersonalizationRepository({});
  await assert.rejects(() => repository.saveProfile("user_1", {
    expectedVersion: 0,
    idempotencyKey: "profile-save-0001",
    profile: { disciplines: [], stage: "unknown" }
  }), /academic_profile_invalid/);
  await assert.rejects(() => repository.setEnabled("user_1", {
    enabled: false,
    expectedVersion: -1,
    idempotencyKey: "settings-update-0001"
  }), /personalization_version_invalid/);
});

test("bounds cache maintenance batches before opening a transaction", async () => {
  const repository = new PostgresPersonalizationRepository({});
  await assert.rejects(() => repository.purgeExpiredCaches(0), /maintenance_limit_invalid/);
  await assert.rejects(() => repository.purgeExpiredCaches(10_001), /maintenance_limit_invalid/);
});
