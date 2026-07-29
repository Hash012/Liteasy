import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveRecommendationPayload,
  normalizeRecommendationResearchProfile
} from "./recommendationPayloads.mjs";

function source(id, title, relevance) {
  return {
    id: `openalex:${id}`,
    provider: "openalex",
    relation: "topic_search",
    relevance,
    title,
    url: `https://openalex.org/${id}`
  };
}

test("reranks near-duplicate recommendations with a bounded auditable diversity penalty", () => {
  const result = buildLiveRecommendationPayload(
    {
      selectedDocuments: [{ id: "paper-1", title: "Target Paper" }]
    },
    [{
      relatedDocumentTitle: "Target Paper",
      sources: [
        source("W1", "Neural Retrieval with Dense Embeddings", 0.95),
        source("W2", "Neural Retrieval with Dense Embedding Models", 0.94),
        source("W3", "Graph Methods for Protein Discovery", 0.9)
      ]
    }],
    new Date("2026-07-29T00:00:00.000Z")
  );

  assert.deepEqual(
    result.recommendations.map((candidate) => candidate.canonicalId),
    ["openalex:W1", "openalex:W3", "openalex:W2"]
  );
  const first = result.recommendations[0];
  const duplicate = result.recommendations[2];
  assert.deepEqual(result.rankingFusion, {
    absoluteRelevanceFloorWeight: 0.3,
    candidateCount: 3,
    fusionWeight: 0.7,
    k: 10,
    routes: [{ id: "provider", weight: 0.35 }],
    version: "recommendation-ranking-fusion/v1"
  });
  assert.equal(first.scoreComponents.baseRelevance, 0.95);
  assert.equal(first.scoreComponents.diversityPenalty, 0);
  assert.equal(first.scoreComponents.finalScore, 0.95);
  assert.equal(first.scoreComponents.fusionScore, 1);
  assert.equal(first.scoreComponents.preFusionRelevance, 0.95);
  assert.equal(first.scoreComponents.providerRelevance, 0.95);
  assert.equal(first.scoreComponents.sourceRelevance, 0.95);
  assert.deepEqual(first.rankingFusion.routes, [{
    contribution: 0.031818,
    id: "provider",
    rank: 1,
    score: 0.95,
    weight: 0.35
  }]);
  assert.ok(duplicate.scoreComponents.diversityPenalty >= 0.03);
  assert.ok(duplicate.scoreComponents.diversityPenalty <= 0.18);
  assert.equal(
    duplicate.relevanceScore,
    duplicate.scoreComponents.finalScore
  );
  assert.equal(
    Number((duplicate.scoreComponents.baseRelevance -
      duplicate.scoreComponents.diversityPenalty).toFixed(3)),
    duplicate.scoreComponents.finalScore
  );
  assert.match(duplicate.reason, /多样性降权/);
});

test("blends a real embedding score at a bounded weight and exposes score components", () => {
  const result = buildLiveRecommendationPayload(
    { selectedDocuments: [{ id: "paper-1", title: "Target Paper" }] },
    [{
      relatedDocumentTitle: "Target Paper",
      sources: [{
        ...source("W99", "Semantic Retrieval Candidate", 0.8),
        semanticRelevance: 0.2,
        semanticRetrievalVersion: "recommendation-semantic-retrieval/v1"
      }]
    }],
    new Date("2026-07-29T00:00:00.000Z")
  );

  const candidate = result.recommendations[0];
  assert.equal(candidate.scoreComponents.providerRelevance, 0.8);
  assert.equal(candidate.scoreComponents.semanticRelevance, 0.2);
  assert.equal(candidate.scoreComponents.sourceRelevance, 0.59);
  assert.equal(candidate.scoreComponents.finalScore, 0.59);
  assert.match(candidate.reason, /真实 embedding provider/);
  assert.match(candidate.reason, /0.35 权重/);
});

test("fuses provider, BM25 lexical, and semantic ranks with per-route audit", () => {
  const input = {
    selectedDocuments: [{ id: "paper-1", title: "Target Paper" }]
  };
  const sourceGroups = [{
    relatedDocumentTitle: "Target Paper",
    semanticQuery: "graph protein",
    sources: [
      { ...source("W50", "Dense Language Retrieval", 0.95), semanticRelevance: 0.1 },
      { ...source("W51", "Graph Protein Discovery", 0.75), semanticRelevance: 0.9 },
      { ...source("W52", "Other Benchmark", 0.85), semanticRelevance: 0.4 }
    ]
  }];
  const first = buildLiveRecommendationPayload(
    input,
    sourceGroups,
    new Date("2026-07-29T00:00:00.000Z")
  );
  const second = buildLiveRecommendationPayload(
    input,
    sourceGroups,
    new Date("2026-07-29T00:00:00.000Z")
  );

  assert.deepEqual(first, second);
  assert.deepEqual(first.rankingFusion.routes, [
    { id: "provider", weight: 0.35 },
    { id: "lexical_bm25", weight: 0.3 },
    { id: "semantic", weight: 0.25 }
  ]);
  assert.equal(first.recommendations[0].canonicalId, "openalex:W51");
  assert.equal(first.recommendations[0].scoreComponents.lexicalRelevance, 1);
  assert.deepEqual(
    first.recommendations[0].rankingFusion.routes.map((route) => [route.id, route.rank]),
    [["provider", 3], ["lexical_bm25", 1], ["semantic", 1]]
  );
  assert.match(first.recommendations[0].reason, /RRF 融合/);
  const unrelated = first.recommendations.find((candidate) => candidate.canonicalId === "openalex:W50");
  assert.equal(
    unrelated.rankingFusion.routes.some((route) => route.id === "lexical_bm25"),
    false
  );
});

test("adds a bounded auditable research-profile signal without demographic proxies", () => {
  const sourceGroups = [{
    relatedDocumentTitle: "Target Paper",
    sources: [
      source("W20", "Neural Retrieval with Hybrid Search", 0.7),
      source("W21", "Protein Folding with Molecular Dynamics", 0.7)
    ]
  }];
  const researchProfile = {
    datasets: ["BEIR"],
    languages: ["中文"],
    methods: ["hybrid search"],
    topics: ["neural retrieval"]
  };
  const withProfile = buildLiveRecommendationPayload(
    { researchProfile, selectedDocuments: [{ id: "paper-1", title: "Target Paper" }] },
    sourceGroups,
    new Date("2026-07-29T00:00:00.000Z")
  );
  const matching = withProfile.recommendations.find((item) => item.canonicalId === "openalex:W20");
  const unrelated = withProfile.recommendations.find((item) => item.canonicalId === "openalex:W21");

  assert.equal(matching.scoreComponents.profileRelevance, 0.2);
  assert.equal(unrelated.scoreComponents.profileRelevance, 0);
  assert.ok(matching.relevanceScore > unrelated.relevanceScore);
  assert.match(matching.reason, /研究画像/);
  assert.ok(matching.scoreComponents.profileRelevance <= 0.2);
  assert.ok(matching.rankingFusion.routes.some((route) => route.id === "personalization"));
  assert.equal(unrelated.rankingFusion.routes.some((route) => route.id === "personalization"), false);
  assert.equal(
    matching.scoreComponents.baseRelevance,
    Number((matching.scoreComponents.sourceRelevance +
      matching.scoreComponents.preference +
      matching.scoreComponents.profileRelevance).toFixed(3))
  );

  const withDemographics = buildLiveRecommendationPayload(
    {
      age: "92",
      gender: "任意值",
      researchProfile,
      selectedDocuments: [{ id: "paper-1", title: "Target Paper" }]
    },
    sourceGroups,
    new Date("2026-07-29T00:00:00.000Z")
  );
  assert.deepEqual(
    withDemographics.recommendations.map((item) => [item.canonicalId, item.relevanceScore]),
    withProfile.recommendations.map((item) => [item.canonicalId, item.relevanceScore])
  );
});

test("rejects malformed and oversized research profiles", () => {
  assert.deepEqual(normalizeRecommendationResearchProfile({ topics: "retrieval" }), {
    error: "research_profile_datasets_invalid",
    ok: false
  });
  assert.equal(normalizeRecommendationResearchProfile({
    datasets: [],
    languages: [],
    methods: [],
    topics: Array.from({ length: 13 }, (_, index) => `topic-${index}`)
  }).ok, false);
});

test("uses DOI as the recommendation identity and retains cross-provider provenance", () => {
  const result = buildLiveRecommendationPayload(
    { selectedDocuments: [{ id: "paper-1", title: "Target Paper" }] },
    [{
      relatedDocumentTitle: "Target Paper",
      sources: [{
        ...source("W30", "Cross Provider Retrieval Evaluation", 0.8),
        canonicalPaperId: "doi:10.1000/shared-paper",
        doi: "https://doi.org/10.1000/SHARED-PAPER",
        sourceRecords: [
          {
            id: "openalex:W30",
            provider: "openalex",
            title: "Cross Provider Retrieval Evaluation",
            url: "https://openalex.org/W30",
            year: 2025
          },
          {
            id: "crossref:10.1000/shared-paper",
            provider: "crossref",
            recordUrl: "https://api.crossref.org/works/10.1000%2Fshared-paper",
            title: "Cross-provider retrieval evaluation",
            url: "https://doi.org/10.1000/shared-paper",
            year: 2025
          }
        ]
      }]
    }],
    new Date("2026-07-29T00:00:00.000Z")
  );

  assert.equal(result.recommendations.length, 1);
  const candidate = result.recommendations[0];
  assert.equal(candidate.canonicalId, "doi:10.1000/shared-paper");
  assert.equal(candidate.id, "reading-candidate:doi:10.1000/shared-paper");
  assert.deepEqual(candidate.identityResolution.providers, ["openalex", "crossref"]);
  assert.deepEqual(candidate.identityResolution.aliases, [
    "openalex:W30",
    "crossref:10.1000/shared-paper"
  ]);
  assert.equal(candidate.identityResolution.consistent, true);
  assert.equal(candidate.source, "OpenAlex + Crossref");
  assert.match(candidate.reason, /已按 DOI 合并/);
});

test("rejects conflicting records that claim the same DOI", () => {
  const result = buildLiveRecommendationPayload(
    { selectedDocuments: [{ id: "paper-1", title: "Target Paper" }] },
    [{
      relatedDocumentTitle: "Target Paper",
      sources: [{
        ...source("W31", "Neural Retrieval Evaluation", 0.9),
        doi: "https://doi.org/10.1000/conflict",
        sourceRecords: [
          {
            id: "openalex:W31",
            provider: "openalex",
            title: "Neural Retrieval Evaluation",
            url: "https://openalex.org/W31",
            year: 2025
          },
          {
            id: "crossref:10.1000/conflict",
            provider: "crossref",
            title: "Unrelated Protein Folding Study",
            url: "https://doi.org/10.1000/conflict",
            year: 2012
          }
        ]
      }]
    }],
    new Date("2026-07-29T00:00:00.000Z")
  );

  assert.equal(result.recommendations.length, 0);
  assert.equal(result.qualityGate.rejected, 1);
});

test("merges the same DOI across independent retrieval groups", () => {
  const result = buildLiveRecommendationPayload(
    { selectedDocuments: [{ id: "paper-1", title: "Target One" }] },
    [
      {
        relatedDocumentTitle: "Target One",
        sources: [{
          ...source("W32", "Shared Retrieval Paper", 0.8),
          doi: "https://doi.org/10.1000/across-groups"
        }]
      },
      {
        relatedDocumentTitle: "Research Profile",
        sources: [{
          doi: "https://doi.org/10.1000/across-groups",
          id: "crossref:10.1000/across-groups",
          provider: "crossref",
          relation: "topic_search",
          relevance: 0.75,
          title: "Shared retrieval paper",
          url: "https://doi.org/10.1000/across-groups"
        }]
      }
    ],
    new Date("2026-07-29T00:00:00.000Z")
  );

  assert.equal(result.recommendations.length, 1);
  assert.deepEqual(result.recommendations[0].identityResolution.providers, ["openalex", "crossref"]);
  assert.deepEqual(result.recommendations[0].relatedDocumentTitles, ["Target One", "Research Profile"]);
});

test("uses a versionless arXiv identity when DOI is unavailable", () => {
  const result = buildLiveRecommendationPayload(
    { selectedDocuments: [{ id: "paper-1", title: "Target Paper" }] },
    [{
      relatedDocumentTitle: "Target Paper",
      sources: [{
        ...source("W40", "ArXiv Retrieval Candidate", 0.8),
        arxivId: "2401.01234v3"
      }]
    }],
    new Date("2026-07-29T00:00:00.000Z")
  );

  assert.equal(result.recommendations[0].canonicalId, "arxiv:2401.01234");
  assert.equal(result.recommendations[0].identityResolution.arxivId, "2401.01234");
  assert.ok(result.recommendations[0].identityResolution.aliases.includes("arxiv:2401.01234"));
});

test("marks DOI and arXiv aliases as an unverified possible version family", () => {
  const result = buildLiveRecommendationPayload(
    { selectedDocuments: [{ id: "paper-1", title: "Target Paper" }] },
    [{
      relatedDocumentTitle: "Target Paper",
      sources: [{
        ...source("W41", "Versioned Retrieval Candidate", 0.8),
        arxivId: "2101.01234",
        doi: "https://doi.org/10.1000/versioned",
        sourceRecords: [
          {
            arxivId: "2101.01234v2",
            id: "openalex:W41",
            provider: "openalex",
            title: "Versioned Retrieval Candidate",
            url: "https://arxiv.org/abs/2101.01234",
            year: 2021
          },
          {
            arxivId: "2101.01234",
            doi: "https://doi.org/10.1000/versioned",
            id: "crossref:10.1000/versioned",
            provider: "crossref",
            title: "Versioned Retrieval Candidate",
            url: "https://doi.org/10.1000/versioned",
            year: 2024
          }
        ]
      }]
    }],
    new Date("2026-07-29T00:00:00.000Z")
  );

  const candidate = result.recommendations[0];
  assert.equal(candidate.canonicalId, "doi:10.1000/versioned");
  assert.equal(candidate.identityResolution.lineageStatus, "possible_version_family");
  assert.ok(candidate.identityResolution.aliases.includes("arxiv:2101.01234"));
  assert.match(candidate.reason, /可能版本族/);
  assert.match(candidate.reason, /尚未核验/);
});

test("records an arXiv-declared DOI publication link without claiming full-text equivalence", () => {
  const result = buildLiveRecommendationPayload(
    { selectedDocuments: [{ id: "paper-1", title: "Target Paper" }] },
    [{
      relatedDocumentTitle: "Target Paper",
      sources: [{
        ...source("W42", "Published Retrieval Candidate", 0.82),
        arxivId: "2201.01234",
        doi: "https://doi.org/10.1000/published",
        sourceRecords: [
          {
            arxivId: "2201.01234v4",
            doi: "https://doi.org/10.1000/published",
            id: "arxiv:2201.01234",
            provider: "arxiv",
            recordUrl: "https://arxiv.org/abs/2201.01234",
            title: "Published Retrieval Candidate",
            url: "https://arxiv.org/abs/2201.01234",
            year: 2022
          },
          {
            doi: "https://doi.org/10.1000/published",
            id: "crossref:10.1000/published",
            provider: "crossref",
            recordUrl: "https://api.crossref.org/works/10.1000%2Fpublished",
            title: "Published retrieval candidate",
            url: "https://doi.org/10.1000/published",
            year: 2024
          }
        ]
      }]
    }],
    new Date("2026-07-29T00:00:00.000Z")
  );

  const candidate = result.recommendations[0];
  assert.equal(candidate.canonicalId, "doi:10.1000/published");
  assert.equal(
    candidate.identityResolution.lineageStatus,
    "provider_declared_publication_link"
  );
  assert.deepEqual(candidate.identityResolution.lineageEvidence, {
    declaredBy: "arxiv",
    relation: "arxiv_declared_doi",
    sourceId: "arxiv:2201.01234",
    sourceRecordUrl: "https://arxiv.org/abs/2201.01234",
    targetId: "doi:10.1000/published"
  });
  assert.equal(candidate.identityResolution.version, "recommendation-identity/v2");
  assert.match(candidate.reason, /arXiv 元数据明确声明/);
  assert.match(candidate.reason, /尚未核验两版全文内容等价/);
});

test("rejects a provider-declared publication link when cross-provider titles conflict", () => {
  const result = buildLiveRecommendationPayload(
    { selectedDocuments: [{ id: "paper-1", title: "Target Paper" }] },
    [{
      relatedDocumentTitle: "Target Paper",
      sources: [{
        ...source("W43", "Retrieval Systems Candidate", 0.82),
        arxivId: "2201.05678",
        doi: "https://doi.org/10.1000/conflicting-publication",
        sourceRecords: [
          {
            arxivId: "2201.05678",
            doi: "https://doi.org/10.1000/conflicting-publication",
            id: "arxiv:2201.05678",
            provider: "arxiv",
            title: "Retrieval Systems Candidate",
            url: "https://arxiv.org/abs/2201.05678",
            year: 2022
          },
          {
            doi: "https://doi.org/10.1000/conflicting-publication",
            id: "crossref:10.1000/conflicting-publication",
            provider: "crossref",
            title: "Unrelated Clinical Oncology Trial",
            url: "https://doi.org/10.1000/conflicting-publication",
            year: 2023
          }
        ]
      }]
    }],
    new Date("2026-07-29T00:00:00.000Z")
  );

  assert.equal(result.recommendations.length, 0);
  assert.equal(result.qualityGate.rejected, 1);
});

test("rejects known retractions and implausible publication years before ranking", () => {
  const result = buildLiveRecommendationPayload(
    { selectedDocuments: [{ id: "paper-1", title: "Target Paper" }] },
    [{
      relatedDocumentTitle: "Target Paper",
      sources: [
        { ...source("W10", "Retracted Retrieval Result", 0.99), isRetracted: true },
        { ...source("W11", "Future Retrieval Result", 0.98), year: 2200 },
        { ...source("W12", "Traceable Retrieval Result", 0.8), openAccessAvailable: true }
      ]
    }],
    new Date("2026-07-29T00:00:00.000Z")
  );

  assert.deepEqual(result.qualityGate, {
    accepted: 1,
    evaluated: 3,
    rejected: 2,
    version: "recommendation-quality/v1"
  });
  assert.deepEqual(
    result.recommendations.map((candidate) => candidate.canonicalId),
    ["openalex:W12"]
  );
  assert.equal(result.recommendations[0].openAccessAvailable, true);
  assert.equal(result.recommendations[0].qualityGate.passed, true);
});
