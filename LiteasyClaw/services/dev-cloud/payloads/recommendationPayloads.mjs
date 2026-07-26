export function buildRecommendationPayload(body) {
  const selectedDocuments = Array.isArray(body.selectedDocuments) ? body.selectedDocuments : [];
  const selectedTitles = selectedDocuments
    .filter((document) => typeof document?.title === "string")
    .map((document) => document.title);

  if (selectedTitles.some((title) => title.includes("ACORN"))) {
    return {
      recommendations: [
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
      ]
    };
  }

  if (selectedTitles.some((title) => title.includes("Vector Database"))) {
    return {
      recommendations: [
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
      ]
    };
  }

  return {
    recommendations: [
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
    ]
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
