import type {
  ThinReadingExternalSource,
  ThinReadingRecommendationPaperEdge
} from "../thin-reading/thinReading.types";
import { pageGraphPaperKey } from "./associationGraphLayout";

export type AssociationPageGraphProjection = {
  paperEdges: readonly {
    directed: boolean;
    kind: ThinReadingRecommendationPaperEdge["kind"];
    sourcePaperKey: string;
    strength: number;
    targetPaperKey: string;
  }[];
  paperNodes: readonly {
    anchorIds: readonly string[];
    paperKey: string;
    primaryAnchorId: string;
    secondaryAnchorIds: readonly string[];
    source: ThinReadingExternalSource;
  }[];
  primaryAnchorEdges: readonly { anchorId: string; paperKey: string }[];
};

type ProjectionAnchor = {
  anchorId: string;
  quality?: { score: number };
};

type OwnershipCandidate = {
  anchorId: string;
  anchorQuality: number;
  source: ThinReadingExternalSource;
};

const confidenceBasisRank: Record<NonNullable<ThinReadingExternalSource["confidenceBasis"]>, number> = {
  algorithmic_retrieval: 0,
  citation_graph: 1,
  canonical_registry: 2,
  author_citation: 3
};

function compareOwnership(left: OwnershipCandidate, right: OwnershipCandidate) {
  return (confidenceBasisRank[right.source.confidenceBasis ?? "algorithmic_retrieval"] -
      confidenceBasisRank[left.source.confidenceBasis ?? "algorithmic_retrieval"]) ||
    ((right.source.confidence ?? 0.3) - (left.source.confidence ?? 0.3)) ||
    (right.source.relevance - left.source.relevance) ||
    (right.anchorQuality - left.anchorQuality) ||
    left.anchorId.localeCompare(right.anchorId) ||
    left.source.id.localeCompare(right.source.id);
}

function relationKey(edge: AssociationPageGraphProjection["paperEdges"][number]) {
  return `${edge.kind}\u0000${edge.directed ? "directed" : "undirected"}\u0000${
    edge.sourcePaperKey
  }\u0000${edge.targetPaperKey}`;
}

export function projectAssociationPageGraph({
  anchors,
  paperEdges,
  sourcesByAnchor
}: {
  anchors: readonly ProjectionAnchor[];
  paperEdges: readonly ThinReadingRecommendationPaperEdge[];
  sourcesByAnchor: Readonly<Record<string, readonly ThinReadingExternalSource[]>>;
}): AssociationPageGraphProjection {
  const anchorQualityById = new Map(
    anchors.map((anchor) => [anchor.anchorId, anchor.quality?.score ?? 0] as const)
  );
  const candidatesByPaperKey = new Map<string, Map<string, OwnershipCandidate>>();

  for (const anchor of [...anchors].sort((left, right) => left.anchorId.localeCompare(right.anchorId))) {
    for (const source of sourcesByAnchor[anchor.anchorId] ?? []) {
      const paperKey = pageGraphPaperKey(source);
      if (!paperKey) continue;
      const candidatesByAnchor = candidatesByPaperKey.get(paperKey) ?? new Map();
      const candidate = {
        anchorId: anchor.anchorId,
        anchorQuality: anchorQualityById.get(anchor.anchorId) ?? 0,
        source
      };
      const previous = candidatesByAnchor.get(anchor.anchorId);
      if (!previous || compareOwnership(candidate, previous) < 0) {
        candidatesByAnchor.set(anchor.anchorId, candidate);
      }
      candidatesByPaperKey.set(paperKey, candidatesByAnchor);
    }
  }

  const paperNodes = [...candidatesByPaperKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([paperKey, candidatesByAnchor]) => {
      const candidates = [...candidatesByAnchor.values()].sort(compareOwnership);
      const primary = candidates[0]!;
      const anchorIds = [...candidatesByAnchor.keys()].sort();
      return {
        anchorIds,
        paperKey,
        primaryAnchorId: primary.anchorId,
        secondaryAnchorIds: anchorIds.filter((anchorId) => anchorId !== primary.anchorId),
        source: primary.source
      };
    });

  const visiblePaperKeys = new Set(paperNodes.map((node) => node.paperKey));
  const paperEdgeByKey = new Map<string, AssociationPageGraphProjection["paperEdges"][number]>();
  for (const edge of paperEdges) {
    if (!visiblePaperKeys.has(edge.sourcePaperId) || !visiblePaperKeys.has(edge.targetPaperId) ||
      edge.sourcePaperId === edge.targetPaperId) {
      continue;
    }
    const endpoints = edge.directed
      ? [edge.sourcePaperId, edge.targetPaperId]
      : [edge.sourcePaperId, edge.targetPaperId].sort();
    const projected = {
      directed: edge.directed,
      kind: edge.kind,
      sourcePaperKey: endpoints[0]!,
      strength: edge.strength,
      targetPaperKey: endpoints[1]!
    };
    const key = relationKey(projected);
    const previous = paperEdgeByKey.get(key);
    if (!previous || projected.strength > previous.strength) paperEdgeByKey.set(key, projected);
  }

  return {
    paperEdges: [...paperEdgeByKey.values()].sort((left, right) =>
      relationKey(left).localeCompare(relationKey(right))),
    paperNodes,
    primaryAnchorEdges: paperNodes.map((node) => ({
      anchorId: node.primaryAnchorId,
      paperKey: node.paperKey
    }))
  };
}
