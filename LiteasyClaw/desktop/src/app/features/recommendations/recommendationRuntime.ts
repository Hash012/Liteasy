import {
  createRecommendationClient,
  type RecommendationTransport
} from "./recommendationClient";
import type {
  RecommendationItem,
  RecommendationRequestDocument,
  RecommendationResearchProfile
} from "./recommendation.types";
import type { SettingsState } from "../settings/settings.types";

type RecommendationRuntimeInput = {
  controlPlaneEndpoint: string;
  researchProfile?: RecommendationResearchProfile;
  sortMode: SettingsState["network.recommendation.sort_mode"];
  selectedDocuments: RecommendationRequestDocument[];
  sessionId: string;
};

type RecommendationRuntimeDeps = {
  transport?: RecommendationTransport;
};

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

export async function fetchCloudRecommendations(
  input: RecommendationRuntimeInput,
  deps: RecommendationRuntimeDeps = {}
) {
  const client = createRecommendationClient({
    endpoint: input.controlPlaneEndpoint,
    transport: deps.transport
  });
  const items = await client({
    researchProfile: input.researchProfile,
    selectedDocuments: input.selectedDocuments,
    sessionId: input.sessionId
  });
  return sortRecommendations(items, input.sortMode);
}
