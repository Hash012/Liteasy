import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";
import { createLiteratureResolver } from "./literatureResolver.mjs";

const user = { id: "reader-1" };

function publicIdentifier(kind, value) {
  return { kind, source: "public_registry", value };
}

function candidate({ candidateKey, identifiers, provider, relations, title = "A Paper", authors = ["A. Author"], documentType, year = 2026 }) {
  return {
    candidateKey,
    provider,
    record: { authors, ...(documentType ? { documentType } : {}), identifiers, title, year },
    ...(relations ? { relations } : {})
  };
}

function provider(name, { fetchCandidate, search = async () => [] } = {}) {
  return { fetchCandidate, name, search };
}

function repository(overrides = {}) {
  return {
    async confirmRefetchedLiterature(_owner, verifiedCandidate) {
      return { source: "refetched", title: verifiedCandidate.record.title };
    },
    async findLiteratureById() {
      return null;
    },
    async findLiteratureByIdentifiers() {
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
          identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/shared" }],
          literatureId: "literature_internal",
          provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry", provider: "crossref" },
          revision: 1,
          status: "confirmed",
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

test("normalizes DOI URL queries before internal lookup even when providers are offline", async () => {
  const db = new Database(":memory:");
  const literatureRepository = new SqliteAnnotationCommunityRepository(db);
  try {
    const stored = await literatureRepository.confirmRefetchedLiterature(user, {
      candidateKey: "crossref:doi:10.1000/verified",
      provider: "crossref",
      record: {
        authors: ["Ada Lovelace"],
        identifiers: [publicIdentifier("doi", "10.1000/verified")],
        title: "Confirmed DOI Record",
        year: 1843
      }
    });
    const resolver = createLiteratureResolver({
      providers: [provider("crossref", { search: async () => { throw new Error("offline"); } })],
      repository: literatureRepository
    });

    const result = await resolver.resolve(user, {
      purpose: "forum_compose",
      query: "https://doi.org/10.1000/Verified."
    });

    assert.deepEqual(result, {
      candidate: {
        candidateKey: `intuecho:${stored.literatureId}`,
        provider: "intuecho",
        record: {
          authors: ["Ada Lovelace"],
          identifiers: [publicIdentifier("doi", "10.1000/verified")],
          title: "Confirmed DOI Record",
          year: 1843
        }
      },
      confirmationMode: "candidate",
      status: "exact",
      unavailableProviders: []
    });
  } finally {
    db.close();
  }
});

test("normalizes lowercase OpenAlex queries before repository lookup", async () => {
  const resolver = createLiteratureResolver({
    providers: [],
    repository: repository({
      async findLiteratureByIdentifiers(identifiers) {
        assert.deepEqual(identifiers, [{ kind: "openalex_id", value: "W123" }]);
        return {
          authors: ["A. Author"],
          identifiers: [publicIdentifier("openalex_id", "W123")],
          literatureId: "literature-openalex",
          provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry", provider: "openalex" },
          revision: 1,
          status: "confirmed",
          title: "Stored OpenAlex Work"
        };
      }
    })
  });

  const result = await resolver.resolve(user, { purpose: "forum_compose", query: "w123" });

  assert.equal(result.status, "exact");
  assert.equal(result.candidate.candidateKey, "intuecho:literature-openalex");
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
  assert.equal(result.candidate.provider, "crossref");
  assert.deepEqual(result.candidate.record.identifiers.map((item) => item.kind), ["doi"]);
});

test("marks two independently corroborated aggregate candidates as exact", async () => {
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
      provider("semantic_scholar", {
        search: async () => [candidate({
          candidateKey: "semantic_scholar:semantic_scholar_id:corpus:456",
          identifiers: [
            publicIdentifier("semantic_scholar_id", "corpus:456"),
            publicIdentifier("doi", "10.1000/shared")
          ],
          provider: "semantic_scholar"
        })]
      })
    ],
    repository: repository()
  });

  const result = await resolver.resolve(user, {
    hints: {
      authors: ["A. Author"],
      title: "A Paper",
      year: 2026
    },
    purpose: "liteasy_pdf_annotation"
  });

  assert.equal(result.status, "exact");
  assert.equal(result.confirmationMode, "corroborated");
  assert.equal(result.candidate.provider, "openalex");
});

test("rejects an aggregate publication candidate that collapses arXiv and DOI versions", async () => {
  const semanticCandidate = candidate({
    candidateKey: "semantic_scholar:semantic_scholar_id:semantic-123",
    identifiers: [
      publicIdentifier("semantic_scholar_id", "semantic-123"),
      publicIdentifier("doi", "10.1000/shared"),
      publicIdentifier("arxiv_id", "2401.01234")
    ],
    documentType: "publication",
    provider: "semantic_scholar",
    title: "Shared Work"
  });
  const resolver = createLiteratureResolver({
    providers: [
      provider("openalex", {
        search: async () => [candidate({
          candidateKey: "openalex:openalex_id:W123",
          identifiers: [
            publicIdentifier("openalex_id", "W123"),
            publicIdentifier("doi", "10.1000/shared")
          ],
          provider: "openalex",
          title: "Shared Work"
        })]
      }),
      provider("semantic_scholar", {
        fetchCandidate: async (candidateKey) => {
          assert.equal(candidateKey, semanticCandidate.candidateKey);
          return semanticCandidate;
        },
        search: async () => [semanticCandidate]
      })
    ],
    repository: repository()
  });

  const resolved = await resolver.resolve(user, { purpose: "forum_compose", query: "arXiv:2401.01234v2" });

  assert.equal(resolved.status, "ambiguous");
  assert.deepEqual(resolved.candidates.map((item) => item.candidateKey), ["openalex:openalex_id:W123"]);
  await assert.rejects(
    () => resolver.confirm(user, { candidateKey: semanticCandidate.candidateKey, mode: "candidate" }),
    /LITERATURE_CANDIDATE_NOT_FOUND/
  );
});

test("does not manufacture a unique stable-identifier match from conflicting provider records", async () => {
  const resolver = createLiteratureResolver({
    providers: [
      provider("crossref", { search: async () => [candidate({
        candidateKey: "crossref:doi:10.1000/conflict",
        identifiers: [publicIdentifier("doi", "10.1000/conflict")],
        provider: "crossref",
        title: "Verified Title",
        year: 2026
      })] }),
      provider("openalex", { search: async () => [candidate({
        candidateKey: "openalex:openalex_id:W999",
        identifiers: [
          publicIdentifier("openalex_id", "W999"),
          publicIdentifier("doi", "10.1000/conflict")
        ],
        provider: "openalex",
        title: "Spoofed Different Work",
        year: 2024
      })] })
    ],
    repository: repository()
  });

  const result = await resolver.resolve(user, {
    hints: { identifiers: [{ kind: "doi", value: "10.1000/conflict" }] },
    purpose: "liteasy_pdf_annotation"
  });

  assert.equal(result.status, "conflict");
  assert.equal(result.candidates.length, 2);
});

test("honors limit one for internal search, provider aggregation, and final candidates", async () => {
  const observedLimits = [];
  const resolver = createLiteratureResolver({
    providers: [
      provider("crossref", {
        search: async (input) => {
          observedLimits.push(input.limit);
          return [candidate({
            candidateKey: "crossref:doi:10.1000/first",
            identifiers: [publicIdentifier("doi", "10.1000/first")],
            provider: "crossref",
            title: "First external result"
          })];
        }
      }),
      provider("arxiv", {
        search: async (input) => {
          observedLimits.push(input.limit);
          return [candidate({
            candidateKey: "arxiv:arxiv_id:2401.00001",
            identifiers: [publicIdentifier("arxiv_id", "2401.00001")],
            provider: "arxiv",
            title: "Second external result"
          })];
        }
      })
    ],
    repository: repository({
      async searchStoredLiterature(_query, limit) {
        observedLimits.push(limit);
        return [];
      }
    })
  });

  const result = await resolver.resolve(user, {
    limit: 1,
    purpose: "forum_compose",
    query: "bounded results"
  });

  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(observedLimits, [1, 1, 1]);
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

test("auto-confirms only one complete title-year-author-set match regardless of author order", async () => {
  const exact = candidate({
    authors: ["Hopper, Grace", "Ada Lovelace"],
    candidateKey: "crossref:doi:10.1000/exact",
    identifiers: [publicIdentifier("doi", "10.1000/exact")],
    provider: "crossref",
    title: "Exact Identity",
    year: 2026
  });
  const resolver = createLiteratureResolver({
    providers: [provider("crossref", { search: async () => [exact] })],
    repository: repository()
  });

  const result = await resolver.resolve(user, {
    hints: {
      authors: ["Ada Lovelace", "Grace Hopper"],
      title: "Exact Identity",
      year: 2026
    },
    purpose: "liteasy_pdf_annotation"
  });

  assert.equal(result.status, "exact");
  assert.equal(result.candidate.candidateKey, exact.candidateKey);
});

test("keeps partial authors and multiple complete matches ambiguous", async () => {
  const resolver = createLiteratureResolver({
    providers: [provider("crossref", { search: async () => [
      candidate({
        authors: ["Ada Lovelace"],
        candidateKey: "crossref:doi:10.1000/partial",
        identifiers: [publicIdentifier("doi", "10.1000/partial")],
        provider: "crossref",
        title: "Shared Identity"
      }),
      candidate({
        authors: ["Grace Hopper", "Ada Lovelace"],
        candidateKey: "crossref:doi:10.1000/full",
        identifiers: [publicIdentifier("doi", "10.1000/full")],
        provider: "crossref",
        title: "Shared Identity"
      }),
      candidate({
        authors: ["Ada Lovelace", "Grace Hopper"],
        candidateKey: "crossref:doi:10.1000/full-duplicate",
        identifiers: [publicIdentifier("doi", "10.1000/full-duplicate")],
        provider: "crossref",
        title: "Shared Identity"
      })
    ] })],
    repository: repository()
  });

  const result = await resolver.resolve(user, {
    hints: { authors: ["Ada Lovelace", "Grace Hopper"], title: "Shared Identity", year: 2026 },
    purpose: "liteasy_pdf_annotation"
  });

  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 3);
});

test("rejects unrelated broad provider hits from PDF identity candidates", async () => {
  const resolver = createLiteratureResolver({
    providers: [provider("crossref", { search: async () => [candidate({
      authors: ["Unrelated Author"],
      candidateKey: "crossref:doi:10.1000/unrelated",
      identifiers: [publicIdentifier("doi", "10.1000/unrelated")],
      provider: "crossref",
      title: "An Unrelated Paper",
      year: 2024
    })] })],
    repository: repository()
  });

  const result = await resolver.resolve(user, {
    hints: { authors: ["Ada Lovelace"], title: "HelioX", year: 2026 },
    purpose: "liteasy_pdf_annotation"
  });

  assert.deepEqual(result, { candidates: [], status: "not_found", unavailableProviders: [] });
});

test("selects providers by adapter capability for identity and forum search", async () => {
  let calls = 0;
  const searchOnly = {
    capabilities: Object.freeze(["search"]),
    name: "crossref",
    async search() {
      calls += 1;
      return [];
    }
  };
  const resolver = createLiteratureResolver({ providers: [searchOnly], repository: repository() });

  await resolver.resolve(user, {
    hints: { authors: ["Ada Lovelace"], title: "A Paper", year: 2026 },
    purpose: "liteasy_pdf_annotation"
  });
  assert.equal(calls, 0);

  await resolver.resolve(user, { purpose: "forum_compose", query: "A Paper" });
  assert.equal(calls, 1);
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
    relations: [{
      direction: "to_current",
      evidence: { sourceField: "relation.has-preprint" },
      relationType: "is_preprint_of",
      targetIdentifier: { kind: "arxiv_id", value: "2401.01234" }
    }],
    title: "Verified Provider Record"
  });
  let confirmedCandidate;
  const resolver = createLiteratureResolver({
    providers: [provider("crossref", {
      async fetchCandidate(candidateKey) {
        assert.equal(candidateKey, "crossref:doi:10.1000/verified");
        return refetched;
      }
    })],
    repository: repository({
      async confirmRefetchedLiterature(_owner, verifiedCandidate) {
        confirmedCandidate = verifiedCandidate;
        return { source: "refetched", title: verifiedCandidate.record.title };
      }
    })
  });

  const result = await resolver.confirm(user, {
    candidateKey: "crossref:doi:10.1000/verified",
    mode: "candidate",
    record: { title: "Client-supplied replacement" }
  });

  assert.deepEqual(result, { source: "refetched", title: "Verified Provider Record" });
  assert.deepEqual(confirmedCandidate.relations, refetched.relations);
});

test("re-fetches an independent aggregate source before corroborated confirmation", async () => {
  const selected = candidate({
    candidateKey: "openalex:openalex_id:W123",
    identifiers: [
      publicIdentifier("openalex_id", "W123"),
      publicIdentifier("doi", "10.1000/shared")
    ],
    provider: "openalex"
  });
  const corroborating = candidate({
    candidateKey: "semantic_scholar:semantic_scholar_id:corpus:456",
    identifiers: [
      publicIdentifier("semantic_scholar_id", "corpus:456"),
      publicIdentifier("doi", "10.1000/shared")
    ],
    provider: "semantic_scholar"
  });
  let confirmedCandidate;
  const resolver = createLiteratureResolver({
    providers: [
      provider("openalex", { fetchCandidate: async () => selected }),
      provider("semantic_scholar", {
        fetchCandidate: async (candidateKey) => candidateKey === corroborating.candidateKey ? corroborating : null,
        search: async () => [corroborating]
      })
    ],
    repository: repository({
      async confirmRefetchedLiterature(_owner, verifiedCandidate) {
        confirmedCandidate = verifiedCandidate;
        return { source: "refetched", title: verifiedCandidate.record.title };
      }
    })
  });

  await resolver.confirm(user, {
    candidateKey: selected.candidateKey,
    mode: "corroborated"
  });

  assert.deepEqual(confirmedCandidate.corroborations, [corroborating]);
});

test("rejects corroborated confirmation when the independent source no longer agrees", async () => {
  const selected = candidate({
    candidateKey: "openalex:openalex_id:W123",
    identifiers: [publicIdentifier("openalex_id", "W123")],
    provider: "openalex"
  });
  const resolver = createLiteratureResolver({
    providers: [
      provider("openalex", { fetchCandidate: async () => selected }),
      provider("semantic_scholar", { search: async () => [] })
    ],
    repository: repository()
  });

  await assert.rejects(() => resolver.confirm(user, {
    candidateKey: selected.candidateKey,
    mode: "corroborated"
  }), /LITERATURE_CORROBORATION_REQUIRED/);
});

test("rejects user-selected aggregate confirmation after a fresh cross-source conflict", async () => {
  const selected = candidate({
    candidateKey: "openalex:openalex_id:W123",
    identifiers: [
      publicIdentifier("openalex_id", "W123"),
      publicIdentifier("doi", "10.1000/shared")
    ],
    provider: "openalex"
  });
  const conflicting = candidate({
    authors: ["Different Author"],
    candidateKey: "semantic_scholar:semantic_scholar_id:corpus:456",
    identifiers: [
      publicIdentifier("semantic_scholar_id", "corpus:456"),
      publicIdentifier("doi", "10.1000/shared")
    ],
    provider: "semantic_scholar",
    title: "Different Paper",
    year: 2025
  });
  const resolver = createLiteratureResolver({
    providers: [
      provider("openalex", { fetchCandidate: async () => selected }),
      provider("semantic_scholar", {
        fetchCandidate: async () => conflicting,
        search: async () => [conflicting]
      })
    ],
    repository: repository()
  });

  await assert.rejects(() => resolver.confirm(user, {
    candidateKey: selected.candidateKey,
    mode: "candidate"
  }), /LITERATURE_IDENTITY_CONFLICT/);
});

test("reloads internal candidates by literature id before confirming", async () => {
  const resolver = createLiteratureResolver({
    providers: [],
    repository: repository({
      async findLiteratureById(literatureId) {
        assert.equal(literatureId, "literature_existing");
        return {
          authors: ["A. Author"],
          identifiers: [publicIdentifier("doi", "10.1000/existing")],
          literatureId,
          provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "public_registry", provider: "crossref" },
          revision: 1,
          status: "confirmed",
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

test("rejects manual confirmation without a provider candidate key", async () => {
  const resolver = createLiteratureResolver({ providers: [], repository: repository() });

  await assert.rejects(
    () => resolver.confirm(user, { mode: "manual", record: { title: "Manual Record" } }),
    /LITERATURE_CANDIDATE_NOT_FOUND/
  );
});
