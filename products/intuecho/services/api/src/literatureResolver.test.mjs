import assert from "node:assert/strict";
import test from "node:test";
import { createLiteratureResolver } from "./literatureResolver.mjs";

const user = { id: "reader-1" };

function publicIdentifier(kind, value) {
  return { kind, source: "public_registry", value };
}

function candidate({ candidateKey, identifiers, provider, title = "A Paper", authors = ["A. Author"], year = 2026 }) {
  return {
    candidateKey,
    provider,
    record: { authors, identifiers, title, year }
  };
}

function provider(name, { fetchCandidate, search = async () => [] } = {}) {
  return { fetchCandidate, name, search };
}

function repository(overrides = {}) {
  return {
    async confirmLiterature(_owner, input) {
      return { source: "manual", title: input.record.title };
    },
    async confirmRefetchedLiterature(_owner, verifiedCandidate) {
      return { source: "refetched", title: verifiedCandidate.record.title };
    },
    async findLiteratureById() {
      return null;
    },
    async searchStoredLiterature() {
      return [];
    },
    ...overrides
  };
}

test("prefers an internal confirmed record over matching provider candidates", async () => {
  const resolver = createLiteratureResolver({
    providers: [provider("crossref", {
      search: async () => [candidate({
        candidateKey: "crossref:doi:10.1000/shared",
        identifiers: [publicIdentifier("doi", "10.1000/shared")],
        provider: "crossref",
        title: "Registry Title"
      })]
    })],
    repository: repository({
      async searchStoredLiterature() {
        return [{
          authors: ["A. Author"],
          identifiers: [{ kind: "doi", source: "manual", value: "10.1000/shared" }],
          literatureId: "literature_internal",
          provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "manual" },
          title: "Confirmed Title",
          year: 2026
        }];
      }
    })
  });

  const result = await resolver.resolve(user, { purpose: "forum_compose", query: "10.1000/shared" });

  assert.equal(result.status, "exact");
  assert.equal(result.candidate.candidateKey, "intuecho:literature_internal");
  assert.equal(result.candidate.record.title, "Confirmed Title");
  assert.deepEqual(result.unavailableProviders, []);
});

test("deduplicates Crossref and OpenAlex candidates only through their shared stable identifier", async () => {
  const resolver = createLiteratureResolver({
    providers: [
      provider("openalex", {
        search: async () => [candidate({
          candidateKey: "openalex:openalex_id:W123",
          identifiers: [
            publicIdentifier("openalex_id", "W123"),
            publicIdentifier("doi", "10.1000/shared")
          ],
          provider: "openalex"
        })]
      }),
      provider("crossref", {
        search: async () => [candidate({
          candidateKey: "crossref:doi:10.1000/shared",
          identifiers: [publicIdentifier("doi", "10.1000/shared")],
          provider: "crossref"
        })]
      })
    ],
    repository: repository()
  });

  const result = await resolver.resolve(user, { purpose: "forum_compose", query: "10.1000/shared" });

  assert.equal(result.status, "exact");
  assert.deepEqual(result.candidate.record.identifiers.map((item) => item.kind).sort(), ["doi", "openalex_id"]);
});

test("does not merge a preprint and publication from title similarity alone", async () => {
  const resolver = createLiteratureResolver({
    providers: [
      provider("arxiv", {
        search: async () => [candidate({
          candidateKey: "arxiv:arxiv_id:2401.01234",
          identifiers: [publicIdentifier("arxiv_id", "2401.01234")],
          provider: "arxiv",
          title: "A Shared Title"
        })]
      }),
      provider("crossref", {
        search: async () => [candidate({
          candidateKey: "crossref:doi:10.1000/published",
          identifiers: [publicIdentifier("doi", "10.1000/published")],
          provider: "crossref",
          title: "A Shared Title"
        })]
      })
    ],
    repository: repository()
  });

  const result = await resolver.resolve(user, { purpose: "forum_compose", query: "A Shared Title" });

  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.candidates.map((item) => item.candidateKey), [
    "arxiv:arxiv_id:2401.01234",
    "crossref:doi:10.1000/published"
  ]);
});

test("reports partial provider failure without exposing provider error details", async () => {
  const resolver = createLiteratureResolver({
    providers: [
      provider("crossref", { search: async () => { throw new Error("api key leaked in transport detail"); } }),
      provider("arxiv", {
        search: async () => [candidate({
          candidateKey: "arxiv:arxiv_id:2401.01234",
          identifiers: [publicIdentifier("arxiv_id", "2401.01234")],
          provider: "arxiv"
        })]
      })
    ],
    repository: repository()
  });

  const result = await resolver.resolve(user, { purpose: "forum_compose", query: "partial failure" });

  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.unavailableProviders, ["crossref"]);
  assert.equal(JSON.stringify(result).includes("api key"), false);
});

test("distinguishes an empty provider result from all providers being unavailable", async () => {
  const emptyResolver = createLiteratureResolver({
    providers: [
      provider("openalex"),
      provider("crossref", { search: async () => { throw new Error("unavailable"); } })
    ],
    repository: repository()
  });
  const failingResolver = createLiteratureResolver({
    providers: [
      provider("openalex", { search: async () => { throw new Error("unavailable"); } }),
      provider("crossref", { search: async () => { throw new Error("unavailable"); } }),
      provider("arxiv", { search: async () => { throw new Error("unavailable"); } }),
      provider("semantic_scholar", { search: async () => { throw new Error("unavailable"); } })
    ],
    repository: repository()
  });

  const notFound = await emptyResolver.resolve(user, { purpose: "forum_compose", query: "unindexed" });
  const unavailable = await failingResolver.resolve(user, { purpose: "forum_compose", query: "unreachable" });

  assert.deepEqual(notFound, {
    candidates: [],
    status: "not_found",
    unavailableProviders: ["crossref"]
  });
  assert.deepEqual(unavailable, {
    retryable: true,
    status: "unavailable",
    unavailableProviders: ["openalex", "crossref", "arxiv", "semantic_scholar"]
  });
});

test("re-fetches an external candidate and never accepts the client record", async () => {
  const refetched = candidate({
    candidateKey: "crossref:doi:10.1000/verified",
    identifiers: [publicIdentifier("doi", "10.1000/verified")],
    provider: "crossref",
    title: "Verified Provider Record"
  });
  const resolver = createLiteratureResolver({
    providers: [provider("crossref", {
      async fetchCandidate(candidateKey) {
        assert.equal(candidateKey, "crossref:doi:10.1000/verified");
        return refetched;
      }
    })],
    repository: repository()
  });

  const result = await resolver.confirm(user, {
    candidateKey: "crossref:doi:10.1000/verified",
    mode: "candidate",
    record: { title: "Client-supplied replacement" }
  });

  assert.deepEqual(result, { source: "refetched", title: "Verified Provider Record" });
});

test("reloads internal candidates by literature id before confirming", async () => {
  const resolver = createLiteratureResolver({
    providers: [],
    repository: repository({
      async findLiteratureById(literatureId) {
        assert.equal(literatureId, "literature_existing");
        return {
          authors: ["A. Author"],
          identifiers: [{ kind: "doi", source: "manual", value: "10.1000/existing" }],
          literatureId,
          provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "manual" },
          title: "Existing Confirmed Record",
          year: 2026
        };
      }
    })
  });

  const result = await resolver.confirm(user, {
    candidateKey: "intuecho:literature_existing",
    mode: "candidate",
    record: { title: "Client-supplied replacement" }
  });

  assert.equal(result.literatureId, "literature_existing");
  assert.equal(result.title, "Existing Confirmed Record");
});

test("forwards manual confirmation through the manual-only repository boundary", async () => {
  const resolver = createLiteratureResolver({ providers: [], repository: repository() });

  const result = await resolver.confirm(user, {
    mode: "manual",
    record: {
      authors: ["M. Author"],
      identifiers: [{ kind: "doi", source: "manual", value: "10.1000/manual" }],
      title: "Manual Record",
      year: 2026
    }
  });

  assert.deepEqual(result, { source: "manual", title: "Manual Record" });
});
