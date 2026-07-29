function buildRecommendationCandidates(body) {
  const selectedDocuments = Array.isArray(body.selectedDocuments) ? body.selectedDocuments : [];
  const selectedTitles = selectedDocuments
    .filter((document) => typeof document?.title === "string")
    .map((document) => document.title);

  if (selectedTitles.some((title) => title.includes("ACORN"))) {
    return [
        {
          discoveredAt: "2026-05-14T08:15:00Z",
          id: "rec-acorn-1",
          relatedDocumentTitle: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data",
          relevanceBand: "high",
          relevanceScore: 0.91,
          reason: "同样关注带结构化过滤条件的近似最近邻检索。",
          source: "Semantic Scholar",
          sourceKind: "mock",
          title: "Filtered-DiskANN: Graph Algorithms for Approximate Nearest Neighbor Search with Filters"
        },
        {
          discoveredAt: "2026-05-14T09:10:00Z",
          id: "rec-acorn-2",
          relatedDocumentTitle: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data",
          relevanceBand: "medium",
          relevanceScore: 0.79,
          reason: "补充混合结构化条件和向量检索的系统设计背景。",
          source: "arXiv Watch",
          sourceKind: "mock",
          title: "Efficient Filtered Approximate Nearest Neighbor Search"
        }
    ];
  }

  if (selectedTitles.some((title) => title.includes("Vector Database"))) {
    return [
        {
          discoveredAt: "2026-05-14T08:15:00Z",
          id: "rec-vdbms-1",
          relatedDocumentTitle: "Survey of Vector Database Management Systems",
          relevanceBand: "high",
          relevanceScore: 0.92,
          reason: "同样关注向量数据库系统架构与相似度检索能力。",
          source: "Semantic Scholar",
          sourceKind: "mock",
          title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
        },
        {
          discoveredAt: "2026-05-14T09:10:00Z",
          id: "rec-vdbms-2",
          relatedDocumentTitle: "Survey of Vector Database Management Systems",
          relevanceBand: "medium",
          relevanceScore: 0.78,
          reason: "补充开源向量数据库系统实现，便于和综述框架对照。",
          source: "arXiv Watch",
          sourceKind: "mock",
          title: "Milvus: A Purpose-Built Vector Data Management System"
        }
    ];
  }

  return [
      {
        discoveredAt: "2026-05-14T07:30:00Z",
        id: "rec-colbert-1",
        relatedDocumentTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
        relevanceBand: "high",
        relevanceScore: 0.91,
        reason: "同样关注神经检索中的稀疏/密集表示与效率权衡。",
        source: "Semantic Scholar",
        sourceKind: "mock",
        title: "SPLADE: Sparse Lexical and Expansion Model for First Stage Ranking"
      },
      {
        discoveredAt: "2026-05-14T09:00:00Z",
        id: "rec-colbert-2",
        relatedDocumentTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
        relevanceBand: "medium",
        relevanceScore: 0.75,
        reason: "补充稠密段落检索路线，便于比较 late interaction 的取舍。",
        source: "Connected Papers",
        sourceKind: "mock",
        title: "Dense Passage Retrieval for Open-Domain Question Answering"
      }
  ];
}

function getProfileTerms(profile) {
  if (!profile || typeof profile !== "object" || !Array.isArray(profile.disciplines)) {
    return [];
  }

  return profile.disciplines.flatMap((discipline) => [
    discipline.categoryName,
    discipline.description,
    discipline.name
  ]);
}

function getSearchableText(item) {
  return [item.reason, item.relatedDocumentTitle, item.title].join(" ").toLowerCase();
}

function normalizeTerms(terms) {
  return terms
    .filter((term) => typeof term === "string" && term.trim().length > 1)
    .map((term) => term.trim().toLowerCase());
}

function personalizeRecommendation(item, preferences) {
  const searchableText = getSearchableText(item);
  const profileTerms = normalizeTerms(getProfileTerms(preferences.profile));
  const behaviorTerms = Array.isArray(preferences.terms) ? preferences.terms : [];
  const profileBoost = profileTerms.some((term) => searchableText.includes(term)) ? 0.025 : 0;
  const behaviorBoost = behaviorTerms.reduce((total, term) => {
    if (
      !term ||
      typeof term.term !== "string" ||
      typeof term.weight !== "number" ||
      !searchableText.includes(term.term.toLowerCase())
    ) {
      return total;
    }
    return total + Math.max(0, term.weight) * 0.015;
  }, 0);

  return {
    ...item,
    relevanceScore: Number(Math.min(0.99, item.relevanceScore + profileBoost + behaviorBoost).toFixed(3))
  };
}

export function buildRecommendationPayload(body, preferences = {}) {
  const suppressedRecommendationIds = new Set(
    Array.isArray(preferences.suppressedRecommendationIds)
      ? preferences.suppressedRecommendationIds
      : []
  );
  const recommendations = buildRecommendationCandidates(body)
    .filter((item) => !suppressedRecommendationIds.has(item.id))
    .map((item) => personalizeRecommendation(item, preferences))
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, 4);

  return { recommendations };
}

function normalizeRecommendationTitle(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, " ").trim()
    : "";
}

function recommendationReason(source) {
  if (source.relation === "cited_by_target") {
    return "目标论文的参考文献中出现该工作，可作为方法与知识背景的阅读线索。";
  }
  if (source.relation === "cites_target") {
    return "该工作明确引用目标论文，可作为后续延展的阅读线索。";
  }
  if (source.relation === "related") {
    return "OpenAlex 将其标为与目标论文相关的工作，建议作为关联阅读线索核对。";
  }
  return "该条目来自主题检索，建议作为候选阅读线索而非论文结论的证据。";
}

function relevanceBand(score) {
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function recommendationTokens(value) {
  const normalized = normalizeRecommendationTitle(value);
  const latin = normalized.split(" ").filter((token) => token.length >= 3);
  const chineseRuns = normalized.match(/[\u3400-\u9fff]+/g) ?? [];
  const chinese = chineseRuns.flatMap((run) => run.length < 2
    ? [run]
    : Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2)));
  return [...new Set([...latin, ...chinese])];
}

function tokenSimilarity(left, right) {
  const leftTokens = recommendationTokens(left);
  const rightTokens = new Set(recommendationTokens(right));
  if (leftTokens.length === 0 || rightTokens.size === 0) return 0;
  const overlap = leftTokens.filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(1, Math.min(leftTokens.length, rightTokens.size));
}

function rankingTokens(value) {
  const normalized = normalizeRecommendationTitle(value);
  const latin = normalized.split(" ").filter((token) => token.length >= 2);
  const chineseRuns = normalized.match(/[\u3400-\u9fff]+/g) ?? [];
  const chinese = chineseRuns.flatMap((run) => run.length < 2
    ? [run]
    : Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2)));
  return [...latin, ...chinese];
}

function normalizeRankingScores(scores) {
  const maximum = Math.max(0, ...scores.values());
  if (maximum <= 0) return new Map();
  return new Map([...scores].map(([id, score]) => [
    id,
    Number(Math.max(0, score / maximum).toFixed(6))
  ]));
}

function bm25RankingScores(candidates) {
  if (candidates.length === 0) return new Map();
  const documents = candidates.map((candidate) => rankingTokens(candidate.rankingText));
  const averageLength = documents.reduce((sum, tokens) => sum + tokens.length, 0) /
    Math.max(1, documents.length);
  const documentFrequency = new Map();
  for (const tokens of documents) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const scores = new Map();
  const k1 = 1.2;
  const b = 0.75;
  candidates.forEach((candidate, index) => {
    const documentTokens = documents[index];
    const frequencies = new Map();
    documentTokens.forEach((token) => frequencies.set(token, (frequencies.get(token) ?? 0) + 1));
    let score = 0;
    for (const query of candidate.rankingQueries) {
      for (const token of new Set(rankingTokens(query))) {
        const frequency = frequencies.get(token) ?? 0;
        if (frequency === 0) continue;
        const frequencyAcrossDocuments = documentFrequency.get(token) ?? 0;
        const inverseDocumentFrequency = Math.log(
          1 + (candidates.length - frequencyAcrossDocuments + 0.5) /
            (frequencyAcrossDocuments + 0.5)
        );
        const lengthNormalization = frequency + k1 * (
          1 - b + b * documentTokens.length / Math.max(1, averageLength)
        );
        score += inverseDocumentFrequency * frequency * (k1 + 1) / lengthNormalization;
      }
    }
    scores.set(candidate.id, score);
  });
  return normalizeRankingScores(scores);
}

const recommendationRankingRoutes = [
  { id: "provider", weight: 0.35 },
  { id: "lexical_bm25", weight: 0.3 },
  { id: "semantic", weight: 0.25 },
  { id: "personalization", weight: 0.1 }
];
const recommendationRrfK = 10;
const recommendationFusionWeight = 0.7;

function rankedRoute(candidates, route, scores, options = {}) {
  const entries = candidates
    .filter((candidate) => options.participates?.(candidate) ?? true)
    .map((candidate) => ({ candidate, score: scores.get(candidate.id) ?? 0 }))
    .sort((left, right) => right.score - left.score ||
      left.candidate.title.localeCompare(right.candidate.title));
  if (entries.length === 0 || (options.requirePositive === true && entries[0].score <= 0)) {
    return undefined;
  }
  return {
    id: route.id,
    ranks: new Map(entries.map((entry, index) => [entry.candidate.id, {
      rank: index + 1,
      score: Number(entry.score.toFixed(6))
    }])),
    weight: route.weight
  };
}

function fuseRecommendationRanks(candidates) {
  const items = [...candidates];
  const lexicalScores = bm25RankingScores(items);
  const providerScores = new Map(items.map((candidate) => [
    candidate.id,
    candidate.scoreComponents.providerRelevance
  ]));
  const semanticScores = new Map(items.flatMap((candidate) => (
    candidate.scoreComponents.semanticRelevance === undefined
      ? []
      : [[candidate.id, candidate.scoreComponents.semanticRelevance]]
  )));
  const personalizationScores = new Map(items.map((candidate) => [
    candidate.id,
    candidate.personalizationRelevance
  ]));
  const routeById = new Map(recommendationRankingRoutes.map((route) => [route.id, route]));
  const routes = [
    rankedRoute(items, routeById.get("provider"), providerScores),
    rankedRoute(items, routeById.get("lexical_bm25"), lexicalScores, {
      participates: (candidate) => (lexicalScores.get(candidate.id) ?? 0) > 0,
      requirePositive: true
    }),
    rankedRoute(items, routeById.get("semantic"), semanticScores, {
      participates: (candidate) => candidate.scoreComponents.semanticRelevance !== undefined,
      requirePositive: true
    }),
    rankedRoute(items, routeById.get("personalization"), personalizationScores, {
      participates: (candidate) => (personalizationScores.get(candidate.id) ?? 0) > 0,
      requirePositive: true
    })
  ].filter(Boolean);

  return {
    audit: {
      absoluteRelevanceFloorWeight: Number((1 - recommendationFusionWeight).toFixed(2)),
      candidateCount: items.length,
      fusionWeight: recommendationFusionWeight,
      k: recommendationRrfK,
      routes: routes.map((route) => ({ id: route.id, weight: route.weight })),
      version: "recommendation-ranking-fusion/v1"
    },
    candidates: items.map((candidate) => {
      const candidateRoutes = routes.flatMap((route) => {
        const ranked = route.ranks.get(candidate.id);
        if (!ranked) return [];
        return [{
          contribution: Number((route.weight / (recommendationRrfK + ranked.rank)).toFixed(6)),
          id: route.id,
          rank: ranked.rank,
          score: ranked.score,
          weight: route.weight
        }];
      });
      const rawScore = candidateRoutes.reduce((sum, route) => sum + route.contribution, 0);
      const maximumScore = candidateRoutes.reduce(
        (sum, route) => sum + route.weight / (recommendationRrfK + 1),
        0
      );
      const fusionScore = Number((maximumScore > 0 ? rawScore / maximumScore : 0).toFixed(3));
      const preFusionRelevance = candidate.baseRelevance;
      const baseRelevance = Number(Math.max(0, Math.min(1,
        preFusionRelevance * (
          (1 - recommendationFusionWeight) + fusionScore * recommendationFusionWeight
        )
      )).toFixed(3));
      const {
        personalizationRelevance,
        rankingQueries,
        rankingText,
        ...publicCandidate
      } = candidate;
      return {
        ...publicCandidate,
        baseRelevance,
        rankingFusion: {
          calibratedScore: baseRelevance,
          fusionScore,
          k: recommendationRrfK,
          routes: candidateRoutes,
          version: "recommendation-ranking-fusion/v1"
        },
        scoreComponents: {
          ...candidate.scoreComponents,
          fusionScore,
          ...(lexicalScores.has(candidate.id)
            ? { lexicalRelevance: lexicalScores.get(candidate.id) }
            : {}),
          preFusionRelevance
        }
      };
    })
  };
}

function recommendationDoiKey(value) {
  const normalized = typeof value === "string"
    ? value.trim()
        .replace(/^doi:/i, "")
        .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
        .toLowerCase()
    : "";
  return /^10\.\d{4,9}\/\S+$/.test(normalized) ? normalized : "";
}

function recommendationArxivKey(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  const match = normalized.match(
    /(?:arxiv[:/\s.]+|abs\/|pdf\/)?([a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)/i
  );
  return (match?.[1] ?? "").replace(/\.pdf$/i, "").replace(/v\d+$/i, "").toLowerCase();
}

function resolveRecommendationIdentity(source) {
  const records = (Array.isArray(source?.sourceRecords) && source.sourceRecords.length > 0
    ? source.sourceRecords
    : [{
        id: source?.id,
        provider: source?.provider,
        ...(source?.arxivId ? { arxivId: source.arxivId } : {}),
        ...(source?.doi ? { doi: source.doi } : {}),
        ...(source?.sourceRecordUrl ? { recordUrl: source.sourceRecordUrl } : {}),
        title: source?.title,
        url: source?.url,
        ...(Number.isInteger(source?.year) ? { year: source.year } : {})
      }])
    .filter((record) => record && typeof record.id === "string" &&
      (record.provider === "openalex" || record.provider === "crossref" || record.provider === "arxiv"))
    .slice(0, 6);
  const doi = recommendationDoiKey(source?.doi ?? source?.canonicalPaperId) ||
    records.map((record) => recommendationDoiKey(record.doi)).find(Boolean);
  const arxivId = recommendationArxivKey(source?.arxivId ?? source?.canonicalPaperId) ||
    records.map((record) => recommendationArxivKey(record.arxivId ?? record.doi)).find(Boolean);
  const aliases = [...new Set([
    ...records.map((record) => record.id),
    ...(arxivId ? [`arxiv:${arxivId}`] : [])
  ])];
  const providers = [...new Set(records.map((record) => record.provider))];
  const years = records.map((record) => record.year).filter(Number.isInteger);
  const recordDois = new Set(records.map((record) => recommendationDoiKey(record.doi)).filter(Boolean));
  const declaringArxivRecord = doi
    ? records.find((record) => record.provider === "arxiv" &&
      recommendationDoiKey(record.doi) === doi &&
      recommendationArxivKey(record.arxivId ?? record.id) === arxivId)
    : undefined;
  const corroboratingPublicationRecord = doi
    ? records.find((record) => record.provider !== "arxiv" && recommendationDoiKey(record.doi) === doi)
    : undefined;
  const hasProviderDeclaredPublicationLink = Boolean(
    declaringArxivRecord && corroboratingPublicationRecord
  );
  const hasArxivOnlyRecord = arxivId && records.some((record) => !recommendationDoiKey(record.doi) &&
    recommendationArxivKey(record.arxivId ?? record.doi) === arxivId);
  const lineageStatus = hasProviderDeclaredPublicationLink
    ? "provider_declared_publication_link"
    : doi && arxivId && (recordDois.size > 1 || hasArxivOnlyRecord)
      ? "possible_version_family"
      : records.length > 1
        ? "same_identifier"
        : "single_record";
  const titles = records.map((record) => record.title).filter((title) => typeof title === "string");
  const titleConsistent = titles.every((title, index) => index === 0 ||
    normalizeRecommendationTitle(title) === normalizeRecommendationTitle(titles[0]) ||
    tokenSimilarity(title, titles[0]) >= 0.4);
  const maximumYearDifference = lineageStatus === "provider_declared_publication_link"
    ? 10
    : lineageStatus === "possible_version_family"
      ? 5
      : 1;
  const yearConsistent = years.length < 2 ||
    Math.max(...years) - Math.min(...years) <= maximumYearDifference;
  return {
    aliases,
    ...(arxivId ? { arxivId } : {}),
    canonicalId: doi ? `doi:${doi}` : arxivId ? `arxiv:${arxivId}` : source?.id,
    ...(doi ? { doi: `https://doi.org/${doi}` } : {}),
    ...(hasProviderDeclaredPublicationLink ? {
      lineageEvidence: {
        declaredBy: "arxiv",
        relation: "arxiv_declared_doi",
        sourceId: declaringArxivRecord.id,
        ...(declaringArxivRecord.recordUrl
          ? { sourceRecordUrl: declaringArxivRecord.recordUrl }
          : {}),
        targetId: `doi:${doi}`
      }
    } : {}),
    lineageStatus,
    providers,
    records,
    consistent: titleConsistent && yearConsistent,
    version: "recommendation-identity/v2"
  };
}

function recommendationIdentityReason(identity) {
  if (identity.providers.length < 2) {
    return "";
  }
  const providers = identity.providers.join(" / ");
  if (identity.lineageStatus === "possible_version_family") {
    return ` 已依据共享 arXiv 标识归入 ${providers} 的可能版本族，具体版本关系尚未核验。`;
  }
  if (identity.lineageStatus === "provider_declared_publication_link") {
    return ` arXiv 元数据明确声明该 DOI，并由 ${providers} 的同 DOI 记录交叉确认；这证明记录级出版关联，但尚未核验两版全文内容等价。`;
  }
  return identity.doi
    ? ` 已按 DOI 合并 ${providers} 来源记录。`
    : ` 已按 arXiv ID 合并 ${providers} 来源记录。`;
}

const researchProfileLimits = {
  datasets: 12,
  languages: 6,
  methods: 12,
  topics: 12
};

export function normalizeRecommendationResearchProfile(value) {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "research_profile_invalid", ok: false };
  }
  const normalized = {};
  for (const [field, limit] of Object.entries(researchProfileLimits)) {
    const items = value[field];
    if (!Array.isArray(items) || items.length > limit || items.some((item) => (
      typeof item !== "string" || item.trim().length === 0 || item.trim().length > 80
    ))) {
      return { error: `research_profile_${field}_invalid`, ok: false };
    }
    normalized[field] = [...new Set(items.map((item) => item.trim().replace(/\s+/g, " ")))];
  }
  return { ok: true, value: normalized };
}

function candidateProfileSignal(source, researchProfile) {
  if (!researchProfile) {
    return { adjustment: 0 };
  }
  const weightedFields = [
    ["topics", 0.12],
    ["methods", 0.1],
    ["datasets", 0.08]
  ];
  let adjustment = 0;
  let bestMatch;
  let bestSimilarity = 0;
  for (const [field, weight] of weightedFields) {
    for (const item of researchProfile[field]) {
      const similarity = tokenSimilarity(source.title, item);
      adjustment += similarity * weight;
      if (similarity > bestSimilarity) {
        bestMatch = item;
        bestSimilarity = similarity;
      }
    }
  }
  return {
    adjustment: Number(Math.min(0.2, adjustment).toFixed(3)),
    ...(bestSimilarity >= 0.25 ? { bestMatch } : {})
  };
}

function candidateFeedbackSignal(source, identity, feedback) {
  const exact = feedback.find((item) => (
    (item.canonicalId && (
      item.canonicalId === identity.canonicalId || identity.aliases.includes(item.canonicalId)
    )) ||
    normalizeRecommendationTitle(item.title) === normalizeRecommendationTitle(source.title)
  ));
  if (exact) {
    return { adjustment: 0, excludedBy: exact.action };
  }
  let positiveSimilarity = 0;
  let negativeSimilarity = 0;
  for (const item of feedback) {
    const similarity = tokenSimilarity(source.title, item.title);
    if (item.action === "saved") positiveSimilarity = Math.max(positiveSimilarity, similarity);
    if (item.action === "dismissed") negativeSimilarity = Math.max(negativeSimilarity, similarity);
  }
  const adjustment = Math.max(-0.25, Math.min(0.15,
    positiveSimilarity * 0.15 - negativeSimilarity * 0.25
  ));
  return { adjustment: Number(adjustment.toFixed(3)) };
}

function evaluateRecommendationQuality(source, identity, now) {
  const currentYear = now.getUTCFullYear();
  const checks = {
    canonicalIdentity: typeof identity.canonicalId === "string" &&
      /^(doi:10\.\d{4,9}\/\S+|arxiv:[a-z-]+(?:\.[a-z]{2})?\/\d{7}|arxiv:\d{4}\.\d{4,5}|openalex:W\d+|crossref:10\.)/i.test(identity.canonicalId),
    crossProviderConsistent: identity.consistent,
    notKnownRetracted: source?.isRetracted !== true,
    plausiblePublicationYear: source?.year === undefined ||
      (Number.isInteger(source.year) && source.year >= 1600 && source.year <= currentYear + 1),
    supportedProvider: identity.providers.length > 0 &&
      identity.providers.every((provider) => (
        provider === "openalex" || provider === "crossref" || provider === "arxiv"
      )),
    traceableHttpsSource: typeof source?.url === "string" && /^https:\/\//i.test(source.url),
    usableTitle: typeof source?.title === "string" &&
      normalizeRecommendationTitle(source.title).length >= 5
  };
  const reasons = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([check]) => check);
  return {
    checks,
    passed: reasons.length === 0,
    reasons,
    version: "recommendation-quality/v1"
  };
}

function rerankRecommendationDiversity(candidates, limit = 8) {
  const remaining = [...candidates];
  const selected = [];

  while (remaining.length > 0 && selected.length < limit) {
    let bestIndex = 0;
    let bestCandidate;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const maximumSimilarity = selected.reduce((maximum, selectedCandidate) => (
        Math.max(maximum, tokenSimilarity(candidate.title, selectedCandidate.title))
      ), 0);
      const diversityPenalty = Number(Math.min(0.18, maximumSimilarity * 0.18).toFixed(3));
      const finalScore = Number(Math.max(0, candidate.baseRelevance - diversityPenalty).toFixed(3));
      const rankedCandidate = { candidate, diversityPenalty, finalScore };

      if (!bestCandidate ||
        rankedCandidate.finalScore > bestCandidate.finalScore ||
        (rankedCandidate.finalScore === bestCandidate.finalScore &&
          rankedCandidate.candidate.baseRelevance > bestCandidate.candidate.baseRelevance) ||
        (rankedCandidate.finalScore === bestCandidate.finalScore &&
          rankedCandidate.candidate.baseRelevance === bestCandidate.candidate.baseRelevance &&
          rankedCandidate.candidate.title.localeCompare(bestCandidate.candidate.title) < 0)) {
        bestCandidate = rankedCandidate;
        bestIndex = index;
      }
    }

    const [{ baseRelevance, ...candidate }] = remaining.splice(bestIndex, 1);
    const diversityReason = bestCandidate.diversityPenalty >= 0.03
      ? " 为避免相近主题重复占满列表，已施加可审计的多样性降权。"
      : "";
    const fusionReason = candidate.rankingFusion?.routes?.length > 1
      ? ` 已通过 ${candidate.rankingFusion.routes.map((route) => route.id).join(" / ")} 多路排名的 RRF 融合校准顺序。`
      : "";
    selected.push({
      ...candidate,
      relevanceBand: relevanceBand(bestCandidate.finalScore),
      relevanceScore: bestCandidate.finalScore,
      reason: `${candidate.reason}${fusionReason}${diversityReason}`,
      scoreComponents: {
        ...candidate.scoreComponents,
        baseRelevance,
        diversityPenalty: bestCandidate.diversityPenalty,
        finalScore: bestCandidate.finalScore
      }
    });
  }

  return selected;
}

/**
 * Converts already-retrieved, provenance-bearing literature sources into
 * reading candidates. This boundary deliberately does not turn candidates
 * into thin-reading evidence.
 */
export function buildLiveRecommendationPayload(body, sourceGroups, now = new Date(), feedback = []) {
  const selectedDocuments = Array.isArray(body?.selectedDocuments) ? body.selectedDocuments : [];
  const selectedTitles = new Set(selectedDocuments
    .map((document) => normalizeRecommendationTitle(document?.title))
    .filter(Boolean));
  const candidates = new Map();
  const identityConflicts = new Set();
  const profileResult = normalizeRecommendationResearchProfile(body?.researchProfile);
  const researchProfile = profileResult.ok ? profileResult.value : undefined;
  let evaluatedCandidateCount = 0;
  let rejectedCandidateCount = 0;

  for (const group of Array.isArray(sourceGroups) ? sourceGroups : []) {
    const relatedDocumentTitle = typeof group?.relatedDocumentTitle === "string"
      ? group.relatedDocumentTitle
      : "当前选中文献";
    const rankingQuery = typeof group?.semanticQuery === "string" && group.semanticQuery.trim()
      ? group.semanticQuery.trim()
      : relatedDocumentTitle;
    for (const source of Array.isArray(group?.sources) ? group.sources : []) {
      evaluatedCandidateCount += 1;
      const identityResolution = resolveRecommendationIdentity(source);
      const qualityGate = evaluateRecommendationQuality(source, identityResolution, now);
      if (!qualityGate.passed || selectedTitles.has(normalizeRecommendationTitle(source?.title))) {
        rejectedCandidateCount += 1;
        continue;
      }
      const feedbackSignal = candidateFeedbackSignal(
        source,
        identityResolution,
        Array.isArray(feedback) ? feedback : []
      );
      if (feedbackSignal.excludedBy) {
        continue;
      }
      const providerRelevance = Math.max(0, Math.min(1, Number(source.relevance) || 0));
      const semanticRelevance = Number.isFinite(source.semanticRelevance)
        ? Math.max(0, Math.min(1, Number(source.semanticRelevance)))
        : undefined;
      const sourceRelevance = semanticRelevance === undefined
        ? providerRelevance
        : Number((providerRelevance * 0.65 + semanticRelevance * 0.35).toFixed(3));
      const profileSignal = candidateProfileSignal(source, researchProfile);
      const personalizationRelevance = Number((
        feedbackSignal.adjustment + profileSignal.adjustment
      ).toFixed(3));
      const baseRelevance = Number(Math.max(0, Math.min(1,
        sourceRelevance + personalizationRelevance
      )).toFixed(3));
      const preferenceReason = feedbackSignal.adjustment >= 0.03
        ? " 与你已收藏主题相近，相关性排序已提高。"
        : feedbackSignal.adjustment <= -0.03
          ? " 与你曾忽略的主题相近，相关性排序已降低。"
          : "";
      const profileReason = profileSignal.bestMatch && profileSignal.adjustment >= 0.02
        ? ` 与研究画像中的“${profileSignal.bestMatch}”相匹配，画像相关性提高 ${profileSignal.adjustment.toFixed(3)}。`
        : "";
      const semanticReason = semanticRelevance === undefined
        ? ""
        : ` 配置的真实 embedding provider 给出语义相关度 ${semanticRelevance.toFixed(3)}；该值以 0.35 权重校准来源相关度，并作为独立 semantic rank 进入 RRF。`;
      const candidate = {
        ...(typeof source.abstract === "string" && source.abstract.trim()
          ? { abstract: source.abstract.replace(/\s+/g, " ").trim().slice(0, 4000) }
          : {}),
        ...(Array.isArray(source.authors) ? {
          authors: source.authors
            .filter((author) => typeof author === "string" && author.trim())
            .map((author) => author.replace(/\s+/g, " ").trim().slice(0, 160))
            .slice(0, 12)
        } : {}),
        canonicalId: identityResolution.canonicalId,
        discoveredAt: source.fromCandidatePool && typeof source.discoveredAt === "string"
          ? source.discoveredAt
          : now.toISOString(),
        id: `reading-candidate:${identityResolution.canonicalId}`,
        identityResolution,
        ...(Number.isInteger(source.year) ? { publishedYear: source.year } : {}),
        ...(source.openAccessAvailable === true ? { openAccessAvailable: true } : {}),
        personalizationRelevance,
        qualityGate,
        rankingQueries: [rankingQuery],
        rankingText: [
          source.title,
          source.abstract,
          ...(Array.isArray(source.authors) ? source.authors.slice(0, 6) : [])
        ].filter(Boolean).join(" "),
        relatedDocumentTitle,
        relatedDocumentTitles: [relatedDocumentTitle],
        ...(source.relation ? { relation: source.relation } : {}),
        baseRelevance,
        reason: `${recommendationReason(source)}${recommendationIdentityReason(identityResolution)}${preferenceReason}${profileReason}${semanticReason}${source.fromCandidatePool
          ? " 该候选来自近期持久候选池，本轮未将其标记为新发现。"
          : ""}`,
        scoreComponents: {
          preference: feedbackSignal.adjustment,
          profileRelevance: profileSignal.adjustment,
          providerRelevance,
          ...(semanticRelevance === undefined ? {} : { semanticRelevance }),
          sourceRelevance
        },
        primaryProvider: source.provider,
        source: identityResolution.providers.map((provider) => (
          provider === "openalex" ? "OpenAlex" : provider === "crossref" ? "Crossref" : "arXiv"
        )).join(" + "),
        sourceKind: source.fromCandidatePool ? "cache" : "live",
        sourceUrl: source.url,
        title: source.title
      };
      const existing = candidates.get(candidate.id);
      if (identityConflicts.has(candidate.id)) {
        continue;
      }
      if (!existing) {
        candidates.set(candidate.id, candidate);
        continue;
      }
      const records = [...new Map([
        ...existing.identityResolution.records,
        ...candidate.identityResolution.records
      ].map((record) => [`${record.provider}:${record.id}`, record])).values()].slice(0, 6);
      const combinedIdentity = resolveRecommendationIdentity({
        ...source,
        canonicalPaperId: existing.identityResolution.canonicalId,
        doi: existing.identityResolution.doi ?? candidate.identityResolution.doi,
        sourceRecords: records
      });
      if (!combinedIdentity.consistent) {
        candidates.delete(candidate.id);
        identityConflicts.add(candidate.id);
        rejectedCandidateCount += 1;
        continue;
      }
      const preferred = candidate.baseRelevance > existing.baseRelevance ? candidate : existing;
      const identityReason = recommendationIdentityReason(combinedIdentity);
      const mergedReason = preferred.reason.includes("来源记录") || preferred.reason.includes("可能版本族")
        ? preferred.reason
        : `${preferred.reason}${identityReason}`;
      candidates.set(candidate.id, {
        ...preferred,
        identityResolution: combinedIdentity,
        personalizationRelevance: Math.max(
          existing.personalizationRelevance,
          candidate.personalizationRelevance
        ),
        rankingQueries: [...new Set([
          ...existing.rankingQueries,
          ...candidate.rankingQueries
        ])].slice(0, 8),
        rankingText: [...new Set([
          existing.rankingText,
          candidate.rankingText
        ].filter(Boolean))].join(" ").slice(0, 6000),
        reason: mergedReason,
        relatedDocumentTitles: [...new Set([
          ...existing.relatedDocumentTitles,
          ...candidate.relatedDocumentTitles
        ])].slice(0, 12),
        source: combinedIdentity.providers.map((provider) => (
          provider === "openalex" ? "OpenAlex" : provider === "crossref" ? "Crossref" : "arXiv"
        )).join(" + ")
      });
    }
  }

  const fusion = fuseRecommendationRanks(candidates.values());
  return {
    qualityGate: {
      accepted: candidates.size,
      evaluated: evaluatedCandidateCount,
      rejected: rejectedCandidateCount,
      version: "recommendation-quality/v1"
    },
    rankingFusion: fusion.audit,
    recommendations: rerankRecommendationDiversity(fusion.candidates)
  };
}

export function buildDocumentMetadataSyncPayload(body) {
  const documents = Array.isArray(body.documents) ? body.documents : [];
  const validDocuments = documents.filter(
    (document) =>
      typeof document?.id === "string" &&
      typeof document?.title === "string" &&
      (typeof document?.sourcePath === "string" ||
        typeof document?.sourcePath === "undefined")
  );
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "anonymous";
  const workspaceRevision = Number.isFinite(body.workspaceRevision)
    ? body.workspaceRevision
    : 0;

  return {
    result: {
      acceptedCount: validDocuments.length,
      rejectedCount: documents.length - validDocuments.length,
      syncId: `metadata-${sessionId}-r${workspaceRevision}`,
      syncedAt: "2026-05-14T10:20:00Z"
    }
  };
}
