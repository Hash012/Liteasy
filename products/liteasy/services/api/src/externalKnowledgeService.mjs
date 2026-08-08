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

function normalizeDoi(value) {
  const normalized = typeof value === "string" ? value.normalize("NFKC").trim()
    .replace(/^doi:\s*/i, "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase() : "";
  return /^10\.\d{4,9}\/[^\s\u0000-\u001f\u007f]+$/.test(normalized) ? normalized : "";
}

function normalizeRelationIdentity(value) {
  const raw = typeof value === "string" ? value.normalize("NFKC").trim() : "";
  const doi = normalizeDoi(raw);
  if (doi) return `doi:${doi}`;
  const openAlex = raw.match(/^(?:https?:\/\/openalex\.org\/|openalex:)?(W\d+)$/i);
  if (openAlex) return `openalex:${openAlex[1].toUpperCase()}`;
  const semantic = raw.match(/^(?:https?:\/\/(?:www\.)?semanticscholar\.org\/paper\/|semantic_scholar:|semanticscholar:)([^\s/]+)$/i);
  return semantic ? `semantic_scholar:${semantic[1].toLowerCase()}` : raw.toLowerCase();
}

function normalizeRelationSource(provider, value) {
  const raw = requiredText(value, 1, 512, "external_retrieval_relation_paper_invalid");
  if (provider === "openalex") return normalizeRelationIdentity(raw).replace(/^openalex:/, "");
  if (provider === "semantic_scholar") {
    const normalized = normalizeRelationIdentity(raw);
    return (normalized.startsWith("semantic_scholar:") ? normalized : normalizeRelationIdentity(`semantic_scholar:${raw}`)).replace(/^semantic_scholar:/, "");
  }
  if (provider === "crossref") return normalizeDoi(raw);
  return raw.toLowerCase();
}

function relationPaperAliases(paper) {
  return [...new Set([
    paper.canonicalPaperId,
    paper.doi ? `doi:${paper.doi}` : null,
    `${paper.provider}:${paper.sourceId}`
  ].filter(Boolean))].sort();
}

function validateRelationNamespaces(paper) {
  if (!paper.canonicalPaperId) return;
  if (paper.canonicalPaperId.startsWith("doi:") &&
    (paper.doi && paper.canonicalPaperId !== `doi:${paper.doi}` || paper.provider === "crossref" && paper.canonicalPaperId !== `doi:${paper.sourceId}`)) {
    throw new ExternalRetrievalError("external_retrieval_relation_identity_conflict");
  }
  if (paper.canonicalPaperId.startsWith("openalex:") &&
    (paper.provider !== "openalex" || paper.canonicalPaperId !== `openalex:${paper.sourceId}`)) {
    throw new ExternalRetrievalError("external_retrieval_relation_identity_conflict");
  }
  if (paper.canonicalPaperId.startsWith("semantic_scholar:") &&
    (paper.provider !== "semantic_scholar" || paper.canonicalPaperId !== `semantic_scholar:${paper.sourceId}`)) {
    throw new ExternalRetrievalError("external_retrieval_relation_identity_conflict");
  }
}

function relationInput(value) {
  exactFields(value, new Set(["artifactId", "papers"]), "external_retrieval_relation_request_invalid");
  const artifactId = requiredText(value.artifactId, 1, 256, "external_retrieval_relation_request_invalid");
  if (!/^[A-Za-z0-9._-]+$/.test(artifactId) || !Array.isArray(value.papers) || value.papers.length === 0) {
    throw new ExternalRetrievalError("external_retrieval_relation_request_invalid");
  }
  const papers = value.papers.map((paper) => {
    exactFields(paper, new Set(["canonicalPaperId", "doi", "id", "provider", "sourceId"]), "external_retrieval_relation_paper_invalid");
    const id = requiredText(paper.id, 1, 512, "external_retrieval_relation_paper_invalid");
    const provider = requiredText(paper.provider, 1, 64, "external_retrieval_relation_paper_invalid").toLowerCase();
    const sourceId = normalizeRelationSource(provider, paper.sourceId);
    if (!/^[a-z0-9_-]+$/.test(provider)) throw new ExternalRetrievalError("external_retrieval_relation_paper_invalid");
    const canonicalPaperId = paper.canonicalPaperId === undefined ? undefined : normalizeRelationIdentity(requiredText(paper.canonicalPaperId, 1, 512, "external_retrieval_relation_paper_invalid"));
    const doi = paper.doi === undefined ? undefined : normalizeDoi(paper.doi);
    if (!sourceId || paper.doi !== undefined && !doi || paper.canonicalPaperId !== undefined && !canonicalPaperId) throw new ExternalRetrievalError("external_retrieval_relation_paper_invalid");
    const normalized = { id, provider, sourceId, ...(canonicalPaperId ? { canonicalPaperId } : {}), ...(doi ? { doi } : {}) };
    validateRelationNamespaces(normalized);
    return { ...normalized, aliases: relationPaperAliases(normalized) };
  });
  const parent = papers.map((_, index) => index);
  const find = (index) => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const firstByAlias = new Map();
  papers.forEach((paper, index) => paper.aliases.forEach((alias) => {
    const first = firstByAlias.get(alias);
    if (first === undefined) firstByAlias.set(alias, index);
    else { const left = find(first); const right = find(index); if (left !== right) parent[Math.max(left, right)] = Math.min(left, right); }
  }));
  const grouped = new Map();
  papers.forEach((paper, index) => { const root = find(index); grouped.set(root, [...(grouped.get(root) ?? []), paper]); });
  const components = [...grouped.values()].map((records) => {
    const canonicals = new Set(records.map((paper) => paper.canonicalPaperId).filter(Boolean));
    const dois = new Set(records.map((paper) => paper.doi).filter(Boolean));
    const sources = new Map();
    records.forEach((paper) => sources.set(paper.provider, new Set([...(sources.get(paper.provider) ?? []), paper.sourceId])));
    if (canonicals.size > 1 || dois.size > 1 || [...sources.values()].some((values) => values.size > 1)) throw new ExternalRetrievalError("external_retrieval_relation_identity_conflict");
    const representative = [...records].sort((left, right) => {
      const a = `${left.id}\0${left.provider}\0${left.sourceId}`; const b = `${right.id}\0${right.provider}\0${right.sourceId}`;
      return a < b ? -1 : a > b ? 1 : 0;
    })[0];
    return { ...representative, aliases: [...new Set(records.flatMap((paper) => paper.aliases))].sort() };
  });
  if (components.length > 24) throw new ExternalRetrievalError("external_retrieval_relation_limit_invalid");
  return { artifactId, papers: components.sort((a, b) => stableCompareText(a.aliases[0], b.aliases[0]) || stableCompareText(a.id, b.id)), retrievalPapers: papers };
}

function relationCacheKey(input, sources) {
  return `relations:${createHash("sha256").update(JSON.stringify({
    papers: input.papers,
    sources: sources.map(({ baseUrl, connectorType, revision, sourceId }) => ({ baseUrl, connectorType, revision, sourceId }))
  })).digest("hex")}`;
}

function validEvidenceUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function stableCompareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEdges(left, right) {
  return stableCompareText(left.sourcePaperId, right.sourcePaperId) ||
    stableCompareText(left.targetPaperId, right.targetPaperId) || stableCompareText(left.kind, right.kind) ||
    stableCompareText(left.provider, right.provider) || stableCompareText(left.evidenceRecordUrls.join("\0"), right.evidenceRecordUrls.join("\0"));
}

function sanitizeEdges(edges, papers) {
  const requestedIds = new Set(papers.map((paper) => paper.id));
  const selected = new Map();
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge || typeof edge !== "object" || !requestedIds.has(edge.sourcePaperId) ||
      !requestedIds.has(edge.targetPaperId) || edge.sourcePaperId === edge.targetPaperId ||
      !["openalex", "semantic_scholar"].includes(edge.provider) ||
      !Number.isFinite(edge.strength) || edge.strength < 0 || edge.strength > 1) continue;
    const directed = edge.kind === "direct_citation";
    if (!["direct_citation", "bibliographic_coupling", "co_cited"].includes(edge.kind) ||
      edge.directed !== directed) continue;
    const evidenceRecordUrls = [...new Set((Array.isArray(edge.evidenceRecordUrls) ? edge.evidenceRecordUrls : [])
      .map(validEvidenceUrl).filter(Boolean))].sort();
    if (evidenceRecordUrls.length === 0) continue;
    const normalized = {
      directed,
      evidenceRecordUrls,
      kind: edge.kind,
      provider: edge.provider,
      sourcePaperId: edge.sourcePaperId,
      strength: edge.strength,
      targetPaperId: edge.targetPaperId
    };
    const pair = directed ? `${edge.sourcePaperId}>${edge.targetPaperId}` : [edge.sourcePaperId, edge.targetPaperId].sort().join("~");
    const key = `${edge.kind}:${pair}`;
    const current = selected.get(key);
    if (!current || normalized.strength > current.strength ||
      normalized.strength === current.strength && compareEdges(normalized, current) < 0) selected.set(key, normalized);
  }
  return [...selected.values()].sort(compareEdges);
}

function relationCached(value, papers) {
  const payload = value?.items && typeof value.items === "object" ? value.items : value;
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.edges) || !Array.isArray(payload.warnings)) return null;
  return {
    edges: sanitizeEdges(payload.edges, papers),
    warnings: [...new Set(payload.warnings.filter((warning) => typeof warning === "string" && warning.length <= 120))].sort()
  };
}

function deriveRelations(papers, records) {
  const requested = new Map(papers.flatMap((paper) => paper.aliases.map((alias) => [alias.toLowerCase(), paper])));
  const normalizedRecords = records.filter((record) => record && typeof record.id === "string" &&
    ["openalex", "semantic_scholar"].includes(record.provider) && validEvidenceUrl(record.evidenceRecordUrl) &&
    record.id.toLowerCase().startsWith(`${record.provider}:`) && requested.has(normalizeRelationIdentity(record.id).toLowerCase())).map((record) => ({
      ...record,
      owner: requested.get(normalizeRelationIdentity(record.id).toLowerCase()),
      evidenceRecordUrl: validEvidenceUrl(record.evidenceRecordUrl),
      referencedPaperIds: Array.isArray(record.referencedPaperIds) ? record.referencedPaperIds.filter((id) => typeof id === "string").map(normalizeRelationIdentity).filter(Boolean) : [],
      citingPaperIds: Array.isArray(record.citingPaperIds) ? record.citingPaperIds.filter((id) => typeof id === "string").map(normalizeRelationIdentity).filter(Boolean) : []
    }));
  const edges = [];
  const add = (source, target, kind, strength, evidenceRecordUrls, provider, directed) => {
    if (!source || !target || source.id === target.id) return;
    edges.push({ directed, evidenceRecordUrls, kind, provider, sourcePaperId: source.id, strength, targetPaperId: target.id });
  };
  for (const record of normalizedRecords) {
    const source = record.owner;
    const refs = new Set((record.referencedPaperIds ?? []).map((id) => String(id).toLowerCase()));
    for (const targetAlias of refs) {
      const target = requested.get(targetAlias);
      if (target) add(source, target, "direct_citation", 1, [record.evidenceRecordUrl], record.provider, true);
    }
  }
  for (let i = 0; i < normalizedRecords.length; i += 1) for (let j = i + 1; j < normalizedRecords.length; j += 1) {
    const l = normalizedRecords[i]; const r = normalizedRecords[j];
    const left = l.owner; const right = r.owner;
    if (left.id === right.id || l.provider !== r.provider) continue;
    const shared = new Set((l.referencedPaperIds ?? []).map(String));
    const overlap = (r.referencedPaperIds ?? []).filter((id) => shared.has(String(id))).length;
    if (overlap > 0) add(left, right, "bibliographic_coupling", overlap / Math.max(1, Math.min(l.referencedPaperIds.length, r.referencedPaperIds.length)), [l.evidenceRecordUrl, r.evidenceRecordUrl], l.provider, false);
    const co = new Set((l.citingPaperIds ?? []).map(String));
    const coCount = (r.citingPaperIds ?? []).filter((id) => co.has(String(id))).length;
    if (coCount > 0) add(left, right, "co_cited", coCount / Math.max(1, Math.min(l.citingPaperIds.length, r.citingPaperIds.length)), [l.evidenceRecordUrl, r.evidenceRecordUrl], l.provider, false);
  }
  return sanitizeEdges(edges, papers);
}

function throwIfAborted(signal, errors = []) {
  const aborted = signal?.aborted || errors.some((error) => error?.name === "AbortError");
  if (!aborted) return;
  if (signal?.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted", "AbortError");
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

  async relations(principal, value, signal) {
    const input = relationInput(value);
    throwIfAborted(signal);
    const configuredSources = await this.repository.listEnabledSources();
    throwIfAborted(signal);
    const relationSources = configuredSources.filter((source) => ["openalex", "semantic_scholar"].includes(source.connectorType));
    if (relationSources.length === 0) throw new ExternalRetrievalError("external_retrieval_unavailable", 503);
    const configuredConnectors = new Set(relationSources.map((source) => source.connectorType));
    if (input.retrievalPapers.some((paper) => !["openalex", "semantic_scholar"].includes(paper.provider) || !configuredConnectors.has(paper.provider))) {
      throw new ExternalRetrievalError("external_retrieval_source_invalid", 503);
    }
    const requestedProviders = new Set(input.retrievalPapers.map((paper) => paper.provider));
    const requestedSources = relationSources.filter((source) => requestedProviders.has(source.connectorType));
    const cacheKey = relationCacheKey(input, requestedSources);
    const cached = relationCached(await this.repository.loadRetrievalCache(principal.subjectId, cacheKey), input.papers);
    throwIfAborted(signal);
    if (cached) return cached;
    const attempts = await Promise.allSettled(requestedSources.map(async (source) => {
      const connector = this.connectors[source.connectorType];
      const relationConnector = this.connectors.relations ?? (typeof connector === "function"
        ? (connector.relations ?? connector)
        : connector?.relations);
      if (typeof relationConnector !== "function") throw new ExternalRetrievalError("external_retrieval_source_invalid", 503);
      return relationConnector(source, { papers: input.retrievalPapers, signal });
    }));
    throwIfAborted(signal, attempts.filter((result) => result.status === "rejected").map((result) => result.reason));
    const fulfilled = attempts.filter((result) => result.status === "fulfilled").map((result) => result.value);
    const records = fulfilled.flatMap((value) => Array.isArray(value) ? value : (value?.records ?? []));
    const warnings = [...new Set([
      ...(attempts.some((result) => result.status === "rejected") ? ["paper_relation_provider_unavailable"] : []),
      ...fulfilled.flatMap((value) => Array.isArray(value?.warnings) ? value.warnings : [])
        .filter((warning) => typeof warning === "string" && warning.length <= 120)
    ])].sort();
    const result = { edges: deriveRelations(input.papers, records), warnings };
    if (records.length > 0 || warnings.length === 0) await this.repository.saveRetrievalCache(principal.subjectId, cacheKey, result);
    return result;
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
