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

function freezeTarget(target: ThinReadingAnnotationTarget): ThinReadingAnnotationTarget {
  return Object.freeze({ ...target }) as ThinReadingAnnotationTarget;
}

function freezeScope(scope: ThinReadingRecommendationScope): ThinReadingRecommendationScope {
  return Object.freeze({
    ...scope,
    paperIdentity: scope.paperIdentity ? freezePaperIdentity(scope.paperIdentity) : undefined
  });
}

function queueItemForAnnotation(
  document: ThinReadingDocument,
  annotation: ThinReadingAnnotation
): ThinReadingIntuechoAnnotationQueueItem | null {
  const node = document.nodes[annotation.nodeId];
  if (!node || annotation.visibility !== "pending_public") {
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
