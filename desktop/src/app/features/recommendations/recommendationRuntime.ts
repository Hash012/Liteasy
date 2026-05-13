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
  if (selectedDocuments.some((document) => document.title.includes("BERT"))) {
    return [
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
    ];
  }

  return [
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
