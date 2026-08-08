import type { ModelTransportResponse } from "../models/modelHttpClient";
import type { RecommendationItem } from "./recommendation.types";

export type RecommendationFeedbackAction = "dismissed" | "saved";

export type RecommendationFeedbackTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type RecommendationFeedbackTransport = (
  request: RecommendationFeedbackTransportRequest
) => Promise<ModelTransportResponse>;

async function defaultTransport(request: RecommendationFeedbackTransportRequest) {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export function createRecommendationFeedbackClient(input: {
  endpoint: string;
  transport?: RecommendationFeedbackTransport;
}) {
  return async (request: {
    action: RecommendationFeedbackAction;
    candidate: RecommendationItem;
    sessionId: string;
  }) => {
    const response = await (input.transport ?? defaultTransport)({
      body: JSON.stringify({
        action: request.action,
        candidate: {
          canonicalId: request.candidate.canonicalId,
          id: request.candidate.id,
          source: request.candidate.source,
          title: request.candidate.title
        },
        idempotencyKey: `recommendation-feedback-${globalThis.crypto.randomUUID()}`,
        sessionId: request.sessionId
      }),
      headers: {
        Authorization: `Bearer ${request.sessionId}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      url: `${input.endpoint.replace(/\/+$/, "")}/v1/recommendations/feedback`
    });
    if (!response.ok) {
      throw new Error(`推荐反馈保存失败（${response.status}）`);
    }
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || !("feedback" in payload) ||
      typeof payload.feedback !== "object" || payload.feedback === null ||
      !("action" in payload.feedback) || payload.feedback.action !== request.action) {
      throw new Error("推荐反馈返回格式无效");
    }
    return payload.feedback;
  };
}
