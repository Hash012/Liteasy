import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "./database.mjs";
import {
  createLibraryStorageRepository,
  LibraryStorageError
} from "./libraryStorageRepository.mjs";

function createHarness(start = new Date("2026-08-02T00:00:00.000Z")) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-storage-test-"));
  let current = start;
  const database = createDatabase({ databasePath: path.join(root, "test.sqlite") });
  const repository = createLibraryStorageRepository(database, {
    now: () => current,
    objectDirectory: path.join(root, "objects")
  });
  return {
    advance(milliseconds) {
      current = new Date(current.getTime() + milliseconds);
    },
    close() {
      database.close();
      fs.rmSync(root, { force: true, recursive: true });
    },
    database,
    repository,
    root
  };
}

const pdf = Buffer.from("%PDF-1.7\nLiteasy storage fixture\n%%EOF");

test("logical copies consume quota twice while the physical object is deduplicated", () => {
  const harness = createHarness();
  try {
    harness.repository.setQuota("user", "user:alice", pdf.length * 3);
    const first = harness.repository.uploadDocument({
      bytes: pdf,
      fileName: "Paper.pdf",
      scopeId: "user:alice",
      scopeType: "user",
      uploadedBy: "user:alice"
    });
    const prompt = harness.repository.uploadDocument({
      bytes: pdf,
      fileName: "Paper.pdf",
      scopeId: "user:alice",
      scopeType: "user",
      uploadedBy: "user:alice"
    });
    assert.equal(prompt.status, "duplicate");
    assert.deepEqual(prompt.duplicates.map((item) => item.documentId), [first.document.documentId]);

    const second = harness.repository.uploadDocument({
      bytes: pdf,
      duplicateAction: "save_copy",
      fileName: "Paper.pdf",
      scopeId: "user:alice",
      scopeType: "user",
      uploadedBy: "user:alice"
    });
    assert.notEqual(second.document.documentId, first.document.documentId);
    assert.equal(second.document.contentHash, first.document.contentHash);
    assert.equal(second.document.fileName, "Paper (2).pdf");
    assert.equal(harness.repository.getQuota("user", "user:alice").usedBytes, pdf.length * 2);

    const objects = harness.database.prepare("SELECT * FROM storage_objects").all();
    assert.equal(objects.length, 1);
    assert.equal(objects[0].reference_count, 2);
  } finally {
    harness.close();
  }
});

test("trash keeps logical quota and hides team annotations until restore", () => {
  const harness = createHarness();
  try {
    const upload = harness.repository.uploadDocument({
      bytes: pdf,
      fileName: "Shared.pdf",
      scopeId: "org-1",
      scopeType: "organization",
      uploadedBy: "member-1"
    });
    const annotation = harness.repository.uploadTeamAnnotation({
      body: { comment: "useful" },
      documentId: upload.document.documentId,
      organizationId: "org-1",
      uploadedBy: "member-1"
    });
    assert.equal(harness.repository.listTeamAnnotations("org-1", upload.document.documentId).length, 1);

    const trashed = harness.repository.trashDocument(upload.document.documentId, {
      scopeId: "org-1",
      scopeType: "organization"
    });
    assert.equal(trashed.status, "trashed");
    assert.equal(harness.repository.getQuota("organization", "org-1").usedBytes, pdf.length);
    assert.deepEqual(harness.repository.listTeamAnnotations("org-1", upload.document.documentId), []);

    harness.repository.restoreDocument(upload.document.documentId, {
      scopeId: "org-1",
      scopeType: "organization"
    });
    assert.equal(
      harness.repository.listTeamAnnotations("org-1", upload.document.documentId)[0].annotationId,
      annotation.annotationId
    );
  } finally {
    harness.close();
  }
});

test("expired trash releases the logical copy and removes an unreferenced object", () => {
  const harness = createHarness();
  try {
    const upload = harness.repository.uploadDocument({
      bytes: pdf,
      fileName: "Disposable.pdf",
      scopeId: "user:alice",
      scopeType: "user",
      uploadedBy: "user:alice"
    });
    harness.repository.trashDocument(upload.document.documentId, {
      scopeId: "user:alice",
      scopeType: "user"
    });
    harness.advance(30 * 24 * 60 * 60 * 1000 + 1);
    assert.deepEqual(harness.repository.purgeExpired(), { purgedCount: 1 });
    assert.equal(harness.repository.getQuota("user", "user:alice").usedBytes, 0);
    assert.equal(harness.database.prepare("SELECT count(*) AS count FROM storage_objects").get().count, 0);
  } finally {
    harness.close();
  }
});

test("quota is enforced against logical bytes, including duplicate copies", () => {
  const harness = createHarness();
  try {
    harness.repository.setQuota("user", "user:alice", pdf.length);
    harness.repository.uploadDocument({
      bytes: pdf,
      fileName: "Paper.pdf",
      scopeId: "user:alice",
      scopeType: "user",
      uploadedBy: "user:alice"
    });
    assert.throws(
      () => harness.repository.uploadDocument({
        bytes: pdf,
        duplicateAction: "save_copy",
        fileName: "Paper.pdf",
        scopeId: "user:alice",
        scopeType: "user",
        uploadedBy: "user:alice"
      }),
      (error) => error instanceof LibraryStorageError && error.code === "storage_quota_exceeded"
    );
  } finally {
    harness.close();
  }
});
