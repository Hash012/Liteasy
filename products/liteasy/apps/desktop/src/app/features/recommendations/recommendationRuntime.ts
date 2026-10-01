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
  // Existing API accepts three documents per request. Batch instead of silently discarding selections.
  const documents = await Promise.all(input.selectedDocuments.slice(0, 16).map(async (document) => {
    const bounded = { ...document, title: document.title.slice(0, 500), ...(document.abstract ? { abstract: document.abstract.slice(0, 12000) } : {}) };
    if (document.id.length <= 300) return bounded;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(document.id));
    return { ...bounded, id: `asset:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2,"0")).join("")}` };
  }));
  const batches = documents.length ? Array.from({ length: Math.ceil(documents.length / 3) }, (_, index) => documents.slice(index * 3, index * 3 + 3)) : [[]];
  const results: Awaited<ReturnType<typeof client>>[] = new Array(batches.length);
  const errors: unknown[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3,batches.length) }, async () => {
    while (cursor < batches.length) {
      input.signal?.throwIfAborted(); const index = cursor++;
      try { results[index] = await client({ style: input.style, signal: input.signal, researchProfile: input.researchProfile, selectedDocuments: batches[index], sessionId: input.sessionId }); }
      catch (error) { input.signal?.throwIfAborted(); errors.push(error); results[index] = []; }
    }
  }));
  input.signal?.throwIfAborted();
  if (errors.length === batches.length) throw errors[0];
  return rankRecommendations(results.flat(), input).slice(0, 200);
}
