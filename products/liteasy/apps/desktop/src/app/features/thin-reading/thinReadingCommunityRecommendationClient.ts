import type { ModelTransportResponse } from "../models/modelHttpClient";
import type { ThinReadingRecommendationScope } from "./thinReading.types";

export type ThinReadingCommunityRecommendation = {
  compatibility: number;
  id: string;
  note: string;
  literatureId: string;
  relationship: string;
  source: "intuecho_community";
};

export type ThinReadingCommunityRecommendationTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type ThinReadingCommunityRecommendationTransport = (
  request: ThinReadingCommunityRecommendationTransportRequest
) => Promise<ModelTransportResponse>;

type CommunityRecommendationPayload = {
  recommendations: ThinReadingCommunityRecommendation[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function communityRecommendationUrl(endpoint: string) {
  const url = new URL(endpoint);
  const loopback = url.protocol === "http:" && new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname);
  if ((url.protocol !== "https:" && !loopback) || url.username || url.password) {
    throw new Error("Intuecho 推荐端点必须是 HTTPS 地址。");
  }
  url.hash = "";
  url.search = "";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/thin-reading/recommendations:query`;
  return url.toString();
}

function isCommunityRecommendation(
  value: unknown,
  literatureId: string
): value is ThinReadingCommunityRecommendation {
  return isRecord(value) && typeof value.id === "string" && value.id.trim().length > 0 &&
    typeof value.relationship === "string" && value.relationship.trim().length > 0 &&
    typeof value.note === "string" && value.note.trim().length > 0 &&
    typeof value.compatibility === "number" && Number.isFinite(value.compatibility) &&
    value.compatibility >= 0 && value.compatibility <= 1 &&
    value.source === "intuecho_community" && value.literatureId === literatureId;
}

function communityScopePayload(scope: ThinReadingRecommendationScope, literatureId: string) {
  return {
    ...(scope.kind === "section" ? { sectionKey: scope.sectionKey } : {}),
    ...(scope.kind === "selected_passage" ? {
      evidenceIds: scope.evidenceIds ?? [],
      externalSourceIds: scope.externalSourceIds ?? []
    } : {}),
    kind: scope.kind === "whole_paper" ? "document" : scope.kind,
    literatureId
  };
}

async function defaultTransport(
  request: ThinReadingCommunityRecommendationTransportRequest
): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export function hasThinReadingCommunityIdentity(scope: ThinReadingRecommendationScope) {
  return Boolean(scope.literatureId?.trim());
}

export function createThinReadingCommunityRecommendationClient(input: {
  endpoint: string;
  sessionId?: string;
  transport?: ThinReadingCommunityRecommendationTransport;
}) {
  const transport = input.transport ?? defaultTransport;

  return async (scope: ThinReadingRecommendationScope): Promise<readonly ThinReadingCommunityRecommendation[]> => {
    const literatureId = scope.literatureId?.trim();
    if (!literatureId) {
      throw new Error("当前文献尚未完成来源确认，无法读取 Intuecho 社区推荐。");
    }
    if (!input.sessionId) {
      throw new Error("请先登录 Liteasy 再读取 Intuecho 社区推荐。");
    }
    const response = await transport({
      body: JSON.stringify({ scope: communityScopePayload(scope, literatureId) }),
      headers: { Authorization: `Bearer ${input.sessionId}`, "content-type": "application/json" },
      method: "POST",
      url: communityRecommendationUrl(input.endpoint)
    });
    if (!response.ok) {
      throw new Error(`Intuecho 社区推荐请求失败（HTTP ${response.status}）。`);
    }
    const payload = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.recommendations) ||
      !payload.recommendations.every((item) => isCommunityRecommendation(item, literatureId))) {
      throw new Error("Intuecho 社区推荐响应无效或不属于当前文献。");
    }
    return Object.freeze(payload.recommendations.map((recommendation) => Object.freeze({
      compatibility: recommendation.compatibility,
      id: recommendation.id,
      note: recommendation.note,
      literatureId: recommendation.literatureId,
      relationship: recommendation.relationship,
      source: "intuecho_community" as const
    })));
  };
}
