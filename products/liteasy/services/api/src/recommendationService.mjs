import { LibraryRepositoryError } from "./libraryRepository.mjs";
import { diverseRecommendations, recommendationStyle, score, similarity, styleEvidence, titleKey } from "./recommendationRanking.mjs";

const profileLimits = { datasets: 12, languages: 6, methods: 12, topics: 12 };

function normalizedText(value, maximum = 500) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function profile(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LibraryRepositoryError("research_profile_invalid");
  }
  const result = {};
  for (const [field, limit] of Object.entries(profileLimits)) {
    if (!Array.isArray(value[field]) || value[field].length > limit || value[field].some((item) => (
      typeof item !== "string" || !item.trim() || item.trim().length > 80
    ))) {
      throw new LibraryRepositoryError(`research_profile_${field}_invalid`);
    }
    result[field] = [...new Set(value[field].map((item) => normalizedText(item, 80)))];
    if (result[field].some((item) => !item)) {
      throw new LibraryRepositoryError(`research_profile_${field}_invalid`);
    }
  }
  return result;
}

function documents(value) {
  if (!Array.isArray(value) || value.length > 3) throw new LibraryRepositoryError("recommendation_documents_invalid");
  return value.map((document) => {
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new LibraryRepositoryError("recommendation_documents_invalid");
    }
    if (typeof document.id !== "string" || !document.id.trim() || document.id.trim().length > 300 ||
      typeof document.title !== "string" || !document.title.trim() || document.title.trim().length > 500) {
      throw new LibraryRepositoryError("recommendation_documents_invalid");
    }
    const id = normalizedText(document.id, 300);
    const title = normalizedText(document.title, 500);
    return { id, title };
  });
}

function pdfGrantInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "candidateId") ||
    typeof value.candidateId !== "string" ||
    !/^[A-Za-z0-9._:/-]{1,300}$/.test(value.candidateId)) {
    throw new LibraryRepositoryError("recommendation_candidate_invalid");
  }
  return { candidateId: value.candidateId };
}

function band(score) {
  return score >= 0.75 ? "high" : score >= 0.45 ? "medium" : "low";
}

function documentIdentity(value) {
  const normalized = value.toLowerCase().replace(/^reading-candidate:/, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "doi:");
  return /^10\.\d{4,9}\/\S+$/.test(normalized) ? `doi:${normalized}` : normalized;
}

export class RecommendationService {
  constructor(repository, provider, pdfGrantRepository, dependencies = {}) {
    this.repository = repository;
    this.provider = provider;
    this.pdfGrantRepository = pdfGrantRepository;
    this.now = dependencies.now ?? (() => new Date());
  }

  async generate(subject, input) {
    const selectedDocuments = documents(input.selectedDocuments);
    const style = recommendationStyle(input.style);
    const requestedProfile = profile(input.researchProfile);
    const context = await this.repository.context(subject);
    const researchProfile = context.enabled ? requestedProfile : undefined;
    const explicitQueries = [
      ...selectedDocuments.map((document) => ({ label: document.title, query: document.title })),
      ...(researchProfile ? [{
        label: "研究画像",
        query: [...researchProfile.topics.slice(0, 2), ...researchProfile.methods.slice(0, 1)].join(" ")
      }] : [])
    ].filter((item) => item.query);
    const personalizedQueries = context.enabled
      ? context.terms.slice(0, 3).map((item) => ({ label: `tag:${item.term}`, query: item.term }))
      : [];
    const seenQueries = new Set();
    const queryGroups = [...explicitQueries, ...personalizedQueries].filter((group) => {
      const key = titleKey(group.query);
      if (seenQueries.has(key)) return false;
      seenQueries.add(key);
      return true;
    }).slice(0, 5);
    if (queryGroups.length === 0) return { recommendations: [] };
    // At most five distinct queries, two active query groups and three provider lanes per group.
    const settled = [];
    for (let index = 0; index < queryGroups.length; index += 2) {
      settled.push(...await Promise.allSettled(queryGroups.slice(index, index + 2).map(async (group) => ({
        ...group,
        candidates: await this.provider.search(group.query, 12, { style })
      }))));
    }
    const completed = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (completed.length === 0) throw settled[0].reason;
    const selectedTitles = new Set(selectedDocuments.map((document) => titleKey(document.title)));
    const selectedIds = new Set(selectedDocuments.map((document) => documentIdentity(document.id)));
    const suppressed = new Set(context.suppressions);
    const candidates = new Map();
    const timestamp = this.now();
    const now = timestamp.toISOString();
    for (const group of completed) {
      for (const source of group.candidates) {
        if (suppressed.has(source.id) || selectedTitles.has(titleKey(source.title)) ||
          selectedIds.has(source.canonicalId ? documentIdentity(source.canonicalId) : undefined) ||
          selectedIds.has(documentIdentity(source.id))) continue;
        const lexical = similarity(group.query, source.title);
        const termRelevance = context.enabled
          ? Math.max(0, ...context.terms.map((term) => similarity(term.term, source.title) * Math.min(1, term.weight / 3)))
          : 0;
        const feedbackRelevance = context.enabled
          ? Math.max(0, ...context.feedback
            .filter((feedback) => feedback.action === "saved")
            .map((feedback) => similarity(feedback.title, source.title)))
          : 0;
        // Citation-sorted position is not topical relevance. Require actual title overlap
        // from every lane so a popular, off-topic result cannot win on date/citations.
        if (lexical < 0.12) continue;
        const providerRelevance = source.retrievalLane === "classic" ? 0.5
          : Math.max(0.2, 1 - (source.providerRank - 1) * 0.04);
        const preference = Math.max(termRelevance, feedbackRelevance);
        const relevance = score(providerRelevance * 0.25 + lexical * 0.65 + preference * 0.1);
        const evidence = styleEvidence(source, style, timestamp);
        const styleWeight = style === "frontier" || style === "classic" ? 0.3 : style === "balanced" ? 0.18 : 0;
        // Style evidence can reorder related work, but its contribution scales with
        // topical relevance; citations/recency alone cannot lift a weak title match.
        const finalScore = score(relevance * (1 - styleWeight + evidence.styleScore * styleWeight));
        const item = {
          ...(source.authors.length ? { authors: source.authors } : {}),
          canonicalId: source.canonicalId,
          ...(Number.isSafeInteger(source.citationCount) && source.citationCount >= 0
            ? { citationCount: source.citationCount } : {}),
          discoveredAt: now,
          ...(source.fullTextUrl ? { fullTextUrl: source.fullTextUrl } : {}),
          id: source.id,
          ...(source.openAccessAvailable ? { openAccessAvailable: true } : {}),
          ...(source.publishedYear ? { publishedYear: source.publishedYear } : {}),
          ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}),
          rankingStyle: style,
          relatedDocumentTitle: group.label,
          relevanceBand: band(relevance),
          relevanceScore: relevance,
          reason: `与“${group.label}”主题相关；${evidence.explanation}。请通过 DOI 来源页核对正文与结论。`,
          scoreComponents: {
            baseRelevance: relevance,
            diversityPenalty: 0,
            finalScore,
            lexicalRelevance: Number(lexical.toFixed(3)),
            preference: Number(preference.toFixed(3)),
            providerRelevance: Number(providerRelevance.toFixed(3)),
            sourceRelevance: relevance
          },
          styleScore: evidence.styleScore,
          source: source.source,
          sourceKind: "live",
          sourceUrl: source.sourceUrl,
          title: source.title
        };
        const key = item.canonicalId?.toLowerCase() ?? item.id;
        const existing = candidates.get(key);
        if (!existing || item.relevanceScore > existing.relevanceScore) candidates.set(key, item);
      }
    }
    const uniqueTitles = new Map();
    for (const item of candidates.values()) {
      const key = titleKey(item.title);
      const existing = uniqueTitles.get(key);
      if (!existing || item.relevanceScore > existing.relevanceScore) uniqueTitles.set(key, item);
    }
    const recommendations = diverseRecommendations([...uniqueTitles.values()], style);
    await this.repository.saveCandidates(subject, recommendations, input.traceId);
    return {
      recommendations: recommendations.map(({ fullTextUrl: _, ...item }) => item)
    };
  }

  async issuePdfGrant(subject, value) {
    const input = pdfGrantInput(value);
    const candidate = await this.repository.loadCandidate(subject, input.candidateId);
    if (!candidate.openAccessAvailable || typeof candidate.fullTextUrl !== "string" ||
      !candidate.fullTextUrl.startsWith("https://") || !this.pdfGrantRepository) {
      throw new LibraryRepositoryError("recommendation_pdf_unavailable", 404);
    }
    const connectorType = candidate.source === "Crossref" ? "crossref" : undefined;
    if (!connectorType) throw new LibraryRepositoryError("recommendation_pdf_unavailable", 404);
    const grantId = await this.pdfGrantRepository.issueRecommendationPdfGrant(subject, {
      connectorType,
      sourceId: candidate.id,
      sourceRecordId: candidate.canonicalId ?? candidate.id,
      sourceUrl: candidate.fullTextUrl
    });
    if (!grantId) throw new LibraryRepositoryError("recommendation_pdf_unavailable", 404);
    return {
      fullTextGrantId: grantId,
      fullTextUrl: candidate.fullTextUrl,
      sourceId: candidate.id
    };
  }
}
