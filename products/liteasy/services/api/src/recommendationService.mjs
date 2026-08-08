import { LibraryRepositoryError } from "./libraryRepository.mjs";

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

function tokens(value) {
  const normalized = normalizedText(value).toLocaleLowerCase("en-US");
  const latin = normalized.match(/[a-z0-9][a-z0-9-]{1,}/g) ?? [];
  const chineseRuns = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  return [...new Set([...latin, ...chineseRuns.flatMap((run) =>
    Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2))
  )])];
}

function similarity(left, right) {
  const leftTokens = tokens(left);
  const rightTokens = new Set(tokens(right));
  if (leftTokens.length === 0 || rightTokens.size === 0) return 0;
  return leftTokens.filter((token) => rightTokens.has(token)).length /
    Math.max(1, Math.min(leftTokens.length, rightTokens.size));
}

function band(score) {
  return score >= 0.75 ? "high" : score >= 0.45 ? "medium" : "low";
}

export class RecommendationService {
  constructor(repository, provider, pdfGrantRepository) {
    this.repository = repository;
    this.provider = provider;
    this.pdfGrantRepository = pdfGrantRepository;
  }

  async generate(subject, input) {
    const selectedDocuments = documents(input.selectedDocuments);
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
    const queryGroups = [...explicitQueries, ...personalizedQueries];
    if (queryGroups.length === 0) return { recommendations: [] };
    const settled = await Promise.allSettled(queryGroups.map(async (group) => ({
      ...group,
      candidates: await this.provider.search(group.query, 8)
    })));
    const completed = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    if (completed.length === 0) throw settled[0].reason;
    const selectedTitles = selectedDocuments.map((document) => document.title);
    const suppressed = new Set(context.suppressions);
    const candidates = new Map();
    const now = new Date().toISOString();
    for (const group of completed) {
      for (const source of group.candidates) {
        if (suppressed.has(source.id) || selectedTitles.some((title) => similarity(title, source.title) >= 0.96)) continue;
        const lexical = similarity(group.query, source.title);
        const termRelevance = context.enabled
          ? Math.max(0, ...context.terms.map((term) => similarity(term.term, source.title) * Math.min(1, term.weight / 3)))
          : 0;
        const feedbackRelevance = context.enabled
          ? Math.max(0, ...context.feedback
            .filter((feedback) => feedback.action === "saved")
            .map((feedback) => similarity(feedback.title, source.title)))
          : 0;
        const providerRelevance = Math.max(0.2, 1 - (source.providerRank - 1) * 0.08);
        const preference = Math.max(termRelevance, feedbackRelevance);
        const score = Number(Math.min(1, providerRelevance * 0.62 + lexical * 0.28 + preference * 0.1).toFixed(3));
        const item = {
          ...(source.authors.length ? { authors: source.authors } : {}),
          canonicalId: source.canonicalId,
          discoveredAt: now,
          ...(source.fullTextUrl ? { fullTextUrl: source.fullTextUrl } : {}),
          id: source.id,
          ...(source.openAccessAvailable ? { openAccessAvailable: true } : {}),
          ...(source.publishedYear ? { publishedYear: source.publishedYear } : {}),
          relatedDocumentTitle: group.label,
          relevanceBand: band(score),
          relevanceScore: score,
          reason: `Crossref 书目数据中与“${group.label}”相关的真实文献候选；请通过 DOI 来源页核对正文与结论。`,
          scoreComponents: {
            baseRelevance: score,
            diversityPenalty: 0,
            finalScore: score,
            lexicalRelevance: Number(lexical.toFixed(3)),
            preference: Number(preference.toFixed(3)),
            providerRelevance: Number(providerRelevance.toFixed(3)),
            sourceRelevance: score
          },
          source: source.source,
          sourceKind: "live",
          sourceUrl: source.sourceUrl,
          title: source.title
        };
        const existing = candidates.get(item.id);
        if (!existing || item.relevanceScore > existing.relevanceScore) candidates.set(item.id, item);
      }
    }
    const recommendations = [...candidates.values()]
      .sort((left, right) => right.relevanceScore - left.relevanceScore || left.title.localeCompare(right.title))
      .slice(0, 8);
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
