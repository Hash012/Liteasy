import { freezePaperIdentity } from "../paper-identity/paperIdentity";
import type {
  ThinReadingAnnotation,
  ThinReadingAnnotationTarget,
  ThinReadingDocument,
  ThinReadingRecommendationScope
} from "./thinReading.types";

export const THIN_READING_INTUECHO_PENDING_LABEL = "等待 Intuecho 同步";

export type ThinReadingIntuechoQueueStatus = "pending_public";

export type ThinReadingIntuechoAnnotationQueueItem = {
  annotationId: string;
  artifactId: string;
  body: string;
  createdAt: string;
  excerpt: string;
  nodeId: string;
  paperId?: string;
  queueKey: string;
  scope: ThinReadingRecommendationScope;
  status: ThinReadingIntuechoQueueStatus;
  statusLabel: typeof THIN_READING_INTUECHO_PENDING_LABEL;
  target: ThinReadingAnnotationTarget;
  updatedAt: string;
};

export type ThinReadingIntuechoSyncResult =
  | {
      annotationId: string;
      queueKey: string;
      status: "pending_public";
      message: typeof THIN_READING_INTUECHO_PENDING_LABEL;
    }
  | {
      annotationId: string;
      intuechoAnnotationId: string;
      queueKey: string;
      status: "synced";
      syncedAt: string;
    }
  | {
      annotationId: string;
      error: string;
      queueKey: string;
      status: "failed";
    };

export type ThinReadingIntuechoSyncAdapter = {
  syncPendingAnnotations: (
    items: readonly ThinReadingIntuechoAnnotationQueueItem[]
  ) => Promise<readonly ThinReadingIntuechoSyncResult[]>;
};

export type ThinReadingIntuechoSyncTransport = (
  input: { body: string; headers: Record<string, string>; method: "POST"; url: string }
) => Promise<{ json: () => Promise<unknown>; ok: boolean; status: number }>;

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function failedResults(items: readonly ThinReadingIntuechoAnnotationQueueItem[], error: string) {
  return Object.freeze(items.map((item) => Object.freeze({
    annotationId: item.annotationId,
    error,
    queueKey: item.queueKey,
    status: "failed" as const
  })));
}

const LOCAL_IDENTITY_SYNC_ERROR = "该批注仍为仅本地文献身份，补全 DOI、arXiv、Semantic Scholar 或题名作者年份信息后才能同步到 Intuecho。";

function isCommunitySyncableItem(item: ThinReadingIntuechoAnnotationQueueItem) {
  return item.scope.paperIdentity?.primary.kind !== undefined &&
    item.scope.paperIdentity.primary.kind !== "local_paper_id";
}

function mergeResultsInInputOrder(input: {
  items: readonly ThinReadingIntuechoAnnotationQueueItem[];
  results: readonly ThinReadingIntuechoSyncResult[];
}) {
  const byQueueKey = new Map(input.results.map((result) => [result.queueKey, result]));
  return Object.freeze(input.items.map((item) => byQueueKey.get(item.queueKey) ?? Object.freeze({
    annotationId: item.annotationId,
    error: "Intuecho 同步未返回该批注的结果。",
    queueKey: item.queueKey,
    status: "failed" as const
  })));
}

function isHttpsEndpoint(value: string) {
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === "https:" && !endpoint.username && !endpoint.password;
  } catch {
    return false;
  }
}

function syncEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  url.hash = "";
  url.search = "";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/thin-reading/annotations:sync`;
  return url.toString();
}

function normalizeRemoteResults(input: {
  items: readonly ThinReadingIntuechoAnnotationQueueItem[];
  value: unknown;
}) {
  const results = input.value && typeof input.value === "object" && !Array.isArray(input.value) &&
    "results" in input.value && Array.isArray(input.value.results)
      ? input.value.results
      : [];
  const itemsByKey = new Map(input.items.map((item) => [item.queueKey, item]));
  const resultByKey = new Map<string, ThinReadingIntuechoSyncResult>();
  for (const result of results) {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      continue;
    }
    const candidate = result as Partial<ThinReadingIntuechoSyncResult>;
    const item = typeof candidate.queueKey === "string" ? itemsByKey.get(candidate.queueKey) : undefined;
    if (!item || candidate.annotationId !== item.annotationId || resultByKey.has(item.queueKey)) {
      continue;
    }
    if (candidate.status === "synced" && typeof candidate.intuechoAnnotationId === "string" &&
      candidate.intuechoAnnotationId.trim().length > 0 && typeof candidate.syncedAt === "string") {
      resultByKey.set(item.queueKey, Object.freeze({
        annotationId: item.annotationId,
        intuechoAnnotationId: candidate.intuechoAnnotationId,
        queueKey: item.queueKey,
        status: "synced",
        syncedAt: candidate.syncedAt
      }));
      continue;
    }
    if (candidate.status === "failed" && typeof candidate.error === "string" && candidate.error.trim().length > 0) {
      resultByKey.set(item.queueKey, Object.freeze({
        annotationId: item.annotationId,
        error: candidate.error,
        queueKey: item.queueKey,
        status: "failed"
      }));
    }
  }
  return Object.freeze(input.items.map((item) => resultByKey.get(item.queueKey) ?? Object.freeze({
    annotationId: item.annotationId,
    error: "Intuecho 同步响应缺少该批注的可验证结果。",
    queueKey: item.queueKey,
    status: "failed" as const
  })));
}

export function createHttpIntuechoSyncAdapter(input: {
  endpoint: string;
  transport?: ThinReadingIntuechoSyncTransport;
}): ThinReadingIntuechoSyncAdapter {
  return Object.freeze({
    async syncPendingAnnotations(items) {
      if (items.length === 0) {
        return Object.freeze([]);
      }
      const syncableItems = items.filter(isCommunitySyncableItem);
      const localOnlyItems = items.filter((item) => !isCommunitySyncableItem(item));
      const localOnlyResults = failedResults(localOnlyItems, LOCAL_IDENTITY_SYNC_ERROR);
      if (syncableItems.length === 0) {
        return mergeResultsInInputOrder({ items, results: localOnlyResults });
      }
      if (!isHttpsEndpoint(input.endpoint)) {
        return mergeResultsInInputOrder({
          items,
          results: [...localOnlyResults, ...failedResults(syncableItems, "Intuecho 同步端点必须是 HTTPS 地址。")]
        });
      }
      const idempotencyKey = `thin-reading-sync-${stableHash(
        syncableItems.map((item) => `${item.queueKey}\u0000${item.updatedAt}`).join("\u0001")
      )}`;
      const transport = input.transport ?? (async (request) => {
        const response = await fetch(request.url, {
          body: request.body,
          headers: request.headers,
          method: request.method
        });
        return { json: () => response.json(), ok: response.ok, status: response.status };
      });
      try {
        const response = await transport({
          body: JSON.stringify({ annotations: syncableItems }),
          headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey
          },
          method: "POST",
          url: syncEndpoint(input.endpoint)
        });
        if (!response.ok) {
          return mergeResultsInInputOrder({
            items,
            results: [...localOnlyResults, ...failedResults(syncableItems, `Intuecho 同步请求失败（HTTP ${response.status}）。`)]
          });
        }
        return mergeResultsInInputOrder({
          items,
          results: [...localOnlyResults, ...normalizeRemoteResults({ items: syncableItems, value: await response.json() })]
        });
      } catch (error) {
        return mergeResultsInInputOrder({
          items,
          results: [
            ...localOnlyResults,
            ...failedResults(
              syncableItems,
              `Intuecho 同步请求未完成：${error instanceof Error ? error.message : String(error)}`
            )
          ]
        });
      }
    }
  });
}

function freezeTarget(target: ThinReadingAnnotationTarget): ThinReadingAnnotationTarget {
  return Object.freeze({ ...target }) as ThinReadingAnnotationTarget;
}

function freezeScope(scope: ThinReadingRecommendationScope): ThinReadingRecommendationScope {
  return Object.freeze({
    ...scope,
    evidenceIds: scope.kind === "selected_passage" && scope.evidenceIds
      ? Object.freeze([...scope.evidenceIds])
      : undefined,
    paperIdentity: scope.paperIdentity ? freezePaperIdentity(scope.paperIdentity) : undefined
  });
}

function queueItemForAnnotation(
  document: ThinReadingDocument,
  annotation: ThinReadingAnnotation
): ThinReadingIntuechoAnnotationQueueItem | null {
  const node = document.nodes[annotation.nodeId];
  if (!node || annotation.visibility !== "pending_public" || annotation.syncState?.status === "synced") {
    return null;
  }
  const scope = freezeScope(node.recommendationScope);
  return Object.freeze({
    annotationId: annotation.id,
    artifactId: document.artifactId,
    body: annotation.body,
    createdAt: annotation.createdAt,
    excerpt: annotation.excerpt,
    nodeId: annotation.nodeId,
    paperId: scope.paperId,
    queueKey: `${document.artifactId}:${annotation.id}`,
    scope,
    status: "pending_public" as const,
    statusLabel: THIN_READING_INTUECHO_PENDING_LABEL,
    target: freezeTarget(annotation.target),
    updatedAt: annotation.updatedAt
  });
}

export function listThinReadingPendingPublicAnnotations(
  document: ThinReadingDocument
): readonly ThinReadingIntuechoAnnotationQueueItem[] {
  const annotationsById = new Map(document.annotations.map((annotation) => [annotation.id, annotation]));
  const seen = new Set<string>();
  const orderedAnnotations: ThinReadingAnnotation[] = [];

  for (const annotationId of document.pendingPublicAnnotationIds) {
    const annotation = annotationsById.get(annotationId);
    if (annotation?.visibility === "pending_public" && !seen.has(annotation.id)) {
      orderedAnnotations.push(annotation);
      seen.add(annotation.id);
    }
  }

  for (const annotation of document.annotations) {
    if (annotation.visibility === "pending_public" && !seen.has(annotation.id)) {
      orderedAnnotations.push(annotation);
      seen.add(annotation.id);
    }
  }

  return Object.freeze(
    orderedAnnotations.flatMap((annotation) => {
      const item = queueItemForAnnotation(document, annotation);
      return item ? [item] : [];
    })
  );
}

export function createLocalPendingIntuechoSyncAdapter(): ThinReadingIntuechoSyncAdapter {
  return Object.freeze({
    syncPendingAnnotations: async (items) => Object.freeze(
      items.map((item) => Object.freeze({
        annotationId: item.annotationId,
        message: THIN_READING_INTUECHO_PENDING_LABEL,
        queueKey: item.queueKey,
        status: "pending_public" as const
      }))
    )
  });
}
