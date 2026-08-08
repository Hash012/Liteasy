import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { PdfUploadService } from "./pdfUploadService.mjs";

const staged = {
  byteLength: 12,
  contentHash: "a".repeat(64),
  mediaType: "application/pdf",
  storageKey: "documents/.staging/upload-1"
};

const scanProof = {
  contentHash: staged.contentHash,
  scannedAt: "2026-08-07T00:00:00.000Z",
  scanner: "clamav",
  version: "1.4.3"
};

const cleanScanner = { async scan() { return scanProof; } };

function scannedObjectStore(overrides = {}) {
  return {
    async openObject() {
      return {
        body: Readable.from(["%PDF-1.7\n"]),
        byteLength: staged.byteLength,
        mediaType: "application/pdf"
      };
    },
    ...overrides
  };
}

function securedWorkflow(value) {
  return {
    ...value,
    security_scan_hash: scanProof.contentHash,
    security_scanned_at: scanProof.scannedAt,
    security_scanner: scanProof.scanner,
    security_scanner_version: scanProof.version
  };
}

function input(overrides = {}) {
  return {
    actorId: "user_1",
    expectedRevision: 0,
    fileName: "paper.pdf",
    idempotencyKey: "upload-pdf-0001",
    readable: Readable.from(["%PDF-1.7\n"]),
    traceId: "trace_1",
    ...overrides
  };
}

test("returns a duplicate decision without creating a logical entry", async () => {
  const deleted = [];
  const service = new PdfUploadService({
    async findPdfDuplicates() { return [{ documentId: "document_existing" }]; },
    async preparePdfUpload() { throw new Error("must not prepare"); }
  }, scannedObjectStore({
    async deleteKey(key) { deleted.push(key); },
    async stagePdf() { return staged; }
  }), cleanScanner);
  assert.deepEqual(await service.upload({ scopeId: "user_1", scopeType: "user" }, input()), {
    duplicates: [{ documentId: "document_existing" }],
    status: "duplicate"
  });
  assert.deepEqual(deleted, [staged.storageKey]);
});

test("publishes a new object and only then completes the database workflow", async () => {
  const events = [];
  const workflow = securedWorkflow({
    byte_length: 12,
    content_hash: staged.contentHash,
    staging_key: staged.storageKey,
    workflow_id: "workflow_1"
  });
  const service = new PdfUploadService({
    async completePdfUpload(value) { events.push(`complete:${value.workflow_id}`); return { status: "imported" }; },
    async findPdfDuplicates() { return []; },
    async markPdfUploadRepairRequired() { throw new Error("must not repair"); },
    async markPdfObjectPublished(id) { events.push(`published:${id}`); },
    async preparePdfUpload(_scope, preparedInput, preparedStaged) {
      events.push(`prepare:${preparedInput.finalKey}`);
      assert.deepEqual(preparedStaged.securityScan, scanProof);
      return { kind: "workflow", workflow };
    }
  }, scannedObjectStore({
    objectKey() { return `documents/objects/aa/${staged.contentHash}`; },
    async publishStagedPdf() { events.push("publish"); },
    async stagePdf() { return staged; }
  }), cleanScanner);
  assert.deepEqual(await service.upload({ scopeId: "user_1", scopeType: "user" }, input()), { status: "imported" });
  assert.deepEqual(events, [
    `prepare:documents/objects/aa/${staged.contentHash}`,
    "publish",
    "published:workflow_1",
    "complete:workflow_1"
  ]);
});

test("deletes staging and never prepares the database when security scanning rejects the PDF", async () => {
  const events = [];
  const service = new PdfUploadService({
    async findPdfDuplicates() { throw new Error("must not query duplicates"); },
    async preparePdfUpload() { throw new Error("must not prepare"); }
  }, scannedObjectStore({
    async deleteKey(key) { events.push(`delete:${key}`); },
    async stagePdf() { return staged; }
  }), {
    async scan() {
      const error = new Error("unsafe");
      error.code = "pdf_security_rejected";
      error.status = 422;
      throw error;
    }
  });

  await assert.rejects(
    () => service.upload({ scopeId: "user_1", scopeType: "user" }, input()),
    (error) => error.code === "pdf_security_rejected" && error.status === 422
  );
  assert.deepEqual(events, [`delete:${staged.storageKey}`]);
});

test("fails closed and deletes staging when the scanner is unavailable or staging metadata changed", async () => {
  for (const baseStore of [
    scannedObjectStore({
      async stagePdf() { return staged; }
    }),
    scannedObjectStore({
      async openObject() {
        return { body: Readable.from(["%PDF-"]), byteLength: 99, mediaType: "application/pdf" };
      },
      async stagePdf() { return staged; }
    })
  ]) {
    const deleted = [];
    const objectStore = { ...baseStore, async deleteKey(key) { deleted.push(key); } };
    const service = new PdfUploadService({
      async findPdfDuplicates() { throw new Error("must not query duplicates"); }
    }, objectStore, {
      async scan() { throw new Error("scanner offline"); }
    });
    await assert.rejects(
      () => service.upload({ scopeId: "user_1", scopeType: "user" }, input()),
      (error) => error.code === "pdf_security_scanner_unavailable" && error.status === 503
    );
    assert.deepEqual(deleted, [staged.storageKey]);
  }
});

test("preserves repair state when object publication fails", async () => {
  const repairs = [];
  const service = new PdfUploadService({
    async findPdfDuplicates() { return []; },
    async markPdfObjectPublished() { throw new Error("must not mark published"); },
    async markPdfUploadRepairRequired(id, code) { repairs.push({ code, id }); },
    async preparePdfUpload() {
      return { kind: "workflow", workflow: securedWorkflow({
        byte_length: 12,
        content_hash: staged.contentHash,
        staging_key: staged.storageKey,
        workflow_id: "workflow_failed"
      }) };
    }
  }, scannedObjectStore({
    objectKey() { return "documents/objects/aa/hash"; },
    async publishStagedPdf() { throw new Error("S3 unavailable"); },
    async stagePdf() { return staged; }
  }), cleanScanner);
  await assert.rejects(
    () => service.upload({ scopeId: "user_1", scopeType: "user" }, input()),
    /storage_publish_failed/
  );
  assert.deepEqual(repairs, [{ code: "storage_publish_failed", id: "workflow_failed" }]);
});

test("replays unfinished publish workflows before readiness", async () => {
  const events = [];
  const repository = {
    async completePdfUpload(workflow) { events.push(`complete:${workflow.workflow_id}`); },
    async listRecoverablePdfUploads() {
      return [securedWorkflow({
        byte_length: 12,
        content_hash: staged.contentHash,
        staging_key: staged.storageKey,
        state: "repair_required",
        workflow_id: "workflow_repair"
      })];
    },
    async markPdfObjectPublished(id) { events.push(`published:${id}`); },
    async markPdfUploadRepairRequired() { throw new Error("repair should succeed"); }
  };
  const service = new PdfUploadService(repository, scannedObjectStore({
    async publishStagedPdf() { events.push("publish"); }
  }), cleanScanner);
  assert.deepEqual(await service.repairPendingWorkflows(), { repaired: 1, scanned: 1 });
  assert.deepEqual(events, ["publish", "published:workflow_repair", "complete:workflow_repair"]);
});

test("rescans and persists proof before recovering a legacy workflow", async () => {
  const events = [];
  const repository = {
    async completePdfUpload() { events.push("complete"); },
    async listRecoverablePdfUploads() {
      return [{
        byte_length: staged.byteLength,
        content_hash: staged.contentHash,
        staging_key: staged.storageKey,
        state: "database_committed",
        workflow_id: "workflow_legacy"
      }];
    },
    async markPdfObjectPublished() { events.push("published"); },
    async markPdfUploadRepairRequired() { throw new Error("repair should succeed"); },
    async recordPdfSecurityScan(_workflowId, proof) {
      assert.deepEqual(proof, scanProof);
      events.push("proof");
    }
  };
  const service = new PdfUploadService(repository, scannedObjectStore({
    async publishStagedPdf() { events.push("publish"); }
  }), { async scan() { events.push("scan"); return scanProof; } });

  assert.deepEqual(await service.repairPendingWorkflows(), { repaired: 1, scanned: 1 });
  assert.deepEqual(events, ["scan", "proof", "publish", "published", "complete"]);
});

test("never publishes a workflow with an invalid persisted scan proof", async () => {
  const repairs = [];
  const service = new PdfUploadService({
    async listRecoverablePdfUploads() {
      return [{
        byte_length: staged.byteLength,
        content_hash: staged.contentHash,
        security_scan_hash: "b".repeat(64),
        security_scanned_at: scanProof.scannedAt,
        security_scanner: scanProof.scanner,
        security_scanner_version: scanProof.version,
        staging_key: staged.storageKey,
        state: "database_committed",
        workflow_id: "workflow_invalid_proof"
      }];
    },
    async markPdfUploadRepairRequired(id, code) { repairs.push({ code, id }); }
  }, scannedObjectStore({
    async publishStagedPdf() { throw new Error("must not publish"); }
  }), cleanScanner);

  await assert.rejects(() => service.repairPendingWorkflows(), /storage_workflow_repair_failed/);
  assert.deepEqual(repairs, [{
    code: "storage_security_scan_required",
    id: "workflow_invalid_proof"
  }]);
});

test("backfills legacy available objects with a hash-bound scan proof", async () => {
  const events = [];
  const service = new PdfUploadService({
    async countUnverifiedPdfObjects() { return 0; },
    async listUnverifiedPdfObjects() {
      return [{
        byte_length: staged.byteLength,
        content_hash: staged.contentHash,
        media_type: "application/pdf",
        storage_key: "documents/objects/aa/legacy"
      }];
    },
    async recordObjectSecurityScan(contentHash, proof) {
      assert.equal(contentHash, staged.contentHash);
      assert.deepEqual(proof, scanProof);
      events.push("proof");
    }
  }, scannedObjectStore(), {
    async scan() { events.push("scan"); return scanProof; }
  });

  assert.deepEqual(await service.scanUnverifiedObjects(), {
    failures: [],
    remaining: 0,
    scanned: 1
  });
  assert.deepEqual(events, ["scan", "proof"]);
});

test("attaches a staged PDF to a metadata entry and removes redundant staging", async () => {
  const events = [];
  const service = new PdfUploadService({
    async prepareMetadataPdfAttachment(_scope, preparedInput) {
      events.push(`prepare:${preparedInput.documentId}`);
      return { kind: "complete", response: { entry: { documentId: preparedInput.documentId }, revision: 1 } };
    }
  }, scannedObjectStore({
    async deleteKey(key) { events.push(`delete:${key}`); },
    objectKey() { return `documents/objects/aa/${staged.contentHash}`; },
    async stagePdf() { return staged; }
  }), cleanScanner);

  assert.deepEqual(await service.attach(
    { scopeId: "user_1", scopeType: "user" },
    input({ documentId: "document_metadata" })
  ), { entry: { documentId: "document_metadata" }, revision: 1 });
  assert.deepEqual(events, [
    "prepare:document_metadata",
    `delete:${staged.storageKey}`
  ]);
});

test("publishes and completes a recoverable metadata attachment workflow", async () => {
  const events = [];
  const workflow = securedWorkflow({
    byte_length: staged.byteLength,
    content_hash: staged.contentHash,
    staging_key: staged.storageKey,
    workflow_id: "workflow_attach"
  });
  const service = new PdfUploadService({
    async completePdfUpload(value) { events.push(`complete:${value.workflow_id}`); return { revision: 1 }; },
    async markPdfObjectPublished(id) { events.push(`published:${id}`); },
    async markPdfUploadRepairRequired() { throw new Error("must not repair"); },
    async prepareMetadataPdfAttachment() { return { kind: "workflow", workflow }; }
  }, scannedObjectStore({
    objectKey() { return `documents/objects/aa/${staged.contentHash}`; },
    async publishStagedPdf() { events.push("publish"); },
    async stagePdf() { return staged; }
  }), cleanScanner);

  assert.deepEqual(await service.attach(
    { scopeId: "user_1", scopeType: "user" },
    input({ documentId: "document_metadata" })
  ), { revision: 1 });
  assert.deepEqual(events, ["publish", "published:workflow_attach", "complete:workflow_attach"]);
});
