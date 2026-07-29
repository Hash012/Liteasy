import { readJsonFile, writeJsonFile } from "./jsonFileStore.mjs";

const recommendationCandidateFilename = "recommendation-candidates.json";
const maximumCandidatesPerUser = 1000;
const defaultCandidateMaxAgeMs = 30 * 24 * 60 * 60 * 1000;

function readState() {
  return readJsonFile(recommendationCandidateFilename, {});
}

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
    scoreComponents: candidate.scoreComponents,
    source: candidate.source,
    sourceUrl: candidate.sourceUrl,
    status: existing?.status || "candidate",
    title: candidate.title
  };
}

export function listRecommendationCandidates(userId) {
  const state = readState();
  return Array.isArray(state[userId]) ? state[userId] : [];
}

export function listRecommendationCandidateSources(userId, relatedDocumentTitle, options = {}) {
  const normalizedRelatedTitle = String(relatedDocumentTitle ?? "").trim().toLowerCase();
  const now = options.now instanceof Date ? options.now.getTime() : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs)
    ? Math.max(0, options.maxAgeMs)
    : defaultCandidateMaxAgeMs;
  return listRecommendationCandidates(userId)
    .filter((candidate) => {
      const lastDiscoveredAt = Date.parse(candidate.lastDiscoveredAt);
      return candidate.status === "candidate" &&
        Number.isFinite(lastDiscoveredAt) &&
        now - lastDiscoveredAt <= maxAgeMs &&
        candidate.relatedDocumentTitles.some((title) => title.trim().toLowerCase() === normalizedRelatedTitle);
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
}

export function upsertRecommendationCandidates(userId, candidates, now = new Date()) {
  const state = readState();
  const current = Array.isArray(state[userId]) ? state[userId] : [];
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
  state[userId] = [...byKey.values()]
    .sort((left, right) => right.lastDiscoveredAt.localeCompare(left.lastDiscoveredAt))
    .slice(0, maximumCandidatesPerUser);
  writeJsonFile(recommendationCandidateFilename, state);
  return updated;
}

export function updateRecommendationCandidateStatus(userId, candidate, action, now = new Date()) {
  const state = readState();
  const current = Array.isArray(state[userId]) ? state[userId] : [];
  const key = candidateKey(candidate);
  let updated;
  state[userId] = current.map((record) => {
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
    writeJsonFile(recommendationCandidateFilename, state);
  }
  return updated;
}

export function resetRecommendationCandidateData() {
  writeJsonFile(recommendationCandidateFilename, {});
  return { reset: true };
}
