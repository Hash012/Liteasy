import { useEffect, useRef, useState } from "react";

import { pageGraphPaperKey } from "../associations/associationGraphLayout";
import {
  createThinReadingPaperRelationsClient,
  normalizeThinReadingPaperRelationEdges,
  type ThinReadingPaperRelationsTransport
} from "./thinReadingPaperRelationsClient";
import type {
  ThinReadingDocument,
  ThinReadingExternalSource,
  ThinReadingRecommendationPaperEdge
} from "./thinReading.types";

type UseThinReadingPaperRelationsInput = {
  artifactId: string;
  enabled: boolean;
  endpoint: string;
  node: ThinReadingDocument["nodes"][string];
  onPersist: (edges: readonly ThinReadingRecommendationPaperEdge[]) => void;
  transport?: ThinReadingPaperRelationsTransport;
};

function listAnchorSources(node: UseThinReadingPaperRelationsInput["node"]) {
  const sourceById = new Map(
    (node.evidence.externalSources ?? []).map((source) => [source.id, source])
  );
  const sourceByPaperKey = new Map<string, ThinReadingExternalSource>();
  for (const sourceId of (node.evidence.anchors ?? []).flatMap((anchor) => anchor.externalSourceIds)) {
    const source = sourceById.get(sourceId);
    if (!source) continue;
    const paperKey = pageGraphPaperKey(source);
    if (paperKey && !sourceByPaperKey.has(paperKey)) sourceByPaperKey.set(paperKey, source);
  }
  return [...sourceByPaperKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, source]) => source);
}

function edgeSnapshot(edges: readonly ThinReadingRecommendationPaperEdge[]) {
  return JSON.stringify(edges);
}

type RelationAttemptStatus = "failed" | "in_flight" | "succeeded";

export function useThinReadingPaperRelations(input: UseThinReadingPaperRelationsInput) {
  const pageSources = listAnchorSources(input.node);
  const paperKeys = pageSources.map(pageGraphPaperKey);
  const requestKey = JSON.stringify([input.artifactId, input.node.id, paperKeys]);
  const persistedEdges = input.node.evidence.recommendationPaperEdges ?? [];
  const persistedSnapshot = edgeSnapshot(persistedEdges);
  const [edges, setEdges] = useState<readonly ThinReadingRecommendationPaperEdge[]>(persistedEdges);
  const [loading, setLoading] = useState(false);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const currentEdgesRef = useRef(persistedEdges);
  const onPersistRef = useRef(input.onPersist);
  const pageSourcesRef = useRef(pageSources);
  const transportRef = useRef(input.transport);
  const attemptStatusByKeyRef = useRef(new Map<string, RelationAttemptStatus>());
  onPersistRef.current = input.onPersist;
  pageSourcesRef.current = pageSources;
  transportRef.current = input.transport;
  const endpoint = input.endpoint.trim().replace(/\/+$/u, "");
  const attemptKey = JSON.stringify([requestKey, endpoint]);

  useEffect(() => {
    currentEdgesRef.current = persistedEdges;
    setEdges(persistedEdges);
  }, [persistedSnapshot, requestKey]);

  useEffect(() => {
    setWarnings([]);
    setLoading(false);
  }, [requestKey]);

  useEffect(() => {
    const requestSources = pageSourcesRef.current;
    const currentStatus = attemptStatusByKeyRef.current.get(attemptKey);
    if (!input.enabled || !endpoint || requestSources.length < 2 ||
      currentStatus === "failed" || currentStatus === "in_flight" || currentStatus === "succeeded") {
      return undefined;
    }

    const controller = new AbortController();
    const requestedPaperKeys = new Set(paperKeys.slice(0, 24));
    setLoading(true);
    setWarnings([]);
    queueMicrotask(() => {
      if (controller.signal.aborted || attemptStatusByKeyRef.current.has(attemptKey)) return;
      attemptStatusByKeyRef.current.set(attemptKey, "in_flight");
      void createThinReadingPaperRelationsClient({
        endpoint,
        transport: transportRef.current
      })({
        artifactId: input.artifactId,
        papers: requestSources,
        signal: controller.signal
      }).then((result) => {
        if (controller.signal.aborted) return;
        attemptStatusByKeyRef.current.set(attemptKey, "succeeded");
        const currentNormalized = normalizeThinReadingPaperRelationEdges(
          currentEdgesRef.current,
          requestedPaperKeys
        );
        const nextEdges = result.warnings.length > 0
          ? normalizeThinReadingPaperRelationEdges(
              [...currentNormalized, ...result.edges],
              requestedPaperKeys
            )
          : result.edges;
        currentEdgesRef.current = nextEdges;
        setEdges(nextEdges);
        setWarnings(result.warnings);
        setLoading(false);
        if (edgeSnapshot(nextEdges) !== edgeSnapshot(currentNormalized)) {
          onPersistRef.current(nextEdges);
        }
      }).catch((reason) => {
        if (controller.signal.aborted) return;
        attemptStatusByKeyRef.current.set(attemptKey, "failed");
        setLoading(false);
        setWarnings([reason instanceof Error ? reason.message : "推荐文献关系暂时不可用。"]);
      });
    });
    return () => {
      controller.abort();
      if (attemptStatusByKeyRef.current.get(attemptKey) !== "succeeded") {
        attemptStatusByKeyRef.current.delete(attemptKey);
      }
      setLoading(false);
    };
  }, [
    attemptKey,
    endpoint,
    input.enabled,
    requestKey
  ]);

  return { edges, loading, warnings };
}
