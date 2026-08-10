import { createHash, randomUUID } from "node:crypto";
import { withPostgresTransaction } from "./postgres.mjs";
import {
  LiteratureMetadataValidationError,
  normalizeLiteratureMetadata,
  normalizeLiteratureProjectionReference
} from "./literatureMetadata.mjs";

export class LibraryRepositoryError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function validateScope(scope) {
  if (!new Set(["user", "organization"]).has(scope?.scopeType) || typeof scope?.scopeId !== "string" || !scope.scopeId) {
    throw new LibraryRepositoryError("library_scope_invalid");
  }
  return scope;
}

function nodeName(value, label = "name") {
  if (typeof value !== "string") throw new LibraryRepositoryError(`library_${label}_invalid`);
  const name = value.normalize("NFKC").trim();
  if (!name || name.length > 255 || /[\u0000-\u001f/\\]/.test(name) || name === "." || name === "..") {
    throw new LibraryRepositoryError(`library_${label}_invalid`);
  }
  return { name, normalizedName: name.toLocaleLowerCase("en-US") };
}

function pdfName(value) {
  const result = nodeName(value, "file_name");
  if (!result.name.toLocaleLowerCase("en-US").endsWith(".pdf")) {
    throw new LibraryRepositoryError("library_pdf_file_name_invalid");
  }
  return result;
}

function optionalText(value, maximum) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new LibraryRepositoryError("library_metadata_invalid");
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maximum) throw new LibraryRepositoryError("library_metadata_invalid");
  return normalized;
}

function expectedRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new LibraryRepositoryError("library_revision_invalid");
  return value;
}

function idempotencyKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,200}$/.test(value)) {
    throw new LibraryRepositoryError("idempotency_key_invalid");
  }
  return value;
}

function requestHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requiredId(value, label) {
  if (typeof value !== "string" || !value || value.length > 200) {
    throw new LibraryRepositoryError(`library_${label}_invalid`);
  }
  return value;
}

function securityScanProof(staged) {
  const proof = staged?.securityScan;
  const scannedAt = new Date(proof?.scannedAt);
  const validIdentity = (value) => (
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/+ -]{0,99}$/.test(value)
  );
  if (!proof || proof.contentHash !== staged.contentHash ||
    !Number.isFinite(scannedAt.getTime()) ||
    !validIdentity(proof.scanner) || !validIdentity(proof.version)) {
    throw new LibraryRepositoryError("storage_security_scan_required", 503);
  }
  return {
    contentHash: proof.contentHash,
    scannedAt: scannedAt.toISOString(),
    scanner: proof.scanner,
    version: proof.version
  };
}

function storedSecurityScanProof(row) {
  return securityScanProof({
    contentHash: row.content_hash,
    securityScan: {
      contentHash: row.security_scan_hash,
      scannedAt: row.security_scanned_at,
      scanner: row.security_scanner,
      version: row.security_scanner_version
    }
  });
}

async function requireFolder(client, scope, folderId, status) {
  const result = await client.query(`
    SELECT * FROM library_folders
     WHERE folder_id = $1 AND scope_type = $2 AND scope_id = $3
     FOR UPDATE
  `, [folderId, scope.scopeType, scope.scopeId]);
  const row = result.rows[0];
  if (!row) throw new LibraryRepositoryError("library_folder_not_found", 404);
  if (status && row.status !== status) {
    throw new LibraryRepositoryError(status === "active" ? "library_folder_trashed" : "library_folder_not_trashed", 409);
  }
  return row;
}

async function requireEntry(client, scope, documentId, status) {
  const result = await client.query(`
    SELECT entry.*, reference.content_hash, object.byte_length, object.status AS object_status,
           object.security_scan_hash, object.security_scanned_at
      FROM library_entries entry
      LEFT JOIN storage_object_references reference USING (document_id)
      LEFT JOIN storage_objects object ON object.content_hash = reference.content_hash
     WHERE entry.document_id = $1 AND entry.scope_type = $2 AND entry.scope_id = $3
     FOR UPDATE OF entry
  `, [documentId, scope.scopeType, scope.scopeId]);
  const row = result.rows[0];
  if (!row) throw new LibraryRepositoryError("library_document_not_found", 404);
  if (status && row.status !== status) {
    throw new LibraryRepositoryError(status === "active" ? "library_document_trashed" : "library_document_not_trashed", 409);
  }
  return row;
}

async function requireActiveTargetFolder(client, scope, folderId) {
  if (folderId === null) return;
  await requireFolder(client, scope, folderId, "active");
}

function restoredNameCandidate(originalName, sequence, pdf) {
  if (!pdf) return `${originalName} (${sequence})`;
  return `${originalName.slice(0, -4)} (${sequence}).pdf`;
}

async function uniqueRestoredName(client, scope, parentFolderId, originalName, pdf = false) {
  await client.query("SELECT lock_library_sibling_names($1, $2, $3)", [
    scope.scopeType, scope.scopeId, parentFolderId
  ]);
  const result = await client.query(`
    SELECT normalized_name FROM library_folders
     WHERE scope_type = $1 AND scope_id = $2 AND status = 'active'
       AND parent_folder_id IS NOT DISTINCT FROM $3
    UNION ALL
    SELECT normalized_name FROM library_entries
     WHERE scope_type = $1 AND scope_id = $2 AND status = 'active'
       AND folder_id IS NOT DISTINCT FROM $3
  `, [scope.scopeType, scope.scopeId, parentFolderId]);
  const used = new Set(result.rows.map((row) => row.normalized_name));
  let candidate = originalName;
  for (let sequence = 2; used.has(candidate.toLocaleLowerCase("en-US")); sequence += 1) {
    if (sequence >= 100_000) throw new LibraryRepositoryError("library_restore_name_exhausted", 409);
    candidate = restoredNameCandidate(originalName, sequence, pdf);
  }
  return nodeName(candidate, pdf ? "file_name" : "name");
}

async function assertQuota(client, scope, additionalBytes) {
  const quota = await client.query(`
    SELECT limit_bytes FROM storage_quotas
    WHERE scope_type = $1 AND scope_id = $2
    FOR UPDATE
  `, [scope.scopeType, scope.scopeId]);
  if (!quota.rows[0]) throw new LibraryRepositoryError("library_quota_not_configured", 403);
  const usage = await client.query(`
    SELECT COALESCE(SUM(logical_bytes), 0) AS used_bytes
    FROM library_entries
    WHERE scope_type = $1 AND scope_id = $2
  `, [scope.scopeType, scope.scopeId]);
  const usedBytes = Number(usage.rows[0].used_bytes);
  const limitBytes = Number(quota.rows[0].limit_bytes);
  if (usedBytes + additionalBytes > limitBytes) throw new LibraryRepositoryError("library_quota_exceeded", 409);
}

function mapFolder(row) {
  return {
    createdAt: row.created_at.toISOString(),
    folderId: row.folder_id,
    name: row.name,
    parentFolderId: row.parent_folder_id ?? undefined,
    purgeAfter: row.purge_after?.toISOString(),
    status: row.status,
    trashedAt: row.trashed_at?.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function mapEntry(row) {
  const base = {
    createdAt: row.created_at.toISOString(),
    documentId: row.document_id,
    entryKind: row.entry_kind,
    folderId: row.folder_id ?? undefined,
    purgeAfter: row.purge_after?.toISOString(),
    scopeId: row.scope_id,
    scopeType: row.scope_type,
    status: row.status,
    title: row.title,
    trashedAt: row.trashed_at?.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
  if (row.entry_kind === "metadata_only") {
    return {
      ...base,
      doi: row.metadata?.doi,
      externalUrl: row.metadata?.externalUrl,
      metadata: row.metadata ?? {},
      sourceId: row.metadata?.sourceId
    };
  }
  return {
    ...base,
    byteLength: Number(row.byte_length),
    contentHash: row.content_hash,
    fileName: row.file_name,
    metadata: row.metadata ?? {},
    uploadedBy: row.created_by
  };
}

async function lockScopeRevision(client, scope, expected) {
  await client.query(`
    INSERT INTO library_scope_revisions(scope_type, scope_id, revision)
    VALUES ($1, $2, 0)
    ON CONFLICT (scope_type, scope_id) DO NOTHING
  `, [scope.scopeType, scope.scopeId]);
  const result = await client.query(`
    SELECT revision FROM library_scope_revisions
    WHERE scope_type = $1 AND scope_id = $2
    FOR UPDATE
  `, [scope.scopeType, scope.scopeId]);
  const revision = Number(result.rows[0]?.revision);
  if (revision !== expected) throw new LibraryRepositoryError("library_revision_conflict", 409);
  return revision;
}

async function bumpScopeRevision(client, scope) {
  const result = await client.query(`
    UPDATE library_scope_revisions
       SET revision = revision + 1, updated_at = now()
     WHERE scope_type = $1 AND scope_id = $2
     RETURNING revision
  `, [scope.scopeType, scope.scopeId]);
  return Number(result.rows[0].revision);
}

function translateConstraint(error) {
  if (error instanceof LibraryRepositoryError) return error;
  if (error?.code === "23505") return new LibraryRepositoryError("library_name_exists", 409);
  if (error?.code === "23503") return new LibraryRepositoryError("library_parent_missing", 409);
  if (error?.code === "23514") return new LibraryRepositoryError(error.message || "library_constraint_failed", 409);
  return error;
}

export class PostgresLibraryRepository {
  constructor(pool, { literatureProjectionVerifier } = {}) {
    this.pool = pool;
    this.literatureProjectionVerifier = literatureProjectionVerifier;
  }

  async getTree(scopeInput, status = "active") {
    const scope = validateScope(scopeInput);
    const normalizedStatus = status === "trashed" ? "trashed" : "active";
    const [folderResult, entryResult, revisionResult, quotaResult] = await Promise.all([
      this.pool.query(`
        SELECT * FROM library_folders
        WHERE scope_type = $1 AND scope_id = $2 AND status = $3
        ORDER BY normalized_name, folder_id
      `, [scope.scopeType, scope.scopeId, normalizedStatus]),
      this.pool.query(`
        SELECT entry.*, reference.content_hash, object.byte_length
          FROM library_entries entry
          LEFT JOIN storage_object_references reference USING (document_id)
          LEFT JOIN storage_objects object ON object.content_hash = reference.content_hash
         WHERE entry.scope_type = $1 AND entry.scope_id = $2
           AND entry.status = $3 AND entry.availability = 'available'
           AND (entry.entry_kind = 'metadata_only' OR object.security_scan_hash = object.content_hash)
         ORDER BY entry.normalized_name, entry.document_id
      `, [scope.scopeType, scope.scopeId, normalizedStatus]),
      this.pool.query(`
        SELECT revision FROM library_scope_revisions
        WHERE scope_type = $1 AND scope_id = $2
      `, [scope.scopeType, scope.scopeId]),
      this.pool.query(`
        SELECT quota.limit_bytes, COALESCE(SUM(entry.logical_bytes), 0) AS used_bytes
          FROM storage_quotas quota
          LEFT JOIN library_entries entry
            ON entry.scope_type = quota.scope_type AND entry.scope_id = quota.scope_id
         WHERE quota.scope_type = $1 AND quota.scope_id = $2
         GROUP BY quota.limit_bytes
      `, [scope.scopeType, scope.scopeId])
    ]);
    const limitBytes = Number(quotaResult.rows[0]?.limit_bytes ?? 0);
    const usedBytes = Number(quotaResult.rows[0]?.used_bytes ?? 0);
    return {
      quota: { availableBytes: Math.max(0, limitBytes - usedBytes), limitBytes, usedBytes, ...scope },
      serverNow: new Date().toISOString(),
      tree: {
        entries: entryResult.rows.map(mapEntry),
        folders: folderResult.rows.map(mapFolder),
        revision: Number(revisionResult.rows[0]?.revision ?? 0),
        ...scope
      }
    };
  }

  async createFolder(scopeInput, input) {
    const scope = validateScope(scopeInput);
    const name = nodeName(input.name);
    const parentFolderId = optionalText(input.parentFolderId, 200) ?? null;
    return this.#mutation(scope, input, "create_library_folder", async (client) => {
      const folderId = `folder_${randomUUID()}`;
      const result = await client.query(`
        INSERT INTO library_folders(
          folder_id, scope_type, scope_id, parent_folder_id, name, normalized_name, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [folderId, scope.scopeType, scope.scopeId, parentFolderId, name.name, name.normalizedName, input.actorId]);
      return { folder: mapFolder(result.rows[0]) };
    });
  }

  async createMetadataEntry(scopeInput, input) {
    const scope = validateScope(scopeInput);
    const title = nodeName(input.title, "title");
    const folderId = optionalText(input.folderId, 200) ?? null;
    const metadata = {
      ...(input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : {}),
      ...(optionalText(input.doi, 300) ? { doi: optionalText(input.doi, 300) } : {}),
      ...(optionalText(input.externalUrl, 2000) ? { externalUrl: optionalText(input.externalUrl, 2000) } : {}),
      ...(optionalText(input.sourceId, 500) ? { sourceId: optionalText(input.sourceId, 500) } : {})
    };
    return this.#mutation(scope, input, "create_metadata_entry", async (client) => {
      const documentId = `document_${randomUUID()}`;
      const result = await client.query(`
        INSERT INTO library_entries(
          document_id, scope_type, scope_id, folder_id, entry_kind, file_name,
          normalized_name, title, metadata, created_by
        ) VALUES ($1, $2, $3, $4, 'metadata_only', $5, $6, $7, $8::jsonb, $9)
        RETURNING *
      `, [
        documentId, scope.scopeType, scope.scopeId, folderId, title.name,
        title.normalizedName, title.name, JSON.stringify(metadata), input.actorId
      ]);
      return { entry: mapEntry(result.rows[0]) };
    });
  }

  async updateEntry(scopeInput, input) {
    const scope = validateScope(scopeInput);
    const documentId = requiredId(input.documentId, "document");
    let literature;
    try {
      if (Object.hasOwn(input, "literature")) {
        const reference = normalizeLiteratureProjectionReference(input.literature);
        if (!this.literatureProjectionVerifier) {
          throw new LibraryRepositoryError("literature_projection_verifier_unavailable", 503);
        }
        literature = normalizeLiteratureMetadata(
          await this.literatureProjectionVerifier.verifyProjection(reference)
        );
        if (literature.literatureId !== reference.literatureId || literature.revision !== reference.revision) {
          throw new LibraryRepositoryError("literature_projection_verification_mismatch", 503);
        }
      }
    } catch (error) {
      if (error instanceof LiteratureMetadataValidationError) {
        throw new LibraryRepositoryError(error.code);
      }
      if (error?.code && error?.status) throw new LibraryRepositoryError(error.code, error.status);
      throw error;
    }
    return this.#mutation(scope, input, "update_library_entry", async (client) => {
      const current = await requireEntry(client, scope, documentId, "active");
      const folderId = Object.hasOwn(input, "folderId")
        ? optionalText(input.folderId, 200) ?? null
        : current.folder_id;
      await requireActiveTargetFolder(client, scope, folderId);
      if (literature) {
        await client.query(`
          INSERT INTO literature_record_projections(literature_id, revision, snapshot)
          VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (literature_id, revision) DO NOTHING
        `, [literature.literatureId, literature.revision, JSON.stringify(literature)]);
        const projection = await client.query(`
          SELECT snapshot = $3::jsonb AS matches
            FROM literature_record_projections
           WHERE literature_id = $1 AND revision = $2
        `, [literature.literatureId, literature.revision, JSON.stringify(literature)]);
        if (!projection.rows[0]?.matches) {
          throw new LibraryRepositoryError("literature_projection_revision_conflict", 409);
        }
        await client.query(`
          UPDATE library_entries
             SET metadata = jsonb_set(metadata, '{literature}', $2::jsonb, true),
                 updated_at = now()
           WHERE document_id = $1
        `, [documentId, JSON.stringify(literature)]);
      }
      if (current.entry_kind === "pdf") {
        const fileName = Object.hasOwn(input, "fileName") ? pdfName(input.fileName) : {
          name: current.file_name, normalizedName: current.normalized_name
        };
        const title = Object.hasOwn(input, "title") ? nodeName(input.title, "title").name : current.title;
        await client.query(`
          UPDATE library_entries
             SET folder_id = $2, file_name = $3, normalized_name = $4,
                 title = $5, updated_at = now()
           WHERE document_id = $1
        `, [documentId, folderId, fileName.name, fileName.normalizedName, title]);
      } else {
        const title = Object.hasOwn(input, "title") ? nodeName(input.title, "title") : {
          name: current.title, normalizedName: current.normalized_name
        };
        await client.query(`
          UPDATE library_entries
             SET folder_id = $2, file_name = $3, normalized_name = $4,
                 title = $3, updated_at = now()
           WHERE document_id = $1
        `, [documentId, folderId, title.name, title.normalizedName]);
      }
      return { document: mapEntry(await requireEntry(client, scope, documentId)) };
    });
  }

  async updateFolder(scopeInput, input) {
    const scope = validateScope(scopeInput);
    const folderId = requiredId(input.folderId, "folder");
    return this.#mutation(scope, input, "update_library_folder", async (client) => {
      const current = await requireFolder(client, scope, folderId, "active");
      const parentFolderId = Object.hasOwn(input, "parentFolderId")
        ? optionalText(input.parentFolderId, 200) ?? null
        : current.parent_folder_id;
      if (parentFolderId === folderId) throw new LibraryRepositoryError("library_folder_cycle", 409);
      await requireActiveTargetFolder(client, scope, parentFolderId);
      const name = Object.hasOwn(input, "name") ? nodeName(input.name) : {
        name: current.name, normalizedName: current.normalized_name
      };
      const result = await client.query(`
        UPDATE library_folders
           SET parent_folder_id = $2, name = $3, normalized_name = $4, updated_at = now()
         WHERE folder_id = $1
         RETURNING *
      `, [folderId, parentFolderId, name.name, name.normalizedName]);
      return { folder: mapFolder(result.rows[0]) };
    });
  }

  async trashEntry(scopeInput, input) {
    const scope = validateScope(scopeInput);
    const documentId = requiredId(input.documentId, "document");
    return this.#mutation(scope, input, "trash_library_entry", async (client) => {
      await requireEntry(client, scope, documentId, "active");
      await client.query(`
        UPDATE library_entries SET status = 'trashed', trashed_at = now(),
          purge_after = now() + interval '30 days', trashed_by_folder_id = NULL, updated_at = now()
        WHERE document_id = $1
      `, [documentId]);
      return { document: mapEntry(await requireEntry(client, scope, documentId)) };
    });
  }

  async restoreEntry(scopeInput, input) {
    const scope = validateScope(scopeInput);
    const documentId = requiredId(input.documentId, "document");
    return this.#mutation(scope, input, "restore_library_entry", async (client) => {
      const current = await requireEntry(client, scope, documentId, "trashed");
      let folderId = current.folder_id;
      if (folderId) {
        const parent = await requireFolder(client, scope, folderId);
        if (parent.status !== "active") folderId = null;
      }
      const name = await uniqueRestoredName(
        client, scope, folderId, current.file_name, current.entry_kind === "pdf"
      );
      await client.query(`
        UPDATE library_entries SET status = 'active', folder_id = $2,
          file_name = $3, normalized_name = $4, trashed_at = NULL,
          purge_after = NULL, trashed_by_folder_id = NULL, updated_at = now()
        WHERE document_id = $1
      `, [documentId, folderId, name.name, name.normalizedName]);
      return { document: mapEntry(await requireEntry(client, scope, documentId)) };
    });
  }

  async trashFolder(scopeInput, input) {
    const scope = validateScope(scopeInput);
    const folderId = requiredId(input.folderId, "folder");
    return this.#mutation(scope, input, "trash_library_folder", async (client) => {
      const root = await requireFolder(client, scope, folderId, "active");
      const subtree = await client.query(`
        WITH RECURSIVE nodes(folder_id) AS (
          SELECT folder_id FROM library_folders
           WHERE folder_id = $1 AND scope_type = $2 AND scope_id = $3
          UNION ALL
          SELECT child.folder_id FROM library_folders child
          JOIN nodes parent ON child.parent_folder_id = parent.folder_id
          WHERE child.scope_type = $2 AND child.scope_id = $3
        ) SELECT folder_id FROM nodes
      `, [folderId, scope.scopeType, scope.scopeId]);
      const folderIds = subtree.rows.map((row) => row.folder_id);
      await client.query(`
        UPDATE library_entries SET status = 'trashed', trashed_at = now(),
          purge_after = now() + interval '30 days', trashed_by_folder_id = $1, updated_at = now()
        WHERE scope_type = $2 AND scope_id = $3 AND folder_id = ANY($4::text[])
      `, [folderId, scope.scopeType, scope.scopeId, folderIds]);
      await client.query(`
        UPDATE library_folders SET status = 'trashed', trashed_at = now(),
          purge_after = now() + interval '30 days', trashed_by_folder_id = $1,
          original_parent_folder_id = CASE WHEN folder_id = $1 THEN parent_folder_id ELSE NULL END,
          parent_folder_id = CASE WHEN folder_id = $1 THEN NULL ELSE parent_folder_id END,
          updated_at = now()
        WHERE folder_id = ANY($2::text[])
      `, [folderId, folderIds]);
      return { folder: mapFolder(await requireFolder(client, scope, folderId)) };
    });
  }

  async restoreFolder(scopeInput, input) {
    const scope = validateScope(scopeInput);
    const folderId = requiredId(input.folderId, "folder");
    return this.#mutation(scope, input, "restore_library_folder", async (client) => {
      const root = await requireFolder(client, scope, folderId, "trashed");
      if (root.trashed_by_folder_id !== folderId) {
        throw new LibraryRepositoryError("library_folder_restore_parent_required", 409);
      }
      let parentFolderId = root.original_parent_folder_id;
      if (parentFolderId) {
        const parent = await requireFolder(client, scope, parentFolderId);
        if (parent.status !== "active") parentFolderId = null;
      }
      const name = await uniqueRestoredName(client, scope, parentFolderId, root.name);
      await client.query(`
        UPDATE library_folders SET status = 'active',
          parent_folder_id = CASE WHEN folder_id = $1 THEN $4 ELSE parent_folder_id END,
          name = CASE WHEN folder_id = $1 THEN $5 ELSE name END,
          normalized_name = CASE WHEN folder_id = $1 THEN $6 ELSE normalized_name END,
          trashed_at = NULL, purge_after = NULL, trashed_by_folder_id = NULL,
          original_parent_folder_id = NULL, updated_at = now()
        WHERE scope_type = $2 AND scope_id = $3 AND trashed_by_folder_id = $1
      `, [folderId, scope.scopeType, scope.scopeId, parentFolderId, name.name, name.normalizedName]);
      await client.query(`
        UPDATE library_entries SET status = 'active', trashed_at = NULL, purge_after = NULL,
          trashed_by_folder_id = NULL, updated_at = now()
        WHERE scope_type = $2 AND scope_id = $3 AND trashed_by_folder_id = $1
      `, [folderId, scope.scopeType, scope.scopeId]);
      return { folder: mapFolder(await requireFolder(client, scope, folderId)) };
    });
  }

  async purgeEntry(scopeInput, input) {
    const scope = validateScope(scopeInput);
    const documentId = requiredId(input.documentId, "document");
    return this.#mutation(scope, input, "purge_library_entry", async (client) => {
      await requireEntry(client, scope, documentId, "trashed");
      await client.query("DELETE FROM library_entries WHERE document_id = $1", [documentId]);
      return { result: { documentId, purged: true } };
    });
  }

  async purgeFolder(scopeInput, input) {
    const scope = validateScope(scopeInput);
    const folderId = requiredId(input.folderId, "folder");
    return this.#mutation(scope, input, "purge_library_folder", async (client) => {
      const root = await requireFolder(client, scope, folderId, "trashed");
      if (root.trashed_by_folder_id !== folderId) {
        throw new LibraryRepositoryError("library_folder_purge_parent_required", 409);
      }
      await client.query(`
        DELETE FROM library_entries
        WHERE scope_type = $2 AND scope_id = $3 AND trashed_by_folder_id = $1
      `, [folderId, scope.scopeType, scope.scopeId]);
      await client.query(`
        DELETE FROM library_folders
        WHERE scope_type = $2 AND scope_id = $3 AND trashed_by_folder_id = $1
      `, [folderId, scope.scopeType, scope.scopeId]);
      return { folder: { folderId, purged: true } };
    });
  }

  async emptyTrash(scopeInput, input) {
    const scope = validateScope(scopeInput);
    return this.#mutation(scope, input, "empty_library_trash", async (client) => {
      const entries = await client.query(`
        DELETE FROM library_entries
        WHERE scope_type = $1 AND scope_id = $2 AND status = 'trashed'
        RETURNING document_id
      `, [scope.scopeType, scope.scopeId]);
      const folders = await client.query(`
        DELETE FROM library_folders
        WHERE scope_type = $1 AND scope_id = $2 AND status = 'trashed'
        RETURNING folder_id
      `, [scope.scopeType, scope.scopeId]);
      return { purgedCount: entries.rowCount + folders.rowCount };
    });
  }

  async copyEntry(sourceScopeInput, targetScopeInput, input) {
    const sourceScope = validateScope(sourceScopeInput);
    const targetScope = validateScope(targetScopeInput);
    const documentId = requiredId(input.documentId, "document");
    const folderId = optionalText(input.folderId, 200) ?? null;
    return this.#mutation(targetScope, {
      ...input,
      sourceScope: { scopeId: sourceScope.scopeId, scopeType: sourceScope.scopeType }
    }, "copy_library_entry", async (client) => {
      const source = await requireEntry(client, sourceScope, documentId, "active");
      if (source.availability !== "available") {
        throw new LibraryRepositoryError("library_document_not_available", 409);
      }
      if (source.entry_kind === "pdf" && source.object_status !== "available") {
        throw new LibraryRepositoryError("storage_object_not_available", 409);
      }
      if (source.entry_kind === "pdf" && source.security_scan_hash !== source.content_hash) {
        throw new LibraryRepositoryError("storage_security_scan_required", 503);
      }
      await requireActiveTargetFolder(client, targetScope, folderId);
      if (source.entry_kind === "pdf") await assertQuota(client, targetScope, Number(source.byte_length));
      const name = await uniqueRestoredName(
        client, targetScope, folderId, source.file_name, source.entry_kind === "pdf"
      );
      const copiedDocumentId = `document_${randomUUID()}`;
      const result = await client.query(`
        INSERT INTO library_entries(
          document_id, scope_type, scope_id, folder_id, entry_kind, file_name,
          normalized_name, title, metadata, logical_bytes, availability, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, 'available', $11)
        RETURNING *
      `, [
        copiedDocumentId, targetScope.scopeType, targetScope.scopeId, folderId,
        source.entry_kind, name.name, name.normalizedName, source.title,
        JSON.stringify(source.metadata ?? {}), Number(source.logical_bytes), input.actorId
      ]);
      if (source.entry_kind === "pdf") {
        await client.query(`
          INSERT INTO storage_object_references(document_id, content_hash)
          VALUES ($1, $2)
        `, [copiedDocumentId, source.content_hash]);
      }
      return {
        entry: mapEntry({
          ...result.rows[0],
          byte_length: source.entry_kind === "pdf" ? source.byte_length : null,
          content_hash: source.entry_kind === "pdf" ? source.content_hash : null
        })
      };
    });
  }

  async findPdfDuplicates(scopeInput, contentHash) {
    const scope = validateScope(scopeInput);
    if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new LibraryRepositoryError("storage_content_hash_invalid");
    const result = await this.pool.query(`
      SELECT entry.*, reference.content_hash, object.byte_length
        FROM library_entries entry
        JOIN storage_object_references reference USING (document_id)
        JOIN storage_objects object ON object.content_hash = reference.content_hash
       WHERE entry.scope_type = $1 AND entry.scope_id = $2
         AND entry.status = 'active' AND entry.availability = 'available'
         AND object.security_scan_hash = object.content_hash
         AND reference.content_hash = $3
       ORDER BY entry.created_at, entry.document_id
    `, [scope.scopeType, scope.scopeId, contentHash]);
    return result.rows.map(mapEntry);
  }

  async getDownloadablePdf(scopeInput, documentId) {
    const scope = validateScope(scopeInput);
    if (typeof documentId !== "string" || !documentId) throw new LibraryRepositoryError("library_document_invalid");
    const result = await this.pool.query(`
      SELECT entry.document_id, entry.file_name, entry.title, entry.metadata,
             reference.content_hash, object.byte_length, object.media_type, object.storage_key,
             COALESCE((
               SELECT revision FROM library_scope_revisions
                WHERE scope_type = entry.scope_type AND scope_id = entry.scope_id
             ), 0) AS scope_revision
        FROM library_entries entry
        JOIN storage_object_references reference USING (document_id)
        JOIN storage_objects object ON object.content_hash = reference.content_hash
       WHERE entry.document_id = $1
         AND entry.scope_type = $2 AND entry.scope_id = $3
         AND entry.entry_kind = 'pdf' AND entry.status = 'active'
         AND entry.availability = 'available' AND object.status = 'available'
         AND object.security_scan_hash = object.content_hash
    `, [documentId, scope.scopeType, scope.scopeId]);
    const row = result.rows[0];
    if (!row) throw new LibraryRepositoryError("library_document_not_found", 404);
    return {
      byteLength: Number(row.byte_length),
      contentHash: row.content_hash,
      documentId: row.document_id,
      fileName: row.file_name,
      mediaType: row.media_type,
      metadata: row.metadata ?? {},
      revision: Number(row.scope_revision),
      storageKey: row.storage_key,
      title: row.title
    };
  }

  async recordDocumentAccess(scopeInput, input) {
    const scope = validateScope(scopeInput);
    if (!new Set(["download_pdf", "export_pdf", "authorize_pdf_read", "support_document_accessed"]).has(input.action)) {
      throw new LibraryRepositoryError("library_audit_action_invalid", 500);
    }
    const supportAccess = input.action === "support_document_accessed";
    if (supportAccess && (
      typeof input.supportGrantId !== "string" ||
      typeof input.reason !== "string" ||
      !input.reason.trim()
    )) throw new LibraryRepositoryError("support_access_audit_invalid", 500);
    await this.pool.query(`
      INSERT INTO audit_events(
        audit_id, actor_id, actor_audience, action, resource_type,
        resource_id, scope_type, scope_id, reason, trace_id, detail
      ) VALUES ($1, $2, $3, $4, 'library_document', $5, $6, $7, $8, $9, $10::jsonb)
    `, [
      `audit_${randomUUID()}`, input.actorId, supportAccess ? "liteasy-admin" : "liteasy-desktop",
      input.action, input.documentId, scope.scopeType, scope.scopeId,
      supportAccess ? input.reason.trim() : null, input.traceId,
      JSON.stringify(supportAccess ? { supportGrantId: input.supportGrantId } : {})
    ]);
  }

  async preparePdfUpload(scopeInput, input, staged) {
    const scope = validateScope(scopeInput);
    const fileName = pdfName(input.fileName);
    const expected = expectedRevision(input.expectedRevision);
    const key = idempotencyKey(input.idempotencyKey);
    if (!Number.isSafeInteger(staged.byteLength) || staged.byteLength <= 0 || !/^[a-f0-9]{64}$/.test(staged.contentHash)) {
      throw new LibraryRepositoryError("storage_staged_object_invalid");
    }
    const scan = securityScanProof(staged);
    const title = fileName.name.replace(/\.pdf$/i, "");
    const hash = requestHash({
      byteLength: staged.byteLength,
      contentHash: staged.contentHash,
      expectedRevision: expected,
      fileName: fileName.name,
      folderId: input.folderId ?? null,
      operation: "upload_pdf",
      scope
    });
    try {
      return await withPostgresTransaction(this.pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${input.actorId}:upload_pdf:${key}`
        ]);
        const completed = await client.query(`
          SELECT request_hash, response_body FROM idempotency_records
           WHERE actor_id = $1 AND operation = 'upload_pdf'
             AND idempotency_key = $2 AND expires_at > now()
        `, [input.actorId, key]);
        if (completed.rows[0]) {
          if (completed.rows[0].request_hash !== hash) throw new LibraryRepositoryError("idempotency_key_reused", 409);
          return { kind: "complete", response: completed.rows[0].response_body };
        }
        const priorWorkflow = await client.query(`
          SELECT * FROM storage_publish_workflows
           WHERE actor_id = $1 AND operation = 'upload_pdf' AND idempotency_key = $2
        `, [input.actorId, key]);
        if (priorWorkflow.rows[0]) {
          if (priorWorkflow.rows[0].request_hash !== hash) throw new LibraryRepositoryError("idempotency_key_reused", 409);
          let workflow = priorWorkflow.rows[0];
          if (!workflow.security_scanned_at) {
            const updated = await client.query(`
              UPDATE storage_publish_workflows
                 SET security_scanned_at = $2, security_scanner = $3,
                     security_scanner_version = $4, security_scan_hash = $5,
                     updated_at = now()
               WHERE workflow_id = $1
               RETURNING *
            `, [workflow.workflow_id, scan.scannedAt, scan.scanner, scan.version, scan.contentHash]);
            workflow = updated.rows[0];
          } else {
            storedSecurityScanProof(workflow);
          }
          return { kind: "workflow", workflow };
        }

        await lockScopeRevision(client, scope, expected);
        await assertQuota(client, scope, staged.byteLength);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`storage:${staged.contentHash}`]);
        const existingObject = await client.query(
          "SELECT * FROM storage_objects WHERE content_hash = $1",
          [staged.contentHash]
        );
        if (existingObject.rows[0] && existingObject.rows[0].status !== "available") {
          throw new LibraryRepositoryError("storage_object_pending", 409);
        }

        const documentId = `document_${randomUUID()}`;
        const availability = existingObject.rows[0]?.status === "available" ? "available" : "pending";
        if (!existingObject.rows[0]) {
          await client.query(`
            INSERT INTO storage_objects(
              content_hash, byte_length, storage_key, media_type, checksum_verified_at,
              status, staging_key, security_scanned_at, security_scanner,
              security_scanner_version, security_scan_hash
            ) VALUES ($1, $2, $3, 'application/pdf', now(), 'staging', $4, $5, $6, $7, $8)
          `, [
            staged.contentHash, staged.byteLength, input.finalKey, staged.storageKey,
            scan.scannedAt, scan.scanner, scan.version, scan.contentHash
          ]);
        } else if (Number(existingObject.rows[0].byte_length) !== staged.byteLength) {
          throw new LibraryRepositoryError("storage_existing_object_integrity_mismatch", 500);
        } else {
          await client.query(`
            UPDATE storage_objects
               SET security_scanned_at = $2, security_scanner = $3,
                   security_scanner_version = $4, security_scan_hash = $5,
                   updated_at = now()
             WHERE content_hash = $1
          `, [staged.contentHash, scan.scannedAt, scan.scanner, scan.version, scan.contentHash]);
        }
        const entryResult = await client.query(`
          INSERT INTO library_entries(
            document_id, scope_type, scope_id, folder_id, entry_kind, file_name,
            normalized_name, title, logical_bytes, created_by, availability
          ) VALUES ($1, $2, $3, $4, 'pdf', $5, $6, $7, $8, $9, $10)
          RETURNING *
        `, [
          documentId, scope.scopeType, scope.scopeId, input.folderId ?? null,
          fileName.name, fileName.normalizedName, title, staged.byteLength,
          input.actorId, availability
        ]);
        await client.query(
          "INSERT INTO storage_object_references(document_id, content_hash) VALUES ($1, $2)",
          [documentId, staged.contentHash]
        );
        const revision = await bumpScopeRevision(client, scope);
        const response = {
          document: mapEntry({
            ...entryResult.rows[0],
            byte_length: staged.byteLength,
            content_hash: staged.contentHash
          }),
          duplicates: [],
          revision,
          status: "imported"
        };
        if (availability === "available") {
          await this.#recordCompletedMutation(client, {
            actorId: input.actorId,
            hash,
            idempotencyKey: key,
            operation: "upload_pdf",
            response,
            scope,
            traceId: input.traceId
          });
          return { kind: "complete", response };
        }

        const workflowId = `workflow_${randomUUID()}`;
        await client.query(`
          INSERT INTO storage_publish_workflows(
            workflow_id, actor_id, operation, idempotency_key, request_hash,
            scope_type, scope_id, document_id, content_hash, staging_key,
            final_key, byte_length, security_scanned_at, security_scanner,
            security_scanner_version, security_scan_hash, response_body, state
          ) VALUES (
            $1, $2, 'upload_pdf', $3, $4, $5, $6, $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16::jsonb,
            'database_committed'
          )
        `, [
          workflowId, input.actorId, key, hash, scope.scopeType, scope.scopeId,
          documentId, staged.contentHash, staged.storageKey, input.finalKey,
          staged.byteLength, scan.scannedAt, scan.scanner, scan.version,
          scan.contentHash, JSON.stringify(response)
        ]);
        return {
          kind: "workflow",
          workflow: {
            actor_id: input.actorId,
            byte_length: staged.byteLength,
            content_hash: staged.contentHash,
            document_id: documentId,
            final_key: input.finalKey,
            idempotency_key: key,
            request_hash: hash,
            response_body: response,
            scope_id: scope.scopeId,
            scope_type: scope.scopeType,
            security_scan_hash: scan.contentHash,
            security_scanned_at: scan.scannedAt,
            security_scanner: scan.scanner,
            security_scanner_version: scan.version,
            staging_key: staged.storageKey,
            state: "database_committed",
            workflow_id: workflowId
          }
        };
      }, { isolation: "READ COMMITTED" });
    } catch (error) {
      throw translateConstraint(error);
    }
  }

  async prepareMetadataPdfAttachment(scopeInput, input, staged) {
    const scope = validateScope(scopeInput);
    const documentId = requiredId(input.documentId, "document");
    const fileName = pdfName(input.fileName);
    const expected = expectedRevision(input.expectedRevision);
    const key = idempotencyKey(input.idempotencyKey);
    if (!Number.isSafeInteger(staged.byteLength) || staged.byteLength <= 0 || !/^[a-f0-9]{64}$/.test(staged.contentHash)) {
      throw new LibraryRepositoryError("storage_staged_object_invalid");
    }
    const scan = securityScanProof(staged);
    const operation = "attach_metadata_pdf";
    const hash = requestHash({
      byteLength: staged.byteLength,
      contentHash: staged.contentHash,
      documentId,
      expectedRevision: expected,
      fileName: fileName.name,
      operation,
      scope
    });
    try {
      return await withPostgresTransaction(this.pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${input.actorId}:${operation}:${key}`
        ]);
        const completed = await client.query(`
          SELECT request_hash, response_body FROM idempotency_records
           WHERE actor_id = $1 AND operation = $2
             AND idempotency_key = $3 AND expires_at > now()
        `, [input.actorId, operation, key]);
        if (completed.rows[0]) {
          if (completed.rows[0].request_hash !== hash) throw new LibraryRepositoryError("idempotency_key_reused", 409);
          return { kind: "complete", response: completed.rows[0].response_body };
        }
        const priorWorkflow = await client.query(`
          SELECT * FROM storage_publish_workflows
           WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3
        `, [input.actorId, operation, key]);
        if (priorWorkflow.rows[0]) {
          if (priorWorkflow.rows[0].request_hash !== hash) throw new LibraryRepositoryError("idempotency_key_reused", 409);
          let workflow = priorWorkflow.rows[0];
          if (!workflow.security_scanned_at) {
            const updated = await client.query(`
              UPDATE storage_publish_workflows
                 SET security_scanned_at = $2, security_scanner = $3,
                     security_scanner_version = $4, security_scan_hash = $5,
                     updated_at = now()
               WHERE workflow_id = $1
               RETURNING *
            `, [workflow.workflow_id, scan.scannedAt, scan.scanner, scan.version, scan.contentHash]);
            workflow = updated.rows[0];
          } else {
            storedSecurityScanProof(workflow);
          }
          return { kind: "workflow", workflow };
        }

        await lockScopeRevision(client, scope, expected);
        const entry = await requireEntry(client, scope, documentId, "active");
        if (entry.entry_kind !== "metadata_only") {
          throw new LibraryRepositoryError("library_entry_already_has_pdf", 409);
        }
        await assertQuota(client, scope, staged.byteLength);
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`storage:${staged.contentHash}`]);
        const existingObject = await client.query(
          "SELECT * FROM storage_objects WHERE content_hash = $1",
          [staged.contentHash]
        );
        if (existingObject.rows[0] && existingObject.rows[0].status !== "available") {
          throw new LibraryRepositoryError("storage_object_pending", 409);
        }
        const availability = existingObject.rows[0]?.status === "available" ? "available" : "pending";
        if (!existingObject.rows[0]) {
          await client.query(`
            INSERT INTO storage_objects(
              content_hash, byte_length, storage_key, media_type, checksum_verified_at,
              status, staging_key, security_scanned_at, security_scanner,
              security_scanner_version, security_scan_hash
            ) VALUES ($1, $2, $3, 'application/pdf', now(), 'staging', $4, $5, $6, $7, $8)
          `, [
            staged.contentHash, staged.byteLength, input.finalKey, staged.storageKey,
            scan.scannedAt, scan.scanner, scan.version, scan.contentHash
          ]);
        } else if (Number(existingObject.rows[0].byte_length) !== staged.byteLength) {
          throw new LibraryRepositoryError("storage_existing_object_integrity_mismatch", 500);
        } else {
          await client.query(`
            UPDATE storage_objects
               SET security_scanned_at = $2, security_scanner = $3,
                   security_scanner_version = $4, security_scan_hash = $5,
                   updated_at = now()
             WHERE content_hash = $1
          `, [staged.contentHash, scan.scannedAt, scan.scanner, scan.version, scan.contentHash]);
        }
        const updated = await client.query(`
          UPDATE library_entries
             SET entry_kind = 'pdf', file_name = $2, normalized_name = $3,
                 logical_bytes = $4, availability = $5, updated_at = now()
           WHERE document_id = $1
           RETURNING *
        `, [documentId, fileName.name, fileName.normalizedName, staged.byteLength, availability]);
        await client.query(
          "INSERT INTO storage_object_references(document_id, content_hash) VALUES ($1, $2)",
          [documentId, staged.contentHash]
        );
        const revision = await bumpScopeRevision(client, scope);
        const response = {
          entry: mapEntry({
            ...updated.rows[0],
            byte_length: staged.byteLength,
            content_hash: staged.contentHash
          }),
          revision
        };
        if (availability === "available") {
          await this.#recordCompletedMutation(client, {
            actorId: input.actorId,
            hash,
            idempotencyKey: key,
            operation,
            response,
            scope,
            traceId: input.traceId
          });
          return { kind: "complete", response };
        }

        const workflowId = `workflow_${randomUUID()}`;
        await client.query(`
          INSERT INTO storage_publish_workflows(
            workflow_id, actor_id, operation, idempotency_key, request_hash,
            scope_type, scope_id, document_id, content_hash, staging_key,
            final_key, byte_length, security_scanned_at, security_scanner,
            security_scanner_version, security_scan_hash, response_body, state
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17::jsonb,
            'database_committed')
        `, [
          workflowId, input.actorId, operation, key, hash, scope.scopeType, scope.scopeId,
          documentId, staged.contentHash, staged.storageKey, input.finalKey,
          staged.byteLength, scan.scannedAt, scan.scanner, scan.version,
          scan.contentHash, JSON.stringify(response)
        ]);
        return { kind: "workflow", workflow: {
          actor_id: input.actorId,
          byte_length: staged.byteLength,
          content_hash: staged.contentHash,
          document_id: documentId,
          final_key: input.finalKey,
          idempotency_key: key,
          request_hash: hash,
          response_body: response,
          scope_id: scope.scopeId,
          scope_type: scope.scopeType,
          security_scan_hash: scan.contentHash,
          security_scanned_at: scan.scannedAt,
          security_scanner: scan.scanner,
          security_scanner_version: scan.version,
          staging_key: staged.storageKey,
          state: "database_committed",
          workflow_id: workflowId
        } };
      }, { isolation: "READ COMMITTED" });
    } catch (error) {
      throw translateConstraint(error);
    }
  }

  async completePdfUpload(workflowInput, traceId) {
    return withPostgresTransaction(this.pool, async (client) => {
      const result = await client.query(
        "SELECT * FROM storage_publish_workflows WHERE workflow_id = $1 FOR UPDATE",
        [workflowInput.workflow_id]
      );
      const workflow = result.rows[0];
      if (!workflow) throw new LibraryRepositoryError("storage_workflow_missing", 404);
      if (workflow.state === "completed") return workflow.response_body;
      if (workflow.state !== "object_published") {
        throw new LibraryRepositoryError("storage_object_not_published", 503);
      }
      const scan = storedSecurityScanProof(workflow);
      const object = await client.query(`
        UPDATE storage_objects
           SET status = 'available', staging_key = NULL,
               security_scanned_at = $3, security_scanner = $4,
               security_scanner_version = $5, security_scan_hash = $6,
               updated_at = now()
         WHERE content_hash = $1 AND storage_key = $2
         RETURNING content_hash
      `, [
        workflow.content_hash, workflow.final_key, scan.scannedAt,
        scan.scanner, scan.version, scan.contentHash
      ]);
      if (!object.rows[0]) throw new LibraryRepositoryError("storage_workflow_object_missing", 503);
      await client.query(`
        UPDATE library_entries SET availability = 'available', updated_at = now()
        WHERE document_id = $1
      `, [workflow.document_id]);
      await this.#recordCompletedMutation(client, {
        actorId: workflow.actor_id,
        hash: workflow.request_hash,
        idempotencyKey: workflow.idempotency_key,
        operation: workflow.operation,
        response: workflow.response_body,
        scope: { scopeId: workflow.scope_id, scopeType: workflow.scope_type },
        traceId
      });
      await client.query(`
        UPDATE storage_publish_workflows
           SET state = 'completed', error_code = NULL, updated_at = now()
         WHERE workflow_id = $1
      `, [workflow.workflow_id]);
      return workflow.response_body;
    }, { isolation: "READ COMMITTED" });
  }

  async markPdfObjectPublished(workflowId) {
    const result = await this.pool.query(`
      UPDATE storage_publish_workflows
         SET state = 'object_published', error_code = NULL, updated_at = now()
       WHERE workflow_id = $1 AND state <> 'completed'
         AND security_scanned_at IS NOT NULL
         AND security_scan_hash = content_hash
       RETURNING workflow_id
    `, [workflowId]);
    if (!result.rows[0]) throw new LibraryRepositoryError("storage_security_scan_required", 503);
  }

  async recordPdfSecurityScan(workflowId, proofInput) {
    return withPostgresTransaction(this.pool, async (client) => {
      const result = await client.query(`
        SELECT * FROM storage_publish_workflows
         WHERE workflow_id = $1 AND state <> 'completed'
         FOR UPDATE
      `, [workflowId]);
      const workflow = result.rows[0];
      if (!workflow) throw new LibraryRepositoryError("storage_workflow_missing", 404);
      const proof = securityScanProof({ contentHash: workflow.content_hash, securityScan: proofInput });
      const updated = await client.query(`
        UPDATE storage_publish_workflows
           SET security_scanned_at = $2, security_scanner = $3,
               security_scanner_version = $4, security_scan_hash = $5,
               updated_at = now()
         WHERE workflow_id = $1
         RETURNING *
      `, [workflowId, proof.scannedAt, proof.scanner, proof.version, proof.contentHash]);
      await client.query(`
        UPDATE storage_objects
           SET security_scanned_at = $2, security_scanner = $3,
               security_scanner_version = $4, security_scan_hash = $5,
               updated_at = now()
         WHERE content_hash = $1
      `, [workflow.content_hash, proof.scannedAt, proof.scanner, proof.version, proof.contentHash]);
      return updated.rows[0];
    }, { isolation: "READ COMMITTED" });
  }

  async listUnverifiedPdfObjects(limit = 100) {
    const boundedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
    const result = await this.pool.query(`
      SELECT content_hash, byte_length, media_type, storage_key
        FROM storage_objects
       WHERE status = 'available' AND security_scanned_at IS NULL
       ORDER BY created_at, content_hash
       LIMIT $1
    `, [boundedLimit]);
    return result.rows;
  }

  async countUnverifiedPdfObjects() {
    const result = await this.pool.query(`
      SELECT count(*) AS count
        FROM storage_objects
       WHERE status = 'available' AND security_scanned_at IS NULL
    `);
    return Number(result.rows[0].count);
  }

  async recordObjectSecurityScan(contentHash, proofInput) {
    if (!/^[a-f0-9]{64}$/.test(contentHash)) {
      throw new LibraryRepositoryError("storage_content_hash_invalid");
    }
    const proof = securityScanProof({ contentHash, securityScan: proofInput });
    const result = await this.pool.query(`
      UPDATE storage_objects
         SET security_scanned_at = $2, security_scanner = $3,
             security_scanner_version = $4, security_scan_hash = $5,
             updated_at = now()
       WHERE content_hash = $1 AND status = 'available'
       RETURNING content_hash
    `, [contentHash, proof.scannedAt, proof.scanner, proof.version, proof.contentHash]);
    if (!result.rows[0]) throw new LibraryRepositoryError("storage_object_not_available", 409);
  }

  async listRecoverablePdfUploads(limit = 100) {
    const boundedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
    const result = await this.pool.query(`
      SELECT * FROM storage_publish_workflows
       WHERE state <> 'completed'
       ORDER BY updated_at, workflow_id
       LIMIT $1
    `, [boundedLimit]);
    return result.rows;
  }

  async markPdfUploadRepairRequired(workflowId, code) {
    await this.pool.query(`
      UPDATE storage_publish_workflows
         SET state = 'repair_required', error_code = $2, updated_at = now()
       WHERE workflow_id = $1 AND state <> 'completed'
    `, [workflowId, String(code).slice(0, 100)]);
  }

  async purgeExpiredTrash() {
    return withPostgresTransaction(this.pool, async (client) => {
      const scopes = await client.query(`
        SELECT DISTINCT scope_type, scope_id FROM (
          SELECT scope_type, scope_id FROM library_entries
           WHERE status = 'trashed' AND purge_after <= now()
          UNION
          SELECT scope_type, scope_id FROM library_folders
           WHERE status = 'trashed' AND purge_after <= now()
        ) expired
        ORDER BY scope_type, scope_id
      `);
      let purgedCount = 0;
      for (const scope of scopes.rows) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `scope:${scope.scope_type}:${scope.scope_id}`
        ]);
        const entries = await client.query(`
          DELETE FROM library_entries
           WHERE scope_type = $1 AND scope_id = $2
             AND status = 'trashed' AND purge_after <= now()
          RETURNING document_id
        `, [scope.scope_type, scope.scope_id]);
        const folders = await client.query(`
          DELETE FROM library_folders
           WHERE scope_type = $1 AND scope_id = $2
             AND status = 'trashed' AND purge_after <= now()
          RETURNING folder_id
        `, [scope.scope_type, scope.scope_id]);
        const count = entries.rowCount + folders.rowCount;
        if (count === 0) continue;
        purgedCount += count;
        await client.query(`
          INSERT INTO library_scope_revisions(scope_type, scope_id, revision)
          VALUES ($1, $2, 1)
          ON CONFLICT (scope_type, scope_id) DO UPDATE
            SET revision = library_scope_revisions.revision + 1, updated_at = now()
        `, [scope.scope_type, scope.scope_id]);
        await client.query(`
          INSERT INTO audit_events(
            audit_id, actor_id, actor_audience, action, resource_type,
            resource_id, scope_type, scope_id, trace_id, detail
          ) VALUES ($1, 'storage-maintenance', 'service', 'purge_expired_library_trash',
            'library_scope', $2, $3, $4, $5, $6::jsonb)
        `, [
          `audit_${randomUUID()}`, `${scope.scope_type}:${scope.scope_id}`,
          scope.scope_type, scope.scope_id, `trace_${randomUUID()}`, JSON.stringify({ purgedCount: count })
        ]);
      }
      return { purgedCount, scopes: scopes.rowCount };
    });
  }

  async claimUnreferencedObjects(limit = 100) {
    const boundedLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
    return withPostgresTransaction(this.pool, async (client) => {
      const result = await client.query(`
        SELECT object.content_hash, object.storage_key
          FROM storage_objects object
         WHERE object.status IN ('available', 'deleting')
           AND NOT EXISTS (
             SELECT 1 FROM storage_object_references reference
              WHERE reference.content_hash = object.content_hash
           )
         ORDER BY object.updated_at, object.content_hash
         FOR UPDATE OF object SKIP LOCKED
         LIMIT $1
      `, [boundedLimit]);
      for (const object of result.rows) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `storage:${object.content_hash}`
        ]);
      }
      if (result.rows.length > 0) {
        await client.query(`
          UPDATE storage_objects SET status = 'deleting', updated_at = now()
          WHERE content_hash = ANY($1::text[])
        `, [result.rows.map((row) => row.content_hash)]);
      }
      return result.rows;
    });
  }

  async completeObjectGarbageCollection(contentHash) {
    if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new LibraryRepositoryError("storage_content_hash_invalid");
    const result = await this.pool.query(`
      DELETE FROM storage_objects object
       WHERE object.content_hash = $1 AND object.status = 'deleting'
         AND NOT EXISTS (
           SELECT 1 FROM storage_object_references reference
            WHERE reference.content_hash = object.content_hash
         )
      RETURNING content_hash
    `, [contentHash]);
    if (result.rowCount !== 1) throw new LibraryRepositoryError("storage_gc_state_changed", 409);
  }

  async #mutation(scope, input, operation, mutate) {
    const expected = expectedRevision(input.expectedRevision);
    const key = idempotencyKey(input.idempotencyKey);
    const { actorId: _actorId, traceId: _traceId, ...requestInput } = input;
    const hash = requestHash({ operation, scope, input: requestInput });
    try {
      return await withPostgresTransaction(this.pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${input.actorId}:${operation}:${key}`
        ]);
        const prior = await client.query(`
          SELECT request_hash, response_status, response_body
            FROM idempotency_records
           WHERE actor_id = $1 AND operation = $2 AND idempotency_key = $3 AND expires_at > now()
        `, [input.actorId, operation, key]);
        if (prior.rows[0]) {
          if (prior.rows[0].request_hash !== hash) throw new LibraryRepositoryError("idempotency_key_reused", 409);
          return prior.rows[0].response_body;
        }
        await lockScopeRevision(client, scope, expected);
        const response = await mutate(client);
        response.revision = await bumpScopeRevision(client, scope);
        await this.#recordCompletedMutation(client, {
          actorId: input.actorId,
          auditDetail: input.documentId
            ? { documentId: input.documentId, operation }
            : { operation },
          hash,
          idempotencyKey: key,
          operation,
          response,
          scope,
          traceId: input.traceId
        });
        return response;
      }, { isolation: "READ COMMITTED" });
    } catch (error) {
      throw translateConstraint(error);
    }
  }

  async #recordCompletedMutation(client, input) {
    await client.query(`
      INSERT INTO idempotency_records(
        actor_id, operation, idempotency_key, request_hash, response_status,
        response_body, expires_at
      ) VALUES ($1, $2, $3, $4, 200, $5::jsonb, now() + interval '24 hours')
      ON CONFLICT (actor_id, operation, idempotency_key) DO NOTHING
    `, [input.actorId, input.operation, input.idempotencyKey, input.hash, JSON.stringify(input.response)]);
    await client.query(`
      INSERT INTO audit_events(
        audit_id, actor_id, actor_audience, action, resource_type,
        resource_id, scope_type, scope_id, trace_id, detail
      ) VALUES ($1, $2, 'liteasy-desktop', $3, 'library_scope', $4, $5, $6, $7, $8::jsonb)
    `, [
      `audit_${randomUUID()}`, input.actorId, input.operation,
      `${input.scope.scopeType}:${input.scope.scopeId}`, input.scope.scopeType, input.scope.scopeId,
      input.traceId ?? `trace_${randomUUID()}`, JSON.stringify(input.auditDetail ?? {})
    ]);
  }
}
