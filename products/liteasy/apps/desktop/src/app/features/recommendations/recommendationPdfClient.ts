import { loadStoredAccountSession } from "../account/accountSessionStorage";
import {
  downloadExternalPdf,
  type DownloadedExternalPdf
} from "../library/externalPdfDownload";
import type { ModelTransport, ModelTransportResponse } from "../models/modelHttpClient";
import type { RecommendationItem } from "./recommendation.types";

type RecommendationPdfGrant = {
  fullTextGrantId: string;
  fullTextUrl: string;
  sourceId: string;
};

function isGrant(value: unknown): value is RecommendationPdfGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const grant = value as Partial<RecommendationPdfGrant>;
  return typeof grant.fullTextGrantId === "string" &&
    /^pdfgrant_[A-Za-z0-9-]+$/.test(grant.fullTextGrantId) &&
    typeof grant.fullTextUrl === "string" && /^https:\/\//i.test(grant.fullTextUrl) &&
    typeof grant.sourceId === "string";
}

async function defaultTransport(request: Parameters<ModelTransport>[0]): Promise<ModelTransportResponse> {
  const sessionId = loadStoredAccountSession()?.sessionId;
  if (!sessionId) throw new Error("登录已失效，请重新登录后保存推荐文献。");
  return fetch(request.url, {
    body: request.body,
    headers: { ...request.headers, Authorization: `Bearer ${sessionId}` },
    method: request.method,
    signal: request.signal
  });
}

export async function downloadRecommendationPdf(input: {
  endpoint: string;
  recommendation: RecommendationItem;
  transport?: ModelTransport;
}): Promise<DownloadedExternalPdf | null> {
  if (!input.recommendation.openAccessAvailable) return null;
  const transport = input.transport ?? defaultTransport;
  const grantResponse = await transport({
    body: JSON.stringify({ candidateId: input.recommendation.id }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    url: `${input.endpoint.replace(/\/+$/, "")}/v1/recommendations/pdf-grant`
  });
  const grantPayload = await grantResponse.json();
  if (!grantResponse.ok) {
    const code = grantPayload && typeof grantPayload === "object" && "code" in grantPayload
      ? grantPayload.code
      : undefined;
    if (grantResponse.status === 404 && code === "recommendation_pdf_unavailable") return null;
    const message = grantPayload && typeof grantPayload === "object" && "message" in grantPayload &&
      typeof grantPayload.message === "string"
      ? grantPayload.message
      : `开放全文授权失败（${grantResponse.status}）。`;
    throw new Error(message);
  }
  if (!isGrant(grantPayload) || grantPayload.sourceId !== input.recommendation.id) {
    throw new Error("开放全文授权返回的数据无效。");
  }
  return downloadExternalPdf({
    endpoint: input.endpoint,
    source: {
      fullTextGrantId: grantPayload.fullTextGrantId,
      fullTextUrl: grantPayload.fullTextUrl,
      id: grantPayload.sourceId
    },
    transport
  });
}
