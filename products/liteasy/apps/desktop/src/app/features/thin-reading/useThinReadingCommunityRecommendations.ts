import { useEffect, useMemo, useState } from "react";
import {
  createThinReadingCommunityRecommendationClient,
  hasThinReadingCommunityIdentity,
  type ThinReadingCommunityRecommendation
} from "./thinReadingCommunityRecommendationClient";
import type { ThinReadingRecommendationScope } from "./thinReading.types";

export type ThinReadingCommunityRecommendationState =
  | { recommendations: readonly ThinReadingCommunityRecommendation[]; status: "ready" }
  | { recommendations: readonly ThinReadingCommunityRecommendation[]; status: "unconfigured" | "unavailable" | "loading" }
  | { message: string; recommendations: readonly ThinReadingCommunityRecommendation[]; status: "error" };

const unconfiguredState: ThinReadingCommunityRecommendationState = Object.freeze({
  recommendations: Object.freeze([]),
  status: "unconfigured"
});

function scopeKey(scope: ThinReadingRecommendationScope) {
  const identity = scope.paperIdentity?.primary;
  return JSON.stringify({
    evidenceIds: scope.kind === "selected_passage" ? scope.evidenceIds ?? [] : [],
    externalSourceIds: scope.kind === "selected_passage" ? scope.externalSourceIds ?? [] : [],
    identity: identity ? { kind: identity.kind, value: identity.value } : undefined,
    kind: scope.kind,
    sectionKey: scope.kind === "section" ? scope.sectionKey : undefined
  });
}

export function useThinReadingCommunityRecommendations(input: {
  endpoint?: string;
  sessionId?: string;
  scope: ThinReadingRecommendationScope;
}): ThinReadingCommunityRecommendationState {
  const endpoint = input.endpoint?.trim() ?? "";
  const requestKey = useMemo(() => scopeKey(input.scope), [input.scope]);
  const [state, setState] = useState<ThinReadingCommunityRecommendationState>(unconfiguredState);

  useEffect(() => {
    if (!endpoint) {
      setState(unconfiguredState);
      return;
    }
    if (!hasThinReadingCommunityIdentity(input.scope)) {
      setState(Object.freeze({ recommendations: Object.freeze([]), status: "unavailable" }));
      return;
    }

    let active = true;
    setState(Object.freeze({ recommendations: Object.freeze([]), status: "loading" }));
    void createThinReadingCommunityRecommendationClient({ endpoint, sessionId: input.sessionId })(input.scope)
      .then((recommendations) => {
        if (active) {
          setState(Object.freeze({ recommendations, status: "ready" }));
        }
      })
      .catch((error) => {
        if (active) {
          setState(Object.freeze({
            message: error instanceof Error ? error.message : String(error),
            recommendations: Object.freeze([]),
            status: "error"
          }));
        }
      });
    return () => {
      active = false;
    };
  }, [endpoint, input.scope, input.sessionId, requestKey]);

  return state;
}
