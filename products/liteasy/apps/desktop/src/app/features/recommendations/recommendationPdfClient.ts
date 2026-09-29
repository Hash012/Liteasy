import { loadStoredAccountSession } from "../account/accountSessionStorage";
import {
  downloadExternalPdf,
  type DownloadedExternalPdf
} from "../library/externalPdfDownload";
import type { ModelTransport, ModelTransportResponse } from "../models/modelHttpClient";
import type { RecommendationItem } from "./recommendation.types";
import { paperServiceRequest } from "../paper-services/paperServiceTransport";

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
  if (input.recommendation.openAccessPdfUrl) {
    const url = new URL(input.recommendation.openAccessPdfUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("开放全文地址无效。");
    const response = await paperServiceRequest({ provider: "crossref", endpoint: url.origin }, url.href, {
      authenticate: false, maxResponseBytes: 32 * 1024 * 1024, timeoutMs: 45_000,
      followPublicRedirects: true,
    });
    if (!response.ok) throw new Error(`开放全文下载失败（${response.status}），可从元信息中的来源页面查看获取方式。`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("来源返回的不是 PDF，未向文献库写入文件。");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return { bytes, contentHash: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      finalUrl: response.url || url.href, sourceId: input.recommendation.id };
  }
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
