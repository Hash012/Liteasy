import { loadStoredAccountSession } from "../account/accountSessionStorage";
import {
  downloadExternalPdf,
} from "../library/externalPdfDownload";
import type { ModelTransport, ModelTransportResponse } from "../models/modelHttpClient";
import type { RecommendationItem } from "./recommendation.types";
import type { PaperServiceConfig } from "../paper-services/paperServiceTransport";
import { resolvePaperPdf, type ResolvedPaperPdf } from "../paper-services/paperPdfResolver";

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
  service?: PaperServiceConfig;
  signal?: AbortSignal;
  nativeDownload?: boolean;
  onProgress?: (value: import("../paper-services/paperFullTextTransport").FullTextProgress) => void;
}): Promise<ResolvedPaperPdf | null> {
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000);
  signal.throwIfAborted();
  const item = input.recommendation;
  // Keep authenticated cloud grants working, but their availability is no longer
  // the gate for public papers or users who are not signed in.
  if (!item.openAccessPdfUrl && item.openAccessAvailable && input.endpoint && (input.transport || loadStoredAccountSession()?.sessionId)) {
    try {
      const granted = await downloadGrantedPdf({ ...input, signal });
      signal.throwIfAborted();
      if (granted) return granted;
    } catch { signal.throwIfAborted(); }
  }
  return resolvePaperPdf({ id: item.canonicalId || item.id, doi: item.identityResolution?.doi,
    arxivId: item.identityResolution?.arxivId, url: item.sourceUrl, pdfUrl: item.openAccessPdfUrl }, { service: input.service, signal, nativeDownload: input.nativeDownload, onProgress: input.onProgress })
    .then((pdf) => pdf ? { ...pdf, sourceId: item.id } : null);
}

async function downloadGrantedPdf(input: {
  endpoint: string; recommendation: RecommendationItem; transport?: ModelTransport; signal?: AbortSignal;
  service?: PaperServiceConfig; nativeDownload?: boolean; onProgress?: (value: import("../paper-services/paperFullTextTransport").FullTextProgress) => void;
}): Promise<ResolvedPaperPdf | null> {
  const transport: ModelTransport = (request) => (input.transport ?? defaultTransport)({ ...request, signal: request.signal ?? input.signal });
  const grantResponse = await transport({
    body: JSON.stringify({ candidateId: input.recommendation.id }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
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
  if (input.nativeDownload) return resolvePaperPdf({ id: input.recommendation.id, pdfUrl: grantPayload.fullTextUrl }, { nativeDownload: true, service: input.service, signal: input.signal, onProgress: input.onProgress });
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
