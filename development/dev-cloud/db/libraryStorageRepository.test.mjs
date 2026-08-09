import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const manualLiterature = {
  authors: ["Ada Lovelace"],
  identifiers: [{ kind: "doi", source: "manual", value: "10.1000/liteasy" }],
  literatureId: "literature:doi:10.1000/liteasy",
  provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "manual" },
  title: "Cloud Literature Metadata",
  year: 2026
};

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
      expectedRevision: harness.repository.getRevision("organization", "org-1"),
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

test("team annotation writes share library revision and idempotency boundaries", () => {
  const harness = createHarness();
  try {
    const upload = harness.repository.uploadDocument({
      bytes: pdf,
      fileName: "Shared.pdf",
      scopeId: "org-annotations",
      scopeType: "organization",
      uploadedBy: "member-1"
    });
    const expectedRevision = harness.repository.getRevision("organization", "org-annotations");
    const createAnnotation = () => harness.repository.uploadTeamAnnotation({
      body: { comment: "reviewed" },
      documentId: upload.document.documentId,
      expectedRevision,
      organizationId: "org-annotations",
      uploadedBy: "member-1"
    });

    const first = harness.repository.runIdempotent(
      "member-1",
      "annotation-op-1",
      "upload_team_annotation",
      createAnnotation
    );
    const replay = harness.repository.runIdempotent(
      "member-1",
      "annotation-op-1",
      "upload_team_annotation",
      createAnnotation
    );

    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.value.annotationId, first.value.annotationId);
    assert.equal(harness.repository.listTeamAnnotations(
      "org-annotations",
      upload.document.documentId
    ).length, 1);
    assert.equal(
      harness.repository.getRevision("organization", "org-annotations"),
      expectedRevision + 1
    );
    assert.throws(
      createAnnotation,
      (error) => error instanceof LibraryStorageError && error.code === "library_revision_conflict"
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

test("a failed database mutation removes its staged and newly committed object", () => {
  const harness = createHarness();
  try {
    harness.repository.setQuota("user", "user:alice", 0);
    assert.throws(
      () => harness.repository.uploadDocument({
        bytes: pdf,
        fileName: "Rejected.pdf",
        scopeId: "user:alice",
        scopeType: "user",
        uploadedBy: "user:alice"
      }),
      (error) => error instanceof LibraryStorageError && error.code === "storage_quota_exceeded"
    );
    const objectRoot = path.join(harness.root, "objects");
    const remainingFiles = fs.readdirSync(objectRoot, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile());
    assert.equal(remainingFiles.length, 0);
  } finally {
    harness.close();
  }
});

test("an object publish failure leaves no visible document or database reference", () => {
  const harness = createHarness();
  try {
    const contentHash = createHash("sha256").update(pdf).digest("hex");
    fs.mkdirSync(path.join(
      harness.root,
      "objects",
      contentHash.slice(0, 2),
      `${contentHash}.pdf`
    ), { recursive: true });

    assert.throws(() => harness.repository.uploadDocument({
      bytes: pdf,
      fileName: "Publish failure.pdf",
      scopeId: "user:alice",
      scopeType: "user",
      uploadedBy: "user:alice"
    }));
    assert.equal(harness.repository.listDocuments("user", "user:alice").length, 0);
    assert.equal(
      harness.database.prepare("SELECT count(*) AS count FROM storage_objects").get().count,
      0
    );
    assert.equal(
      harness.database.prepare("SELECT count(*) AS count FROM storage_object_references").get().count,
      0
    );
  } finally {
    harness.close();
  }
});

test("an attachment publish failure preserves the metadata-only entry", () => {
  const harness = createHarness();
  try {
    const metadata = harness.repository.createMetadataEntry({
      scopeId: "user:alice",
      scopeType: "user",
      title: "Metadata survives"
    });
    const contentHash = createHash("sha256").update(pdf).digest("hex");
    fs.mkdirSync(path.join(
      harness.root,
      "objects",
      contentHash.slice(0, 2),
      `${contentHash}.pdf`
    ), { recursive: true });

    assert.throws(() => harness.repository.attachMetadataEntryPdf({
      bytes: pdf,
      documentId: metadata.documentId,
      fileName: "Metadata survives.pdf",
      scopeId: "user:alice",
      scopeType: "user",
      uploadedBy: "user:alice"
    }));
    assert.equal(harness.repository.listDocuments("user", "user:alice").length, 0);
    assert.equal(harness.repository.listMetadataEntries("user", "user:alice").length, 1);
    assert.equal(
      harness.database.prepare("SELECT count(*) AS count FROM storage_objects").get().count,
      0
    );
  } finally {
    harness.close();
  }
});

test("object reconciliation removes old staging and orphan files and repairs reference counts", () => {
  const harness = createHarness();
  try {
    const upload = harness.repository.uploadDocument({
      bytes: pdf,
      fileName: "Durable.pdf",
      scopeId: "user:alice",
      scopeType: "user",
      uploadedBy: "user:alice"
    });
    const objectRoot = path.join(harness.root, "objects");
    const stagingPath = path.join(objectRoot, ".staging", "abandoned.upload");
    const orphanDirectory = path.join(objectRoot, "ff");
    const orphanPath = path.join(orphanDirectory, `${"f".repeat(64)}.pdf`);
    fs.mkdirSync(orphanDirectory, { recursive: true });
    fs.writeFileSync(stagingPath, pdf);
    fs.writeFileSync(orphanPath, pdf);
    const oldDate = new Date("2020-01-01T00:00:00.000Z");
    fs.utimesSync(stagingPath, oldDate, oldDate);
    fs.utimesSync(orphanPath, oldDate, oldDate);
    harness.database.prepare(
      "UPDATE storage_objects SET reference_count = 99 WHERE content_hash = ?"
    ).run(upload.document.contentHash);

    const result = harness.repository.reconcileObjects({ minimumAgeMs: 0 });

    assert.deepEqual(result, {
      missingObjects: [],
      recoveredStagedObjects: 0,
      removedOrphanObjects: 1,
      removedStagedObjects: 1,
      removedUnreferencedObjects: 0,
      repairedReferenceCounts: 1
    });
    assert.equal(fs.existsSync(stagingPath), false);
    assert.equal(fs.existsSync(orphanPath), false);
    assert.equal(
      harness.database.prepare(
        "SELECT reference_count FROM storage_objects WHERE content_hash = ?"
      ).get(upload.document.contentHash).reference_count,
      1
    );
  } finally {
    harness.close();
  }
});

test("object reconciliation reports referenced bytes that are missing", () => {
  const harness = createHarness();
  try {
    const upload = harness.repository.uploadDocument({
      bytes: pdf,
      fileName: "Missing.pdf",
      scopeId: "user:alice",
      scopeType: "user",
      uploadedBy: "user:alice"
    });
    const object = harness.database.prepare(
      "SELECT storage_key FROM storage_objects WHERE content_hash = ?"
    ).get(upload.document.contentHash);
    fs.rmSync(path.join(harness.root, "objects", object.storage_key));

    assert.deepEqual(
      harness.repository.reconcileObjects({ minimumAgeMs: 0 }).missingObjects,
      [upload.document.contentHash]
    );
  } finally {
    harness.close();
  }
});

test("object reconciliation detects same-length content corruption", () => {
  const harness = createHarness();
  try {
    const upload = harness.repository.uploadDocument({
      bytes: pdf,
      fileName: "Corrupt.pdf",
      scopeId: "user:alice",
      scopeType: "user",
      uploadedBy: "user:alice"
    });
    const object = harness.database.prepare(
      "SELECT storage_key FROM storage_objects WHERE content_hash = ?"
    ).get(upload.document.contentHash);
    const objectFile = path.join(harness.root, "objects", object.storage_key);
    const corrupted = Buffer.from(pdf);
    corrupted[corrupted.length - 1] ^= 1;
    fs.writeFileSync(objectFile, corrupted);

    assert.deepEqual(
      harness.repository.reconcileObjects({ minimumAgeMs: 0 }).missingObjects,
      [upload.document.contentHash]
    );
  } finally {
    harness.close();
  }
});

test("object reconciliation commits a validated stage left after the database transaction", () => {
  const harness = createHarness();
  try {
    const upload = harness.repository.uploadDocument({
      bytes: pdf,
      fileName: "Recoverable.pdf",
      scopeId: "user:alice",
      scopeType: "user",
      uploadedBy: "user:alice"
    });
    const object = harness.database.prepare(
      "SELECT storage_key FROM storage_objects WHERE content_hash = ?"
    ).get(upload.document.contentHash);
    const objectRoot = path.join(harness.root, "objects");
    const destination = path.join(objectRoot, object.storage_key);
    const stagedPath = path.join(
      objectRoot,
      ".staging",
      `${upload.document.contentHash}-interrupted.upload`
    );
    fs.renameSync(destination, stagedPath);

    const result = harness.repository.reconcileObjects({ minimumAgeMs: 0 });

    assert.equal(result.recoveredStagedObjects, 1);
    assert.deepEqual(result.missingObjects, []);
    assert.equal(fs.existsSync(destination), true);
    assert.equal(fs.existsSync(stagedPath), false);
  } finally {
    harness.close();
  }
});

test("attaching a PDF upgrades metadata in place and creates a durable object reference", () => {
  const harness = createHarness();
  try {
    const metadata = harness.repository.createMetadataEntry({
      doi: "10.1000/liteasy",
      metadata: { authors: ["Ada"] },
      scopeId: "user:alice",
      scopeType: "user",
      title: "Metadata first"
    });
    const revision = harness.repository.getRevision("user", "user:alice");
    const document = harness.repository.attachMetadataEntryPdf({
      bytes: pdf,
      documentId: metadata.documentId,
      expectedRevision: revision,
      fileName: "Metadata first.pdf",
      scopeId: "user:alice",
      scopeType: "user",
      uploadedBy: "user:alice"
    });
    assert.equal(document.documentId, metadata.documentId);
    assert.equal(document.entryKind, "pdf");
    assert.equal(document.doi, "10.1000/liteasy");
    assert.deepEqual(document.metadata, { authors: ["Ada"] });
    assert.equal(harness.repository.listMetadataEntries("user", "user:alice").length, 0);
    assert.equal(
      harness.database.prepare("SELECT count(*) AS count FROM storage_object_references").get().count,
      1
    );
  } finally {
    harness.close();
  }
});

test("metadata-only entries can be renamed without becoming PDF documents", () => {
  const harness = createHarness();
  try {
    const metadata = harness.repository.createMetadataEntry({
      scopeId: "user:alice",
      scopeType: "user",
      title: "Before rename"
    });
    const revision = harness.repository.getRevision("user", "user:alice");
    const updated = harness.repository.updateEntry(metadata.documentId, {
      scopeId: "user:alice",
      scopeType: "user"
    }, {
      expectedRevision: revision,
      title: "After rename"
    });

    assert.equal(updated.entryKind, "metadata_only");
    assert.equal(updated.title, "After rename");
    assert.equal(harness.repository.listDocuments("user", "user:alice").length, 0);
    assert.ok(harness.repository.getRevision("user", "user:alice") > revision);
  } finally {
    harness.close();
  }
});

for (const entryKind of ["pdf", "metadata_only"]) {
  test(`updates ${entryKind} literature metadata in the same revision transaction`, () => {
    const harness = createHarness();
    try {
      const created = entryKind === "pdf"
        ? harness.repository.uploadDocument({
          bytes: pdf,
          expectedRevision: 0,
          fileName: "Paper.pdf",
          scopeId: "user:alice",
          scopeType: "user",
          uploadedBy: "user:alice"
        }).document
        : harness.repository.createMetadataEntry({
          expectedRevision: 0,
          scopeId: "user:alice",
          scopeType: "user",
          title: "Paper"
        });
      const revision = harness.repository.getRevision("user", "user:alice");

      const updated = harness.repository.updateEntry(created.documentId, {
        scopeId: "user:alice",
        scopeType: "user"
      }, {
        expectedRevision: revision,
        literature: manualLiterature
      });

      assert.deepEqual(updated.metadata.literature, manualLiterature);
      assert.equal(harness.repository.getRevision("user", "user:alice"), revision + 1);
      const table = entryKind === "pdf" ? "library_documents" : "library_metadata_entries";
      const row = harness.database.prepare(
        `SELECT metadata_json FROM ${table} WHERE document_id = ?`
      ).get(created.documentId);
      assert.deepEqual(JSON.parse(row.metadata_json).literature, manualLiterature);
    } finally {
      harness.close();
    }
  });
}

test("invalid literature does not change development library metadata or revision", () => {
  const harness = createHarness();
  try {
    const created = harness.repository.createMetadataEntry({
      expectedRevision: 0,
      metadata: { retained: true },
      scopeId: "user:alice",
      scopeType: "user",
      title: "Paper"
    });
    const revision = harness.repository.getRevision("user", "user:alice");

    assert.throws(() => harness.repository.updateEntry(created.documentId, {
      scopeId: "user:alice",
      scopeType: "user"
    }, {
      expectedRevision: revision,
      literature: { ...manualLiterature, identifiers: [] }
    }), (error) => error?.code === "literature_metadata_invalid");

    assert.equal(harness.repository.getRevision("user", "user:alice"), revision);
    assert.deepEqual(
      harness.repository.listMetadataEntries("user", "user:alice")[0].metadata,
      { retained: true }
    );
  } finally {
    harness.close();
  }
});

test("idempotency replays the stored response and rejects cross-operation key reuse", () => {
  const harness = createHarness();
  try {
    let calls = 0;
    const create = () => {
      calls += 1;
      return {
        folder: harness.repository.createFolder({
          createdBy: "user:alice",
          expectedRevision: 0,
          name: "Research",
          scopeId: "user:alice",
          scopeType: "user"
        })
      };
    };
    const first = harness.repository.runIdempotent(
      "user:alice",
      "operation-1",
      "create_folder",
      create
    );
    const replay = harness.repository.runIdempotent(
      "user:alice",
      "operation-1",
      "create_folder",
      create
    );
    assert.equal(calls, 1);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.value, JSON.parse(JSON.stringify(first.value)));
    assert.throws(
      () => harness.repository.runIdempotent(
        "user:alice",
        "operation-1",
        "trash_folder",
        () => ({})
      ),
      (error) => error instanceof LibraryStorageError && error.code === "idempotency_key_reused"
    );
  } finally {
    harness.close();
  }
});

test("every tree mutation detects a stale scope revision", () => {
  const harness = createHarness();
  try {
    const first = harness.repository.createFolder({
      createdBy: "user:alice",
      expectedRevision: 0,
      name: "First",
      scopeId: "user:alice",
      scopeType: "user"
    });
    assert.throws(
      () => harness.repository.updateFolder(first.folderId, {
        scopeId: "user:alice",
        scopeType: "user"
      }, { expectedRevision: 0, name: "Stale rename" }),
      (error) => error instanceof LibraryStorageError && error.code === "library_revision_conflict"
    );
    const revision = harness.repository.getRevision("user", "user:alice");
    const renamed = harness.repository.updateFolder(first.folderId, {
      scopeId: "user:alice",
      scopeType: "user"
    }, { expectedRevision: revision, name: "Current rename" });
    assert.equal(renamed.name, "Current rename");
  } finally {
    harness.close();
  }
});

test("folder trash restores a complete subtree and resolves a root name conflict", () => {
  const harness = createHarness();
  try {
    const root = harness.repository.createFolder({
      createdBy: "user:alice",
      name: "Topic",
      scopeId: "user:alice",
      scopeType: "user"
    });
    const child = harness.repository.createFolder({
      createdBy: "user:alice",
      name: "Sources",
      parentFolderId: root.folderId,
      scopeId: "user:alice",
      scopeType: "user"
    });
    const upload = harness.repository.uploadDocument({
      bytes: pdf,
      fileName: "Nested.pdf",
      folderId: child.folderId,
      scopeId: "user:alice",
      scopeType: "user",
      uploadedBy: "user:alice"
    });
    harness.repository.trashFolder(root.folderId, {
      scopeId: "user:alice",
      scopeType: "user"
    });
    harness.repository.createFolder({
      createdBy: "user:alice",
      name: "Topic",
      scopeId: "user:alice",
      scopeType: "user"
    });
    const restored = harness.repository.restoreFolder(root.folderId, {
      scopeId: "user:alice",
      scopeType: "user"
    });
    assert.equal(restored.name, "Topic (2)");
    assert.equal(
      harness.repository.authorizeDocument(upload.document.documentId, {
        scopeId: "user:alice",
        scopeType: "user"
      }).status,
      "active"
    );
    assert.equal(harness.repository.getTree("user", "user:alice").folders.length, 3);
  } finally {
    harness.close();
  }
});

test("empty trash removes the whole scope in one revision", () => {
  const harness = createHarness();
  try {
    const folder = harness.repository.createFolder({
      createdBy: "user:alice",
      name: "Discarded",
      scopeId: "user:alice",
      scopeType: "user"
    });
    harness.repository.uploadDocument({
      bytes: pdf,
      fileName: "Nested.pdf",
      folderId: folder.folderId,
      scopeId: "user:alice",
      scopeType: "user",
      uploadedBy: "user:alice"
    });
    const metadata = harness.repository.createMetadataEntry({
      scopeId: "user:alice",
      scopeType: "user",
      title: "Metadata"
    });
    harness.repository.trashFolder(folder.folderId, {
      scopeId: "user:alice",
      scopeType: "user"
    });
    harness.repository.trashEntry(metadata.documentId, {
      scopeId: "user:alice",
      scopeType: "user"
    });
    const revision = harness.repository.getRevision("user", "user:alice");

    const result = harness.repository.emptyTrash("user", "user:alice", {
      expectedRevision: revision
    });

    assert.equal(result.revision, revision + 1);
    assert.equal(result.purgedCount, 3);
    assert.equal(harness.repository.getTree("user", "user:alice", "trashed").entries.length, 0);
    assert.equal(harness.repository.getTree("user", "user:alice", "trashed").folders.length, 0);
    assert.equal(harness.database.prepare("SELECT COUNT(*) AS count FROM storage_objects").get().count, 0);
  } finally {
    harness.close();
  }
});

test("folders reject cross-scope parents and descendant cycles", () => {
  const harness = createHarness();
  try {
    const userRoot = harness.repository.createFolder({
      createdBy: "user:alice",
      name: "User root",
      scopeId: "user:alice",
      scopeType: "user"
    });
    assert.throws(
      () => harness.repository.createFolder({
        createdBy: "org:owner",
        name: "Invalid child",
        parentFolderId: userRoot.folderId,
        scopeId: "org-1",
        scopeType: "organization"
      }),
      (error) => error instanceof LibraryStorageError && error.code === "library_folder_forbidden"
    );
    const child = harness.repository.createFolder({
      createdBy: "user:alice",
      name: "Child",
      parentFolderId: userRoot.folderId,
      scopeId: "user:alice",
      scopeType: "user"
    });
    assert.throws(
      () => harness.repository.updateFolder(userRoot.folderId, {
        scopeId: "user:alice",
        scopeType: "user"
      }, { parentFolderId: child.folderId }),
      (error) => error instanceof LibraryStorageError && error.code === "invalid_folder_parent"
    );
  } finally {
    harness.close();
  }
});
