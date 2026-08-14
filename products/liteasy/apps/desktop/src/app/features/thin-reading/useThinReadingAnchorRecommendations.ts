import { useEffect, useMemo, useRef, useState } from "react";

import {
  createThinReadingExternalKnowledgeClient,
  type ThinReadingExternalKnowledgeTransport
} from "./thinReadingExternalKnowledgeClient";
import type { ThinReadingAnchor, ThinReadingExternalSource, ThinReadingNodeEvidence } from "./thinReading.types";

type TargetPaper = {
  arxivId?: string;
  doi?: string;
  semanticScholarId?: string;
  title?: string;
};

type RetrievalInput = {
  anchors: readonly ThinReadingAnchor[];
  artifactId: string;
  endpoint: string;
  existingSources: readonly ThinReadingExternalSource[];
  onAnchor: (anchorId: string, sources: readonly ThinReadingExternalSource[]) => void;
  signal: AbortSignal;
  targetPaper?: TargetPaper;
  transport?: ThinReadingExternalKnowledgeTransport;
};

function targetIdentity(paper?: TargetPaper) {
  if (paper?.doi) return { kind: "doi", value: paper.doi };
  if (paper?.arxivId) return { kind: "arxiv_id", value: paper.arxivId };
  if (paper?.semanticScholarId) return { kind: "semantic_scholar_id", value: paper.semanticScholarId };
  return undefined;
}

function selectSources(sources: readonly ThinReadingExternalSource[]) {
  const usable = sources
    .filter((source) => source.isRetracted !== true)
    .sort((left, right) => right.relevance - left.relevance);
  const highRelevance = usable.filter((source) => source.relevance >= 0.42);
  return (highRelevance.length > 0 ? highRelevance : usable).slice(0, 4);
}

export async function retrieveThinReadingAnchorRecommendations(input: RetrievalInput) {
  const sourceById = new Map(input.existingSources.map((source) => [source.id, source]));
  const pending = input.anchors.filter((anchor) => (
    anchor.externalSourceIds.length === 0 ||
    anchor.externalSourceIds.every((sourceId) => !sourceById.has(sourceId))
  ));
  if (pending.length === 0) return new Map<string, readonly ThinReadingExternalSource[]>();
  const search = createThinReadingExternalKnowledgeClient({ endpoint: input.endpoint, transport: input.transport });
  const results = new Map<string, readonly ThinReadingExternalSource[]>();
  let cursor = 0;
  const worker = async () => {
    while (!input.signal.aborted) {
      const anchor = pending[cursor];
      cursor += 1;
      if (!anchor) return;
      try {
        const result = await search({
          anchorReferences: [],
          artifactId: input.artifactId,
          intent: "context",
          limit: 12,
          query: anchor.searchQuery,
          signal: input.signal,
          targetPaperIdentity: targetIdentity(input.targetPaper),
          targetPaperTitle: input.targetPaper?.title
        });
        const selected = selectSources(result.sources);
        results.set(anchor.id, selected);
        input.onAnchor(anchor.id, selected);
      } catch (error) {
        if (input.signal.aborted) throw error;
        results.set(anchor.id, []);
        input.onAnchor(anchor.id, []);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, () => worker()));
  return results;
}

export function useThinReadingAnchorRecommendations(input: {
  anchors: readonly ThinReadingAnchor[];
  artifactId: string;
  enabled: boolean;
  endpoint: string;
  evidence: ThinReadingNodeEvidence;
  nodeId: string;
  onPersist: (evidence: ThinReadingNodeEvidence) => void;
  targetPaper?: TargetPaper;
  transport?: ThinReadingExternalKnowledgeTransport;
}) {
  const [loadedByAnchor, setLoadedByAnchor] = useState<Record<string, readonly ThinReadingExternalSource[]>>({});
  const [loading, setLoading] = useState(false);
  const onPersistRef = useRef(input.onPersist);
  onPersistRef.current = input.onPersist;
  const endpoint = input.endpoint.trim().replace(/\/+$/u, "");
  const requestKey = JSON.stringify([
    input.artifactId,
    input.nodeId,
    input.anchors.map((anchor) => [anchor.id, anchor.searchQuery, anchor.externalSourceIds]),
    endpoint
  ]);

  useEffect(() => setLoadedByAnchor({}), [input.artifactId, input.nodeId]);

  useEffect(() => {
    if (!input.enabled || !endpoint || input.anchors.length === 0) return undefined;
    const controller = new AbortController();
    const collected = new Map<string, readonly ThinReadingExternalSource[]>();
    setLoading(true);
    void retrieveThinReadingAnchorRecommendations({
      anchors: input.anchors,
      artifactId: input.artifactId,
      endpoint,
      existingSources: input.evidence.externalSources ?? [],
      onAnchor: (anchorId, sources) => {
        collected.set(anchorId, sources);
        setLoadedByAnchor((current) => ({ ...current, [anchorId]: sources }));
      },
      signal: controller.signal,
      targetPaper: input.targetPaper,
      transport: input.transport
    }).then(() => {
      if (controller.signal.aborted || collected.size === 0) return;
      const externalSources = new Map(
        (input.evidence.externalSources ?? []).map((source) => [source.id, source])
      );
      collected.forEach((sources) => sources.forEach((source) => externalSources.set(source.id, source)));
      onPersistRef.current({
        ...input.evidence,
        anchors: input.anchors.map((anchor) => ({
          ...anchor,
          externalSourceIds: collected.has(anchor.id)
            ? (collected.get(anchor.id) ?? []).map((source) => source.id)
            : anchor.externalSourceIds
        })),
        externalSources: [...externalSources.values()]
      });
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [input.enabled, requestKey]);

  const externalSources = useMemo(() => {
    const merged = new Map((input.evidence.externalSources ?? []).map((source) => [source.id, source]));
    Object.values(loadedByAnchor).forEach((sources) => sources.forEach((source) => merged.set(source.id, source)));
    return [...merged.values()];
  }, [input.evidence.externalSources, loadedByAnchor]);
  const anchors = useMemo(() => input.anchors.map((anchor) => (
    loadedByAnchor[anchor.id]
      ? { ...anchor, externalSourceIds: loadedByAnchor[anchor.id].map((source) => source.id) }
      : anchor
  )), [input.anchors, loadedByAnchor]);
  return { anchors, externalSources, loading };
}
