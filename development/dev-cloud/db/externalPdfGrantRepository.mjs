import { randomUUID } from "node:crypto";

const defaultGrantLifetimeMs = 15 * 60 * 1000;

function normalizeOwnerKey(value) {
  const ownerKey = typeof value === "string" ? value.trim() : "";
  if (!/^user:[A-Za-z0-9._-]{1,180}$/.test(ownerKey)) {
    throw new Error("external_pdf_grant_owner_invalid");
  }
  return ownerKey;
}

function normalizeSourceId(value) {
  const sourceId = typeof value === "string" ? value.trim() : "";
  if (!/^[^\s\u0000-\u001f\u007f]{1,300}$/.test(sourceId)) {
    throw new Error("external_pdf_source_invalid");
  }
  return sourceId;
}

function normalizeGrantId(value) {
  const grantId = typeof value === "string" ? value.trim() : "";
  if (!/^pdfgrant_[A-Za-z0-9-]{1,100}$/.test(grantId)) {
    throw new Error("external_pdf_grant_invalid");
  }
  return grantId;
}

function normalizeSourceUrl(value) {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new Error("external_pdf_source_url_invalid");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("external_pdf_source_url_invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("external_pdf_source_url_invalid");
  }
  url.hash = "";
  return url.toString();
}

function resolveNow(now) {
  const value = typeof now === "function" ? now() : now;
  return value instanceof Date ? value : new Date();
}

export function createExternalPdfGrantRepository(database, options = {}) {
  const grantLifetimeMs = Number.isFinite(options.grantLifetimeMs)
    ? Math.max(1_000, Math.min(60 * 60 * 1000, Math.floor(options.grantLifetimeMs)))
    : defaultGrantLifetimeMs;
  const insertGrant = database.prepare(`
    INSERT INTO external_pdf_grants(
      grant_id, owner_key, source_id, source_url, created_at, expires_at
    ) VALUES (@grantId, @ownerKey, @sourceId, @sourceUrl, @createdAt, @expiresAt)
  `);
  const loadGrant = database.prepare(`
    SELECT source_id, source_url
      FROM external_pdf_grants
     WHERE grant_id = ? AND owner_key = ? AND source_id = ? AND expires_at > ?
  `);
  const purgeExpired = database.prepare("DELETE FROM external_pdf_grants WHERE expires_at <= ?");

  return {
    issue(ownerKeyInput, input) {
      const ownerKey = normalizeOwnerKey(ownerKeyInput);
      const sourceId = normalizeSourceId(input?.sourceId);
      const sourceUrl = normalizeSourceUrl(input?.sourceUrl);
      const now = resolveNow(options.now);
      const createdAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + grantLifetimeMs).toISOString();
      purgeExpired.run(createdAt);
      const grantId = `pdfgrant_${randomUUID()}`;
      insertGrant.run({ createdAt, expiresAt, grantId, ownerKey, sourceId, sourceUrl });
      return { expiresAt, grantId, sourceId, sourceUrl };
    },

    load(ownerKeyInput, input) {
      const ownerKey = normalizeOwnerKey(ownerKeyInput);
      const grantId = normalizeGrantId(input?.grantId);
      const sourceId = normalizeSourceId(input?.sourceId);
      const now = resolveNow(options.now).toISOString();
      purgeExpired.run(now);
      const row = loadGrant.get(grantId, ownerKey, sourceId, now);
      return row ? { sourceId: row.source_id, sourceUrl: row.source_url } : null;
    },

    purgeExpired() {
      return purgeExpired.run(resolveNow(options.now).toISOString()).changes;
    }
  };
}
