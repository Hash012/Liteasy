import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getLibraryObjectDir } from "./dataPaths.mjs";
import { assertDevCloudDeploymentBoundary } from "../deploymentBoundary.mjs";
import {
  LiteratureMetadataValidationError,
  normalizeLiteratureMetadata
} from "../../../products/liteasy/services/api/src/literatureMetadata.mjs";

const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
const defaultUserQuotaBytes = 2 * 1024 * 1024 * 1024;
const defaultOrganizationQuotaBytes = 20 * 1024 * 1024 * 1024;

export class LibraryStorageError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizedLiterature(value) {
  try {
    return normalizeLiteratureMetadata(value);
  } catch (error) {
    if (error instanceof LiteratureMetadataValidationError) {
      throw new LibraryStorageError(error.code, "Literature metadata is invalid.");
    }
    throw error;
  }
}

function normalizeScope(scopeType, scopeId) {
  const type = scopeType === "organization" ? "organization" : scopeType === "user" ? "user" : "";
  const id = normalizeText(scopeId);
  if (!type || !/^[A-Za-z0-9:._-]{1,180}$/.test(id)) {
    throw new LibraryStorageError("invalid_library_scope", "The library scope is invalid.");
  }
  return { scopeId: id, scopeType: type };
}

function normalizedName(value) {
  return normalizeText(value).normalize("NFKC").toLocaleLowerCase("en-US");
}

function safePdfName(value) {
  const cleaned = normalizeText(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 220);
  const name = cleaned || "Untitled paper.pdf";
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
}

function uniquePdfName(requestedName, usedNames) {
  const initial = safePdfName(requestedName);
  if (!usedNames.has(normalizedName(initial))) return initial;
  const base = initial.replace(/\.pdf$/i, "");
  for (let sequence = 2; sequence < 100_000; sequence += 1) {
    const candidate = `${base} (${sequence}).pdf`;
    if (!usedNames.has(normalizedName(candidate))) return candidate;
  }
  throw new LibraryStorageError("library_name_exhausted", "Unable to allocate a copy name.");
}

function publicDocument(row) {
  let metadata = {};
  try { metadata = JSON.parse(row.metadata_json ?? "{}"); } catch { metadata = {}; }
  return {
    byteLength: row.byte_length,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    documentId: row.document_id,
    doi: row.doi ?? undefined,
    entryKind: "pdf",
    fileName: row.file_name,
    folderId: row.folder_id ?? undefined,
    purgeAfter: row.purge_after ?? undefined,
    scopeId: row.scope_id,
    scopeType: row.scope_type,
    externalUrl: row.external_url ?? undefined,
    metadata,
    sourceId: row.source_id ?? undefined,
    status: row.status,
    trashedAt: row.trashed_at ?? undefined,
    updatedAt: row.updated_at,
    uploadedBy: row.uploaded_by,
    title: row.file_name.replace(/\.pdf$/i, "")
  };
}

function publicMetadataEntry(row) {
  let metadata = {};
  try { metadata = JSON.parse(row.metadata_json ?? "{}"); } catch { metadata = {}; }
  return {
    createdAt: row.created_at,
    documentId: row.document_id,
    doi: row.doi ?? undefined,
    entryKind: "metadata_only",
    externalUrl: row.external_url ?? undefined,
    folderId: row.folder_id ?? undefined,
    metadata,
    purgeAfter: row.purge_after ?? undefined,
    scopeId: row.scope_id,
    scopeType: row.scope_type,
    sourceId: row.source_id ?? undefined,
    status: row.status,
    title: row.title,
    trashedAt: row.trashed_at ?? undefined,
    updatedAt: row.updated_at
  };
}

function publicFolder(row) {
  return {
    createdAt: row.created_at,
    folderId: row.folder_id,
    name: row.original_name ?? row.name,
    parentFolderId: row.parent_folder_id ?? undefined,
    purgeAfter: row.purge_after ?? undefined,
    status: row.status,
    trashedAt: row.trashed_at ?? undefined,
    updatedAt: row.updated_at
  };
}

function normalizeTeamAnnotationBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LibraryStorageError("annotation_body_invalid", "The annotation body is invalid.");
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > 64 * 1024) {
    throw new LibraryStorageError("annotation_body_too_large", "The annotation body is too large.", 413);
  }
  const allowed = new Set([
    "clientAnnotationId", "color", "excerpt", "kind", "note", "page", "rects", "text", "updatedAt"
  ]);
  const colors = new Set(["yellow", "red", "blue", "green", "pink"]);
  const kinds = new Set(["highlight", "underline", "note"]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    typeof value.clientAnnotationId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,200}$/.test(value.clientAnnotationId) ||
    typeof value.excerpt !== "string" || value.excerpt.trim().length < 1 || value.excerpt.length > 5000 ||
    !kinds.has(value.kind) ||
    !Number.isSafeInteger(value.page) || value.page < 1 || value.page > 1_000_000 ||
    !Array.isArray(value.rects) || value.rects.length > 100 ||
    typeof value.text !== "string" || value.text.trim().length < 1 || value.text.length > 100 ||
    typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) ||
    (value.note !== undefined && (typeof value.note !== "string" || value.note.length > 10_000)) ||
    (value.color !== undefined && !colors.has(value.color)) ||
    (value.kind === "highlight" && !colors.has(value.color))
  ) {
    throw new LibraryStorageError("annotation_body_invalid", "The annotation body is invalid.");
  }
  const rects = value.rects.map((rect) => {
    if (!rect || typeof rect !== "object" || Array.isArray(rect)) {
      throw new LibraryStorageError("annotation_body_invalid", "The annotation body is invalid.");
    }
    if (Object.keys(rect).some((key) => !new Set(["height", "left", "top", "width"]).has(key))) {
      throw new LibraryStorageError("annotation_body_invalid", "The annotation body is invalid.");
    }
    for (const key of ["height", "left", "top", "width"]) {
      if (typeof rect[key] !== "number" || !Number.isFinite(rect[key]) || rect[key] < 0 || rect[key] > 1) {
        throw new LibraryStorageError("annotation_body_invalid", "The annotation body is invalid.");
      }
    }
    if (rect.height === 0 || rect.width === 0) {
      throw new LibraryStorageError("annotation_body_invalid", "The annotation body is invalid.");
    }
    return { height: rect.height, left: rect.left, top: rect.top, width: rect.width };
  });
  return {
    clientAnnotationId: value.clientAnnotationId,
    ...(value.color === undefined ? {} : { color: value.color }),
    excerpt: value.excerpt.trim(),
    kind: value.kind,
    ...(value.note === undefined ? {} : { note: value.note }),
    page: value.page,
    rects,
    text: value.text.trim(),
    updatedAt: new Date(value.updatedAt).toISOString()
  };
}

function publicTeamAnnotation(row) {
  return {
    annotationId: row.annotation_id,
    body: JSON.parse(row.body_json),
    createdAt: row.created_at,
    documentId: row.document_id,
    organizationId: row.organization_id,
    revision: Number(row.revision),
    updatedAt: row.updated_at,
    uploadedBy: row.uploaded_by
  };
}

export function createLibraryStorageRepository(database, options = {}) {
  assertDevCloudDeploymentBoundary();
  const objectDirectory = options.objectDirectory ?? getLibraryObjectDir();
  const stagingDirectory = path.join(objectDirectory, ".staging");
  const now = () => options.now?.() ?? new Date();
  fs.mkdirSync(objectDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(stagingDirectory, { recursive: true, mode: 0o700 });

  const quotaRow = database.prepare(
    "SELECT limit_bytes FROM storage_quotas WHERE scope_type = ? AND scope_id = ?"
  );
  const usedBytesRow = database.prepare(`
    SELECT coalesce(sum(byte_length), 0) AS used_bytes
    FROM library_documents
    WHERE scope_type = ? AND scope_id = ?
  `);
  const listDocumentsStatement = database.prepare(`
    SELECT * FROM library_documents
    WHERE scope_type = ? AND scope_id = ? AND (? = 'all' OR status = ?)
    ORDER BY updated_at DESC, document_id
  `);
  const documentById = database.prepare("SELECT * FROM library_documents WHERE document_id = ?");
  const folderById = database.prepare("SELECT * FROM library_folders WHERE folder_id = ?");
  const metadataById = database.prepare(
    "SELECT * FROM library_metadata_entries WHERE document_id = ?"
  );
  const idempotencyByKey = database.prepare(`
    SELECT * FROM library_idempotency_keys
    WHERE actor_key = ? AND operation_key = ?
  `);

  function currentRevision(scopeType, scopeId) {
    return database.prepare(`
      SELECT revision FROM library_scope_revisions
      WHERE scope_type = ? AND scope_id = ?
    `).get(scopeType, scopeId)?.revision ?? 0;
  }

  function assertRevision(scope, expectedRevision) {
    if (expectedRevision === undefined || expectedRevision === null) return;
    const expected = Number(expectedRevision);
    const actual = currentRevision(scope.scopeType, scope.scopeId);
    if (!Number.isSafeInteger(expected) || expected !== actual) {
      throw new LibraryStorageError(
        "library_revision_conflict",
        "The library changed. Refresh and retry the operation.",
        409
      );
    }
  }

  function bumpRevision(scopeType, scopeId) {
    const timestamp = now().toISOString();
    database.prepare(`
      INSERT INTO library_scope_revisions (scope_type, scope_id, revision, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        revision = library_scope_revisions.revision + 1,
        updated_at = excluded.updated_at
    `).run(scopeType, scopeId, timestamp);
    return currentRevision(scopeType, scopeId);
  }

  function quotaLimit(scopeType, scopeId) {
    return quotaRow.get(scopeType, scopeId)?.limit_bytes ?? (
      scopeType === "organization" ? defaultOrganizationQuotaBytes : defaultUserQuotaBytes
    );
  }

  function objectPath(storageKey) {
    const resolved = path.resolve(objectDirectory, storageKey);
    const root = path.resolve(objectDirectory);
    if (!resolved.startsWith(`${root}${path.sep}`)) {
      throw new LibraryStorageError("invalid_storage_key", "The storage key is invalid.", 500);
    }
    return resolved;
  }

  function hashFile(filePath) {
    const descriptor = fs.openSync(filePath, "r");
    const hasher = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    try {
      while (true) {
        const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (read === 0) break;
        hasher.update(buffer.subarray(0, read));
      }
    } finally {
      fs.closeSync(descriptor);
    }
    return hasher.digest("hex");
  }

  function stageObject(bytes, contentHash) {
    const stagedPath = path.join(stagingDirectory, `${contentHash}-${randomUUID()}.upload`);
    const descriptor = fs.openSync(stagedPath, "wx", 0o600);
    try {
      fs.writeFileSync(descriptor, bytes);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    return stagedPath;
  }

  function createUploadStagingPath() {
    const stagedPath = path.join(stagingDirectory, `${randomUUID()}.upload`);
    const descriptor = fs.openSync(stagedPath, "wx", 0o600);
    fs.closeSync(descriptor);
    return stagedPath;
  }

  function requireStagedUpload(stagedPath) {
    const resolved = path.resolve(stagedPath ?? "");
    const stagingRoot = path.resolve(stagingDirectory);
    if (
      path.dirname(resolved) !== stagingRoot ||
      path.extname(resolved) !== ".upload" ||
      !fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()
    ) {
      throw new LibraryStorageError("invalid_staged_upload", "The staged upload is invalid.", 500);
    }
    return resolved;
  }

  function inspectStagedPdf(stagedPath) {
    const resolved = requireStagedUpload(stagedPath);
    const descriptor = fs.openSync(resolved, "r");
    const hasher = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let byteLength = 0;
    let header = Buffer.alloc(0);
    try {
      while (true) {
        const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (read === 0) break;
        if (byteLength === 0) header = Buffer.from(buffer.subarray(0, Math.min(5, read)));
        byteLength += read;
        hasher.update(buffer.subarray(0, read));
      }
    } finally {
      fs.closeSync(descriptor);
    }
    if (byteLength === 0 || !header.equals(Buffer.from("%PDF-"))) {
      throw new LibraryStorageError("invalid_pdf", "The uploaded file is not a PDF.");
    }
    return { byteLength, contentHash: hasher.digest("hex"), stagedPath: resolved };
  }

  function commitStagedObject(stagedPath, storageKey) {
    const destination = objectPath(storageKey);
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    if (fs.existsSync(destination)) {
      const expectedHash = path.basename(storageKey, path.extname(storageKey));
      const stagedSize = fs.statSync(stagedPath).size;
      const destinationStat = fs.statSync(destination);
      if (!destinationStat.isFile() || destinationStat.size !== stagedSize) {
        throw new LibraryStorageError(
          "storage_object_corrupt",
          "The existing content-addressed object is invalid.",
          500
        );
      }
      if (hashFile(destination) !== expectedHash) {
        throw new LibraryStorageError(
          "storage_object_corrupt",
          "The existing content-addressed object failed integrity validation.",
          500
        );
      }
      fs.rmSync(stagedPath, { force: true });
      return false;
    }
    try {
      fs.renameSync(stagedPath, destination);
      fs.chmodSync(destination, 0o600);
      return true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        return commitStagedObject(stagedPath, storageKey);
      }
      throw error;
    }
  }

  function removeObjectIfUnreferenced(contentHash, storageKey, wroteObject) {
    if (
      wroteObject &&
      !database.prepare("SELECT 1 FROM storage_objects WHERE content_hash = ?").get(contentHash)
    ) {
      fs.rmSync(objectPath(storageKey), { force: true });
    }
  }

  function requireDocument(documentId, expectedScope) {
    const row = documentById.get(documentId);
    if (!row) throw new LibraryStorageError("library_document_not_found", "Document not found.", 404);
    if (expectedScope && (
      row.scope_type !== expectedScope.scopeType || row.scope_id !== expectedScope.scopeId
    )) {
      throw new LibraryStorageError("library_document_forbidden", "Document is outside this library.", 403);
    }
    return row;
  }

  function requireFolder(folderId, expectedScope) {
    const row = folderById.get(folderId);
    if (!row) throw new LibraryStorageError("library_folder_not_found", "Folder not found.", 404);
    if (row.scope_type !== expectedScope.scopeType || row.scope_id !== expectedScope.scopeId) {
      throw new LibraryStorageError("library_folder_forbidden", "Folder is outside this library.", 403);
    }
    return row;
  }

  function requireMetadataEntry(documentId, expectedScope) {
    const row = metadataById.get(documentId);
    if (!row) {
      throw new LibraryStorageError("library_document_not_found", "Document not found.", 404);
    }
    if (expectedScope && (
      row.scope_type !== expectedScope.scopeType || row.scope_id !== expectedScope.scopeId
    )) {
      throw new LibraryStorageError("library_document_forbidden", "Document is outside this library.", 403);
    }
    return row;
  }

  function decrementObjectReference(row, storageKeysToRemove) {
    if (!row.content_hash) return;
    const object = database.prepare(
      "SELECT * FROM storage_objects WHERE content_hash = ?"
    ).get(row.content_hash);
    database.prepare(
      "DELETE FROM storage_object_references WHERE document_id = ?"
    ).run(row.document_id);
    const remaining = database.prepare(`
      SELECT count(*) AS reference_count
      FROM storage_object_references
      WHERE content_hash = ?
    `).get(row.content_hash).reference_count;
    if (object && remaining === 0) {
      storageKeysToRemove.push(object.storage_key);
      database.prepare("DELETE FROM storage_objects WHERE content_hash = ?").run(row.content_hash);
    } else if (object) {
      database.prepare(`
        UPDATE storage_objects SET reference_count = ? WHERE content_hash = ?
      `).run(remaining, row.content_hash);
    }
  }

  const uploadTransaction = database.transaction((input) => {
    const usedBytes = usedBytesRow.get(input.scopeType, input.scopeId).used_bytes;
    const limitBytes = quotaLimit(input.scopeType, input.scopeId);
    if (usedBytes + input.byteLength > limitBytes) {
      throw new LibraryStorageError("storage_quota_exceeded", "The library storage quota is exceeded.", 409);
    }
    const names = database.prepare(`
      SELECT normalized_file_name FROM library_documents
      WHERE scope_type = ? AND scope_id = ? AND ifnull(folder_id, '') = ifnull(?, '')
    `).all(input.scopeType, input.scopeId, input.folderId ?? null);
    const fileName = uniquePdfName(
      input.fileName,
      new Set(names.map((row) => row.normalized_file_name))
    );
    const existingObject = database.prepare(
      "SELECT * FROM storage_objects WHERE content_hash = ?"
    ).get(input.contentHash);
    if (existingObject && existingObject.byte_length !== input.byteLength) {
      throw new LibraryStorageError("content_hash_collision", "Content hash collision.", 500);
    }
    if (existingObject) {
      database.prepare(
        "UPDATE storage_objects SET reference_count = reference_count + 1 WHERE content_hash = ?"
      ).run(input.contentHash);
    } else {
      database.prepare(`
        INSERT INTO storage_objects (content_hash, byte_length, storage_key, reference_count, created_at)
        VALUES (?, ?, ?, 1, ?)
      `).run(input.contentHash, input.byteLength, input.storageKey, input.timestamp);
    }
    const documentId = randomUUID();
    database.prepare(`
      INSERT INTO library_documents (
        document_id, scope_type, scope_id, folder_id, content_hash, file_name,
        normalized_file_name, byte_length, uploaded_by, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      documentId,
      input.scopeType,
      input.scopeId,
      input.folderId ?? null,
      input.contentHash,
      fileName,
      normalizedName(fileName),
      input.byteLength,
      input.uploadedBy,
      input.timestamp,
      input.timestamp
    );
    database.prepare(`
      INSERT INTO storage_object_references (document_id, content_hash, created_at)
      VALUES (?, ?, ?)
    `).run(documentId, input.contentHash, input.timestamp);
    bumpRevision(input.scopeType, input.scopeId);
    return requireDocument(documentId);
  });

  function uploadStagedDocument(input) {
    const { scopeId, scopeType } = normalizeScope(input.scopeType, input.scopeId);
    assertRevision({ scopeId, scopeType }, input.expectedRevision);
    const inspected = inspectStagedPdf(input.stagedPath);
    if (input.contentHash && input.contentHash !== inspected.contentHash) {
      throw new LibraryStorageError("content_hash_mismatch", "The staged upload hash changed.", 500);
    }
    if (input.byteLength !== undefined && Number(input.byteLength) !== inspected.byteLength) {
      throw new LibraryStorageError("content_length_mismatch", "The staged upload size changed.", 500);
    }
    const { byteLength, contentHash, stagedPath } = inspected;
    const duplicates = database.prepare(`
      SELECT * FROM library_documents
      WHERE scope_type = ? AND scope_id = ? AND content_hash = ?
      ORDER BY created_at
    `).all(scopeType, scopeId, contentHash).map(publicDocument);
    const duplicateAction = normalizeText(input.duplicateAction);
    if (duplicates.length > 0 && duplicateAction !== "save_copy") {
      fs.rmSync(stagedPath, { force: true });
      if (duplicateAction && duplicateAction !== "cancel") {
        throw new LibraryStorageError(
          "invalid_duplicate_action",
          "Duplicate action must be save_copy or cancel."
        );
      }
      return { contentHash, duplicates, status: duplicateAction === "cancel" ? "cancelled" : "duplicate" };
    }
    const storageKey = path.join(contentHash.slice(0, 2), `${contentHash}.pdf`);
    const folderId = normalizeText(input.folderId) || null;
    if (folderId) requireFolder(folderId, { scopeId, scopeType });
    let wroteObject = false;
    try {
      // Publish validated bytes before making the database reference visible. If the
      // transaction fails, the newly published unreferenced object is removed below.
      wroteObject = commitStagedObject(stagedPath, storageKey);
      const row = uploadTransaction({
        byteLength,
        contentHash,
        fileName: input.fileName,
        folderId,
        scopeId,
        scopeType,
        storageKey,
        timestamp: now().toISOString(),
        uploadedBy: normalizeText(input.uploadedBy) || scopeId
      });
      return { document: publicDocument(row), duplicates, status: "imported" };
    } catch (error) {
      fs.rmSync(stagedPath, { force: true });
      removeObjectIfUnreferenced(contentHash, storageKey, wroteObject);
      throw error;
    }
  }

  return {
    createUploadStagingPath,
    discardStagedUpload(stagedPath) {
      try {
        fs.rmSync(requireStagedUpload(stagedPath), { force: true });
      } catch (error) {
        if (error instanceof LibraryStorageError && error.code === "invalid_staged_upload") return;
        throw error;
      }
    },
    runIdempotent(actorKeyInput, operationKeyInput, operationKindInput, operation, requestInput) {
      const actorKey = normalizeText(actorKeyInput);
      const operationKey = normalizeText(operationKeyInput);
      const operationKind = normalizeText(operationKindInput);
      const requestHash = requestInput === undefined
        ? null
        : createHash("sha256").update(JSON.stringify(requestInput)).digest("hex");
      if (!actorKey || !/^[A-Za-z0-9:._-]{1,220}$/.test(operationKey) || !operationKind) {
        throw new LibraryStorageError(
          "invalid_idempotency_key",
          "A valid idempotency key is required."
        );
      }
      const existing = idempotencyByKey.get(actorKey, operationKey);
      if (existing) {
        if (existing.operation_kind !== operationKind) {
          throw new LibraryStorageError(
            "idempotency_key_reused",
            "The idempotency key was already used for another operation.",
            409
          );
        }
        if (existing.request_hash && existing.request_hash !== requestHash) {
          throw new LibraryStorageError(
            "idempotency_key_reused",
            "The idempotency key was already used for another request.",
            409
          );
        }
        return { replayed: true, value: JSON.parse(existing.response_json) };
      }
      let value;
      database.transaction(() => {
        value = operation();
        database.prepare(`
          INSERT INTO library_idempotency_keys (
            actor_key, operation_key, operation_kind, request_hash, response_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          actorKey,
          operationKey,
          operationKind,
          requestHash,
          JSON.stringify(value),
          now().toISOString()
        );
      })();
      return { replayed: false, value };
    },

    getRevision(scopeTypeInput, scopeIdInput) {
      const { scopeId, scopeType } = normalizeScope(scopeTypeInput, scopeIdInput);
      return currentRevision(scopeType, scopeId);
    },

    getQuota(scopeTypeInput, scopeIdInput) {
      const { scopeId, scopeType } = normalizeScope(scopeTypeInput, scopeIdInput);
      const usedBytes = usedBytesRow.get(scopeType, scopeId).used_bytes;
      const limitBytes = quotaLimit(scopeType, scopeId);
      return { availableBytes: Math.max(0, limitBytes - usedBytes), limitBytes, scopeId, scopeType, usedBytes };
    },

    setQuota(scopeTypeInput, scopeIdInput, limitBytesInput) {
      const { scopeId, scopeType } = normalizeScope(scopeTypeInput, scopeIdInput);
      const limitBytes = Number(limitBytesInput);
      if (!Number.isSafeInteger(limitBytes) || limitBytes < 0) {
        throw new LibraryStorageError("invalid_storage_quota", "Quota must be a non-negative integer.");
      }
      const timestamp = now().toISOString();
      database.prepare(`
        INSERT INTO storage_quotas (scope_type, scope_id, limit_bytes, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(scope_type, scope_id) DO UPDATE SET
          limit_bytes = excluded.limit_bytes,
          updated_at = excluded.updated_at
      `).run(scopeType, scopeId, limitBytes, timestamp);
      return this.getQuota(scopeType, scopeId);
    },

    listDocuments(scopeTypeInput, scopeIdInput, status = "active") {
      const { scopeId, scopeType } = normalizeScope(scopeTypeInput, scopeIdInput);
      const normalizedStatus = status === "trashed" ? "trashed" : status === "all" ? "all" : "active";
      return listDocumentsStatement
        .all(scopeType, scopeId, normalizedStatus, normalizedStatus)
        .map(publicDocument);
    },

    listFolders(scopeTypeInput, scopeIdInput) {
      const { scopeId, scopeType } = normalizeScope(scopeTypeInput, scopeIdInput);
      return database.prepare(`
        SELECT * FROM library_folders
        WHERE scope_type = ? AND scope_id = ? AND status = 'active'
        ORDER BY created_at, folder_id
      `).all(scopeType, scopeId).map(publicFolder);
    },

    listMetadataEntries(scopeTypeInput, scopeIdInput, status = "active") {
      const { scopeId, scopeType } = normalizeScope(scopeTypeInput, scopeIdInput);
      const normalizedStatus = status === "trashed" ? "trashed" : status === "all" ? "all" : "active";
      return database.prepare(`
        SELECT * FROM library_metadata_entries
        WHERE scope_type = ? AND scope_id = ? AND (? = 'all' OR status = ?)
        ORDER BY updated_at DESC, document_id
      `).all(scopeType, scopeId, normalizedStatus, normalizedStatus).map(publicMetadataEntry);
    },

    listEntries(scopeTypeInput, scopeIdInput, status = "active") {
      return [
        ...this.listDocuments(scopeTypeInput, scopeIdInput, status),
        ...this.listMetadataEntries(scopeTypeInput, scopeIdInput, status)
      ].sort((left, right) => left.title.localeCompare(right.title));
    },

    purgeUserScope(scopeIdInput) {
      const scope = normalizeScope("user", scopeIdInput);
      const documents = database.prepare(`
        SELECT * FROM library_documents WHERE scope_type = 'user' AND scope_id = ?
      `).all(scope.scopeId);
      const metadataCount = database.prepare(`
        SELECT count(*) AS count FROM library_metadata_entries
        WHERE scope_type = 'user' AND scope_id = ?
      `).get(scope.scopeId).count;
      const storageKeysToRemove = [];
      database.transaction(() => {
        database.prepare(`
          DELETE FROM library_metadata_entries WHERE scope_type = 'user' AND scope_id = ?
        `).run(scope.scopeId);
        for (const document of documents) {
          database.prepare("DELETE FROM library_documents WHERE document_id = ?").run(document.document_id);
          decrementObjectReference(document, storageKeysToRemove);
        }
        database.prepare(`
          DELETE FROM library_folders WHERE scope_type = 'user' AND scope_id = ?
        `).run(scope.scopeId);
        database.prepare(`
          DELETE FROM storage_quotas WHERE scope_type = 'user' AND scope_id = ?
        `).run(scope.scopeId);
        database.prepare(`
          DELETE FROM library_scope_revisions WHERE scope_type = 'user' AND scope_id = ?
        `).run(scope.scopeId);
        database.prepare("DELETE FROM cloud_collection_items WHERE owner_key = ?").run(scope.scopeId);
      })();
      for (const storageKey of storageKeysToRemove) {
        fs.rmSync(objectPath(storageKey), { force: true });
      }
      return {
        documents: documents.length,
        metadataEntries: metadataCount,
        removedObjects: storageKeysToRemove.length,
        scopeId: scope.scopeId
      };
    },

    getTree(scopeTypeInput, scopeIdInput, status = "active") {
      const { scopeId, scopeType } = normalizeScope(scopeTypeInput, scopeIdInput);
      const normalizedStatus = status === "trashed" ? "trashed" : "active";
      const folders = database.prepare(`
        SELECT * FROM library_folders
        WHERE scope_type = ? AND scope_id = ? AND status = ?
        ORDER BY normalized_name, folder_id
      `).all(scopeType, scopeId, normalizedStatus).map(publicFolder);
      return {
        entries: this.listEntries(scopeType, scopeId, normalizedStatus),
        folders,
        revision: currentRevision(scopeType, scopeId),
        scopeId,
        scopeType
      };
    },

    uploadDocument(input) {
      const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes ?? []);
      if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
        throw new LibraryStorageError("invalid_pdf", "The uploaded file is not a PDF.");
      }
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const stagedPath = stageObject(bytes, contentHash);
      return uploadStagedDocument({ ...input, byteLength: bytes.length, contentHash, stagedPath });
    },

    uploadStagedDocument,

    createMetadataEntry(input) {
      const { scopeId, scopeType } = normalizeScope(input.scopeType, input.scopeId);
      assertRevision({ scopeId, scopeType }, input.expectedRevision);
      const folderId = normalizeText(input.folderId) || null;
      if (folderId) {
        const folder = requireFolder(folderId, { scopeId, scopeType });
        if (folder.status !== "active") {
          throw new LibraryStorageError("library_folder_trashed", "The target folder is in the recycle bin.", 409);
        }
      }
      const title = normalizeText(input.title).slice(0, 500);
      if (!title) {
        throw new LibraryStorageError("invalid_metadata_entry", "A title is required.");
      }
      const documentId = randomUUID();
      const timestamp = now().toISOString();
      try {
        database.transaction(() => {
          database.prepare(`
            INSERT INTO library_metadata_entries (
              document_id, scope_type, scope_id, folder_id, title, normalized_title,
              doi, external_url, source_id, created_by, status, created_at, updated_at,
              metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
          `).run(
            documentId,
            scopeType,
            scopeId,
            folderId,
            title,
            normalizedName(title),
            normalizeText(input.doi).slice(0, 300) || null,
            normalizeText(input.externalUrl).slice(0, 2000) || null,
            normalizeText(input.sourceId).slice(0, 500) || null,
            normalizeText(input.createdBy) || scopeId,
            timestamp,
            timestamp,
            JSON.stringify(input.metadata ?? {})
          );
          bumpRevision(scopeType, scopeId);
        })();
      } catch (error) {
        if (String(error?.code).startsWith("SQLITE_CONSTRAINT")) {
          throw new LibraryStorageError(
            "metadata_entry_name_exists",
            "An entry with this title already exists in the target folder.",
            409
          );
        }
        throw error;
      }
      return publicMetadataEntry(requireMetadataEntry(documentId, { scopeId, scopeType }));
    },

    copyEntry(documentId, sourceScopeInput, targetScopeInput, input = {}) {
      const sourceScope = normalizeScope(sourceScopeInput.scopeType, sourceScopeInput.scopeId);
      const targetScope = normalizeScope(targetScopeInput.scopeType, targetScopeInput.scopeId);
      assertRevision(targetScope, input.expectedRevision);
      const targetFolderId = normalizeText(input.folderId) || null;
      if (targetFolderId) {
        const folder = requireFolder(targetFolderId, targetScope);
        if (folder.status !== "active") {
          throw new LibraryStorageError("library_folder_trashed", "The target folder is in the recycle bin.", 409);
        }
      }
      const metadataSource = metadataById.get(documentId);
      if (metadataSource) {
        requireMetadataEntry(documentId, sourceScope);
        if (metadataSource.status !== "active") {
          throw new LibraryStorageError("library_document_trashed", "Document is in the recycle bin.", 404);
        }
        return this.createMetadataEntry({
          createdBy: input.createdBy,
          doi: metadataSource.doi,
          externalUrl: metadataSource.external_url,
          folderId: targetFolderId,
          scopeId: targetScope.scopeId,
          scopeType: targetScope.scopeType,
          sourceId: metadataSource.source_id,
          title: metadataSource.title,
          expectedRevision: input.expectedRevision,
          metadata: JSON.parse(metadataSource.metadata_json ?? "{}")
        });
      }
      const source = requireDocument(documentId, sourceScope);
      if (source.status !== "active") {
        throw new LibraryStorageError("library_document_trashed", "Document is in the recycle bin.", 404);
      }
      const usedBytes = usedBytesRow.get(targetScope.scopeType, targetScope.scopeId).used_bytes;
      if (usedBytes + source.byte_length > quotaLimit(targetScope.scopeType, targetScope.scopeId)) {
        throw new LibraryStorageError("storage_quota_exceeded", "The library storage quota is exceeded.", 409);
      }
      const copiedId = randomUUID();
      const timestamp = now().toISOString();
      database.transaction(() => {
        const names = database.prepare(`
          SELECT normalized_file_name FROM library_documents
          WHERE scope_type = ? AND scope_id = ? AND status = 'active'
            AND ifnull(folder_id, '') = ifnull(?, '')
        `).all(targetScope.scopeType, targetScope.scopeId, targetFolderId);
        const fileName = uniquePdfName(
          source.file_name,
          new Set(names.map((row) => row.normalized_file_name))
        );
        database.prepare(`
          UPDATE storage_objects SET reference_count = reference_count + 1 WHERE content_hash = ?
        `).run(source.content_hash);
        database.prepare(`
          INSERT INTO library_documents (
            document_id, scope_type, scope_id, folder_id, content_hash, file_name,
            normalized_file_name, byte_length, uploaded_by, status, created_at, updated_at,
            doi, external_url, source_id, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
        `).run(
          copiedId,
          targetScope.scopeType,
          targetScope.scopeId,
          targetFolderId,
          source.content_hash,
          fileName,
          normalizedName(fileName),
          source.byte_length,
          normalizeText(input.createdBy) || targetScope.scopeId,
          timestamp,
          timestamp,
          source.doi,
          source.external_url,
          source.source_id,
          source.metadata_json ?? "{}"
        );
        database.prepare(`
          INSERT INTO storage_object_references (document_id, content_hash, created_at)
          VALUES (?, ?, ?)
        `).run(copiedId, source.content_hash, timestamp);
        bumpRevision(targetScope.scopeType, targetScope.scopeId);
      })();
      return publicDocument(requireDocument(copiedId, targetScope));
    },

    attachMetadataEntryPdf(input) {
      const scope = normalizeScope(input.scopeType, input.scopeId);
      assertRevision(scope, input.expectedRevision);
      const metadata = requireMetadataEntry(input.documentId, scope);
      if (metadata.status !== "active") {
        throw new LibraryStorageError(
          "library_document_trashed",
          "Restore the metadata entry before attaching a PDF.",
          409
        );
      }
      const bytes = input.stagedPath
        ? null
        : Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes ?? []);
      const stagedPath = input.stagedPath
        ? requireStagedUpload(input.stagedPath)
        : stageObject(bytes, createHash("sha256").update(bytes).digest("hex"));
      const inspected = inspectStagedPdf(stagedPath);
      if (input.contentHash && input.contentHash !== inspected.contentHash) {
        throw new LibraryStorageError("content_hash_mismatch", "The staged upload hash changed.", 500);
      }
      if (input.byteLength !== undefined && Number(input.byteLength) !== inspected.byteLength) {
        throw new LibraryStorageError("content_length_mismatch", "The staged upload size changed.", 500);
      }
      const { byteLength, contentHash } = inspected;
      const usedBytes = usedBytesRow.get(scope.scopeType, scope.scopeId).used_bytes;
      if (usedBytes + byteLength > quotaLimit(scope.scopeType, scope.scopeId)) {
        throw new LibraryStorageError("storage_quota_exceeded", "The library storage quota is exceeded.", 409);
      }
      const storageKey = path.join(contentHash.slice(0, 2), `${contentHash}.pdf`);
      let wroteObject = false;
      try {
        wroteObject = commitStagedObject(stagedPath, storageKey);
        database.transaction(() => {
          const existingObject = database.prepare(
            "SELECT * FROM storage_objects WHERE content_hash = ?"
          ).get(contentHash);
          if (existingObject && existingObject.byte_length !== byteLength) {
            throw new LibraryStorageError("content_hash_collision", "Content hash collision.", 500);
          }
          if (existingObject) {
            database.prepare(`
              UPDATE storage_objects SET reference_count = reference_count + 1
              WHERE content_hash = ?
            `).run(contentHash);
          } else {
            database.prepare(`
              INSERT INTO storage_objects (
                content_hash, byte_length, storage_key, reference_count, created_at, media_type
              ) VALUES (?, ?, ?, 1, ?, 'application/pdf')
            `).run(contentHash, byteLength, storageKey, now().toISOString());
          }
          const names = database.prepare(`
            SELECT normalized_file_name FROM library_documents
            WHERE scope_type = ? AND scope_id = ? AND status = 'active'
              AND ifnull(folder_id, '') = ifnull(?, '')
          `).all(scope.scopeType, scope.scopeId, metadata.folder_id);
          const fileName = uniquePdfName(
            input.fileName || metadata.title,
            new Set(names.map((row) => row.normalized_file_name))
          );
          database.prepare(
            "DELETE FROM library_metadata_entries WHERE document_id = ?"
          ).run(metadata.document_id);
          database.prepare(`
            INSERT INTO library_documents (
              document_id, scope_type, scope_id, folder_id, content_hash, file_name,
              normalized_file_name, byte_length, uploaded_by, status, created_at, updated_at,
              doi, external_url, source_id, metadata_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
          `).run(
            metadata.document_id,
            scope.scopeType,
            scope.scopeId,
            metadata.folder_id,
            contentHash,
            fileName,
            normalizedName(fileName),
            byteLength,
            normalizeText(input.uploadedBy) || scope.scopeId,
            metadata.created_at,
            now().toISOString(),
            metadata.doi,
            metadata.external_url,
            metadata.source_id,
            metadata.metadata_json ?? "{}"
          );
          database.prepare(`
            INSERT INTO storage_object_references (document_id, content_hash, created_at)
            VALUES (?, ?, ?)
          `).run(metadata.document_id, contentHash, now().toISOString());
          bumpRevision(scope.scopeType, scope.scopeId);
        })();
      } catch (error) {
        fs.rmSync(stagedPath, { force: true });
        removeObjectIfUnreferenced(contentHash, storageKey, wroteObject);
        throw error;
      }
      return publicDocument(requireDocument(metadata.document_id, scope));
    },

    attachMetadataEntryStagedPdf(input) {
      return this.attachMetadataEntryPdf(input);
    },

    trashDocument(documentId, expectedScope, options = {}) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      assertRevision(scope, options.expectedRevision);
      const row = requireDocument(documentId, scope);
      if (row.status === "trashed") return publicDocument(row);
      const timestamp = now();
      database.transaction(() => {
        database.prepare(`
          UPDATE library_documents
          SET status = 'trashed', trashed_at = ?, purge_after = ?, updated_at = ?
          WHERE document_id = ?
        `).run(
          timestamp.toISOString(),
          new Date(timestamp.getTime() + thirtyDaysMs).toISOString(),
          timestamp.toISOString(),
          documentId
        );
        bumpRevision(scope.scopeType, scope.scopeId);
      })();
      return publicDocument(requireDocument(documentId, scope));
    },

    restoreDocument(documentId, expectedScope, options = {}) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      assertRevision(scope, options.expectedRevision);
      const row = requireDocument(documentId, scope);
      if (row.status === "active") return publicDocument(row);
      const names = database.prepare(`
        SELECT normalized_file_name FROM library_documents
        WHERE scope_type = ? AND scope_id = ? AND status = 'active'
          AND ifnull(folder_id, '') = ifnull(?, '')
      `).all(scope.scopeType, scope.scopeId, row.folder_id);
      const fileName = uniquePdfName(row.file_name, new Set(names.map((entry) => entry.normalized_file_name)));
      database.transaction(() => {
        database.prepare(`
          UPDATE library_documents
          SET status = 'active', file_name = ?, normalized_file_name = ?,
              trashed_at = NULL, purge_after = NULL, updated_at = ?
          WHERE document_id = ?
        `).run(fileName, normalizedName(fileName), now().toISOString(), documentId);
        bumpRevision(scope.scopeType, scope.scopeId);
      })();
      return publicDocument(requireDocument(documentId, scope));
    },

    trashEntry(documentId, expectedScope, options = {}) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      assertRevision(scope, options.expectedRevision);
      if (metadataById.get(documentId)) {
        const row = requireMetadataEntry(documentId, scope);
        if (row.status === "trashed") return publicMetadataEntry(row);
        const timestamp = now();
        database.transaction(() => {
          database.prepare(`
            UPDATE library_metadata_entries
            SET status = 'trashed', trashed_at = ?, purge_after = ?, updated_at = ?
            WHERE document_id = ?
          `).run(
            timestamp.toISOString(),
            new Date(timestamp.getTime() + thirtyDaysMs).toISOString(),
            timestamp.toISOString(),
            documentId
          );
          bumpRevision(scope.scopeType, scope.scopeId);
        })();
        return publicMetadataEntry(requireMetadataEntry(documentId, scope));
      }
      return this.trashDocument(documentId, scope, options);
    },

    restoreEntry(documentId, expectedScope, options = {}) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      assertRevision(scope, options.expectedRevision);
      if (metadataById.get(documentId)) {
        const row = requireMetadataEntry(documentId, scope);
        if (row.status === "active") return publicMetadataEntry(row);
        const used = new Set(database.prepare(`
          SELECT normalized_title FROM library_metadata_entries
          WHERE scope_type = ? AND scope_id = ? AND status = 'active'
            AND ifnull(folder_id, '') = ifnull(?, '')
        `).all(scope.scopeType, scope.scopeId, row.folder_id).map((item) => item.normalized_title));
        let title = row.title;
        if (used.has(normalizedName(title))) {
          for (let sequence = 2; sequence < 100_000; sequence += 1) {
            const candidate = `${row.title} (${sequence})`;
            if (!used.has(normalizedName(candidate))) {
              title = candidate;
              break;
            }
          }
        }
        database.transaction(() => {
          database.prepare(`
            UPDATE library_metadata_entries SET status = 'active', title = ?,
              normalized_title = ?, trashed_at = NULL, purge_after = NULL, updated_at = ?
            WHERE document_id = ?
          `).run(title, normalizedName(title), now().toISOString(), documentId);
          bumpRevision(scope.scopeType, scope.scopeId);
        })();
        return publicMetadataEntry(requireMetadataEntry(documentId, scope));
      }
      return this.restoreDocument(documentId, scope, options);
    },

    updateEntry(documentId, expectedScope, changes = {}) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      assertRevision(scope, changes.expectedRevision);
      if (!metadataById.get(documentId)) {
        return this.updateDocument(documentId, scope, changes);
      }
      const row = requireMetadataEntry(documentId, scope);
      if (row.status !== "active") {
        throw new LibraryStorageError(
          "library_document_trashed",
          "Restore the entry before editing it.",
          409
        );
      }
      const folderId = Object.prototype.hasOwnProperty.call(changes, "folderId")
        ? normalizeText(changes.folderId) || null
        : row.folder_id;
      if (folderId) {
        const folder = requireFolder(folderId, scope);
        if (folder.status !== "active") {
          throw new LibraryStorageError(
            "library_folder_trashed",
            "The target folder is in the recycle bin.",
            409
          );
        }
      }
      const title = Object.prototype.hasOwnProperty.call(changes, "title")
        ? normalizeText(changes.title).slice(0, 500)
        : row.title;
      if (!title) {
        throw new LibraryStorageError("invalid_metadata_entry", "A title is required.");
      }
      const metadata = JSON.parse(row.metadata_json ?? "{}");
      if (Object.prototype.hasOwnProperty.call(changes, "literature")) {
        metadata.literature = normalizedLiterature(changes.literature);
      }
      try {
        database.transaction(() => {
          database.prepare(`
            UPDATE library_metadata_entries
            SET folder_id = ?, title = ?, normalized_title = ?, metadata_json = ?, updated_at = ?
            WHERE document_id = ?
          `).run(
            folderId,
            title,
            normalizedName(title),
            JSON.stringify(metadata),
            now().toISOString(),
            documentId
          );
          bumpRevision(scope.scopeType, scope.scopeId);
        })();
      } catch (error) {
        if (String(error?.code).startsWith("SQLITE_CONSTRAINT")) {
          throw new LibraryStorageError(
            "metadata_entry_name_exists",
            "An entry with this title already exists in the target folder.",
            409
          );
        }
        throw error;
      }
      return publicMetadataEntry(requireMetadataEntry(documentId, scope));
    },

    updateDocument(documentId, expectedScope, changes = {}) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      assertRevision(scope, changes.expectedRevision);
      const row = requireDocument(documentId, scope);
      if (row.status !== "active") {
        throw new LibraryStorageError("library_document_trashed", "Restore the document before editing it.", 409);
      }
      const folderId = Object.prototype.hasOwnProperty.call(changes, "folderId")
        ? normalizeText(changes.folderId) || null
        : row.folder_id;
      if (folderId) requireFolder(folderId, scope);
      const requestedName = Object.prototype.hasOwnProperty.call(changes, "fileName")
        ? safePdfName(changes.fileName)
        : row.file_name;
      const names = database.prepare(`
        SELECT normalized_file_name FROM library_documents
        WHERE scope_type = ? AND scope_id = ? AND status = 'active'
          AND document_id <> ? AND ifnull(folder_id, '') = ifnull(?, '')
      `).all(scope.scopeType, scope.scopeId, documentId, folderId);
      const fileName = uniquePdfName(
        requestedName,
        new Set(names.map((entry) => entry.normalized_file_name))
      );
      const metadata = JSON.parse(row.metadata_json ?? "{}");
      if (Object.prototype.hasOwnProperty.call(changes, "literature")) {
        metadata.literature = normalizedLiterature(changes.literature);
      }
      database.transaction(() => {
        database.prepare(`
          UPDATE library_documents
          SET folder_id = ?, file_name = ?, normalized_file_name = ?, metadata_json = ?, updated_at = ?
          WHERE document_id = ?
        `).run(
          folderId,
          fileName,
          normalizedName(fileName),
          JSON.stringify(metadata),
          now().toISOString(),
          documentId
        );
        bumpRevision(scope.scopeType, scope.scopeId);
      })();
      return publicDocument(requireDocument(documentId, scope));
    },

    locateDocument(documentId, expectedScope) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      const row = requireDocument(documentId, scope);
      if (row.status !== "active") {
        throw new LibraryStorageError("library_document_trashed", "Document is in the recycle bin.", 404);
      }
      const object = database.prepare(
        "SELECT storage_key FROM storage_objects WHERE content_hash = ?"
      ).get(row.content_hash);
      if (!object) throw new LibraryStorageError("storage_object_missing", "Stored PDF is missing.", 500);
      const filePath = objectPath(object.storage_key);
      const stat = fs.statSync(filePath, { throwIfNoEntry: false });
      if (!stat?.isFile() || stat.size !== row.byte_length) {
        throw new LibraryStorageError("storage_object_missing", "Stored PDF is missing or corrupt.", 500);
      }
      return { byteLength: stat.size, document: publicDocument(row), filePath };
    },

    authorizeDocument(documentId, expectedScope) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      const row = requireDocument(documentId, scope);
      if (row.status !== "active") {
        throw new LibraryStorageError("library_document_trashed", "Document is in the recycle bin.", 404);
      }
      return publicDocument(row);
    },

    purgeExpired() {
      const cutoff = now().toISOString();
      const expiredDocuments = database.prepare(`
        SELECT * FROM library_documents
        WHERE status = 'trashed' AND purge_after <= ?
      `).all(cutoff);
      const expiredMetadata = database.prepare(`
        SELECT * FROM library_metadata_entries
        WHERE status = 'trashed' AND purge_after <= ?
      `).all(cutoff);
      const expiredFolders = database.prepare(`
        WITH RECURSIVE expired_tree(folder_id, depth) AS (
          SELECT folder_id, 0 FROM library_folders
          WHERE status = 'trashed' AND purge_after <= ?
            AND trashed_by_folder_id = folder_id
          UNION ALL
          SELECT child.folder_id, parent.depth + 1
          FROM library_folders child
          JOIN expired_tree parent ON child.parent_folder_id = parent.folder_id
          WHERE child.status = 'trashed'
        )
        SELECT folder.* FROM expired_tree tree
        JOIN library_folders folder ON folder.folder_id = tree.folder_id
        ORDER BY tree.depth DESC, folder.folder_id
      `).all(cutoff);
      const storageKeysToRemove = [];
      const scopes = new Map();
      database.transaction(() => {
        for (const row of expiredDocuments) {
          database.prepare("DELETE FROM library_documents WHERE document_id = ?").run(row.document_id);
          decrementObjectReference(row, storageKeysToRemove);
          scopes.set(`${row.scope_type}:${row.scope_id}`, row);
        }
        for (const row of expiredMetadata) {
          database.prepare(
            "DELETE FROM library_metadata_entries WHERE document_id = ?"
          ).run(row.document_id);
          scopes.set(`${row.scope_type}:${row.scope_id}`, row);
        }
        for (const row of expiredFolders) {
          database.prepare("DELETE FROM library_folders WHERE folder_id = ?").run(row.folder_id);
          scopes.set(`${row.scope_type}:${row.scope_id}`, row);
        }
        for (const row of scopes.values()) {
          bumpRevision(row.scope_type, row.scope_id);
        }
      })();
      for (const storageKey of storageKeysToRemove) {
        fs.rmSync(objectPath(storageKey), { force: true });
      }
      return {
        purgedCount: expiredDocuments.length + expiredMetadata.length + expiredFolders.length
      };
    },

    reconcileObjects(options = {}) {
      const minimumAgeMs = Number.isFinite(options.minimumAgeMs)
        ? Math.max(0, Number(options.minimumAgeMs))
        : 60 * 60 * 1000;
      const cutoff = now().getTime() - minimumAgeMs;
      const expectedObjects = new Map(database.prepare(
        "SELECT content_hash, byte_length, storage_key, reference_count FROM storage_objects"
      ).all().map((row) => [row.storage_key, row]));
      const referenceCounts = new Map(database.prepare(`
        SELECT content_hash, count(*) AS reference_count
        FROM storage_object_references
        GROUP BY content_hash
      `).all().map((row) => [row.content_hash, row.reference_count]));
      let repairedReferenceCounts = 0;
      const unreferencedStorageKeys = [];
      database.transaction(() => {
        for (const row of expectedObjects.values()) {
          const referenceCount = referenceCounts.get(row.content_hash) ?? 0;
          if (referenceCount === 0) {
            database.prepare("DELETE FROM storage_objects WHERE content_hash = ?")
              .run(row.content_hash);
            unreferencedStorageKeys.push(row.storage_key);
          } else if (referenceCount !== row.reference_count) {
            database.prepare(
              "UPDATE storage_objects SET reference_count = ? WHERE content_hash = ?"
            ).run(referenceCount, row.content_hash);
            repairedReferenceCounts += 1;
          }
        }
      })();

      for (const storageKey of unreferencedStorageKeys) {
        fs.rmSync(objectPath(storageKey), { force: true });
        expectedObjects.delete(storageKey);
      }

      let removedOrphanObjects = 0;
      for (const prefix of fs.readdirSync(objectDirectory, { withFileTypes: true })) {
        if (!prefix.isDirectory() || prefix.name === ".staging") continue;
        const prefixDirectory = path.join(objectDirectory, prefix.name);
        for (const entry of fs.readdirSync(prefixDirectory, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          const storageKey = path.join(prefix.name, entry.name);
          const candidatePath = objectPath(storageKey);
          if (!expectedObjects.has(storageKey) && fs.statSync(candidatePath).mtimeMs <= cutoff) {
            fs.rmSync(candidatePath, { force: true });
            removedOrphanObjects += 1;
          }
        }
      }

      const stagedObjects = fs.readdirSync(stagingDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => ({
          name: entry.name,
          path: path.join(stagingDirectory, entry.name)
        }));
      const missingObjects = [];
      let recoveredStagedObjects = 0;
      for (const [storageKey, row] of expectedObjects) {
        const candidatePath = objectPath(storageKey);
        if (
          fs.existsSync(candidatePath) &&
          fs.statSync(candidatePath).isFile() &&
          fs.statSync(candidatePath).size === row.byte_length &&
          hashFile(candidatePath) === row.content_hash
        ) {
          continue;
        }
        const staged = stagedObjects.find((entry) => entry.name.startsWith(`${row.content_hash}-`));
        if (
          !fs.existsSync(candidatePath) &&
          staged &&
          fs.statSync(staged.path).size === row.byte_length &&
          hashFile(staged.path) === row.content_hash
        ) {
          commitStagedObject(staged.path, storageKey);
          recoveredStagedObjects += 1;
        } else {
          missingObjects.push(row.content_hash);
        }
      }

      let removedStagedObjects = 0;
      for (const staged of stagedObjects) {
        if (fs.existsSync(staged.path) && fs.statSync(staged.path).mtimeMs <= cutoff) {
          fs.rmSync(staged.path, { force: true });
          removedStagedObjects += 1;
        }
      }
      return {
        missingObjects,
        recoveredStagedObjects,
        removedOrphanObjects,
        removedStagedObjects,
        repairedReferenceCounts,
        removedUnreferencedObjects: unreferencedStorageKeys.length
      };
    },

    purgeEntry(documentId, expectedScope, options = {}) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      assertRevision(scope, options.expectedRevision);
      const metadata = metadataById.get(documentId);
      if (metadata) {
        const row = requireMetadataEntry(documentId, scope);
        if (row.status !== "trashed") {
          throw new LibraryStorageError("library_document_not_trashed", "Move the entry to the recycle bin first.", 409);
        }
        database.transaction(() => {
          database.prepare(
            "DELETE FROM library_metadata_entries WHERE document_id = ?"
          ).run(documentId);
          bumpRevision(scope.scopeType, scope.scopeId);
        })();
        return { documentId, purged: true };
      }
      const row = requireDocument(documentId, scope);
      if (row.status !== "trashed") {
        throw new LibraryStorageError("library_document_not_trashed", "Move the document to the recycle bin first.", 409);
      }
      const storageKeysToRemove = [];
      database.transaction(() => {
        database.prepare("DELETE FROM library_documents WHERE document_id = ?").run(documentId);
        decrementObjectReference(row, storageKeysToRemove);
        bumpRevision(scope.scopeType, scope.scopeId);
      })();
      for (const storageKey of storageKeysToRemove) {
        fs.rmSync(objectPath(storageKey), { force: true });
      }
      return { documentId, purged: true };
    },

    createFolder(input) {
      const { scopeId, scopeType } = normalizeScope(input.scopeType, input.scopeId);
      assertRevision({ scopeId, scopeType }, input.expectedRevision);
      const name = normalizeText(input.name);
      if (!name) throw new LibraryStorageError("invalid_folder_name", "Folder name is required.");
      const folderId = randomUUID();
      const parentFolderId = normalizeText(input.parentFolderId) || null;
      if (parentFolderId) requireFolder(parentFolderId, { scopeId, scopeType });
      const timestamp = now().toISOString();
      database.transaction(() => {
        database.prepare(`
          INSERT INTO library_folders (
            folder_id, scope_type, scope_id, parent_folder_id, name,
            normalized_name, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          folderId, scopeType, scopeId, parentFolderId,
          name, normalizedName(name), input.createdBy, timestamp, timestamp
        );
        bumpRevision(scopeType, scopeId);
      })();
      return publicFolder(requireFolder(folderId, { scopeId, scopeType }));
    },

    updateFolder(folderId, expectedScope, changes = {}) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      assertRevision(scope, changes.expectedRevision);
      const row = requireFolder(folderId, scope);
      const name = Object.prototype.hasOwnProperty.call(changes, "name")
        ? normalizeText(changes.name)
        : row.name;
      if (!name) throw new LibraryStorageError("invalid_folder_name", "Folder name is required.");
      const parentFolderId = Object.prototype.hasOwnProperty.call(changes, "parentFolderId")
        ? normalizeText(changes.parentFolderId) || null
        : row.parent_folder_id;
      if (parentFolderId === folderId) {
        throw new LibraryStorageError("invalid_folder_parent", "A folder cannot contain itself.");
      }
      let ancestorId = parentFolderId;
      while (ancestorId) {
        const ancestor = requireFolder(ancestorId, scope);
        if (ancestor.status !== "active") {
          throw new LibraryStorageError(
            "library_folder_trashed",
            "The target folder is in the recycle bin.",
            409
          );
        }
        if (ancestor.parent_folder_id === folderId) {
          throw new LibraryStorageError("invalid_folder_parent", "A folder cannot move into its descendant.");
        }
        ancestorId = ancestor.parent_folder_id;
      }
      try {
        database.transaction(() => {
          database.prepare(`
            UPDATE library_folders
            SET parent_folder_id = ?, name = ?, normalized_name = ?, updated_at = ?
            WHERE folder_id = ?
          `).run(parentFolderId, name, normalizedName(name), now().toISOString(), folderId);
          bumpRevision(scope.scopeType, scope.scopeId);
        })();
      } catch (error) {
        if (String(error?.code).startsWith("SQLITE_CONSTRAINT")) {
          throw new LibraryStorageError("folder_name_exists", "A folder with this name already exists.", 409);
        }
        throw error;
      }
      return publicFolder(requireFolder(folderId, scope));
    },

    trashFolder(folderId, expectedScope, options = {}) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      assertRevision(scope, options.expectedRevision);
      const root = requireFolder(folderId, scope);
      if (root.status === "trashed") return publicFolder(root);
      const timestamp = now();
      const purgeAfter = new Date(timestamp.getTime() + thirtyDaysMs).toISOString();
      const subtree = database.prepare(`
        WITH RECURSIVE subtree(folder_id) AS (
          SELECT folder_id FROM library_folders WHERE folder_id = ?
          UNION ALL
          SELECT child.folder_id FROM library_folders child
          JOIN subtree parent ON child.parent_folder_id = parent.folder_id
        )
        SELECT folder_id FROM subtree
      `).all(folderId).map((row) => row.folder_id);
      const placeholders = subtree.map(() => "?").join(", ");
      database.transaction(() => {
        database.prepare(`
          UPDATE library_documents SET
            status = 'trashed', trashed_at = ?, purge_after = ?,
            trashed_by_folder_id = ?, updated_at = ?
          WHERE status = 'active' AND folder_id IN (${placeholders})
        `).run(
          timestamp.toISOString(), purgeAfter, folderId, timestamp.toISOString(), ...subtree
        );
        database.prepare(`
          UPDATE library_metadata_entries SET
            status = 'trashed', trashed_at = ?, purge_after = ?,
            trashed_by_folder_id = ?, updated_at = ?
          WHERE status = 'active' AND folder_id IN (${placeholders})
        `).run(
          timestamp.toISOString(), purgeAfter, folderId, timestamp.toISOString(), ...subtree
        );
        for (const currentFolderId of subtree) {
          const current = requireFolder(currentFolderId, scope);
          database.prepare(`
            UPDATE library_folders SET
              status = 'trashed', original_name = ?,
              name = ?, normalized_name = ?, trashed_at = ?, purge_after = ?,
              original_parent_folder_id = CASE WHEN folder_id = ? THEN parent_folder_id
                ELSE original_parent_folder_id END,
              trashed_by_folder_id = ?, updated_at = ?
            WHERE folder_id = ?
          `).run(
            current.name,
            `trashed-${currentFolderId}`,
            `trashed-${currentFolderId}`,
            timestamp.toISOString(),
            purgeAfter,
            folderId,
            folderId,
            timestamp.toISOString(),
            currentFolderId
          );
        }
        bumpRevision(scope.scopeType, scope.scopeId);
      })();
      return publicFolder(requireFolder(folderId, scope));
    },

    restoreFolder(folderId, expectedScope, options = {}) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      assertRevision(scope, options.expectedRevision);
      const root = requireFolder(folderId, scope);
      if (root.status === "active") return publicFolder(root);
      if (root.trashed_by_folder_id !== folderId) {
        throw new LibraryStorageError(
          "library_folder_restore_parent_required",
          "Restore the parent folder that owns this recycle-bin transaction.",
          409
        );
      }
      let restoredParentId = root.original_parent_folder_id;
      if (restoredParentId) {
        const parent = requireFolder(restoredParentId, scope);
        if (parent.status !== "active") restoredParentId = null;
      }
      const subtree = database.prepare(`
        WITH RECURSIVE subtree(folder_id, depth) AS (
          SELECT folder_id, 0 FROM library_folders WHERE folder_id = ?
          UNION ALL
          SELECT child.folder_id, parent.depth + 1 FROM library_folders child
          JOIN subtree parent ON child.parent_folder_id = parent.folder_id
          WHERE child.trashed_by_folder_id = ?
        )
        SELECT folder_id, depth FROM subtree ORDER BY depth, folder_id
      `).all(folderId, folderId);
      const timestamp = now().toISOString();
      database.transaction(() => {
        for (const item of subtree) {
          const current = requireFolder(item.folder_id, scope);
          const parentId = item.folder_id === folderId ? restoredParentId : current.parent_folder_id;
          const used = new Set(database.prepare(`
            SELECT normalized_name FROM library_folders
            WHERE scope_type = ? AND scope_id = ? AND status = 'active'
              AND ifnull(parent_folder_id, '') = ifnull(?, '')
          `).all(scope.scopeType, scope.scopeId, parentId).map((row) => row.normalized_name));
          const originalName = current.original_name || "Restored folder";
          let name = originalName;
          if (used.has(normalizedName(name))) {
            for (let sequence = 2; sequence < 100_000; sequence += 1) {
              const candidate = `${originalName} (${sequence})`;
              if (!used.has(normalizedName(candidate))) {
                name = candidate;
                break;
              }
            }
          }
          database.prepare(`
            UPDATE library_folders SET
              status = 'active', parent_folder_id = ?, name = ?, normalized_name = ?,
              original_name = NULL, trashed_at = NULL, purge_after = NULL,
              original_parent_folder_id = NULL, trashed_by_folder_id = NULL,
              updated_at = ?
            WHERE folder_id = ?
          `).run(parentId, name, normalizedName(name), timestamp, item.folder_id);
        }
        database.prepare(`
          UPDATE library_documents SET status = 'active', trashed_at = NULL,
            purge_after = NULL, trashed_by_folder_id = NULL, updated_at = ?
          WHERE trashed_by_folder_id = ?
        `).run(timestamp, folderId);
        database.prepare(`
          UPDATE library_metadata_entries SET status = 'active', trashed_at = NULL,
            purge_after = NULL, trashed_by_folder_id = NULL, updated_at = ?
          WHERE trashed_by_folder_id = ?
        `).run(timestamp, folderId);
        bumpRevision(scope.scopeType, scope.scopeId);
      })();
      return publicFolder(requireFolder(folderId, scope));
    },

    purgeFolder(folderId, expectedScope, options = {}) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      assertRevision(scope, options.expectedRevision);
      const root = requireFolder(folderId, scope);
      if (root.status !== "trashed" || root.trashed_by_folder_id !== folderId) {
        throw new LibraryStorageError(
          "library_folder_not_trashed",
          "Move the folder to the recycle bin first.",
          409
        );
      }
      const folders = database.prepare(`
        WITH RECURSIVE subtree(folder_id, depth) AS (
          SELECT folder_id, 0 FROM library_folders WHERE folder_id = ?
          UNION ALL
          SELECT child.folder_id, parent.depth + 1 FROM library_folders child
          JOIN subtree parent ON child.parent_folder_id = parent.folder_id
          WHERE child.trashed_by_folder_id = ?
        )
        SELECT folder_id, depth FROM subtree ORDER BY depth DESC, folder_id
      `).all(folderId, folderId);
      const ids = folders.map((item) => item.folder_id);
      const placeholders = ids.map(() => "?").join(", ");
      const documents = database.prepare(`
        SELECT * FROM library_documents WHERE folder_id IN (${placeholders})
      `).all(...ids);
      const storageKeysToRemove = [];
      database.transaction(() => {
        database.prepare(`
          DELETE FROM library_metadata_entries WHERE folder_id IN (${placeholders})
        `).run(...ids);
        for (const document of documents) {
          database.prepare("DELETE FROM library_documents WHERE document_id = ?").run(document.document_id);
          decrementObjectReference(document, storageKeysToRemove);
        }
        for (const folder of folders) {
          database.prepare("DELETE FROM library_folders WHERE folder_id = ?").run(folder.folder_id);
        }
        bumpRevision(scope.scopeType, scope.scopeId);
      })();
      for (const storageKey of storageKeysToRemove) {
        fs.rmSync(objectPath(storageKey), { force: true });
      }
      return { folderId, purged: true };
    },

    emptyTrash(scopeTypeInput, scopeIdInput, options = {}) {
      const scope = normalizeScope(scopeTypeInput, scopeIdInput);
      assertRevision(scope, options.expectedRevision);
      const documents = database.prepare(`
        SELECT * FROM library_documents
        WHERE scope_type = ? AND scope_id = ? AND status = 'trashed'
      `).all(scope.scopeType, scope.scopeId);
      const metadataCount = database.prepare(`
        SELECT COUNT(*) AS count FROM library_metadata_entries
        WHERE scope_type = ? AND scope_id = ? AND status = 'trashed'
      `).get(scope.scopeType, scope.scopeId).count;
      const folderCount = database.prepare(`
        SELECT COUNT(*) AS count FROM library_folders
        WHERE scope_type = ? AND scope_id = ? AND status = 'trashed'
      `).get(scope.scopeType, scope.scopeId).count;
      const storageKeysToRemove = [];
      database.transaction(() => {
        database.prepare(`
          DELETE FROM library_metadata_entries
          WHERE scope_type = ? AND scope_id = ? AND status = 'trashed'
        `).run(scope.scopeType, scope.scopeId);
        for (const document of documents) {
          database.prepare("DELETE FROM library_documents WHERE document_id = ?")
            .run(document.document_id);
          decrementObjectReference(document, storageKeysToRemove);
        }
        database.prepare(`
          DELETE FROM library_folders
          WHERE scope_type = ? AND scope_id = ? AND status = 'trashed'
        `).run(scope.scopeType, scope.scopeId);
        if (documents.length > 0 || metadataCount > 0 || folderCount > 0) {
          bumpRevision(scope.scopeType, scope.scopeId);
        }
      })();
      for (const storageKey of storageKeysToRemove) {
        fs.rmSync(objectPath(storageKey), { force: true });
      }
      const purgedCount = documents.length + metadataCount + folderCount;
      return { purgedCount, revision: currentRevision(scope.scopeType, scope.scopeId) };
    },

    createTeamAnnotation(input) {
      return database.transaction(() => {
        const scope = normalizeScope("organization", input.organizationId);
        const document = requireDocument(input.documentId, scope);
        if (document.status !== "active") {
          throw new LibraryStorageError("library_document_not_found", "Document not found.", 404);
        }
        const body = normalizeTeamAnnotationBody(input.body);
        const annotationId = `annotation_${randomUUID()}`;
        const timestamp = now().toISOString();
        database.prepare(`
          INSERT INTO team_annotations (
            annotation_id, organization_id, document_id, uploaded_by,
            body_json, status, created_at, updated_at, revision
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 1)
        `).run(
          annotationId,
          scope.scopeId,
          input.documentId,
          normalizeText(input.uploadedBy),
          JSON.stringify(body),
          timestamp,
          timestamp
        );
        return publicTeamAnnotation(database.prepare(
          "SELECT * FROM team_annotations WHERE annotation_id = ?"
        ).get(annotationId));
      })();
    },

    updateTeamAnnotation(input) {
      return database.transaction(() => {
        const organizationId = normalizeScope("organization", input.organizationId).scopeId;
        const row = database.prepare(
          "SELECT * FROM team_annotations WHERE annotation_id = ? AND organization_id = ? AND status = 'active'"
        ).get(normalizeText(input.annotationId), organizationId);
        if (!row) {
          throw new LibraryStorageError("annotation_not_found", "Annotation not found.", 404);
        }
        if (row.uploaded_by !== input.actorId) {
          throw new LibraryStorageError("annotation_author_required", "Only the author can update this annotation.", 403);
        }
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== row.revision) {
          throw new LibraryStorageError("annotation_revision_conflict", "The annotation changed. Refresh and retry.", 409);
        }
        const body = normalizeTeamAnnotationBody(input.body);
        const timestamp = now().toISOString();
        database.prepare(`
          UPDATE team_annotations
          SET body_json = ?, revision = revision + 1, updated_at = ?
          WHERE annotation_id = ? AND organization_id = ? AND revision = ?
        `).run(JSON.stringify(body), timestamp, row.annotation_id, organizationId, input.expectedRevision);
        return publicTeamAnnotation(database.prepare(
          "SELECT * FROM team_annotations WHERE annotation_id = ?"
        ).get(row.annotation_id));
      })();
    },

    deleteTeamAnnotation(input) {
      return database.transaction(() => {
        const organizationId = normalizeScope("organization", input.organizationId).scopeId;
        const row = database.prepare(
          "SELECT * FROM team_annotations WHERE annotation_id = ? AND organization_id = ? AND status = 'active'"
        ).get(normalizeText(input.annotationId), organizationId);
        if (!row) {
          throw new LibraryStorageError("annotation_not_found", "Annotation not found.", 404);
        }
        if (!input.canModerate && row.uploaded_by !== input.actorId) {
          throw new LibraryStorageError("annotation_delete_forbidden", "Only its author or an administrator can delete it.", 403);
        }
        if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== row.revision) {
          throw new LibraryStorageError("annotation_revision_conflict", "The annotation changed. Refresh and retry.", 409);
        }
        database.prepare(`
          DELETE FROM team_annotations
          WHERE annotation_id = ? AND organization_id = ? AND revision = ?
        `).run(row.annotation_id, organizationId, input.expectedRevision);
        return { ...publicTeamAnnotation(row), deleted: true };
      })();
    },

    uploadTeamAnnotation(input) {
      return database.transaction(() => {
        const scope = { scopeId: input.organizationId, scopeType: "organization" };
        assertRevision(scope, input.expectedRevision);
        const row = requireDocument(input.documentId, scope);
        if (row.status !== "active") {
          throw new LibraryStorageError("library_document_trashed", "Document is in the recycle bin.", 404);
        }
        const bodyJson = JSON.stringify(input.body ?? {});
        if (Buffer.byteLength(bodyJson) > 64 * 1024) {
          throw new LibraryStorageError("team_annotation_too_large", "Team annotation is too large.");
        }
        const annotationId = randomUUID();
        const timestamp = now().toISOString();
        database.prepare(`
          INSERT INTO team_annotations (
            annotation_id, organization_id, document_id, uploaded_by,
            body_json, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(annotationId, input.organizationId, input.documentId, input.uploadedBy, bodyJson, timestamp, timestamp);
        bumpRevision("organization", input.organizationId);
        return { annotationId, body: JSON.parse(bodyJson), createdAt: timestamp, uploadedBy: input.uploadedBy };
      })();
    },

    listTeamAnnotations(organizationId, documentId) {
      const row = requireDocument(documentId, { scopeId: organizationId, scopeType: "organization" });
      if (row.status !== "active") return [];
      return database.prepare(`
        SELECT * FROM team_annotations
        WHERE organization_id = ? AND document_id = ? AND status = 'active'
        ORDER BY created_at
      `).all(organizationId, documentId).map(publicTeamAnnotation);
    },

    withdrawTeamAnnotation(input) {
      return database.transaction(() => {
        const scope = { scopeId: input.organizationId, scopeType: "organization" };
        assertRevision(scope, input.expectedRevision);
        const row = database.prepare("SELECT * FROM team_annotations WHERE annotation_id = ?").get(input.annotationId);
        if (!row || row.organization_id !== input.organizationId) {
          throw new LibraryStorageError("team_annotation_not_found", "Annotation not found.", 404);
        }
        if (!input.canModerate && row.uploaded_by !== input.actorId) {
          throw new LibraryStorageError("team_annotation_forbidden", "Only its author or an administrator can remove it.", 403);
        }
        if (row.status === "withdrawn") {
          return { annotationId: input.annotationId, withdrawn: true };
        }
        const timestamp = now().toISOString();
        database.prepare(`
          UPDATE team_annotations
          SET status = 'withdrawn', withdrawn_at = ?, updated_at = ?
          WHERE annotation_id = ?
        `).run(timestamp, timestamp, input.annotationId);
        bumpRevision("organization", input.organizationId);
        return { annotationId: input.annotationId, withdrawn: true };
      })();
    }
  };
}
