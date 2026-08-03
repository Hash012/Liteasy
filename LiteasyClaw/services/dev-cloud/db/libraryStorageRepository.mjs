import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "./jsonFileStore.mjs";

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
  return {
    byteLength: row.byte_length,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    documentId: row.document_id,
    fileName: row.file_name,
    folderId: row.folder_id ?? undefined,
    purgeAfter: row.purge_after ?? undefined,
    scopeId: row.scope_id,
    scopeType: row.scope_type,
    status: row.status,
    trashedAt: row.trashed_at ?? undefined,
    updatedAt: row.updated_at,
    uploadedBy: row.uploaded_by
  };
}

export function createLibraryStorageRepository(database, options = {}) {
  const objectDirectory = options.objectDirectory ?? path.join(getDataDir(), "storage-objects");
  const now = () => options.now?.() ?? new Date();
  fs.mkdirSync(objectDirectory, { recursive: true, mode: 0o700 });

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

  const uploadTransaction = database.transaction((input) => {
    const usedBytes = usedBytesRow.get(input.scopeType, input.scopeId).used_bytes;
    const limitBytes = quotaLimit(input.scopeType, input.scopeId);
    if (usedBytes + input.bytes.length > limitBytes) {
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
    if (existingObject && existingObject.byte_length !== input.bytes.length) {
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
      `).run(input.contentHash, input.bytes.length, input.storageKey, input.timestamp);
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
      input.bytes.length,
      input.uploadedBy,
      input.timestamp,
      input.timestamp
    );
    return requireDocument(documentId);
  });

  return {
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
        WHERE scope_type = ? AND scope_id = ?
        ORDER BY created_at, folder_id
      `).all(scopeType, scopeId).map((row) => ({
        createdAt: row.created_at,
        folderId: row.folder_id,
        name: row.name,
        parentFolderId: row.parent_folder_id ?? undefined,
        updatedAt: row.updated_at
      }));
    },

    uploadDocument(input) {
      const { scopeId, scopeType } = normalizeScope(input.scopeType, input.scopeId);
      const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes ?? []);
      if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
        throw new LibraryStorageError("invalid_pdf", "The uploaded file is not a PDF.");
      }
      const contentHash = createHash("sha256").update(bytes).digest("hex");
      const duplicates = database.prepare(`
        SELECT * FROM library_documents
        WHERE scope_type = ? AND scope_id = ? AND content_hash = ?
        ORDER BY created_at
      `).all(scopeType, scopeId, contentHash).map(publicDocument);
      const duplicateAction = normalizeText(input.duplicateAction);
      if (duplicates.length > 0 && duplicateAction !== "save_copy") {
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
      const destination = objectPath(storageKey);
      let wroteObject = false;
      if (!fs.existsSync(destination)) {
        fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
        try {
          fs.writeFileSync(destination, bytes, { flag: "wx", mode: 0o600 });
          wroteObject = true;
        } catch (error) {
          if (error?.code !== "EEXIST") throw error;
        }
      }
      try {
        const row = uploadTransaction({
          bytes,
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
        if (wroteObject && !database.prepare(
          "SELECT 1 FROM storage_objects WHERE content_hash = ?"
        ).get(contentHash)) {
          fs.rmSync(destination, { force: true });
        }
        throw error;
      }
    },

    trashDocument(documentId, expectedScope) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      const row = requireDocument(documentId, scope);
      if (row.status === "trashed") return publicDocument(row);
      const timestamp = now();
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
      return publicDocument(requireDocument(documentId, scope));
    },

    restoreDocument(documentId, expectedScope) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      const row = requireDocument(documentId, scope);
      if (row.status === "active") return publicDocument(row);
      const names = database.prepare(`
        SELECT normalized_file_name FROM library_documents
        WHERE scope_type = ? AND scope_id = ? AND status = 'active'
          AND ifnull(folder_id, '') = ifnull(?, '')
      `).all(scope.scopeType, scope.scopeId, row.folder_id);
      const fileName = uniquePdfName(row.file_name, new Set(names.map((entry) => entry.normalized_file_name)));
      database.prepare(`
        UPDATE library_documents
        SET status = 'active', file_name = ?, normalized_file_name = ?,
            trashed_at = NULL, purge_after = NULL, updated_at = ?
        WHERE document_id = ?
      `).run(fileName, normalizedName(fileName), now().toISOString(), documentId);
      return publicDocument(requireDocument(documentId, scope));
    },

    updateDocument(documentId, expectedScope, changes = {}) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
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
      database.prepare(`
        UPDATE library_documents
        SET folder_id = ?, file_name = ?, normalized_file_name = ?, updated_at = ?
        WHERE document_id = ?
      `).run(folderId, fileName, normalizedName(fileName), now().toISOString(), documentId);
      return publicDocument(requireDocument(documentId, scope));
    },

    readDocument(documentId, expectedScope) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
      const row = requireDocument(documentId, scope);
      if (row.status !== "active") {
        throw new LibraryStorageError("library_document_trashed", "Document is in the recycle bin.", 404);
      }
      const object = database.prepare(
        "SELECT storage_key FROM storage_objects WHERE content_hash = ?"
      ).get(row.content_hash);
      if (!object) throw new LibraryStorageError("storage_object_missing", "Stored PDF is missing.", 500);
      return { bytes: fs.readFileSync(objectPath(object.storage_key)), document: publicDocument(row) };
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
      const expired = database.prepare(`
        SELECT * FROM library_documents
        WHERE status = 'trashed' AND purge_after <= ?
      `).all(cutoff);
      const storageKeysToRemove = [];
      database.transaction(() => {
        for (const row of expired) {
          database.prepare("DELETE FROM library_documents WHERE document_id = ?").run(row.document_id);
          const object = database.prepare(
            "SELECT * FROM storage_objects WHERE content_hash = ?"
          ).get(row.content_hash);
          if (object?.reference_count === 1) {
            storageKeysToRemove.push(object.storage_key);
            database.prepare("DELETE FROM storage_objects WHERE content_hash = ?").run(row.content_hash);
          } else if (object) {
            database.prepare(`
              UPDATE storage_objects SET reference_count = reference_count - 1 WHERE content_hash = ?
            `).run(row.content_hash);
          }
        }
      })();
      for (const storageKey of storageKeysToRemove) {
        fs.rmSync(objectPath(storageKey), { force: true });
      }
      return { purgedCount: expired.length };
    },

    createFolder(input) {
      const { scopeId, scopeType } = normalizeScope(input.scopeType, input.scopeId);
      const name = normalizeText(input.name);
      if (!name) throw new LibraryStorageError("invalid_folder_name", "Folder name is required.");
      const folderId = randomUUID();
      const parentFolderId = normalizeText(input.parentFolderId) || null;
      if (parentFolderId) requireFolder(parentFolderId, { scopeId, scopeType });
      const timestamp = now().toISOString();
      database.prepare(`
        INSERT INTO library_folders (
          folder_id, scope_type, scope_id, parent_folder_id, name,
          normalized_name, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        folderId, scopeType, scopeId, parentFolderId,
        name, normalizedName(name), input.createdBy, timestamp, timestamp
      );
      return { createdAt: timestamp, folderId, name, parentFolderId: parentFolderId ?? undefined };
    },

    updateFolder(folderId, expectedScope, changes = {}) {
      const scope = normalizeScope(expectedScope.scopeType, expectedScope.scopeId);
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
        if (ancestor.parent_folder_id === folderId) {
          throw new LibraryStorageError("invalid_folder_parent", "A folder cannot move into its descendant.");
        }
        ancestorId = ancestor.parent_folder_id;
      }
      try {
        database.prepare(`
          UPDATE library_folders
          SET parent_folder_id = ?, name = ?, normalized_name = ?, updated_at = ?
          WHERE folder_id = ?
        `).run(parentFolderId, name, normalizedName(name), now().toISOString(), folderId);
      } catch (error) {
        if (String(error?.code).startsWith("SQLITE_CONSTRAINT")) {
          throw new LibraryStorageError("folder_name_exists", "A folder with this name already exists.", 409);
        }
        throw error;
      }
      const updated = requireFolder(folderId, scope);
      return {
        folderId: updated.folder_id,
        name: updated.name,
        parentFolderId: updated.parent_folder_id ?? undefined,
        updatedAt: updated.updated_at
      };
    },

    uploadTeamAnnotation(input) {
      const row = requireDocument(input.documentId, {
        scopeId: input.organizationId,
        scopeType: "organization"
      });
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
      return { annotationId, body: JSON.parse(bodyJson), createdAt: timestamp, uploadedBy: input.uploadedBy };
    },

    listTeamAnnotations(organizationId, documentId) {
      const row = requireDocument(documentId, { scopeId: organizationId, scopeType: "organization" });
      if (row.status !== "active") return [];
      return database.prepare(`
        SELECT * FROM team_annotations
        WHERE organization_id = ? AND document_id = ? AND status = 'active'
        ORDER BY created_at
      `).all(organizationId, documentId).map((entry) => ({
        annotationId: entry.annotation_id,
        body: JSON.parse(entry.body_json),
        createdAt: entry.created_at,
        uploadedBy: entry.uploaded_by
      }));
    },

    withdrawTeamAnnotation(annotationId, actorId, canModerate = false) {
      const row = database.prepare("SELECT * FROM team_annotations WHERE annotation_id = ?").get(annotationId);
      if (!row) throw new LibraryStorageError("team_annotation_not_found", "Annotation not found.", 404);
      if (!canModerate && row.uploaded_by !== actorId) {
        throw new LibraryStorageError("team_annotation_forbidden", "Only its author or an administrator can remove it.", 403);
      }
      const timestamp = now().toISOString();
      database.prepare(`
        UPDATE team_annotations
        SET status = 'withdrawn', withdrawn_at = ?, updated_at = ?
        WHERE annotation_id = ?
      `).run(timestamp, timestamp, annotationId);
      return { annotationId, withdrawn: true };
    }
  };
}
