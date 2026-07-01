export function buildRecommendationPayload(body) {
  const selectedDocuments = Array.isArray(body.selectedDocuments) ? body.selectedDocuments : [];
  const selectedTitles = selectedDocuments
    .filter((document) => typeof document?.title === "string")
    .map((document) => document.title);

  if (selectedTitles.some((title) => title.includes("BERT"))) {
    return {
      recommendations: [
        {
          discoveredAt: "2026-05-14T08:15:00Z",
          id: "rec-bert-1",
          relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
          relevanceBand: "high",
          relevanceScore: 0.92,
          reason: "同样关注大规模预训练语言模型的迁移能力。",
          source: "Semantic Scholar",
          title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
        },
        {
          discoveredAt: "2026-05-14T09:10:00Z",
          id: "rec-bert-2",
          relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
          relevanceBand: "medium",
          relevanceScore: 0.78,
          reason: "延续 BERT 路线，强调参数共享与效率优化。",
          source: "arXiv Watch",
          title: "ALBERT: A Lite BERT for Self-supervised Learning of Language Representations"
        }
      ]
    };
  }

  return {
    recommendations: [
      {
        discoveredAt: "2026-05-14T07:30:00Z",
        id: "rec-transformer-1",
        relatedDocumentTitle: "Attention Is All You Need",
        relevanceBand: "high",
        relevanceScore: 0.91,
        reason: "延伸 Transformer 在视觉任务中的应用脉络。",
        source: "Semantic Scholar",
        title: "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale"
      },
      {
        discoveredAt: "2026-05-14T09:00:00Z",
        id: "rec-transformer-2",
        relatedDocumentTitle: "Attention Is All You Need",
        relevanceBand: "medium",
        relevanceScore: 0.75,
        reason: "补充长序列建模方向，便于横向比较注意力结构。",
        source: "Connected Papers",
        title: "Longformer: The Long-Document Transformer"
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
