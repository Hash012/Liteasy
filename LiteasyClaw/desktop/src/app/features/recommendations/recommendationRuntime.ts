import {
  createRecommendationClient,
  type RecommendationTransport
} from "./recommendationClient";
import type { RecommendationItem, RecommendationRequestDocument } from "./recommendation.types";
import type { SettingsState } from "../settings/settings.types";

type RecommendationRuntimeInput = {
  controlPlaneEndpoint: string;
  sortMode: SettingsState["network.recommendation.sort_mode"];
  selectedDocuments: RecommendationRequestDocument[];
  sessionId: string;
};

type RecommendationRuntimeDeps = {
  transport?: RecommendationTransport;
};

function buildMockRecommendations(
  selectedDocuments: RecommendationRequestDocument[]
): RecommendationItem[] {
  if (selectedDocuments.some((document) => document.title.includes("ACORN"))) {
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

  if (selectedDocuments.some((document) => document.title.includes("Vector Database"))) {
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

function sortRecommendations(
  items: RecommendationItem[],
  sortMode: SettingsState["network.recommendation.sort_mode"]
) {
  const nextItems = [...items];

  if (sortMode === "retrieved_at") {
    return nextItems.sort((left, right) => right.discoveredAt.localeCompare(left.discoveredAt));
  }

  return nextItems.sort((left, right) => right.relevanceScore - left.relevanceScore);
}

function isMockEndpoint(endpoint: string) {
  return endpoint.startsWith("mock://");
}

export async function fetchCloudRecommendations(
  input: RecommendationRuntimeInput,
  deps: RecommendationRuntimeDeps = {}
) {
  if (isMockEndpoint(input.controlPlaneEndpoint)) {
    return sortRecommendations(buildMockRecommendations(input.selectedDocuments), input.sortMode);
  }

  const client = createRecommendationClient({
    endpoint: input.controlPlaneEndpoint,
    transport: deps.transport
  });

  const items = await client({
    selectedDocuments: input.selectedDocuments,
    sessionId: input.sessionId
  });

  return sortRecommendations(items, input.sortMode);
}
