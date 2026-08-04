const maximumCandidatesPerUser = 1000;
const defaultCandidateMaxAgeMs = 30 * 24 * 60 * 60 * 1000;

function candidateKey(candidate) {
  return candidate.canonicalId || candidate.candidateId || candidate.id;
}

function candidateAliases(candidate) {
  return new Set([
    candidateKey(candidate),
    ...(Array.isArray(candidate?.identityResolution?.aliases)
      ? candidate.identityResolution.aliases
      : [])
  ].filter(Boolean));
}

function candidatesShareIdentity(left, right) {
  const leftAliases = candidateAliases(left);
  return [...candidateAliases(right)].some((alias) => leftAliases.has(alias));
}

function candidateRecord(candidate, existing, now) {
  const discoveredAt = candidate.discoveredAt || now.toISOString();
  const relatedDocumentTitles = [...new Set([
    candidate.relatedDocumentTitle,
    ...(Array.isArray(candidate.relatedDocumentTitles) ? candidate.relatedDocumentTitles : []),
    ...(Array.isArray(existing?.relatedDocumentTitles) ? existing.relatedDocumentTitles : [])
  ].filter((title) => typeof title === "string" && title.trim().length > 0))].slice(0, 12);
  return {
    ...(typeof candidate.abstract === "string" ? { abstract: candidate.abstract } : {}),
    ...(Array.isArray(candidate.authors) ? { authors: candidate.authors } : {}),
    canonicalId: candidate.canonicalId,
    candidateId: candidate.id,
    discoveryCount: (Number.isInteger(existing?.discoveryCount) ? existing.discoveryCount : 0) + 1,
    firstDiscoveredAt: existing?.firstDiscoveredAt || discoveredAt,
    ...(candidate.externalReranker ? { externalReranker: candidate.externalReranker } : {}),
    ...(candidate.identityResolution ? { identityResolution: candidate.identityResolution } : {}),
    lastDiscoveredAt: discoveredAt,
    ...(candidate.openAccessAvailable === true ? { openAccessAvailable: true } : {}),
    ...(Number.isInteger(candidate.publishedYear) ? { publishedYear: candidate.publishedYear } : {}),
    qualityGate: candidate.qualityGate,
    ...(candidate.rankingFusion ? { rankingFusion: candidate.rankingFusion } : {}),
    ...(candidate.primaryProvider ? { primaryProvider: candidate.primaryProvider } : {}),
    ...(candidate.relation ? { relation: candidate.relation } : {}),
    reason: candidate.reason,
    relevanceBand: candidate.relevanceBand,
    relevanceScore: candidate.relevanceScore,
    relatedDocumentTitles,
    ...(Array.isArray(candidate.surfacingTags) ? { surfacingTags: candidate.surfacingTags } : {}),
    scoreComponents: candidate.scoreComponents,
    source: candidate.source,
    sourceKind: candidate.sourceKind,
    sourceUrl: candidate.sourceUrl,
    status: existing?.status || "candidate",
    title: candidate.title
  };
}

let singleton = null;

export function setRecommendationCandidateRepository(repository) {
  singleton = repository;
}

export function createRecommendationCandidateRepository(database) {
  const insertRow = database.prepare(`
    INSERT INTO recommendation_candidates (owner_key, canonical_id, status, last_discovered_at, document_json)
    VALUES (@ownerKey, @canonicalId, @status, @lastDiscoveredAt, @documentJson)
    ON CONFLICT(owner_key, canonical_id) DO UPDATE SET
      status = excluded.status,
      last_discovered_at = excluded.last_discovered_at,
      document_json = excluded.document_json
  `);
  const deleteForUser = database.prepare(`DELETE FROM recommendation_candidates WHERE owner_key = ?`);
  const listRowsForUser = database.prepare(`
    SELECT document_json FROM recommendation_candidates
    WHERE owner_key = ? ORDER BY last_discovered_at DESC
  `);
  const countForUser = database.prepare(`SELECT COUNT(*) AS total FROM recommendation_candidates WHERE owner_key = ?`);

  function loadAll(userId) {
    return listRowsForUser.all(userId).map((row) => JSON.parse(row.document_json));
  }

  function persistAll(userId, records) {
    const sorted = [...records]
      .sort((left, right) => right.lastDiscoveredAt.localeCompare(left.lastDiscoveredAt))
      .slice(0, maximumCandidatesPerUser);
    const replaceAll = database.transaction(() => {
      deleteForUser.run(userId);
      for (const record of sorted) {
        insertRow.run({
          canonicalId: candidateKey(record),
          documentJson: JSON.stringify(record),
          lastDiscoveredAt: record.lastDiscoveredAt,
          ownerKey: userId,
          status: record.status || "candidate"
        });
      }
    });
    replaceAll();
    return sorted;
  }

  return {
    clearForUser(userId) {
      const cleared = countForUser.get(userId)?.total ?? 0;
      deleteForUser.run(userId);
      return cleared;
    },

    list(userId) {
      return loadAll(userId);
    },

    listSources(userId, relatedDocumentTitle, options = {}) {
      const normalizedRelatedTitle = String(relatedDocumentTitle ?? "").trim().toLowerCase();
      const now = options.now instanceof Date ? options.now.getTime() : Date.now();
      const maxAgeMs = Number.isFinite(options.maxAgeMs)
        ? Math.max(0, options.maxAgeMs)
        : defaultCandidateMaxAgeMs;
      return loadAll(userId)
        .filter((candidate) => {
          const lastDiscoveredAt = Date.parse(candidate.lastDiscoveredAt);
          return candidate.status === "candidate" &&
            Number.isFinite(lastDiscoveredAt) &&
            now - lastDiscoveredAt <= maxAgeMs &&
            candidate.relatedDocumentTitles.some(
              (title) => title.trim().toLowerCase() === normalizedRelatedTitle
            );
        })
        .map((candidate) => ({
          ...(typeof candidate.abstract === "string" ? { abstract: candidate.abstract } : {}),
          ...(Array.isArray(candidate.authors) ? { authors: candidate.authors } : {}),
          ...(candidate.identityResolution?.canonicalId
            ? { canonicalPaperId: candidate.identityResolution.canonicalId }
            : {}),
          ...(candidate.identityResolution?.arxivId
            ? { arxivId: candidate.identityResolution.arxivId }
            : {}),
          discoveredAt: candidate.lastDiscoveredAt,
          ...(candidate.identityResolution?.doi ? { doi: candidate.identityResolution.doi } : {}),
          id: candidate.canonicalId,
          ...(candidate.openAccessAvailable === true ? { openAccessAvailable: true } : {}),
          provider: candidate.primaryProvider ?? candidate.identityResolution?.providers?.[0] ??
            candidate.source.toLowerCase(),
          ...(candidate.relation ? { relation: candidate.relation } : {}),
          relevance: candidate.scoreComponents?.sourceRelevance ?? candidate.relevanceScore,
          title: candidate.title,
          url: candidate.sourceUrl,
          ...(Array.isArray(candidate.identityResolution?.records)
            ? { sourceRecords: candidate.identityResolution.records }
            : {}),
          ...(Number.isInteger(candidate.publishedYear) ? { year: candidate.publishedYear } : {}),
          fromCandidatePool: true
        }));
    },

    resetAll() {
      database.exec("DELETE FROM recommendation_candidates");
      return { reset: true };
    },

    updateStatus(userId, candidate, action, now = new Date()) {
      const current = loadAll(userId);
      let updated;
      const next = current.map((record) => {
        if (!candidatesShareIdentity(record, candidate)) {
          return record;
        }
        updated = {
          ...record,
          feedbackAt: now.toISOString(),
          status: action
        };
        return updated;
      });
      if (updated) {
        persistAll(userId, next);
      }
      return updated;
    },

    upsert(userId, candidates, now = new Date()) {
      const current = loadAll(userId);
      const byKey = new Map(current.map((candidate) => [candidateKey(candidate), candidate]));
      const updated = [];
      for (const candidate of Array.isArray(candidates) ? candidates : []) {
        const key = candidateKey(candidate);
        if (!key || candidate?.qualityGate?.passed !== true) {
          continue;
        }
        const existing = [...byKey.values()].find((record) => candidatesShareIdentity(record, candidate));
        const record = candidateRecord(candidate, existing, now);
        if (existing && candidateKey(existing) !== key) {
          byKey.delete(candidateKey(existing));
        }
        byKey.set(key, record);
        updated.push(record);
      }
      persistAll(userId, [...byKey.values()]);
      return updated;
    }
  };
}

// Backward-compatible module-level wrappers. Delegate to the singleton registered
// by createDevCloudRequestHandler at startup, so existing call sites (requestHandler,
// payloads, admin reset, tests) keep working without per-call database plumbing.
function requireSingleton() {
  if (!singleton) {
    throw new Error("recommendation_candidate_repository_not_initialized");
  }
  return singleton;
}

export function listRecommendationCandidates(userId) {
  return requireSingleton().list(userId);
}

export function listRecommendationCandidateSources(userId, relatedDocumentTitle, options) {
  return requireSingleton().listSources(userId, relatedDocumentTitle, options);
}

export function upsertRecommendationCandidates(userId, candidates, now) {
  return requireSingleton().upsert(userId, candidates, now);
}

export function updateRecommendationCandidateStatus(userId, candidate, action, now) {
  return requireSingleton().updateStatus(userId, candidate, action, now);
}

export function clearRecommendationCandidatesForUser(userId) {
  return requireSingleton().clearForUser(userId);
}

export function resetRecommendationCandidateData() {
  return requireSingleton().resetAll();
}

export function __resetRecommendationCandidateRepository() {
  singleton = null;
}
