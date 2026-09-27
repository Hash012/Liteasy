import {
  createRecommendationClient,
  type RecommendationTransport
} from "./recommendationClient";
import type {
  RecommendationStyle,
  RecommendationRequestDocument,
  RecommendationResearchProfile
} from "./recommendation.types";
import type { SettingsState } from "../settings/settings.types";
import { rankRecommendations } from "./recommendationRanking";

export type RecommendationRuntimeInput = {
  style?: RecommendationStyle;
  signal?: AbortSignal;
  controlPlaneEndpoint: string;
  researchProfile?: RecommendationResearchProfile;
  sortMode: SettingsState["network.recommendation.sort_mode"];
  selectedDocuments: RecommendationRequestDocument[];
  sessionId: string;
};

type RecommendationRuntimeDeps = {
  transport?: RecommendationTransport;
};

export async function fetchCloudRecommendations(
  input: RecommendationRuntimeInput,
  deps: RecommendationRuntimeDeps = {}
) {
  const client = createRecommendationClient({
    endpoint: input.controlPlaneEndpoint,
    transport: deps.transport
  });
  const items = await client({
    style: input.style,
    signal: input.signal,
    researchProfile: input.researchProfile,
    selectedDocuments: input.selectedDocuments,
    sessionId: input.sessionId
  });
  return rankRecommendations(items, input);
}
