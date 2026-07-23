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
