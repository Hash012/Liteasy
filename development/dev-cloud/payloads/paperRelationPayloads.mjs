import { fetchWithConfiguredProxy } from "../providers/proxyFetch.mjs";

const maximumPapers = 24;
const validGraphProviders = new Set(["openalex", "semantic_scholar"]);
const requestFields = new Set(["artifactId", "papers", "sessionId"]);
const paperFields = new Set(["canonicalPaperId", "doi", "id", "provider", "sourceId"]);

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeDoi(value) {
  const normalized = normalizeText(value)
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .toLowerCase();
  return /^10\.\d{4,9}\/[^\s\u0000-\u001f\u007f]+$/.test(normalized)
    ? normalized
    : "";
}

function normalizeIdentity(value) {
  const text = normalizeText(value);
  if (!text) return "";
  const doi = normalizeDoi(text);
  if (doi) return `doi:${doi}`;
  const openAlex = text.match(/^(?:https?:\/\/openalex\.org\/|openalex:)?(W\d+)$/i);
  if (openAlex) return `openalex:${openAlex[1].toUpperCase()}`;
  const semanticScholar = text.match(/^(?:semantic_scholar:|semanticscholar:)([^\s]+)$/i);
  if (semanticScholar) return `semantic_scholar:${semanticScholar[1].toLowerCase()}`;
  return text.toLowerCase();
}

function isSafeIdentifier(value, maximumLength = 512) {
  return Boolean(value) && value.length <= maximumLength &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function hasOnlyFields(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function normalizeProviderSourceId(provider, value) {
  const sourceId = normalizeText(value);
  if (provider === "openalex") {
    const match = normalizeIdentity(sourceId).match(/^openalex:(W\d+)$/);
    return match ? match[1] : sourceId.toLowerCase();
  }
  if (provider === "crossref") {
    return normalizeDoi(sourceId) || sourceId.toLowerCase();
  }
  if (provider === "semantic_scholar") {
    const direct = normalizeIdentity(sourceId).match(/^semantic_scholar:(.+)$/);
    if (direct) return direct[1];
    const prefixed = normalizeIdentity(`semantic_scholar:${sourceId}`)
      .match(/^semantic_scholar:(.+)$/);
    return prefixed?.[1] ?? sourceId.toLowerCase();
  }
  return sourceId.toLowerCase();
}

function providerSourceAlias(provider, sourceId) {
  return `${provider}:${normalizeProviderSourceId(provider, sourceId)}`;
}

function paperAliases(paper) {
  const aliases = new Set();
  const canonical = normalizeIdentity(paper.canonicalPaperId);
  const doi = normalizeDoi(paper.doi);
  if (canonical) aliases.add(canonical);
  if (doi) aliases.add(`doi:${doi}`);
  aliases.add(providerSourceAlias(paper.provider, paper.sourceId));
  return aliases;
}

function stablePaperRank(paper) {
  return `${paper.id}\u0000${paper.provider}\u0000${paper.sourceId}`;
}

function compareStableText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function findComponent(parent, index) {
  let root = index;
  while (parent[root] !== root) root = parent[root];
  while (parent[index] !== index) {
    const next = parent[index];
    parent[index] = root;
    index = next;
  }
  return root;
}

function unionComponents(parent, left, right) {
  const leftRoot = findComponent(parent, left);
  const rightRoot = findComponent(parent, right);
  if (leftRoot === rightRoot) return;
  const first = Math.min(leftRoot, rightRoot);
  const second = Math.max(leftRoot, rightRoot);
  parent[second] = first;
}

function buildIdentityComponent(records) {
  const canonicalIds = new Set(records.map((paper) => paper.canonicalPaperId).filter(Boolean));
  const dois = new Set(records.map((paper) => paper.doi).filter(Boolean));
  const sourceIdsByProvider = new Map();
  for (const paper of records) {
    const providerSourceIds = sourceIdsByProvider.get(paper.provider) ?? new Set();
    providerSourceIds.add(paper.sourceId);
    sourceIdsByProvider.set(paper.provider, providerSourceIds);
  }
  if (canonicalIds.size > 1 || dois.size > 1 ||
    [...sourceIdsByProvider.values()].some((sourceIds) => sourceIds.size > 1)) {
    throw new PaperRelationValidationError(
      "conflicting_paper_relation_identity",
      "论文关系请求包含相互冲突的论文标识。"
    );
  }
  const representative = [...records].sort((left, right) =>
    compareStableText(stablePaperRank(left), stablePaperRank(right)))[0];
  const aliases = new Set(records.flatMap((paper) => [...paper.aliases]));
  const canonicalPaperId = [...canonicalIds][0];
  const doi = [...dois][0];
  const key = canonicalPaperId || (doi ? `doi:${doi}` : [...aliases].sort()[0]);
  return {
    aliases,
    canonicalPaperId,
    doi,
    id: representative.id,
    key,
    provider: representative.provider,
    sourceId: representative.sourceId
  };
}

export class PaperRelationValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.statusCode = 400;
  }
}

function validateAndNormalizeRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    !hasOnlyFields(body, requestFields)) {
    throw new PaperRelationValidationError(
      "invalid_paper_relation_request",
      "论文关系请求格式无效。"
    );
  }
  const artifactId = normalizeText(body.artifactId);
  if (!isSafeIdentifier(artifactId, 256) || !Array.isArray(body.papers) || body.papers.length === 0) {
    throw new PaperRelationValidationError(
      "invalid_paper_relation_request",
      "论文关系请求缺少有效的 artifactId 或论文列表。"
    );
  }

  const normalizedPapers = body.papers.map((rawPaper) => {
    if (!rawPaper || typeof rawPaper !== "object" || Array.isArray(rawPaper) ||
      !hasOnlyFields(rawPaper, paperFields)) {
      throw new PaperRelationValidationError(
        "invalid_paper_relation_paper",
        "论文关系请求包含无效论文。"
      );
    }
    const id = normalizeText(rawPaper.id);
    const provider = normalizeText(rawPaper.provider).toLowerCase();
    const rawSourceId = normalizeText(rawPaper.sourceId);
    const canonicalPaperId = rawPaper.canonicalPaperId === undefined
      ? undefined
      : normalizeText(rawPaper.canonicalPaperId);
    const doi = rawPaper.doi === undefined ? undefined : normalizeDoi(rawPaper.doi);
    if (!isSafeIdentifier(id, 512) || !isSafeIdentifier(provider, 64) ||
      !/^[a-z0-9_-]+$/.test(provider) || !isSafeIdentifier(rawSourceId, 512) ||
      (rawPaper.canonicalPaperId !== undefined && !isSafeIdentifier(canonicalPaperId, 512)) ||
      (rawPaper.doi !== undefined && !doi)) {
      throw new PaperRelationValidationError(
        "invalid_paper_relation_paper",
        "论文关系请求包含无效论文标识。"
      );
    }

    const normalized = {
      canonicalPaperId: canonicalPaperId ? normalizeIdentity(canonicalPaperId) : undefined,
      doi,
      id,
      provider,
      sourceId: normalizeProviderSourceId(provider, rawSourceId)
    };
    return { ...normalized, aliases: paperAliases(normalized) };
  });

  const parent = normalizedPapers.map((_, index) => index);
  const firstPaperByAlias = new Map();
  normalizedPapers.forEach((paper, index) => {
    for (const alias of paper.aliases) {
      const existingIndex = firstPaperByAlias.get(alias);
      if (existingIndex === undefined) firstPaperByAlias.set(alias, index);
      else unionComponents(parent, existingIndex, index);
    }
  });
  const recordsByComponent = new Map();
  normalizedPapers.forEach((paper, index) => {
    const root = findComponent(parent, index);
    const records = recordsByComponent.get(root) ?? [];
    records.push(paper);
    recordsByComponent.set(root, records);
  });
  const papers = [...recordsByComponent.values()].map(buildIdentityComponent);
  if (papers.length > maximumPapers) {
    throw new PaperRelationValidationError(
      "paper_relation_paper_limit_exceeded",
      `论文关系请求最多包含 ${maximumPapers} 篇去重论文。`
    );
  }

  return {
    artifactId,
    papers: papers.sort((left, right) =>
      left.key.localeCompare(right.key) || left.id.localeCompare(right.id))
  };
}

function validEvidenceUrl(value) {
  const text = normalizeText(value);
  if (!text) return "";
  try {
    return new URL(text).protocol === "https:" ? text : "";
  } catch {
    return "";
  }
}

function evidenceUrlForRecord(record, provider, id) {
  const explicit = validEvidenceUrl(record.evidenceRecordUrl);
  if (explicit) return explicit;
  if (provider === "openalex") {
    const match = normalizeIdentity(id).match(/^openalex:(W\d+)$/);
    return match ? `https://openalex.org/${match[1]}` : "";
  }
  if (provider === "semantic_scholar") {
    const match = normalizeIdentity(id).match(/^semantic_scholar:(.+)$/);
    return match
      ? `https://www.semanticscholar.org/paper/${encodeURIComponent(match[1])}`
      : "";
  }
  return "";
}

function clampStrength(value) {
  return Math.min(1, Math.max(0, Number(Number(value).toFixed(3))));
}

function normalizedRecord(record, aliasOwners) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const provider = normalizeText(record.provider).toLowerCase();
  if (!validGraphProviders.has(provider)) return null;
  const aliases = [
    record.id,
    record.canonicalPaperId,
    record.doi,
    record.sourceId && `${provider}:${record.sourceId}`
  ].map(normalizeIdentity).filter(Boolean);
  const matchingPaperKeys = new Set(aliases.map((alias) => aliasOwners.get(alias)).filter(Boolean));
  if (matchingPaperKeys.size !== 1) return null;
  const [paperKey] = matchingPaperKeys;
  const evidenceRecordUrl = evidenceUrlForRecord(record, provider, record.id);
  if (!evidenceRecordUrl) return null;
  for (const alias of aliases) aliasOwners.set(alias, paperKey);
  const referencedPaperIds = new Set(
    (Array.isArray(record.referencedPaperIds) ? record.referencedPaperIds : [])
      .map(normalizeIdentity)
      .filter(Boolean)
  );
  const coCitedRelations = (Array.isArray(record.coCitedRelations) ? record.coCitedRelations : [])
    .filter((relation) => relation && typeof relation === "object" &&
      Number.isInteger(relation.sharedCitingWorkCount) && relation.sharedCitingWorkCount > 0)
    .map((relation) => ({
      paperIdentity: normalizeIdentity(relation.paperId),
      sharedCitingWorkCount: relation.sharedCitingWorkCount
    }))
    .filter((relation) => relation.paperIdentity);
  const citingPaperCount = Number.isInteger(record.citingPaperCount) && record.citingPaperCount > 0
    ? record.citingPaperCount
    : 0;
  return {
    citingPaperCount,
    coCitedRelations,
    evidenceRecordUrl,
    paperKey,
    provider,
    referencedPaperIds
  };
}

function mergeRecords(records, aliasOwners) {
  const merged = new Map();
  for (const rawRecord of records) {
    const record = normalizedRecord(rawRecord, aliasOwners);
    if (!record) continue;
    const key = `${record.provider}|${record.paperKey}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, record);
      continue;
    }
    for (const reference of record.referencedPaperIds) existing.referencedPaperIds.add(reference);
    existing.coCitedRelations.push(...record.coCitedRelations);
    existing.citingPaperCount = Math.max(existing.citingPaperCount, record.citingPaperCount);
    if (record.evidenceRecordUrl < existing.evidenceRecordUrl) {
      existing.evidenceRecordUrl = record.evidenceRecordUrl;
    }
  }
  return [...merged.values()].sort((left, right) =>
    left.provider.localeCompare(right.provider) || left.paperKey.localeCompare(right.paperKey));
}

function edgeKey(edge) {
  if (edge.directed) {
    return `${edge.kind}|${edge.sourcePaperKey}|${edge.targetPaperKey}`;
  }
  return `${edge.kind}|${[edge.sourcePaperKey, edge.targetPaperKey].sort().join("|")}`;
}

function compareEdgeEvidence(left, right) {
  return right.strength - left.strength ||
    left.provider.localeCompare(right.provider) ||
    left.evidenceRecordUrls.join("\u0000").localeCompare(right.evidenceRecordUrls.join("\u0000"));
}

function deriveEdges(papers, records, aliasOwners) {
  const papersByKey = new Map(papers.map((paper) => [paper.key, paper]));
  const recordsByProvider = new Map();
  for (const record of records) {
    const providerRecords = recordsByProvider.get(record.provider) ?? [];
    providerRecords.push(record);
    recordsByProvider.set(record.provider, providerRecords);
  }
  const edges = new Map();

  const addEdge = (edge) => {
    if (edge.sourcePaperKey === edge.targetPaperKey || edge.evidenceRecordUrls.length === 0) return;
    const key = edgeKey(edge);
    const previous = edges.get(key);
    if (!previous || compareEdgeEvidence(edge, previous) < 0) edges.set(key, edge);
  };

  for (const [provider, providerRecords] of recordsByProvider) {
    const recordByPaper = new Map(providerRecords.map((record) => [record.paperKey, record]));
    for (let leftIndex = 0; leftIndex < papers.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < papers.length; rightIndex += 1) {
        const leftPaper = papers[leftIndex];
        const rightPaper = papers[rightIndex];
        const left = recordByPaper.get(leftPaper.key);
        const right = recordByPaper.get(rightPaper.key);

        const leftCitesRight = left
          ? [...left.referencedPaperIds]
              .some((reference) => aliasOwners.get(reference) === rightPaper.key)
          : false;
        const rightCitesLeft = right
          ? [...right.referencedPaperIds]
              .some((reference) => aliasOwners.get(reference) === leftPaper.key)
          : false;
        if (leftCitesRight) {
          addEdge({
            directed: true,
            evidenceRecordUrls: [left.evidenceRecordUrl],
            kind: "direct_citation",
            provider,
            sourcePaperId: leftPaper.id,
            sourcePaperKey: leftPaper.key,
            strength: 1,
            targetPaperId: rightPaper.id,
            targetPaperKey: rightPaper.key
          });
        }
        if (rightCitesLeft) {
          addEdge({
            directed: true,
            evidenceRecordUrls: [right.evidenceRecordUrl],
            kind: "direct_citation",
            provider,
            sourcePaperId: rightPaper.id,
            sourcePaperKey: rightPaper.key,
            strength: 1,
            targetPaperId: leftPaper.id,
            targetPaperKey: leftPaper.key
          });
        }

        if (!left || !right) continue;

        const sharedReferences = [...left.referencedPaperIds]
          .filter((reference) => right.referencedPaperIds.has(reference));
        const denominator = Math.min(left.referencedPaperIds.size, right.referencedPaperIds.size);
        if (sharedReferences.length > 0 && denominator > 0) {
          addEdge({
            directed: false,
            evidenceRecordUrls: [left.evidenceRecordUrl, right.evidenceRecordUrl].sort(),
            kind: "bibliographic_coupling",
            provider,
            sourcePaperId: leftPaper.id,
            sourcePaperKey: leftPaper.key,
            strength: clampStrength(sharedReferences.length / denominator),
            targetPaperId: rightPaper.id,
            targetPaperKey: rightPaper.key
          });
        }
      }
    }

    for (const source of providerRecords) {
      const sourcePaper = papersByKey.get(source.paperKey);
      if (!sourcePaper) continue;
      for (const relation of source.coCitedRelations) {
        const targetKey = aliasOwners.get(relation.paperIdentity);
        const target = targetKey ? recordByPaper.get(targetKey) : undefined;
        const targetPaper = targetKey ? papersByKey.get(targetKey) : undefined;
        const denominator = target
          ? Math.min(source.citingPaperCount, target.citingPaperCount)
          : 0;
        if (!target || !targetPaper || denominator <= 0 ||
          relation.sharedCitingWorkCount > denominator) continue;
        const [firstPaper, secondPaper] = [sourcePaper, targetPaper]
          .sort((left, right) => left.key.localeCompare(right.key));
        addEdge({
          directed: false,
          evidenceRecordUrls: [source.evidenceRecordUrl, target.evidenceRecordUrl].sort(),
          kind: "co_cited",
          provider,
          sourcePaperId: firstPaper.id,
          sourcePaperKey: firstPaper.key,
          strength: clampStrength(relation.sharedCitingWorkCount / denominator),
          targetPaperId: secondPaper.id,
          targetPaperKey: secondPaper.key
        });
      }
    }
  }

  return [...edges.values()]
    .sort((left, right) =>
      left.sourcePaperKey.localeCompare(right.sourcePaperKey) ||
      left.targetPaperKey.localeCompare(right.targetPaperKey) ||
      left.kind.localeCompare(right.kind) || left.provider.localeCompare(right.provider))
    .map(({ sourcePaperKey: _sourcePaperKey, targetPaperKey: _targetPaperKey, ...edge }) => edge);
}

function openAlexIds(papers) {
  return [...new Set(papers.flatMap((paper) => [...paper.aliases])
    .filter((alias) => alias.startsWith("openalex:"))
    .map((alias) => alias.slice("openalex:".length)))].sort();
}

function semanticScholarIds(papers) {
  return [...new Set(papers.flatMap((paper) => {
    const semantic = [...paper.aliases]
      .filter((alias) => alias.startsWith("semantic_scholar:"))
      .map((alias) => alias.slice("semantic_scholar:".length));
    return semantic.length > 0 ? semantic : paper.doi ? [`DOI:${paper.doi}`] : [];
  }))].sort();
}

async function fetchJson(url, init, { timeoutMs = 8000, transport = fetchWithConfiguredProxy } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await transport(url, { ...init, signal: controller.signal });
    if (!response?.ok) throw new Error(`HTTP ${response?.status ?? "unknown"}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenAlexGraphRecords(papers, options) {
  const ids = openAlexIds(papers);
  const dois = [...new Set(papers.map((paper) => paper.doi).filter(Boolean))].sort();
  const filters = [
    ids.length > 0 ? `openalex_id:${ids.join("|")}` : "",
    dois.length > 0 ? `doi:${dois.join("|")}` : ""
  ].filter(Boolean);
  if (filters.length === 0) return [];
  const settled = await Promise.allSettled(filters.map(async (filter) => {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("filter", filter);
    url.searchParams.set("per-page", String(papers.length));
    url.searchParams.set("select", "id,doi,referenced_works,cited_by_count");
    if (options.openAlexApiKey) url.searchParams.set("api_key", options.openAlexApiKey);
    if (options.openAlexMailto) url.searchParams.set("mailto", options.openAlexMailto);
    const payload = await fetchJson(url.toString(), { headers: { Accept: "application/json" } }, {
      timeoutMs: options.openAlexTimeoutMs,
      transport: options.openAlexTransport
    });
    if (!Array.isArray(payload?.results)) throw new Error("invalid OpenAlex graph response");
    return payload.results;
  }));
  const successfulPayloads = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const failedCount = settled.length - successfulPayloads.length;
  const records = successfulPayloads.flat().map((work) => ({
    citingPaperCount: work?.cited_by_count,
    doi: work?.doi,
    evidenceRecordUrl: normalizeText(work?.id),
    id: normalizeIdentity(work?.id),
    provider: "openalex",
    referencedPaperIds: Array.isArray(work?.referenced_works)
      ? work.referenced_works.map(normalizeIdentity).filter(Boolean)
      : []
  }));
  return {
    records,
    warnings: failedCount === 0
      ? []
      : successfulPayloads.length > 0
        ? ["openalex_paper_relations_partial"]
        : ["openalex_paper_relations_unavailable"]
  };
}

async function fetchSemanticScholarGraphRecords(papers, options) {
  const ids = semanticScholarIds(papers);
  if (ids.length === 0) return [];
  const headers = { "Content-Type": "application/json" };
  if (options.semanticScholarApiKey) headers["x-api-key"] = options.semanticScholarApiKey;
  const payload = await fetchJson(
    "https://api.semanticscholar.org/graph/v1/paper/batch?fields=paperId,externalIds,referenceCount,citationCount,references.paperId",
    { body: JSON.stringify({ ids }), headers, method: "POST" },
    { timeoutMs: options.semanticScholarTimeoutMs, transport: options.semanticScholarTransport }
  );
  if (!Array.isArray(payload)) throw new Error("invalid Semantic Scholar graph response");
  return payload.filter(Boolean).map((paper) => ({
    citingPaperCount: paper?.citationCount,
    doi: paper?.externalIds?.DOI,
    evidenceRecordUrl: paper?.paperId
      ? `https://www.semanticscholar.org/paper/${encodeURIComponent(paper.paperId)}`
      : "",
    id: paper?.paperId ? `semantic_scholar:${paper.paperId}` : "",
    provider: "semantic_scholar",
    referencedPaperIds: Array.isArray(paper?.references)
      ? paper.references.map((reference) => `semantic_scholar:${reference?.paperId ?? ""}`)
      : []
  }));
}

async function fetchDefaultGraphRecords(papers, options) {
  const providers = [];
  if (options.openAlexEnabled !== false &&
    (options.openAlexApiKey || typeof options.openAlexTransport === "function")) {
    providers.push({
      id: "openalex",
      retrieve: () => fetchOpenAlexGraphRecords(papers, options)
    });
  }
  if (options.semanticScholarEnabled === true &&
    (options.semanticScholarApiKey || typeof options.semanticScholarTransport === "function")) {
    providers.push({
      id: "semantic_scholar",
      retrieve: () => fetchSemanticScholarGraphRecords(papers, options)
    });
  }
  if (providers.length === 0) {
    return { records: [], warnings: ["paper_relation_provider_unavailable"] };
  }
  const settled = await Promise.allSettled(providers.map((provider) => provider.retrieve()));
  return {
    records: settled.flatMap((result) => {
      if (result.status === "rejected") return [];
      return Array.isArray(result.value)
        ? result.value
        : Array.isArray(result.value?.records) ? result.value.records : [];
    }),
    warnings: settled.flatMap((result, index) => {
      if (result.status === "rejected") {
        return [`${providers[index].id}_paper_relations_unavailable`];
      }
      return Array.isArray(result.value?.warnings) ? result.value.warnings : [];
    })
  };
}

export async function buildPaperRelationPayload(body, options = {}) {
  const request = validateAndNormalizeRequest(body);
  const aliasOwners = new Map(request.papers.flatMap((paper) =>
    [...paper.aliases].map((alias) => [alias, paper.key])));
  let retrieval;
  try {
    retrieval = typeof options.fetchGraphRecords === "function"
      ? await options.fetchGraphRecords(request.papers.map((paper) => ({
          canonicalPaperId: paper.canonicalPaperId,
          doi: paper.doi,
          id: paper.id,
          provider: paper.provider,
          sourceId: paper.sourceId
        })))
      : await fetchDefaultGraphRecords(request.papers, options);
  } catch {
    return { edges: [], warnings: ["paper_relation_provider_unavailable"] };
  }
  const rawRecords = Array.isArray(retrieval)
    ? retrieval
    : Array.isArray(retrieval?.records) ? retrieval.records : [];
  const warnings = Array.isArray(retrieval?.warnings)
    ? [...new Set(retrieval.warnings.filter((warning) => typeof warning === "string" && warning))].sort()
    : [];
  const records = mergeRecords(rawRecords, aliasOwners);
  return { edges: deriveEdges(request.papers, records, aliasOwners), warnings };
}
