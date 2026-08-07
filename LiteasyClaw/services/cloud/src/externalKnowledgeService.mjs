import { createHash, randomUUID } from "node:crypto";
import { withPostgresTransaction } from "./postgres.mjs";
import { ExternalRetrievalError } from "./externalRetrievalConnectors.mjs";

const retrievalCacheCapacityPerSubject = 100;

function exactFields(value, allowed, code) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ExternalRetrievalError(code);
  }
}

function requiredText(value, minimum, maximum, code) {
  if (typeof value !== "string") throw new ExternalRetrievalError(code);
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new ExternalRetrievalError(code);
  }
  return normalized;
}

function searchInput(value) {
  exactFields(value, new Set([
    "anchorReferences", "artifactId", "includeArxiv", "includeExpandedSources",
    "includeOpenAlex", "limit", "query", "queryVariants", "targetPaperIdentity",
    "targetPaperTitle"
  ]), "external_retrieval_request_invalid");
  const artifactId = requiredText(value.artifactId, 1, 120, "external_retrieval_artifact_invalid");
  if (!/^[A-Za-z0-9._-]+$/.test(artifactId)) {
    throw new ExternalRetrievalError("external_retrieval_artifact_invalid");
  }
  const query = requiredText(value.query, 2, 2000, "external_retrieval_query_invalid");
  const limit = value.limit === undefined ? 12 : value.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32) {
    throw new ExternalRetrievalError("external_retrieval_limit_invalid");
  }
  for (const field of ["includeArxiv", "includeExpandedSources", "includeOpenAlex"]) {
    if (value[field] !== undefined && typeof value[field] !== "boolean") {
      throw new ExternalRetrievalError("external_retrieval_request_invalid");
    }
  }
  if (value.queryVariants !== undefined && (
    !Array.isArray(value.queryVariants) || value.queryVariants.length > 2 ||
    value.queryVariants.some((item) => typeof item !== "string" || item.trim().length < 2 || item.length > 2000)
  )) {
    throw new ExternalRetrievalError("external_retrieval_query_invalid");
  }
  if (value.anchorReferences !== undefined) {
    if (!Array.isArray(value.anchorReferences) || value.anchorReferences.length > 50) {
      throw new ExternalRetrievalError("external_retrieval_anchor_invalid");
    }
    for (const reference of value.anchorReferences) {
      exactFields(reference, new Set(["number", "text"]), "external_retrieval_anchor_invalid");
      if (!Number.isSafeInteger(reference.number) || reference.number < 1 || reference.number > 100_000 ||
        typeof reference.text !== "string" || reference.text.trim().length < 1 || reference.text.length > 2000) {
        throw new ExternalRetrievalError("external_retrieval_anchor_invalid");
      }
    }
  }
  if (value.targetPaperTitle !== undefined) {
    requiredText(value.targetPaperTitle, 1, 1000, "external_retrieval_target_invalid");
  }
  if (value.targetPaperIdentity !== undefined) {
    exactFields(value.targetPaperIdentity, new Set(["kind", "value"]), "external_retrieval_target_invalid");
    requiredText(value.targetPaperIdentity.kind, 1, 50, "external_retrieval_target_invalid");
    requiredText(value.targetPaperIdentity.value, 1, 500, "external_retrieval_target_invalid");
  }
  return { artifactId, limit, query };
}

function downloadInput(value) {
  exactFields(value, new Set(["grantId", "sourceId"]), "external_pdf_request_invalid");
  const grantId = requiredText(value.grantId, 1, 200, "external_pdf_grant_invalid");
  const sourceId = requiredText(value.sourceId, 1, 300, "external_pdf_source_invalid");
  if (!/^pdfgrant_[A-Za-z0-9-]+$/.test(grantId) || !/^[A-Za-z0-9._:/-]+$/.test(sourceId)) {
    throw new ExternalRetrievalError("external_pdf_request_invalid");
  }
  return { grantId, sourceId };
}

function deduplicate(candidates, limit) {
  const seen = new Set();
  return candidates
    .sort((left, right) => right.source.relevance - left.source.relevance || left.source.id.localeCompare(right.source.id))
    .filter(({ source }) => {
      const key = source.doi?.toLowerCase() ?? source.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function retrievalCacheKey(input, sources) {
  return createHash("sha256").update(JSON.stringify({
    limit: input.limit,
    query: input.query,
    sources: sources.map((source) => ({
      baseUrl: source.baseUrl,
      connectorType: source.connectorType,
      revision: source.revision,
      sourceId: source.sourceId
    }))
  })).digest("hex");
}

function cachedCandidates(value, configuredSources) {
  if (!value || typeof value !== "object" || !Array.isArray(value.items)) return null;
  const configuredIds = new Set(configuredSources.map((source) => source.sourceId));
  if (value.items.some((item) => !item || typeof item !== "object" ||
    typeof item.connectorSourceId !== "string" || !configuredIds.has(item.connectorSourceId) ||
    !item.source || typeof item.source !== "object" || typeof item.source.id !== "string")) {
    return null;
  }
  return value.items;
}

export class PostgresExternalKnowledgeRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async listEnabledSources() {
    const result = await this.pool.query(`
      SELECT source_id, connector_type, base_url, revision
        FROM platform_retrieval_sources
       WHERE enabled = true AND connector_type IS NOT NULL
       ORDER BY connector_type, source_id
    `);
    return result.rows.map((row) => ({
      baseUrl: row.base_url,
      connectorType: row.connector_type,
      revision: Number(row.revision),
      sourceId: row.source_id
    }));
  }

  async issuePdfGrants(subjectId, sources) {
    return withPostgresTransaction(this.pool, async (client) => {
      const grants = new Map();
      for (const { connectorSourceId, source } of sources) {
        if (!source.fullTextUrl) continue;
        const grantId = `pdfgrant_${randomUUID()}`;
        await client.query(`
          INSERT INTO external_retrieval_pdf_grants(
            grant_id, subject_id, source_id, source_record_id, connector_source_id,
            connector_type, source_url, expires_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '15 minutes')
        `, [
          grantId, subjectId, source.id, source.sourceId, connectorSourceId,
          source.provider, source.fullTextUrl
        ]);
        grants.set(source.id, grantId);
      }
      return grants;
    });
  }

  async issueRecommendationPdfGrant(subjectId, source) {
    return withPostgresTransaction(this.pool, async (client) => {
      const configured = await client.query(`
        SELECT source_id FROM platform_retrieval_sources
         WHERE connector_type = $1 AND enabled = true
         FOR SHARE
      `, [source.connectorType]);
      if (!configured.rows[0]) return null;
      const grantId = `pdfgrant_${randomUUID()}`;
      await client.query(`
        INSERT INTO external_retrieval_pdf_grants(
          grant_id, subject_id, source_id, source_record_id, connector_source_id,
          connector_type, source_url, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '15 minutes')
      `, [
        grantId,
        subjectId,
        source.sourceId,
        source.sourceRecordId,
        configured.rows[0].source_id,
        source.connectorType,
        source.sourceUrl
      ]);
      return grantId;
    });
  }

  async loadPdfGrant(subjectId, input) {
    const result = await this.pool.query(`
      SELECT source_id, source_url
        FROM external_retrieval_pdf_grants
       WHERE grant_id = $1 AND subject_id = $2 AND source_id = $3 AND expires_at > now()
    `, [input.grantId, subjectId, input.sourceId]);
    if (!result.rows[0]) throw new ExternalRetrievalError("external_pdf_grant_not_found", 404);
    return { sourceId: result.rows[0].source_id, url: result.rows[0].source_url };
  }

  async loadRetrievalCache(subjectId, cacheKey) {
    const result = await this.pool.query(`
      UPDATE external_retrieval_cache
         SET last_accessed_at = now()
       WHERE subject_id = $1 AND cache_key = $2 AND expires_at > now()
      RETURNING payload
    `, [subjectId, cacheKey]);
    return result.rows[0]?.payload ?? null;
  }

  async saveRetrievalCache(subjectId, cacheKey, items) {
    await withPostgresTransaction(this.pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `external_retrieval_cache:${subjectId}`
      ]);
      await client.query(`
        INSERT INTO external_retrieval_cache(
          subject_id, cache_key, payload, expires_at, last_accessed_at
        ) VALUES ($1, $2, $3::jsonb, now() + interval '1 hour', now())
        ON CONFLICT (subject_id, cache_key) DO UPDATE
          SET payload = EXCLUDED.payload,
              expires_at = EXCLUDED.expires_at,
              created_at = now(),
              last_accessed_at = now()
      `, [subjectId, cacheKey, JSON.stringify({ items })]);
      await client.query(`
        WITH surplus AS (
          SELECT cache_key
            FROM external_retrieval_cache
           WHERE subject_id = $1
           ORDER BY last_accessed_at DESC, created_at DESC, cache_key DESC
          OFFSET $2
             FOR UPDATE
        )
        DELETE FROM external_retrieval_cache cache
         USING surplus
         WHERE cache.subject_id = $1 AND cache.cache_key = surplus.cache_key
      `, [subjectId, retrievalCacheCapacityPerSubject]);
    });
  }

  async purgeExpiredRetrievalData(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new ExternalRetrievalError("external_retrieval_maintenance_limit_invalid");
    }
    return withPostgresTransaction(this.pool, async (client) => {
      const grants = await client.query(`
        WITH expired AS (
          SELECT grant_id
            FROM external_retrieval_pdf_grants
           WHERE expires_at <= now()
           ORDER BY expires_at, grant_id
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        DELETE FROM external_retrieval_pdf_grants pdf_grant
         USING expired
         WHERE pdf_grant.grant_id = expired.grant_id
        RETURNING pdf_grant.grant_id
      `, [limit]);
      const cache = await client.query(`
        WITH expired AS (
          SELECT subject_id, cache_key
            FROM external_retrieval_cache
           WHERE expires_at <= now()
           ORDER BY expires_at, subject_id, cache_key
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        DELETE FROM external_retrieval_cache cache
         USING expired
         WHERE cache.subject_id = expired.subject_id AND cache.cache_key = expired.cache_key
        RETURNING cache.cache_key
      `, [limit]);
      return { pdfGrants: grants.rowCount, retrievalCacheEntries: cache.rowCount };
    });
  }
}

export class ExternalKnowledgeService {
  constructor({ connectors, downloader, repository }) {
    this.connectors = connectors;
    this.downloader = downloader;
    this.repository = repository;
  }

  async search(principal, value, signal) {
    const input = searchInput(value);
    const configuredSources = await this.repository.listEnabledSources();
    if (configuredSources.length === 0) {
      throw new ExternalRetrievalError("external_retrieval_unavailable", 503);
    }
    const cacheKey = retrievalCacheKey(input, configuredSources);
    const cached = cachedCandidates(
      await this.repository.loadRetrievalCache(principal.subjectId, cacheKey),
      configuredSources
    );
    const selectedCandidates = cached ?? await (async () => {
      const attempts = await Promise.allSettled(configuredSources.map(async (source) => {
      const connector = this.connectors[source.connectorType];
      if (typeof connector !== "function") {
        throw new ExternalRetrievalError("external_retrieval_source_invalid", 503);
      }
      return {
        connectorSourceId: source.sourceId,
        sources: await connector(source, { ...input, signal })
      };
      }));
      const completed = attempts.filter((result) => result.status === "fulfilled").map((result) => result.value);
      if (completed.length === 0) {
        throw new ExternalRetrievalError("external_retrieval_unavailable", 503);
      }
      const candidates = completed.flatMap((result) => result.sources.map((source) => ({
        connectorSourceId: result.connectorSourceId,
        source
      })));
      const selected = deduplicate(candidates, input.limit);
      await this.repository.saveRetrievalCache(principal.subjectId, cacheKey, selected);
      return selected;
    })();
    const grants = await this.repository.issuePdfGrants(
      principal.subjectId,
      selectedCandidates
    );
    return {
      retrieval: {
        attempts: configuredSources.length,
        id: `retrieval_${randomUUID()}`,
        reused: cached !== null,
        status: "completed"
      },
      sources: selectedCandidates.map(({ source }) => ({
        ...source,
        ...(grants.has(source.id) ? { fullTextGrantId: grants.get(source.id) } : {})
      }))
    };
  }

  async download(principal, value, signal) {
    const input = downloadInput(value);
    const grant = await this.repository.loadPdfGrant(principal.subjectId, input);
    const downloaded = await this.downloader.download(grant.url, signal);
    return {
      byteLength: downloaded.byteLength,
      bytesBase64: downloaded.bytes.toString("base64"),
      contentHash: downloaded.contentHash,
      contentType: downloaded.contentType,
      finalUrl: downloaded.finalUrl,
      sourceId: grant.sourceId
    };
  }
}
