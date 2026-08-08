import assert from "node:assert/strict";
import test from "node:test";

import {
  listExternalKnowledgeProviderIds,
  mergeExternalSources,
  searchExternalKnowledge,
  searchOpenAlexExternalKnowledge
} from "./externalKnowledgePayloads.mjs";

test("reserves verified anchor citations in the final cross-provider top-k", () => {
  const source = (id, relevance, overrides = {}) => ({
    abstract: `Abstract ${id}`,
    authors: [],
    id,
    provider: "doaj",
    relation: "topic_search",
    relevance,
    sourceId: id,
    title: `Topic result ${id}`,
    url: `https://example.test/${id}`,
    ...overrides
  });
  const anchorCitation = source("anchor-citation", 0.01, {
    anchorReference: true,
    provider: "openalex",
    relation: "cited_by_target",
    title: "Explicitly cited at the anchor"
  });

  const merged = mergeExternalSources([
    ...Array.from({ length: 5 }, (_, index) => source(`topic-${index}`, 0.99 - index / 100)),
    anchorCitation
  ], 5);

  assert.equal(merged.length, 5);
  assert.ok(merged.some((candidate) => candidate.id === "anchor-citation"));
  assert.equal(merged.find((candidate) => candidate.id === "anchor-citation")?.confidenceBasis, "author_citation");
});

test("keeps scholarly source expansion behind one provider registry", () => {
  assert.deepEqual(listExternalKnowledgeProviderIds(), [
    "openalex", "crossref", "arxiv", "semantic_scholar", "openaire", "oapen", "doaj"
  ]);
});

test("merges translated and direct query variants without duplicating a paper", async () => {
  const requestedQueries = [];
  const payload = await searchExternalKnowledge({
    limit: 5,
    query: "knowledge graph completion",
    queryVariants: ["knowledge graph completion", "知识图谱补全"]
  }, {
    arxivEnabled: false,
    crossrefEnabled: false,
    openAlexEnabled: false,
    openAireEnabled: true,
    openAireTransport: async (url) => {
      const query = new URL(url).searchParams.get("search");
      requestedQueries.push(query);
      return response({
        results: [{
          abstract: "A shared bilingual repository record.",
          authors: [{ name: "Researcher" }],
          id: "shared-record",
          publicationYear: 2024,
          title: query === "knowledge graph completion"
            ? "Knowledge graph completion with representation learning"
            : "知识图谱补全与表示学习",
          type: "publication"
        }]
      });
    }
  });

  assert.deepEqual(requestedQueries.sort(), ["knowledge graph completion", "知识图谱补全"].sort());
  assert.deepEqual(payload.queryVariants, ["knowledge graph completion", "知识图谱补全"]);
  assert.equal(payload.sources.length, 1);
  assert.equal(payload.sources[0].sourceId, "shared-record");
});

function response(payload) {
  return {
    json: async () => payload,
    ok: true,
    status: 200
  };
}

function paper(paperId, title) {
  return {
    abstract: `${title} abstract`,
    authors: [{ name: "Test Author" }],
    citationCount: 12,
    externalIds: {},
    paperId,
    referenceCount: 8,
    title,
    url: `https://example.test/${paperId}`,
    year: 2024
  };
}

test("a contact email cannot replace the deployment-owned OpenAlex key", async () => {
  let contacted = false;
  await assert.rejects(
    searchOpenAlexExternalKnowledge({ limit: 5, query: "anchor retrieval" }, {
      openAlexMailto: "research@example.test",
      transport: async () => {
        contacted = true;
        return response({ results: [] });
      }
    }),
    (error) => error?.code === "academic_graph_unavailable" && error?.statusCode === 503
  );
  assert.equal(contacted, false);
});

test("OpenAlex timeout covers a stalled response body", async () => {
  await assert.rejects(
    searchOpenAlexExternalKnowledge({ limit: 5, query: "anchor retrieval" }, {
      openAlexApiKey: "test-key",
      timeoutMs: 5,
      transport: async (_url, { signal }) => ({
        json: () => new Promise((_, reject) => signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true })),
        ok: true,
        status: 200
      })
    }),
    (error) => error?.code === "openalex_timeout" && error?.statusCode === 504
  );
});

test("arXiv timeout covers a stalled response body", async () => {
  await assert.rejects(
    searchExternalKnowledge({ limit: 5, query: "anchor retrieval" }, {
      arxivEnabled: true,
      arxivTimeoutMs: 5,
      arxivTransport: async (_url, { signal }) => ({
        ok: true,
        status: 200,
        text: () => new Promise((_, reject) => signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true }))
      }),
      crossrefEnabled: false,
      openAlexEnabled: false
    }),
    (error) => error?.code === "arxiv_timeout" && error?.statusCode === 504
  );
});

test("returns direct, co-cited, and bibliographically coupled Semantic Scholar works as distinct relations", async () => {
  const target = paper("target", "Target paper");
  const citedReference = paper("reference-1", "Direct reference");
  const citingOne = paper("citing-1", "First citing paper");
  const citingTwo = paper("citing-2", "Second citing paper");
  const coCited = paper("co-cited-1", "Frequently co-cited work");
  const coupled = paper("coupled-1", "Bibliographically coupled work");
  const semanticScholarTransport = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/paper/search")) {
      return response({ data: [target, coupled] });
    }
    if (parsed.pathname.endsWith("/paper/target/references")) {
      return response({ data: [{ citedPaper: citedReference }] });
    }
    if (parsed.pathname.endsWith("/paper/target/citations")) {
      return response({ data: [{ citingPaper: citingOne }, { citingPaper: citingTwo }] });
    }
    if (parsed.pathname.endsWith("/paper/citing-1/references")) {
      return response({ data: [{ citedPaper: coCited }, { citedPaper: citedReference }] });
    }
    if (parsed.pathname.endsWith("/paper/citing-2/references")) {
      return response({ data: [{ citedPaper: coCited }] });
    }
    if (parsed.pathname.endsWith("/paper/coupled-1/references")) {
      return response({ data: [{ citedPaper: citedReference }] });
    }
    throw new Error(`Unexpected Semantic Scholar request: ${url}`);
  };

  const payload = await searchExternalKnowledge({
    limit: 16,
    query: "attention mechanism",
    targetPaperTitle: "Target paper"
  }, {
    arxivEnabled: false,
    crossrefEnabled: false,
    openAlexEnabled: false,
    semanticScholarEnabled: true,
    semanticScholarTransport
  });

  assert.equal(payload.provider, "semantic_scholar");
  assert.deepEqual(
    new Map(payload.sources.map((source) => [source.sourceId, source.relation])),
    new Map([
      ["reference-1", "cited_by_target"],
      ["citing-1", "cites_target"],
      ["citing-2", "cites_target"],
      ["co-cited-1", "co_cited"],
      ["coupled-1", "bibliographic_coupling"]
    ])
  );
  assert.ok(payload.sources.find((source) => source.sourceId === "co-cited-1")?.relationshipStrength > 0.5);
  assert.ok(payload.sources.find((source) => source.sourceId === "coupled-1")?.relationshipStrength > 0.5);
});

test("does not reintroduce a whole-paper Semantic Scholar graph in anchor-exclusive mode", async () => {
  const requests = [];
  const payload = await searchExternalKnowledge({
    anchorReferences: [{ number: 1, text: "A local reference" }],
    limit: 5,
    query: "attention mechanism",
    targetPaperTitle: "Target paper"
  }, {
    anchorReferenceMode: "exclusive",
    arxivEnabled: false,
    crossrefEnabled: false,
    openAlexEnabled: false,
    semanticScholarEnabled: true,
    semanticScholarTransport: async (url) => {
      requests.push(new URL(url).pathname);
      return response({ data: [paper("topic-1", "Attention mechanism study")] });
    }
  });

  assert.deepEqual(requests, ["/graph/v1/paper/search"]);
  assert.deepEqual(payload.sources.map((source) => source.relation), ["topic_search"]);
});

test("uses OpenAIRE metadata results when expanded source coverage is enabled", async () => {
  const payload = await searchExternalKnowledge({
    limit: 4,
    query: "social history archive"
  }, {
    arxivEnabled: false,
    crossrefEnabled: false,
    openAlexEnabled: false,
    openAireEnabled: true,
    openAireTransport: async () => response({
      results: [{
        abstract: "A repository record for social history.",
        authors: [{ name: "Historian" }],
        id: "openaire-record-1",
        publicationYear: 2023,
        title: "Social history archive study",
        type: "publication"
      }]
    })
  });

  assert.equal(payload.provider, "openaire");
  assert.deepEqual(payload.sources[0], {
    abstract: "A repository record for social history.",
    accessStatus: "metadata_only",
    authors: ["Historian"],
    // A topic hit with no citation relation is presented as exactly that, never as the
    // author's own reference.
    confidence: 0.3,
    confidenceBasis: "algorithmic_retrieval",
    id: "openaire:openaire-record-1",
    provider: "openaire",
    relation: "topic_search",
    relevance: payload.sources[0].relevance,
    retrievalQuery: "social history archive",
    sourceId: "openaire-record-1",
    sourceRecordUrl: "https://explore.openaire.eu/search/publication?articleId=openaire-record-1",
    title: "Social history archive study",
    url: "https://explore.openaire.eu/search/publication?articleId=openaire-record-1",
    workType: "article",
    year: 2023
  });
});

test("uses OAPEN books with a verified PDF bitstream for humanities discovery", async () => {
  const payload = await searchExternalKnowledge({
    limit: 4,
    query: "social history"
  }, {
    arxivEnabled: false,
    crossrefEnabled: false,
    oapenEnabled: true,
    oapenTransport: async () => response({
      items: [{
        bitstreams: [{
          content: "https://library.example.test/books/social-history.pdf",
          mimeType: "application/pdf"
        }],
        metadata: {
          "dc.contributor.author": [{ value: "Historian" }],
          "dc.date.issued": [{ value: "2022-09-01" }],
          "dc.description.abstract": [{ value: "An open access social history monograph." }],
          "dc.identifier.uri": [{ value: "https://library.oapen.org/handle/20.500.12657/25287" }],
          "dc.title": [{ value: "A social history of archives" }]
        }
      }]
    }),
    openAlexEnabled: false,
    openAireEnabled: false,
    semanticScholarEnabled: false
  });

  assert.equal(payload.provider, "oapen");
  assert.deepEqual(payload.sources, [{
    abstract: "An open access social history monograph.",
    accessStatus: "open_access",
    authors: ["Historian"],
    confidence: 0.3,
    confidenceBasis: "algorithmic_retrieval",
    fullTextUrl: "https://library.example.test/books/social-history.pdf",
    id: "oapen:20.500.12657/25287",
    openAccessAvailable: true,
    provider: "oapen",
    relation: "topic_search",
    relevance: payload.sources[0].relevance,
    retrievalQuery: "social history",
    sourceId: "20.500.12657/25287",
    sourceRecordUrl: "https://library.oapen.org/handle/20.500.12657/25287",
    title: "A social history of archives",
    url: "https://library.example.test/books/social-history.pdf",
    workType: "book",
    year: 2022
  }]);
});

test("uses DOAJ articles only when their open full text is a direct PDF", async () => {
  const payload = await searchExternalKnowledge({
    limit: 4,
    query: "social history"
  }, {
    arxivEnabled: false,
    crossrefEnabled: false,
    doajEnabled: true,
    doajTransport: async () => response({
      results: [{
        bibjson: {
          abstract: "An open access article on social history.",
          author: [{ name: "Researcher" }],
          identifier: [{ id: "10.5555/social.history", type: "doi" }],
          link: [{ content_type: "application/pdf", url: "https://journal.example.test/social-history.pdf" }],
          title: "Social history in open archives",
          year: 2021
        },
        id: "f0c0f90b-8ab1-4a00-a013-888888888888"
      }]
    }),
    oapenEnabled: false,
    openAlexEnabled: false,
    openAireEnabled: false,
    semanticScholarEnabled: false
  });

  assert.deepEqual(payload.sources, [{
    abstract: "An open access article on social history.",
    accessStatus: "open_access",
    authors: ["Researcher"],
    canonicalPaperId: "doi:10.5555/social.history",
    confidence: 0.3,
    confidenceBasis: "algorithmic_retrieval",
    doi: "https://doi.org/10.5555/social.history",
    fullTextUrl: "https://journal.example.test/social-history.pdf",
    id: "doaj:f0c0f90b-8ab1-4a00-a013-888888888888",
    openAccessAvailable: true,
    provider: "doaj",
    relation: "topic_search",
    relevance: payload.sources[0].relevance,
    retrievalQuery: "social history",
    sourceId: "f0c0f90b-8ab1-4a00-a013-888888888888",
    sourceRecordUrl: "https://doaj.org/article/f0c0f90b-8ab1-4a00-a013-888888888888",
    title: "Social history in open archives",
    url: "https://journal.example.test/social-history.pdf",
    workType: "article",
    year: 2021
  }]);
});
