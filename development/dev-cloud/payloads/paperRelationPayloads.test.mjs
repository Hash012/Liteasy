import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPaperRelationPayload,
  PaperRelationValidationError
} from "./paperRelationPayloads.mjs";

const input = {
  artifactId: "artifact-page-1",
  papers: [
    {
      canonicalPaperId: "openalex:W1",
      id: "paper-anchor-a",
      provider: "openalex",
      sourceId: "W1"
    },
    {
      canonicalPaperId: "openalex:W2",
      id: "paper-anchor-b",
      provider: "openalex",
      sourceId: "W2"
    }
  ]
};

test("derives verified relations across papers owned by different anchors", async () => {
  const result = await buildPaperRelationPayload(input, {
    fetchGraphRecords: async () => [
      {
        evidenceRecordUrl: "https://openalex.org/W1",
        id: "openalex:W1",
        provider: "openalex",
        referencedPaperIds: ["openalex:W2", "openalex:W9"]
      },
      {
        evidenceRecordUrl: "https://openalex.org/W2",
        id: "openalex:W2",
        provider: "openalex",
        referencedPaperIds: ["openalex:W9"]
      }
    ]
  });

  assert.deepEqual(
    result.edges.map((edge) => edge.kind).sort(),
    ["bibliographic_coupling", "direct_citation"]
  );
  assert.deepEqual(result.edges.find((edge) => edge.kind === "direct_citation"), {
    directed: true,
    evidenceRecordUrls: ["https://openalex.org/W1"],
    kind: "direct_citation",
    provider: "openalex",
    sourcePaperId: "paper-anchor-a",
    strength: 1,
    targetPaperId: "paper-anchor-b"
  });
  assert.equal(result.edges.every((edge) => edge.evidenceRecordUrls.length > 0), true);
});

test("never emits semantic similarity as a paper relation", async () => {
  const result = await buildPaperRelationPayload(input, {
    fetchGraphRecords: async () => [
      {
        evidenceRecordUrl: "https://openalex.org/W1",
        id: "openalex:W1",
        provider: "openalex",
        relatedPaperIds: ["openalex:W2"],
        semanticSimilarPaperIds: ["openalex:W2"]
      }
    ]
  });

  assert.deepEqual(result.edges, []);
});

test("normalizes DOI identities, deduplicates papers, and avoids self or duplicate edges", async () => {
  const result = await buildPaperRelationPayload({
    artifactId: "artifact-page-2",
    papers: [
      {
        doi: "https://doi.org/10.1000/ONE",
        id: "paper-one",
        provider: "crossref",
        sourceId: "10.1000/ONE"
      },
      {
        canonicalPaperId: "doi:10.1000/one",
        doi: "10.1000/one",
        id: "paper-one-duplicate",
        provider: "openalex",
        sourceId: "W1"
      },
      {
        doi: "10.1000/two",
        id: "paper-two",
        provider: "semantic_scholar",
        sourceId: "S2"
      }
    ]
  }, {
    fetchGraphRecords: async (papers) => {
      assert.equal(papers.length, 2);
      return [
        {
          evidenceRecordUrl: "https://api.example.test/one",
          id: "doi:10.1000/one",
          provider: "openalex",
          referencedPaperIds: ["doi:10.1000/one", "doi:10.1000/two", "doi:10.1000/two"]
        },
        {
          evidenceRecordUrl: "https://api.example.test/two",
          id: "doi:10.1000/two",
          provider: "openalex",
          referencedPaperIds: []
        }
      ];
    }
  });

  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].sourcePaperId, "paper-one");
  assert.equal(result.edges[0].targetPaperId, "paper-two");
});

test("emits co-citation only from an explicit provider count with a usable denominator", async () => {
  const result = await buildPaperRelationPayload(input, {
    fetchGraphRecords: async () => [
      {
        citingPaperCount: 8,
        coCitedRelations: [{ paperId: "openalex:W2", sharedCitingWorkCount: 2 }],
        evidenceRecordUrl: "https://openalex.org/W1",
        id: "openalex:W1",
        provider: "openalex",
        referencedPaperIds: []
      },
      {
        citingPaperCount: 4,
        evidenceRecordUrl: "https://openalex.org/W2",
        id: "openalex:W2",
        provider: "openalex",
        referencedPaperIds: []
      }
    ]
  });

  assert.deepEqual(result.edges, [{
    directed: false,
    evidenceRecordUrls: ["https://openalex.org/W1", "https://openalex.org/W2"],
    kind: "co_cited",
    provider: "openalex",
    sourcePaperId: "paper-anchor-a",
    strength: 0.5,
    targetPaperId: "paper-anchor-b"
  }]);
});

test("returns a warning and no synthesized edges when graph retrieval fails", async () => {
  const result = await buildPaperRelationPayload(input, {
    fetchGraphRecords: async () => {
      throw new Error("provider unavailable");
    }
  });

  assert.deepEqual(result.edges, []);
  assert.deepEqual(result.warnings, ["paper_relation_provider_unavailable"]);
});

test("keeps verified records from a partial retrieval and preserves its provider warning", async () => {
  const result = await buildPaperRelationPayload(input, {
    fetchGraphRecords: async () => ({
      records: [
        {
          evidenceRecordUrl: "https://openalex.org/W1",
          id: "openalex:W1",
          provider: "openalex",
          referencedPaperIds: ["openalex:W2"]
        },
        {
          evidenceRecordUrl: "https://openalex.org/W2",
          id: "openalex:W2",
          provider: "openalex",
          referencedPaperIds: []
        }
      ],
      warnings: ["semantic_scholar_paper_relations_unavailable"]
    })
  });

  assert.deepEqual(result.edges.map((edge) => edge.kind), ["direct_citation"]);
  assert.deepEqual(result.warnings, ["semantic_scholar_paper_relations_unavailable"]);
});

test("batches OpenAlex graph records with server-owned configuration", async () => {
  let requestedUrl;
  const result = await buildPaperRelationPayload(input, {
    openAlexApiKey: "server-key",
    openAlexTransport: async (url) => {
      requestedUrl = url;
      return {
        json: async () => ({
          results: [
            { cited_by_count: 3, id: "https://openalex.org/W1", referenced_works: ["https://openalex.org/W2"] },
            { cited_by_count: 2, id: "https://openalex.org/W2", referenced_works: [] }
          ]
        }),
        ok: true,
        status: 200
      };
    }
  });

  const parsedUrl = new URL(requestedUrl);
  assert.equal(parsedUrl.searchParams.get("filter"), "openalex_id:W1|W2");
  assert.equal(parsedUrl.searchParams.get("api_key"), "server-key");
  assert.deepEqual(result.edges.map((edge) => edge.kind), ["direct_citation"]);
});

test("links provider graph identifiers discovered through DOI batch records", async () => {
  const result = await buildPaperRelationPayload({
    artifactId: "artifact-doi-graph",
    papers: [
      { doi: "10.1000/a", id: "doi-paper-a", provider: "crossref", sourceId: "10.1000/a" },
      { doi: "10.1000/b", id: "doi-paper-b", provider: "crossref", sourceId: "10.1000/b" }
    ]
  }, {
    openAlexApiKey: "server-key",
    openAlexTransport: async () => ({
      json: async () => ({
        results: [
          {
            doi: "https://doi.org/10.1000/a",
            id: "https://openalex.org/W11",
            referenced_works: ["https://openalex.org/W12"]
          },
          {
            doi: "https://doi.org/10.1000/b",
            id: "https://openalex.org/W12",
            referenced_works: []
          }
        ]
      }),
      ok: true,
      status: 200
    })
  });

  assert.deepEqual(result.edges.map((edge) => [edge.sourcePaperId, edge.targetPaperId]), [
    ["doi-paper-a", "doi-paper-b"]
  ]);
});

test("rejects malformed and over-limit requests before provider retrieval", async () => {
  let calls = 0;
  const options = {
    fetchGraphRecords: async () => {
      calls += 1;
      return [];
    }
  };

  await assert.rejects(
    buildPaperRelationPayload({ artifactId: "", papers: [] }, options),
    (error) => error instanceof PaperRelationValidationError &&
      error.code === "invalid_paper_relation_request"
  );
  await assert.rejects(
    buildPaperRelationPayload({
      artifactId: "artifact-over-limit",
      papers: Array.from({ length: 25 }, (_, index) => ({
        id: `paper-${index}`,
        provider: "openalex",
        sourceId: `W${index}`
      }))
    }, options),
    (error) => error instanceof PaperRelationValidationError &&
      error.code === "paper_relation_paper_limit_exceeded"
  );
  await assert.rejects(
    buildPaperRelationPayload({
      artifactId: "artifact-conflicting-identities",
      papers: [
        { canonicalPaperId: "doi:10.1000/a", id: "a", provider: "openalex", sourceId: "W1" },
        { canonicalPaperId: "doi:10.1000/b", id: "b", provider: "openalex", sourceId: "W2" },
        { canonicalPaperId: "doi:10.1000/a", id: "conflict", provider: "openalex", sourceId: "W2" }
      ]
    }, options),
    (error) => error instanceof PaperRelationValidationError &&
      error.code === "conflicting_paper_relation_identity"
  );
  assert.equal(calls, 0);
});
