import { randomUUID } from "node:crypto";

function normalizeText(value, maximum = 2000) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function normalizedName(value) {
  return normalizeText(value).normalize("NFKC").toLocaleLowerCase("en-US");
}

function publicItem(row) {
  let metadata = {};
  try { metadata = JSON.parse(row.metadata_json); } catch { metadata = {}; }
  return {
    doi: row.doi ?? undefined,
    externalUrl: row.external_url ?? undefined,
    folderId: row.folder_id ?? undefined,
    id: row.source_id ?? row.document_id,
    reason: typeof metadata.reason === "string" ? metadata.reason : "",
    savedAt: typeof metadata.savedAt === "string" ? metadata.savedAt : row.created_at,
    source: typeof metadata.source === "string" ? metadata.source : "",
    status: row.status,
    title: row.title
  };
}

export function createCollectionRepository(database, options = {}) {
  const now = () => options.now?.() ?? new Date();

  function bump(ownerKey, timestamp) {
    database.prepare(`
      INSERT INTO library_scope_revisions (scope_type, scope_id, revision, updated_at)
      VALUES ('user', ?, 1, ?)
      ON CONFLICT(scope_type, scope_id) DO UPDATE SET
        revision = library_scope_revisions.revision + 1,
        updated_at = excluded.updated_at
    `).run(ownerKey, timestamp);
  }

  return {
    list(ownerKey, status = "active") {
      const normalizedStatus = status === "trashed" ? "trashed" : "active";
      return database.prepare(`
        SELECT * FROM library_metadata_entries
        WHERE scope_type = 'user' AND scope_id = ? AND status = ?
        ORDER BY created_at DESC, document_id
      `).all(ownerKey, normalizedStatus).map(publicItem);
    },

    save(ownerKey, item) {
      const itemId = normalizeText(item?.id, 500);
      const title = normalizeText(item?.title, 500);
      if (!ownerKey || !itemId || !title) throw new Error("invalid_collection_item");
      const timestamp = now().toISOString();
      const existing = database.prepare(`
        SELECT document_id FROM library_metadata_entries
        WHERE scope_type = 'user' AND scope_id = ? AND source_id = ?
        LIMIT 1
      `).get(ownerKey, itemId);
      const documentId = existing?.document_id ?? randomUUID();
      database.transaction(() => {
        database.prepare(`
          INSERT INTO library_metadata_entries (
            document_id, scope_type, scope_id, folder_id, title, normalized_title,
            doi, external_url, source_id, created_by, status, created_at, updated_at,
            trashed_at, purge_after, metadata_json
          ) VALUES (?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL, NULL, ?)
          ON CONFLICT(document_id) DO UPDATE SET
            folder_id = excluded.folder_id,
            title = excluded.title,
            normalized_title = excluded.normalized_title,
            doi = excluded.doi,
            external_url = excluded.external_url,
            source_id = excluded.source_id,
            status = 'active',
            updated_at = excluded.updated_at,
            trashed_at = NULL,
            purge_after = NULL,
            metadata_json = excluded.metadata_json
        `).run(
          documentId,
          ownerKey,
          normalizeText(item.folderId, 180) || null,
          title,
          normalizedName(title),
          normalizeText(item.doi, 300) || null,
          normalizeText(item.externalUrl, 2000) || null,
          itemId,
          ownerKey,
          timestamp,
          timestamp,
          JSON.stringify({
            reason: normalizeText(item.reason),
            savedAt: Number.isFinite(Date.parse(item.savedAt)) ? item.savedAt : timestamp,
            source: normalizeText(item.source, 500)
          })
        );
        bump(ownerKey, timestamp);
      })();
      return this.list(ownerKey);
    },

    trash(ownerKey, itemId) {
      const timestamp = now();
      const result = database.prepare(`
        UPDATE library_metadata_entries SET status = 'trashed', trashed_at = ?,
          purge_after = ?, updated_at = ?
        WHERE scope_type = 'user' AND scope_id = ? AND source_id = ? AND status = 'active'
      `).run(
        timestamp.toISOString(),
        new Date(timestamp.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        timestamp.toISOString(),
        ownerKey,
        itemId
      );
      if (result.changes === 0) throw new Error("collection_item_not_found");
      bump(ownerKey, timestamp.toISOString());
      return true;
    }
  };
}
