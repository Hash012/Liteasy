import { describe, expect, test } from "vitest";

import { projectAssociationPageGraph } from "../app/features/associations/associationGraphProjection";
import type {
  ThinReadingExternalSource,
  ThinReadingRecommendationPaperEdge
} from "../app/features/thin-reading/thinReading.types";

function source(
  id: string,
  overrides: Partial<ThinReadingExternalSource> = {}
): ThinReadingExternalSource {
  return {
    abstract: "Abstract",
    authors: ["Author"],
    confidence: 0.3,
    confidenceBasis: "algorithmic_retrieval",
    id,
    provider: "openalex",
    relation: "topic_search",
    relevance: 0.8,
    retrievalQuery: "query",
    sourceId: id,
    sourceRecordUrl: `https://openalex.org/${id}`,
    title: id,
    url: `https://openalex.org/${id}`,
    ...overrides
  };
}

function edge(
  sourcePaperId: string,
  targetPaperId: string,
  overrides: Partial<ThinReadingRecommendationPaperEdge> = {}
): ThinReadingRecommendationPaperEdge {
  return {
    directed: false,
    evidenceRecordUrls: ["https://openalex.org/evidence"],
    kind: "co_cited",
    provider: "openalex",
    sourcePaperId,
    strength: 0.7,
    targetPaperId,
    ...overrides
  };
}

describe("projectAssociationPageGraph", () => {
  test("keeps verified relations across different anchor owners", () => {
    const graph = projectAssociationPageGraph({
      anchors: [{ anchorId: "anchor-a" }, { anchorId: "anchor-b" }],
      paperEdges: [edge("openalex:W1", "openalex:W2")],
      sourcesByAnchor: {
        "anchor-a": [source("source-a", { canonicalPaperId: "openalex:W1" })],
        "anchor-b": [source("source-b", { canonicalPaperId: "openalex:W2" })]
      }
    });

    expect(graph.paperNodes).toHaveLength(2);
    expect(graph.paperEdges).toEqual([expect.objectContaining({
      sourcePaperKey: "openalex:W1",
      targetPaperKey: "openalex:W2"
    })]);
  });

  test("chooses one stable primary anchor and retains every secondary membership", () => {
    const graph = projectAssociationPageGraph({
      anchors: [
        { anchorId: "semantic-anchor", quality: { score: 0.95 } },
        { anchorId: "author-cited-anchor", quality: { score: 0.4 } },
        { anchorId: "registry-anchor", quality: { score: 1 } }
      ],
      paperEdges: [],
      sourcesByAnchor: {
        "semantic-anchor": [source("semantic", {
          canonicalPaperId: "openalex:W1",
          confidence: 1,
          confidenceBasis: "algorithmic_retrieval",
          relevance: 1
        })],
        "author-cited-anchor": [source("cited", {
          canonicalPaperId: "openalex:W1",
          confidence: 0.6,
          confidenceBasis: "author_citation",
          relevance: 0.7
        })],
        "registry-anchor": [source("registry", {
          canonicalPaperId: "openalex:W1",
          confidence: 0.9,
          confidenceBasis: "canonical_registry",
          relevance: 0.95
        })]
      }
    });

    expect(graph.paperNodes[0]).toMatchObject({
      anchorIds: ["author-cited-anchor", "registry-anchor", "semantic-anchor"],
      primaryAnchorId: "author-cited-anchor",
      secondaryAnchorIds: ["registry-anchor", "semantic-anchor"],
      source: expect.objectContaining({ id: "cited" })
    });
    expect(graph.primaryAnchorEdges).toEqual([
      { anchorId: "author-cited-anchor", paperKey: "openalex:W1" }
    ]);
  });

  test("uses confidence, relevance, anchor quality, then anchor id as stable ownership tie breakers", () => {
    const graph = projectAssociationPageGraph({
      anchors: [
        { anchorId: "z-low-confidence", quality: { score: 1 } },
        { anchorId: "y-low-relevance", quality: { score: 1 } },
        { anchorId: "x-low-quality", quality: { score: 0.2 } },
        { anchorId: "b-stable", quality: { score: 0.8 } },
        { anchorId: "a-stable", quality: { score: 0.8 } }
      ],
      paperEdges: [],
      sourcesByAnchor: Object.fromEntries([
        ["z-low-confidence", source("z", { doi: "10.1/shared", confidence: 0.7, relevance: 1 })],
        ["y-low-relevance", source("y", { doi: "10.1/shared", confidence: 0.8, relevance: 0.8 })],
        ["x-low-quality", source("x", { doi: "10.1/shared", confidence: 0.8, relevance: 0.9 })],
        ["b-stable", source("b", { doi: "10.1/shared", confidence: 0.8, relevance: 0.9 })],
        ["a-stable", source("a", { doi: "10.1/shared", confidence: 0.8, relevance: 0.9 })]
      ].map(([anchorId, value]) => [anchorId, [value]]))
    });

    expect(graph.paperNodes[0]?.primaryAnchorId).toBe("a-stable");
  });

  test("canonicalizes and logically deduplicates visible undirected relations", () => {
    const graph = projectAssociationPageGraph({
      anchors: [{ anchorId: "anchor" }],
      paperEdges: [
        edge("doi:b", "doi:a", { strength: 0.4 }),
        edge("doi:a", "doi:b", { provider: "semantic_scholar", strength: 0.9 }),
        edge("doi:a", "missing", { kind: "bibliographic_coupling" })
      ],
      sourcesByAnchor: {
        anchor: [
          source("provider-a", { doi: "doi:a", sourceId: "shared-source" }),
          source("provider-a-duplicate", { doi: "doi:a", sourceId: "other-source" }),
          source("provider-b", { doi: "doi:b" })
        ]
      }
    });

    expect(graph.paperNodes.map((node) => node.paperKey)).toEqual(["doi:a", "doi:b"]);
    expect(graph.paperEdges).toEqual([{
      directed: false,
      kind: "co_cited",
      sourcePaperKey: "doi:a",
      strength: 0.9,
      targetPaperKey: "doi:b"
    }]);
  });
});
