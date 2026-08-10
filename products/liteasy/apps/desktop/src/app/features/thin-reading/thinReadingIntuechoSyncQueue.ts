import { freezePaperIdentity } from "../paper-identity/paperIdentity";
import { sha256Hex } from "../paper-identity/paperIdentity";
import type { ForumAnnotationTarget, ForumLiteratureReference } from "../forum/forum.types";
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
  hasConfirmedLiterature: boolean;
  nodeId: string;
  paperId?: string;
  queueKey: string;
  scope: ThinReadingRecommendationScope;
  status: ThinReadingIntuechoQueueStatus;
  statusLabel: typeof THIN_READING_INTUECHO_PENDING_LABEL;
  target: ThinReadingAnnotationTarget;
  targets: ForumAnnotationTarget[];
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

function failedResults(items: readonly ThinReadingIntuechoAnnotationQueueItem[], error: string) {
  return Object.freeze(items.map((item) => Object.freeze({
    annotationId: item.annotationId,
    error,
    queueKey: item.queueKey,
    status: "failed" as const
  })));
}

const LOCAL_IDENTITY_SYNC_ERROR = "该文献尚未完成来源确认，不能同步到 Intuecho。";

function isCommunitySyncableItem(item: ThinReadingIntuechoAnnotationQueueItem) {
  return item.hasConfirmedLiterature && item.targets.length > 0;
}

function wireAnnotation(item: ThinReadingIntuechoAnnotationQueueItem) {
  return {
    annotationId: item.annotationId,
    body: item.body,
    createdAt: item.createdAt,
    queueKey: item.queueKey,
    status: item.status,
    targets: item.targets,
    updatedAt: item.updatedAt
  };
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

function isAllowedEndpoint(value: string) {
  try {
    const endpoint = new URL(value);
    const loopback = endpoint.protocol === "http:" && new Set(["127.0.0.1", "localhost", "[::1]"]).has(endpoint.hostname);
    return (endpoint.protocol === "https:" || loopback) && !endpoint.username && !endpoint.password;
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
  sessionId?: string;
  transport?: ThinReadingIntuechoSyncTransport;
}): ThinReadingIntuechoSyncAdapter {
  return Object.freeze({
    async syncPendingAnnotations(items) {
      if (items.length === 0) {
        return Object.freeze([]);
      }
      const syncableItems = items.filter(isCommunitySyncableItem);
      const localOnlyItems = items.filter((item) => !item.hasConfirmedLiterature);
      const missingEvidenceItems = items.filter((item) => !localOnlyItems.includes(item) && item.targets.length === 0);
      const localOnlyResults = failedResults(localOnlyItems, LOCAL_IDENTITY_SYNC_ERROR);
      const missingEvidenceResults = failedResults(missingEvidenceItems, "薄读生成内容缺少可核验的原文证据映射，不能公开同步到 Intuecho。");
      const rejectedResults = [...localOnlyResults, ...missingEvidenceResults];
      if (syncableItems.length === 0) {
        return mergeResultsInInputOrder({ items, results: rejectedResults });
      }
      if (!isAllowedEndpoint(input.endpoint)) {
        return mergeResultsInInputOrder({
          items,
          results: [...rejectedResults, ...failedResults(syncableItems, "Intuecho 同步端点必须是 HTTPS 地址。")]
        });
      }
      if (!input.sessionId) {
        return mergeResultsInInputOrder({
          items,
          results: [...rejectedResults, ...failedResults(syncableItems, "请先登录 Liteasy 再同步公开批注。")]
        });
      }
      const idempotencyKey = `thin-reading-sync-${sha256Hex(
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
          body: JSON.stringify({ annotations: syncableItems.map(wireAnnotation) }),
          headers: {
            Authorization: `Bearer ${input.sessionId}`,
            "content-type": "application/json",
            "idempotency-key": idempotencyKey
          },
          method: "POST",
          url: syncEndpoint(input.endpoint)
        });
        if (!response.ok) {
          return mergeResultsInInputOrder({
            items,
            results: [...rejectedResults, ...failedResults(syncableItems, `Intuecho 同步请求失败（HTTP ${response.status}）。`)]
          });
        }
        return mergeResultsInInputOrder({
          items,
          results: [...rejectedResults, ...normalizeRemoteResults({ items: syncableItems, value: await response.json() })]
        });
      } catch (error) {
        return mergeResultsInInputOrder({
          items,
          results: [
              ...rejectedResults,
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
  const targets = communityTargets(document, annotation, scope);
  const hasConfirmedLiterature = Boolean(scope.paperId && document.literatureRecords?.[scope.paperId]);
  return Object.freeze({
    annotationId: annotation.id,
    artifactId: document.artifactId,
    body: annotation.body,
    createdAt: annotation.createdAt,
    excerpt: annotation.excerpt,
    hasConfirmedLiterature,
    nodeId: annotation.nodeId,
    paperId: scope.paperId,
    queueKey: `${document.artifactId}:${annotation.id}`,
    scope,
    status: "pending_public" as const,
    statusLabel: THIN_READING_INTUECHO_PENDING_LABEL,
    target: freezeTarget(annotation.target),
    targets,
    updatedAt: annotation.updatedAt
  });
}

function forumLiterature(literatureId: string | undefined): ForumLiteratureReference | null {
  return literatureId ? { literatureId } : null;
}

function communityTargets(
  document: ThinReadingDocument,
  annotation: ThinReadingAnnotation,
  scope: ThinReadingRecommendationScope
): ForumAnnotationTarget[] {
  const literature = forumLiterature(
    scope.paperId ? document.literatureRecords?.[scope.paperId]?.literatureId : undefined
  );
  if (!literature) return [];
  if (scope.kind === "whole_paper") return [{ kind: "whole_document", literature }];
  const node = document.nodes[annotation.nodeId];
  const selectedIds = scope.kind === "selected_passage" ? new Set(scope.evidenceIds ?? []) : null;
  const spans = (node?.evidence.paperEvidenceSpans ?? []).filter((span) => !selectedIds || selectedIds.size === 0 || selectedIds.has(span.id));
  const evidence = spans.flatMap((span) => {
    const evidenceLiterature = forumLiterature(document.literatureRecords?.[span.paperId]?.literatureId);
    return evidenceLiterature ? [{
      anchorHash: `evidence:${span.id}`,
      excerpt: span.quote,
      literature: evidenceLiterature,
      ...(span.page ? { page: span.page } : {}),
      rects: []
    }] : [];
  });
  if (evidence.length === 0) return [];
  return [{
    derivedContent: {
      artifactId: document.artifactId,
      excerpt: annotation.excerpt,
      nodeId: annotation.nodeId,
      version: `${document.version}:${annotation.nodeId}`
    },
    evidence,
    kind: "derived_passage",
    literature
  }];
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
