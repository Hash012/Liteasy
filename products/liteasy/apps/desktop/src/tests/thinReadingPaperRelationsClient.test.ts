import { describe, expect, test, vi } from "vitest";

import {
  createThinReadingPaperRelationsClient,
  type ThinReadingPaperRelationsTransport
} from "../app/features/thin-reading/thinReadingPaperRelationsClient";
import type { ThinReadingExternalSource } from "../app/features/thin-reading/thinReading.types";

function source(input: Partial<ThinReadingExternalSource> & Pick<ThinReadingExternalSource, "id" | "provider" | "sourceId">): ThinReadingExternalSource {
  return {
    abstract: "Abstract",
    authors: ["Author"],
    relation: "related",
    relevance: 0.8,
    retrievalQuery: "query",
    sourceRecordUrl: `https://records.example/${input.sourceId}`,
    title: input.id,
    url: `https://papers.example/${input.sourceId}`,
    ...input
  };
}

const papers = [
  source({ canonicalPaperId: "openalex:W1", id: "source-a", provider: "openalex", sourceId: "W1" }),
  source({ canonicalPaperId: "semantic_scholar:s2", id: "source-b", provider: "semantic_scholar", sourceId: "s2" })
];

const verifiedEdge = {
  directed: false,
  evidenceRecordUrls: ["https://openalex.org/W1", "https://semanticscholar.org/paper/s2"],
  kind: "co_cited" as const,
  provider: "openalex" as const,
  sourcePaperId: "openalex:W1",
  strength: 0.75,
  targetPaperId: "semantic_scholar:s2"
};

function response(payload: unknown, ok = true, status = 200): ThinReadingPaperRelationsTransport {
  return vi.fn(async () => ({ json: async () => payload, ok, status }));
}

describe("thinReadingPaperRelationsClient", () => {
  test("accepts only verified page-member relation edges", async () => {
    const transport = response({ edges: [verifiedEdge], warnings: [] });
    const load = createThinReadingPaperRelationsClient({
      endpoint: "https://api.example/",
      transport
    });

    await expect(load({ artifactId: "artifact-1", papers })).resolves.toEqual({
      edges: [verifiedEdge],
      warnings: []
    });
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      body: JSON.stringify({
        artifactId: "artifact-1",
        papers: [
          {
            canonicalPaperId: "openalex:W1",
            id: "openalex:W1",
            provider: "openalex",
            sourceId: "W1"
          },
          {
            canonicalPaperId: "semantic_scholar:s2",
            id: "semantic_scholar:s2",
            provider: "semantic_scholar",
            sourceId: "s2"
          }
        ]
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      url: "https://api.example/v1/research/paper-relations"
    }));
  });

  test("deduplicates by the graph paper key, sorts, and caps the request at 24 papers", async () => {
    const requested = Array.from({ length: 25 }, (_, index) => source({
      canonicalPaperId: `openalex:W${index + 1}`,
      id: `source-${index + 1}`,
      provider: "openalex",
      sourceId: `W${index + 1}`
    }));
    requested.push(source({
      canonicalPaperId: "openalex:W1",
      id: "duplicate-source",
      provider: "openalex",
      sourceId: "W1"
    }));
    const transport = response({ edges: [], warnings: [] });
    const load = createThinReadingPaperRelationsClient({ endpoint: "https://api.example", transport });

    await load({ artifactId: "artifact-1", papers: requested.reverse() });

    const body = JSON.parse(vi.mocked(transport).mock.calls[0][0].body) as {
      papers: Array<{ id: string }>;
    };
    expect(body.papers).toHaveLength(24);
    expect(body.papers.map((paper) => paper.id)).toEqual(
      [...body.papers.map((paper) => paper.id)].sort()
    );
    expect(new Set(body.papers.map((paper) => paper.id)).size).toBe(24);
  });

  test("normalizes undirected endpoints, evidence, warnings, and duplicate edges deterministically", async () => {
    const reversed = {
      ...verifiedEdge,
      evidenceRecordUrls: [
        "https://semanticscholar.org/paper/s2",
        "https://openalex.org/W1",
        "https://openalex.org/W1"
      ],
      sourcePaperId: "semantic_scholar:s2",
      targetPaperId: "openalex:W1"
    };
    const weaker = { ...verifiedEdge, strength: 0.5 };
    const load = createThinReadingPaperRelationsClient({
      endpoint: "https://api.example",
      transport: response({
        edges: [weaker, reversed],
        warnings: [" provider_partial ", "provider_partial"]
      })
    });

    await expect(load({ artifactId: "artifact-1", papers })).resolves.toEqual({
      edges: [verifiedEdge],
      warnings: ["provider_partial"]
    });
  });

  test.each([
    ["an unrequested endpoint", { ...verifiedEdge, targetPaperId: "openalex:W999" }],
    ["an unsupported kind", { ...verifiedEdge, kind: "semantic_similarity" }],
    ["an unsupported provider", { ...verifiedEdge, provider: "crossref" }],
    ["a wrong direct-citation direction", { ...verifiedEdge, directed: false, kind: "direct_citation" }],
    ["a wrong co-citation direction", { ...verifiedEdge, directed: true }],
    ["a non-finite strength", { ...verifiedEdge, strength: Number.NaN }],
    ["a strength outside the unit interval", { ...verifiedEdge, strength: 1.01 }],
    ["an empty evidence list", { ...verifiedEdge, evidenceRecordUrls: [] }],
    ["a non-HTTPS evidence URL", { ...verifiedEdge, evidenceRecordUrls: ["http://openalex.org/W1"] }],
    ["an extra field", { ...verifiedEdge, semanticScore: 0.9 }]
  ])("rejects %s", async (_label, edge) => {
    const load = createThinReadingPaperRelationsClient({
      endpoint: "https://api.example",
      transport: response({ edges: [edge], warnings: [] })
    });

    await expect(load({ artifactId: "artifact-1", papers })).rejects.toThrow(
      "推荐文献关系返回格式无效"
    );
  });
});
