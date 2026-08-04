import type { PdfAnnotation } from "./pdfAnnotationStorage";

export const PDF_ANNOTATION_PENDING_LABEL = "等待论坛同步";

export type PdfAnnotationIntuechoQueueItem = {
  annotationId: string;
  body: string;
  createdAt: string;
  excerpt: string;
  paperIdentity: PdfAnnotation["paperIdentity"];
  queueKey: string;
  scope: {
    kind: "pdf_passage";
    page: number;
    rects: PdfAnnotation["rects"];
  };
  status: "pending_public";
  statusLabel: typeof PDF_ANNOTATION_PENDING_LABEL;
  updatedAt: string;
};

export type PdfAnnotationIntuechoSyncResult =
  | { annotationId: string; error: string; queueKey: string; status: "failed" }
  | { annotationId: string; intuechoAnnotationId: string; queueKey: string; status: "synced"; syncedAt: string };

export type PdfAnnotationIntuechoSyncTransport = (
  request: { body: string; headers: Record<string, string>; method: "POST"; url: string }
) => Promise<{ json: () => Promise<unknown>; ok: boolean; status: number }>;

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isHttpsEndpoint(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function syncEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  url.hash = "";
  url.search = "";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/pdf-annotations:sync`;
  return url.toString();
}

function failed(items: readonly PdfAnnotationIntuechoQueueItem[], error: string) {
  return items.map((item) => ({ annotationId: item.annotationId, error, queueKey: item.queueKey, status: "failed" as const }));
}

function isSyncable(item: PdfAnnotationIntuechoQueueItem) {
  return item.paperIdentity.primary.kind !== "local_paper_id";
}

function mergeResults(items: readonly PdfAnnotationIntuechoQueueItem[], results: readonly PdfAnnotationIntuechoSyncResult[]) {
  const resultsByQueueKey = new Map(results.map((result) => [result.queueKey, result]));
  return items.map((item) => resultsByQueueKey.get(item.queueKey) ?? {
    annotationId: item.annotationId,
    error: "Intuecho 同步响应缺少该批注的可验证结果。",
    queueKey: item.queueKey,
    status: "failed" as const
  });
}

function normalizeResults(items: readonly PdfAnnotationIntuechoQueueItem[], value: unknown) {
  const values = value && typeof value === "object" && !Array.isArray(value) &&
    "results" in value && Array.isArray(value.results) ? value.results : [];
  const itemsByQueueKey = new Map(items.map((item) => [item.queueKey, item]));
  const results: PdfAnnotationIntuechoSyncResult[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const result = value as Partial<PdfAnnotationIntuechoSyncResult>;
    const item = typeof result.queueKey === "string" ? itemsByQueueKey.get(result.queueKey) : undefined;
    if (!item || result.annotationId !== item.annotationId || results.some((current) => current.queueKey === item.queueKey)) continue;
    if (result.status === "synced" && typeof result.intuechoAnnotationId === "string" && result.intuechoAnnotationId.trim() && typeof result.syncedAt === "string") {
      results.push({ annotationId: item.annotationId, intuechoAnnotationId: result.intuechoAnnotationId, queueKey: item.queueKey, status: "synced", syncedAt: result.syncedAt });
    } else if (result.status === "failed" && typeof result.error === "string" && result.error.trim()) {
      results.push({ annotationId: item.annotationId, error: result.error, queueKey: item.queueKey, status: "failed" });
    }
  }
  return mergeResults(items, results);
}

export function listPdfAnnotationPendingPublicItems(
  annotations: readonly PdfAnnotation[]
): readonly PdfAnnotationIntuechoQueueItem[] {
  return annotations
    .filter((annotation) => annotation.visibility === "pending_public" && annotation.syncState?.status !== "synced")
    .map((annotation) => ({
      annotationId: annotation.id,
      body: annotation.note?.trim() || annotation.excerpt,
      createdAt: annotation.createdAt,
      excerpt: annotation.excerpt,
      paperIdentity: annotation.paperIdentity,
      queueKey: `${annotation.paperIdentity.paperId}:${annotation.id}`,
      scope: { kind: "pdf_passage" as const, page: annotation.page, rects: annotation.rects.map((rect) => ({ ...rect })) },
      status: "pending_public" as const,
      statusLabel: PDF_ANNOTATION_PENDING_LABEL as typeof PDF_ANNOTATION_PENDING_LABEL,
      updatedAt: annotation.updatedAt
    }));
}

export async function syncPdfAnnotationPendingItems(input: {
  endpoint: string;
  items: readonly PdfAnnotationIntuechoQueueItem[];
  transport?: PdfAnnotationIntuechoSyncTransport;
}) {
  const syncable = input.items.filter(isSyncable);
  const localOnly = input.items.filter((item) => !isSyncable(item));
  const results: PdfAnnotationIntuechoSyncResult[] = [
    ...failed(localOnly, "该批注仍为仅本地文献身份，补全 DOI、arXiv、Semantic Scholar 或题名作者年份信息后才能同步到 Intuecho。")
  ];
  if (syncable.length === 0) return mergeResults(input.items, results);
  if (!isHttpsEndpoint(input.endpoint)) {
    return mergeResults(input.items, [...results, ...failed(syncable, "Intuecho 同步端点必须是 HTTPS 地址。")]);
  }
  const transport = input.transport ?? (async (request) => {
    const response = await fetch(request.url, { body: request.body, headers: request.headers, method: request.method });
    return { json: () => response.json(), ok: response.ok, status: response.status };
  });
  try {
    const response = await transport({
      body: JSON.stringify({ annotations: syncable }),
      headers: { "content-type": "application/json", "idempotency-key": `pdf-annotation-sync-${stableHash(syncable.map((item) => `${item.queueKey}\u0000${item.updatedAt}`).join("\u0001"))}` },
      method: "POST",
      url: syncEndpoint(input.endpoint)
    });
    return mergeResults(input.items, [...results, ...(response.ok
      ? normalizeResults(syncable, await response.json())
      : failed(syncable, `Intuecho 同步请求失败（HTTP ${response.status}）。`))]);
  } catch (error) {
    return mergeResults(input.items, [...results, ...failed(syncable, `Intuecho 同步请求未完成：${error instanceof Error ? error.message : String(error)}`)]);
  }
}
